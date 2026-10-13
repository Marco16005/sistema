-- Los intentos de clave que no se pueden deshacer.
--
-- Lo que pasaba (lo encontró Codex el 12 de octubre de 2026:
-- docs/revisiones/2026-10-12-codex-revision-de-personas-y-equipos.md, punto 2). comprobar_clave
-- lleva la cuenta de los fallos en la tabla credencial, dentro de la transacción de quien
-- pregunta. Por la pantalla eso basta: cada pedido va en su transacción y se confirma. Pero quien
-- tuviera la contraseña con que la aplicación entra a la base podía probar una clave dentro de una
-- transacción y deshacerla si no pasaba: el fallo no quedaba contado, la clave nunca se bloqueaba
-- y se podía adivinar probando.
--
-- Lo que cambia. La cuenta vive, además, en una secuencia por persona. Una secuencia no es de la
-- transacción: lo que se le escribe se queda aunque todo lo demás se deshaga. comprobar_clave
-- decide con lo que dice la secuencia, no con lo que dice la tabla, y la tabla le sigue: sus tres
-- columnas (fallos, bloqueos, bloqueada_hasta) dicen lo mismo siempre que nadie haya deshecho
-- nada, y un disparador por columna lleva a la secuencia lo que se le escriba a cada una —el
-- fallo, el bloqueo, el acierto que limpia, la clave nueva que la consola o los ajustes ponen—,
-- aunque se le escriba lo mismo que ya decía: el renglón puede haberse quedado atrás.
--
-- Y el intento se aparta ANTES de comparar la clave. Lo encontró Codex al revisar la primera versión
-- de esta migración, el 13 de octubre: si la cuenta se escribía después de comparar, bastaba con que
-- la base abortara la transacción en ese renglón —se consigue con dos conexiones en SERIALIZABLE—
-- para que no se contara nada, y el contexto del error decía cuál de los dos UPDATE era: el de
-- «acertó» o el de «falló». Ahora la secuencia ya trae el fallo contado (o el bloqueo, si es el
-- quinto) cuando se compara; si la clave resulta ser la buena, se pone en cero ahí mismo. Lo que
-- pueda fallar después ya no cambia la cuenta.
--
-- Con eso: cinco claves malas bloquean aunque las cinco se hayan deshecho; un acierto limpia la
-- cuenta aunque lo que siga falle por otra cosa (nadie queda bloqueado por un error que no fue de
-- su clave), y la lista de personas de los ajustes dice quién está bloqueado según la secuencia.
--
-- Lo que no cambia: quien tiene esa contraseña puede seguir bloqueando a alguien a propósito, a
-- fuerza de fallar; ya podía. Y el renglón de la bitácora que anota un bloqueo sí es de la
-- transacción: si quien pregunta la deshace, el bloqueo queda pero su renglón no.
--
-- La aplicación no toca las secuencias: viven en un esquema propio, sin ningún permiso para ella.

CREATE SCHEMA intentos;
REVOKE ALL ON SCHEMA intentos FROM PUBLIC;

-- Los tres datos en un solo número: hasta cuándo está bloqueada, en milisegundos desde 1970 (cero:
-- no lo está), y en las dos últimas cifras los bloqueos seguidos y los fallos, hasta nueve cada
-- uno. De nueve bloqueos seguidos en adelante ya todos duran lo mismo.
CREATE FUNCTION intento_empacado(p_fallos int, p_bloqueos int, p_hasta timestamptz) RETURNS bigint
LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $$
  SELECT CASE WHEN p_hasta IS NULL OR p_hasta = '-infinity' THEN 0
              WHEN p_hasta = 'infinity' THEN 90000000000000
              ELSE least(greatest(ceil(extract(epoch FROM p_hasta) * 1000), 0), 90000000000000)::bigint END * 100
       + least(greatest(coalesce(p_bloqueos, 0), 0), 9) * 10
       + least(greatest(coalesce(p_fallos, 0), 0), 9);
$$;

-- El número que la secuencia de esa persona guarda ahora. Sin secuencia —no tiene credencial—, nada.
CREATE FUNCTION intento_guardado(p_usuario bigint) RETURNS bigint
LANGUAGE plpgsql STABLE SET search_path = public, pg_temp AS $$
DECLARE
  v_secuencia regclass := to_regclass(format('intentos.%I', 'c' || p_usuario));
  v           bigint;
BEGIN
  IF v_secuencia IS NOT NULL THEN
    EXECUTE format('SELECT last_value FROM %s', v_secuencia) INTO v;
  END IF;
  RETURN v;
END $$;

-- Lo mismo, ya separado en sus tres datos.
CREATE FUNCTION intentos_de(p_usuario bigint, OUT fallos int, OUT bloqueos int, OUT bloqueada_hasta timestamptz)
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  SELECT (v % 10)::int, ((v / 10) % 10)::int, CASE WHEN v / 100 > 0 THEN to_timestamp((v / 100) / 1000.0) END
  FROM (SELECT intento_guardado(p_usuario) AS v) x;
$$;

-- Deja ese número en la secuencia de esa persona. Si a la credencial le faltara la suya —datos
-- cargados con los disparadores apagados—, nace aquí: nadie se queda sin poder entrar por eso.
CREATE FUNCTION guardar_intento(p_usuario bigint, p_empacado bigint) RETURNS void
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  v_nombre text := format('intentos.%I', 'c' || p_usuario);
BEGIN
  IF to_regclass(v_nombre) IS NULL THEN
    EXECUTE format('CREATE SEQUENCE %s AS bigint MINVALUE 0 START 0 NO CYCLE', v_nombre);
  END IF;
  PERFORM setval(v_nombre::regclass, p_empacado);
END $$;

-- Lo que se escribe en cada una de las tres columnas pasa a la secuencia, que es la que no se
-- deshace. Va un disparador por columna, y cada uno cambia solo su parte: así escribir una —la
-- consola que levanta un bloqueo— no pisa las otras dos con lo que el renglón traía, que puede
-- haberse quedado atrás. La secuencia nace con la credencial; si el alta se deshace, se deshace
-- con ella.
CREATE FUNCTION credencial_cuenta() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  v_nuevo bigint := intento_empacado(NEW.fallos, NEW.bloqueos, NEW.bloqueada_hasta);
  v       bigint;
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM guardar_intento(NEW.usuario_id, v_nuevo);
    RETURN NULL;
  END IF;
  v := coalesce(intento_guardado(NEW.usuario_id), 0);
  PERFORM guardar_intento(NEW.usuario_id, CASE TG_ARGV[0]
    WHEN 'fallos' THEN v - v % 10 + v_nuevo % 10
    WHEN 'bloqueos' THEN v - (v / 10) % 10 * 10 + (v_nuevo / 10) % 10 * 10
    ELSE v % 100 + v_nuevo / 100 * 100 END);
  RETURN NULL;
END $$;
CREATE TRIGGER credencial_cuenta_nace AFTER INSERT ON credencial
  FOR EACH ROW EXECUTE FUNCTION credencial_cuenta();
CREATE TRIGGER credencial_cuenta_fallos AFTER UPDATE OF fallos ON credencial
  FOR EACH ROW EXECUTE FUNCTION credencial_cuenta('fallos');
CREATE TRIGGER credencial_cuenta_bloqueos AFTER UPDATE OF bloqueos ON credencial
  FOR EACH ROW EXECUTE FUNCTION credencial_cuenta('bloqueos');
CREATE TRIGGER credencial_cuenta_hasta AFTER UPDATE OF bloqueada_hasta ON credencial
  FOR EACH ROW EXECUTE FUNCTION credencial_cuenta('bloqueada_hasta');

-- Las credenciales que ya existen: cada una con su secuencia, en lo que dicen hoy sus columnas.
DO $$
DECLARE
  r credencial;
BEGIN
  FOR r IN SELECT * FROM credencial ORDER BY usuario_id LOOP
    PERFORM guardar_intento(r.usuario_id, intento_empacado(r.fallos, r.bloqueos, r.bloqueada_hasta));
  END LOOP;
END $$;

-- Comprueba una clave y lleva la cuenta de los fallos. Nunca lanza error por una clave mala:
-- contesta falso. Bloquea la credencial mientras decide: cinco intentos a la vez cuentan cinco.
-- Es la de la 0013 con dos cambios: los fallos, los bloqueos seguidos y el bloqueo vigente se leen
-- de la secuencia de la persona, que no se deshace, y no del renglón, que sí; y el intento se
-- aparta en la secuencia antes de comparar la clave, no después.
CREATE OR REPLACE FUNCTION comprobar_clave(p_equipo uuid, p_usuario bigint, p_clave text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  c           credencial;
  v_fallos    int;
  v_bloqueos  int;
  v_bloqueada timestamptz;
  v_bloquea   boolean;
  v_hasta     timestamptz;
BEGIN
  SELECT cr.* INTO c
  FROM credencial cr JOIN usuario u ON u.id = cr.usuario_id
  WHERE cr.usuario_id = p_usuario AND u.activo
  FOR UPDATE OF cr;
  IF FOUND THEN
    -- Sin secuencia todavía (nace al escribirle), la cuenta está en ceros.
    SELECT coalesce(i.fallos, 0), coalesce(i.bloqueos, 0), i.bloqueada_hasta INTO v_fallos, v_bloqueos, v_bloqueada FROM intentos_de(p_usuario) i;
  END IF;
  IF c.usuario_id IS NULL OR p_clave IS NULL OR v_bloqueada > clock_timestamp() THEN
    -- Se hace el mismo trabajo que con una clave de verdad: la respuesta no delata la razón.
    PERFORM extensiones.crypt(coalesce(p_clave, ''), extensiones.gen_salt('bf', 10));
    RETURN false;
  END IF;

  -- El intento se aparta ya, como si fuera a fallar: el quinto bloquea. Va directo a la secuencia
  -- —no espera al renglón ni a sus disparadores— y antes de comparar: de aquí en adelante, lo que
  -- la base aborte, se cancele o se deshaga ya no se lleva la cuenta, ni dice nada que no esté contado.
  v_bloquea := v_fallos + 1 >= 5;
  IF v_bloquea THEN
    v_hasta := clock_timestamp() + CASE v_bloqueos WHEN 0 THEN interval '5 minutes'
                                                   WHEN 1 THEN interval '15 minutes'
                                                   ELSE interval '60 minutes' END;
    PERFORM guardar_intento(p_usuario, intento_empacado(0, v_bloqueos + 1, v_hasta));
  ELSE
    PERFORM guardar_intento(p_usuario, intento_empacado(v_fallos + 1, v_bloqueos, NULL));
  END IF;

  IF c.huella = extensiones.crypt(p_clave, c.huella) THEN
    -- Era la buena: la cuenta, en cero, también directo a la secuencia. El renglón le sigue.
    PERFORM guardar_intento(p_usuario, 0);
    UPDATE credencial SET fallos = 0, bloqueos = 0, bloqueada_hasta = NULL WHERE usuario_id = p_usuario;
    RETURN true;
  END IF;

  -- No lo era. La secuencia ya lo tiene contado; el renglón dice lo mismo.
  IF NOT v_bloquea THEN
    UPDATE credencial SET fallos = v_fallos + 1, bloqueos = v_bloqueos, bloqueada_hasta = NULL WHERE usuario_id = p_usuario;
    RETURN false;
  END IF;
  UPDATE credencial SET fallos = 0, bloqueos = v_bloqueos + 1, bloqueada_hasta = v_hasta WHERE usuario_id = p_usuario;
  PERFORM anotar(p_usuario, 'bloquear', 'credencial', p_usuario::text,
                 jsonb_build_object('equipo', p_equipo, 'hasta', v_hasta, 'bloqueos_seguidos', v_bloqueos + 1));
  RETURN false;
END $$;

-- La lista de personas de los ajustes: quién está bloqueado lo dice la secuencia. Es la de la
-- 0031, letra por letra, salvo ese renglón.
CREATE OR REPLACE FUNCTION personas_para_administrar(p_usuario bigint)
RETURNS TABLE (id bigint, nombre text, rol text, puede_autorizar boolean, activo boolean, bloqueada boolean, adentro_de text, se_administra boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM exigir_quien_administra(p_usuario);
  RETURN QUERY
    SELECT u.id, u.nombre, u.rol, u.puede_autorizar, u.activo,
           u.activo AND coalesce((SELECT i.bloqueada_hasta FROM intentos_de(u.id) i) > clock_timestamp(), false),
           (SELECT e.nombre FROM sesion s JOIN equipo e ON e.id = s.equipo_id
            WHERE s.usuario_id = u.id AND s.cerrada_en IS NULL AND e.baja_en IS NULL
            ORDER BY s.vista_en DESC LIMIT 1),
           u.activo AND u.rol IN ('mostrador', 'patio', 'consulta')
    FROM usuario u LEFT JOIN credencial c ON c.usuario_id = u.id
    WHERE u.sucursal_id = 1
    ORDER BY u.activo DESC, lower(u.nombre), u.id;
END $$;
