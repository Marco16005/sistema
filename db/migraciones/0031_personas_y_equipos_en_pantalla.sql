-- Personas y equipos desde la pantalla.
--
-- Hasta aquí, dar de alta y de baja personas y equipos, y cambiar claves, era solo de la consola
-- de administración, que corre con otras credenciales (0013): la aplicación no podía hacerlo, y
-- así quien se metiera a ella no podía fabricarse un jefe. El 12 de octubre de 2026 el dueño
-- decidió un punto medio, porque para contratar a alguien de mostrador no debería hacer falta la
-- consola:
--
--   · Lo pide un RESPONSABLE FACULTADO PARA AUTORIZAR, y lo demuestra con su clave en ese momento,
--     desde un equipo dado de alta: la misma comprobación de toda autorización (0017), con su
--     misma cuenta de intentos y su mismo bloqueo. Tener la sesión abierta no basta.
--   · Desde la pantalla se da de alta, se da de baja y se le cambia la clave a personas de
--     MOSTRADOR, de PATIO y de CONSULTA; y se dan de alta y de baja equipos.
--   · Los responsables, quien administra y la facultad de autorizar siguen siendo de la consola:
--     ninguna función de aquí crea a uno, le cambia la clave ni lo da de baja. Lo que una sesión
--     robada más una clave robada pueden hacer es contratar o despedir a un cajero, no nombrar a
--     quien autoriza.
--
-- Las funciones de la consola (alta_persona, fijar_clave, baja_persona, crear_codigo_alta,
-- baja_equipo) no cambian ni se le conceden a la aplicación: las de aquí las llaman por dentro,
-- después de comprobar quién pide y qué pide, y con esa persona como autora, para que la bitácora
-- diga quién fue.
--
-- El orden en cada una es el de siempre: lo que no procede se rechaza ANTES de mirar la clave, y
-- no gasta un intento; una clave que no pasa NO es un error —la función contesta «no» (nada, o
-- falso)—, para que el intento quede contado aunque no se haga nada más.
--
-- Errores:
--   RC005 · lo que se pide no tiene forma: un nombre vacío o repetido, una clave que no vale, una
--           persona o un equipo que no existen o ya estaban de baja, el equipo desde el que se pide
--   RC008 · quien pide no es un responsable facultado; o lo que pide es de la consola (un
--           responsable, quien administra)

-- Quien pide: un responsable activo y facultado para autorizar. Lo demás no pasa de aquí.
CREATE FUNCTION exigir_quien_administra(p_usuario bigint) RETURNS usuario
LANGUAGE plpgsql STABLE SET search_path = public, pg_temp AS $$
DECLARE
  u usuario;
BEGIN
  u := exigir_rol(p_usuario, 'responsable');
  IF NOT u.puede_autorizar THEN
    RAISE EXCEPTION 'Dar de alta y de baja personas y equipos le toca a un responsable facultado para autorizar' USING ERRCODE = 'RC008';
  END IF;
  RETURN u;
END $$;

-- La persona sobre la que se pide algo: activa, y de las que se administran desde la pantalla.
CREATE FUNCTION persona_que_se_administra(p_persona bigint) RETURNS usuario
LANGUAGE plpgsql STABLE SET search_path = public, pg_temp AS $$
DECLARE
  u usuario;
BEGIN
  SELECT * INTO u FROM usuario WHERE id = p_persona AND sucursal_id = 1;
  IF NOT FOUND OR NOT u.activo THEN
    RAISE EXCEPTION 'Esa persona no existe o ya estaba dada de baja' USING ERRCODE = 'RC005';
  END IF;
  IF u.rol NOT IN ('mostrador', 'patio', 'consulta') THEN
    RAISE EXCEPTION 'A % no se le cambia nada desde la pantalla: lo de un responsable y lo de quien administra se hace por la consola', u.nombre
      USING ERRCODE = 'RC008';
  END IF;
  RETURN u;
END $$;

-- ── las listas ──────────────────────────────────────────────────────────────

-- Todas las personas: las activas por nombre, y al final las dadas de baja. De cada una, si está
-- bloqueada por intentos, en qué equipo tiene sesión abierta, y si se administra desde la pantalla.
-- Nunca su clave ni la huella de su clave.
CREATE FUNCTION personas_para_administrar(p_usuario bigint)
RETURNS TABLE (id bigint, nombre text, rol text, puede_autorizar boolean, activo boolean, bloqueada boolean, adentro_de text, se_administra boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM exigir_quien_administra(p_usuario);
  RETURN QUERY
    SELECT u.id, u.nombre, u.rol, u.puede_autorizar, u.activo,
           u.activo AND coalesce(c.bloqueada_hasta > clock_timestamp(), false),
           (SELECT e.nombre FROM sesion s JOIN equipo e ON e.id = s.equipo_id
            WHERE s.usuario_id = u.id AND s.cerrada_en IS NULL AND e.baja_en IS NULL
            ORDER BY s.vista_en DESC LIMIT 1),
           u.activo AND u.rol IN ('mostrador', 'patio', 'consulta')
    FROM usuario u LEFT JOIN credencial c ON c.usuario_id = u.id
    WHERE u.sucursal_id = 1
    ORDER BY u.activo DESC, lower(u.nombre), u.id;
END $$;

-- Todos los equipos: los vigentes por nombre, y al final los dados de baja. De cada uno, quién
-- atiende en él ahora y si es el equipo desde el que se pregunta. Nunca su huella.
CREATE FUNCTION equipos_para_administrar(p_huella text, p_usuario bigint)
RETURNS TABLE (id uuid, nombre text, alta_el date, activo boolean, atiende text, es_este boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM exigir_quien_administra(p_usuario);
  RETURN QUERY
    SELECT e.id, e.nombre, (e.alta_en AT TIME ZONE su.zona)::date, e.baja_en IS NULL,
           (SELECT u.nombre FROM sesion s JOIN usuario u ON u.id = s.usuario_id
            WHERE s.equipo_id = e.id AND s.cerrada_en IS NULL AND e.baja_en IS NULL LIMIT 1),
           e.baja_en IS NULL AND e.huella = p_huella
    FROM equipo e JOIN sucursal su ON su.id = e.sucursal_id
    WHERE e.sucursal_id = 1
    ORDER BY (e.baja_en IS NULL) DESC, lower(e.nombre), e.alta_en, e.id;
END $$;

-- ── personas ────────────────────────────────────────────────────────────────

-- Da de alta a una persona de mostrador, de patio o de consulta, con la clave que se le va a
-- entregar. Devuelve su número; nada si la clave de quien lo pide no pasó.
CREATE FUNCTION alta_de_persona(p_huella text, p_usuario bigint, p_clave text, p_nombre text, p_rol text, p_clave_nueva text) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_nombre text := btrim(coalesce(p_nombre, ''));
  u        usuario;
BEGIN
  PERFORM exigir_quien_administra(p_usuario);
  IF p_rol IN ('responsable', 'administracion') THEN
    RAISE EXCEPTION 'A un responsable y a quien administra se les da de alta por la consola, no desde la pantalla' USING ERRCODE = 'RC008';
  END IF;
  IF p_rol IS NULL OR p_rol NOT IN ('mostrador', 'patio', 'consulta') THEN
    RAISE EXCEPTION 'Desde la pantalla se da de alta a personas de mostrador, de patio o de consulta' USING ERRCODE = 'RC005';
  END IF;
  -- Lo mismo que comprobará alta_persona, pero antes de mirar la clave de quien lo pide.
  IF v_nombre = '' OR char_length(v_nombre) > 40 THEN
    RAISE EXCEPTION 'El nombre de la persona lleva de una a 40 letras' USING ERRCODE = 'RC005';
  END IF;
  IF EXISTS (SELECT 1 FROM usuario WHERE activo AND lower(btrim(nombre)) = lower(v_nombre)) THEN
    RAISE EXCEPTION 'Ya hay una persona activa que se llama %', v_nombre USING ERRCODE = 'RC005';
  END IF;
  PERFORM exigir_clave(p_clave_nueva, p_rol);

  IF NOT autorizo_con_clave(p_huella, p_usuario, p_clave) THEN
    RETURN NULL;
  END IF;
  u := alta_persona(v_nombre, p_rol, false, p_clave_nueva, p_usuario);
  RETURN u.id;
END $$;

-- Le pone una clave nueva a una persona de mostrador, de patio o de consulta: la anterior deja de
-- servir, se cierran sus sesiones y se le quita el bloqueo. Falso si la clave de quien lo pide no pasó.
CREATE FUNCTION cambiar_clave_de_persona(p_huella text, p_usuario bigint, p_clave text, p_persona bigint, p_clave_nueva text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  u usuario;
BEGIN
  PERFORM exigir_quien_administra(p_usuario);
  u := persona_que_se_administra(p_persona);
  PERFORM exigir_clave(p_clave_nueva, u.rol);

  IF NOT autorizo_con_clave(p_huella, p_usuario, p_clave) THEN
    RETURN false;
  END IF;
  -- Pudo cambiar mientras se comprobaba la clave: se vuelve a mirar, ya con ella bloqueada.
  PERFORM 1 FROM usuario WHERE id = p_persona FOR UPDATE;
  u := persona_que_se_administra(p_persona);
  PERFORM fijar_clave(u.id, p_clave_nueva, p_usuario);
  RETURN true;
END $$;

-- Da de baja a una persona de mostrador, de patio o de consulta: ya no entra, y su sesión se
-- cierra. Su historia se conserva. Falso si la clave de quien lo pide no pasó.
CREATE FUNCTION baja_de_persona(p_huella text, p_usuario bigint, p_clave text, p_persona bigint) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  u usuario;
BEGIN
  PERFORM exigir_quien_administra(p_usuario);
  u := persona_que_se_administra(p_persona);

  IF NOT autorizo_con_clave(p_huella, p_usuario, p_clave) THEN
    RETURN false;
  END IF;
  PERFORM 1 FROM usuario WHERE id = p_persona FOR UPDATE;
  u := persona_que_se_administra(p_persona);
  PERFORM baja_persona(u.id, p_usuario);
  RETURN true;
END $$;

-- ── equipos ─────────────────────────────────────────────────────────────────

-- Un código para dar de alta un equipo nuevo: se ve una sola vez, sirve una vez y vence en quince
-- minutos. Que se pidió queda anotado —sin el código—; el alta del equipo se anota al canjearlo.
-- Nada si la clave de quien lo pide no pasó.
CREATE FUNCTION codigo_para_equipo(p_huella text, p_usuario bigint, p_clave text, p_nombre text) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_nombre text := btrim(coalesce(p_nombre, ''));
  v_codigo text;
BEGIN
  PERFORM exigir_quien_administra(p_usuario);
  IF v_nombre = '' OR char_length(v_nombre) > 40 THEN
    RAISE EXCEPTION 'El nombre del equipo lleva de una a 40 letras' USING ERRCODE = 'RC005';
  END IF;

  IF NOT autorizo_con_clave(p_huella, p_usuario, p_clave) THEN
    RETURN NULL;
  END IF;
  v_codigo := crear_codigo_alta(v_nombre, p_usuario);
  PERFORM anotar(p_usuario, 'codigo', 'equipo', NULL, jsonb_build_object('nombre', v_nombre));
  RETURN v_codigo;
END $$;

-- Da de baja un equipo: deja de valer y se cierra la sesión de quien atendía en él. No el equipo
-- desde el que se pide: quien lo pide se quedaría afuera a media acción, y si era el último, nadie
-- podría volver a entrar sin la consola. Falso si la clave de quien lo pide no pasó.
CREATE FUNCTION baja_de_equipo(p_huella text, p_usuario bigint, p_clave text, p_equipo uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  e equipo;
BEGIN
  PERFORM exigir_quien_administra(p_usuario);
  SELECT * INTO e FROM equipo WHERE id = p_equipo AND sucursal_id = 1;
  IF NOT FOUND OR e.baja_en IS NOT NULL THEN
    RAISE EXCEPTION 'Ese equipo no existe o ya estaba dado de baja' USING ERRCODE = 'RC005';
  END IF;
  IF e.huella = p_huella THEN
    RAISE EXCEPTION 'Este es el equipo desde el que lo pides: se da de baja desde otro' USING ERRCODE = 'RC005';
  END IF;

  IF NOT autorizo_con_clave(p_huella, p_usuario, p_clave) THEN
    RETURN false;
  END IF;
  PERFORM baja_equipo(p_equipo, p_usuario);
  RETURN true;
END $$;

-- ── permisos ────────────────────────────────────────────────────────────────
-- Las dos piezas internas se quedan cerradas; la aplicación recibe las siete preguntas.

REVOKE ALL ON FUNCTION exigir_quien_administra(bigint), persona_que_se_administra(bigint) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION
  personas_para_administrar(bigint),
  equipos_para_administrar(text, bigint),
  alta_de_persona(text, bigint, text, text, text, text),
  cambiar_clave_de_persona(text, bigint, text, bigint, text),
  baja_de_persona(text, bigint, text, bigint),
  codigo_para_equipo(text, bigint, text, text),
  baja_de_equipo(text, bigint, text, uuid)
TO feruga_app;
