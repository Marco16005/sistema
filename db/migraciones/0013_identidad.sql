-- Identidad: quién puede usar la aplicación y cómo demuestra quién es.
--
-- Dos capas. El equipo: solo uno dado de alta, con un código de un solo uso, puede siquiera
-- intentar una clave. La persona: una clave corta, con bloqueo por intentos. La sesión resultante
-- vive aquí, no en la cookie, para que se pueda vencer y cerrar desde el servidor.
--
-- La aplicación no lee ninguna de estas tablas: pregunta por funciones que contestan sí o no.
-- Dar de alta y de baja personas y equipos, y cambiar claves, es de la consola de administración;
-- esas funciones no se le conceden a la aplicación.
--
-- La base nunca guarda una clave, un código ni el secreto de un equipo: guarda sus huellas.

-- En su propio esquema: así el esquema public sigue teniendo solo funciones propias, todas con
-- su ruta de búsqueda fija, y la aplicación no alcanza las de cifrado.
CREATE SCHEMA extensiones;
REVOKE ALL ON SCHEMA extensiones FROM PUBLIC;
CREATE EXTENSION pgcrypto SCHEMA extensiones;

-- En la pantalla la persona se elige por su nombre: entre las activas no puede haber dos iguales.
-- Lo cuida la base, no una comprobación previa, porque dos altas a la vez pasarían las dos.
CREATE UNIQUE INDEX usuario_nombre_activo ON usuario (sucursal_id, lower(btrim(nombre))) WHERE activo;

CREATE TABLE credencial (
  usuario_id      bigint PRIMARY KEY REFERENCES usuario,
  huella          text NOT NULL,                    -- de la clave, con sal y costo
  fallos          int NOT NULL DEFAULT 0 CHECK (fallos >= 0),
  -- Bloqueos seguidos sin un acierto de por medio: cada uno dura más que el anterior.
  bloqueos        int NOT NULL DEFAULT 0 CHECK (bloqueos >= 0),
  bloqueada_hasta timestamptz,
  cambiada_en     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE equipo (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sucursal_id smallint NOT NULL REFERENCES sucursal,
  nombre      text NOT NULL,
  huella      text NOT NULL UNIQUE,                 -- del secreto que el equipo guarda en su cookie
  alta_en     timestamptz NOT NULL DEFAULT now(),
  baja_en     timestamptz
);

CREATE TABLE codigo_alta (
  huella        text PRIMARY KEY,                   -- del código, que solo ve quien lo pidió
  sucursal_id   smallint NOT NULL REFERENCES sucursal,
  nombre_equipo text NOT NULL,
  creado_en     timestamptz NOT NULL DEFAULT now(),
  creado_por    bigint REFERENCES usuario,          -- vacío: la consola
  vence_en      timestamptz NOT NULL,
  usado_en      timestamptz,
  equipo_id     uuid REFERENCES equipo
);

CREATE TABLE sesion (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  equipo_id     uuid NOT NULL REFERENCES equipo,
  usuario_id    bigint NOT NULL REFERENCES usuario,
  abierta_en    timestamptz NOT NULL DEFAULT clock_timestamp(),
  vista_en      timestamptz NOT NULL DEFAULT clock_timestamp(),
  cerrada_en    timestamptz,
  motivo_cierre text,
  CONSTRAINT cierre_con_motivo CHECK ((cerrada_en IS NULL) = (motivo_cierre IS NULL))
);
-- Un equipo, una persona atendiendo a la vez.
CREATE UNIQUE INDEX sesion_una_por_equipo ON sesion (equipo_id) WHERE cerrada_en IS NULL;
CREATE INDEX sesion_de_persona ON sesion (usuario_id) WHERE cerrada_en IS NULL;

-- ── piezas internas ─────────────────────────────────────────────────────────

CREATE FUNCTION huella_de(p_texto text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $$
  SELECT encode(extensiones.digest(p_texto, 'sha256'), 'hex');
$$;

-- Cierra las sesiones abiertas que cumplan la condición dada: de una persona o de un equipo.
CREATE FUNCTION cerrar_sesiones(p_usuario bigint, p_equipo uuid, p_motivo text) RETURNS void
LANGUAGE sql SET search_path = public, pg_temp AS $$
  UPDATE sesion SET cerrada_en = clock_timestamp(), motivo_cierre = p_motivo
  WHERE cerrada_en IS NULL AND (usuario_id = p_usuario OR equipo_id = p_equipo);
$$;

-- La clave de una persona: de cuatro a ocho dígitos; seis o más para quien es responsable o
-- administra, porque su clave autoriza. No se admite la que se adivina sola.
CREATE FUNCTION exigir_clave(p_clave text, p_rol text) RETURNS void
LANGUAGE plpgsql IMMUTABLE SET search_path = public, pg_temp AS $$
DECLARE
  v_minimo int := CASE WHEN p_rol IN ('responsable', 'administracion') THEN 6 ELSE 4 END;
BEGIN
  IF p_clave IS NULL OR p_clave !~ '^[0-9]{4,8}$' THEN
    RAISE EXCEPTION 'La clave es de cuatro a ocho dígitos' USING ERRCODE = 'RC005';
  END IF;
  IF char_length(p_clave) < v_minimo THEN
    RAISE EXCEPTION 'La clave de quien es % lleva al menos % dígitos', p_rol, v_minimo USING ERRCODE = 'RC005';
  END IF;
  IF p_clave ~ '^(.)\1+$'
     OR position(p_clave IN '0123456789') > 0
     OR position(p_clave IN '9876543210') > 0 THEN
    RAISE EXCEPTION 'Esa clave se adivina sola: ni un mismo dígito repetido ni una escalera' USING ERRCODE = 'RC005';
  END IF;
END $$;

-- Comprueba una clave y lleva la cuenta de los fallos. Nunca lanza error por una clave mala:
-- contesta falso, para que el fallo quede contado aunque lo que siga se deshaga.
-- Bloquea la credencial mientras decide: cinco intentos a la vez cuentan cinco.
CREATE FUNCTION comprobar_clave(p_equipo uuid, p_usuario bigint, p_clave text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  c       credencial;
  v_hasta timestamptz;
BEGIN
  SELECT cr.* INTO c
  FROM credencial cr JOIN usuario u ON u.id = cr.usuario_id
  WHERE cr.usuario_id = p_usuario AND u.activo
  FOR UPDATE OF cr;
  IF NOT FOUND OR p_clave IS NULL OR c.bloqueada_hasta > clock_timestamp() THEN
    -- Se hace el mismo trabajo que con una clave de verdad: la respuesta no delata la razón.
    PERFORM extensiones.crypt(coalesce(p_clave, ''), extensiones.gen_salt('bf', 10));
    RETURN false;
  END IF;

  IF c.huella = extensiones.crypt(p_clave, c.huella) THEN
    UPDATE credencial SET fallos = 0, bloqueos = 0, bloqueada_hasta = NULL WHERE usuario_id = p_usuario;
    RETURN true;
  END IF;

  IF c.fallos + 1 < 5 THEN
    UPDATE credencial SET fallos = c.fallos + 1, bloqueada_hasta = NULL WHERE usuario_id = p_usuario;
    RETURN false;
  END IF;
  v_hasta := clock_timestamp() + CASE c.bloqueos WHEN 0 THEN interval '5 minutes'
                                                 WHEN 1 THEN interval '15 minutes'
                                                 ELSE interval '60 minutes' END;
  UPDATE credencial SET fallos = 0, bloqueos = c.bloqueos + 1, bloqueada_hasta = v_hasta WHERE usuario_id = p_usuario;
  PERFORM anotar(p_usuario, 'bloquear', 'credencial', p_usuario::text,
                 jsonb_build_object('equipo', p_equipo, 'hasta', v_hasta, 'bloqueos_seguidos', c.bloqueos + 1));
  RETURN false;
END $$;

-- ── lo que la aplicación puede preguntar ────────────────────────────────────

-- El equipo que presenta esa huella, si está dado de alta y no de baja.
CREATE FUNCTION equipo_vigente(p_huella text) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT id FROM equipo WHERE huella = p_huella AND baja_en IS NULL;
$$;

-- Canjea un código de alta por un equipo. Devuelve el equipo, o nada si el código no sirve:
-- equivocado, vencido y ya usado se ven igual. El código se gasta en la misma instrucción que lo
-- comprueba, así dos canjes a la vez dan un solo equipo.
CREATE FUNCTION canjear_codigo(p_codigo text, p_huella text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  k             codigo_alta;
  v_equipo      uuid;
  v_restriccion text;
BEGIN
  IF p_huella IS NULL OR p_huella !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'El equipo no presentó una huella válida' USING ERRCODE = 'RC005';
  END IF;
  IF EXISTS (SELECT 1 FROM equipo WHERE huella = p_huella) THEN
    RAISE EXCEPTION 'Ese equipo ya está dado de alta' USING ERRCODE = 'RC005';
  END IF;
  UPDATE codigo_alta SET usado_en = clock_timestamp()
  WHERE huella = huella_de(upper(regexp_replace(coalesce(p_codigo, ''), '[\s-]', '', 'g')))
    AND usado_en IS NULL AND vence_en > clock_timestamp()
  RETURNING * INTO k;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  BEGIN
    INSERT INTO equipo (sucursal_id, nombre, huella) VALUES (k.sucursal_id, k.nombre_equipo, p_huella) RETURNING id INTO v_equipo;
  EXCEPTION WHEN unique_violation THEN
    -- Otro canje dio de alta esa misma huella mientras este esperaba. El error deshace también el
    -- gasto del código, que queda sin usar.
    GET STACKED DIAGNOSTICS v_restriccion = CONSTRAINT_NAME;
    IF v_restriccion = 'equipo_huella_key' THEN
      RAISE EXCEPTION 'Ese equipo ya está dado de alta' USING ERRCODE = 'RC005';
    END IF;
    RAISE;
  END;
  UPDATE codigo_alta SET equipo_id = v_equipo WHERE huella = k.huella;
  PERFORM anotar(k.creado_por, 'alta', 'equipo', v_equipo::text, jsonb_build_object('nombre', k.nombre_equipo));
  RETURN v_equipo;
END $$;

-- La persona entra en ese equipo. Devuelve la sesión, o nada si no entró —sin decir por qué.
-- Quien estaba atendiendo en ese equipo deja de estarlo.
CREATE FUNCTION entrar(p_huella text, p_usuario bigint, p_clave text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_equipo uuid;
  v_sesion uuid;
BEGIN
  -- El equipo se bloquea antes de comprobar la clave: dos personas entrando a la vez al mismo
  -- equipo pasan de una en una, y la segunda releva a la primera en vez de chocar con ella.
  -- El orden de candados de la identidad es siempre equipo, credencial, sesión.
  SELECT id INTO v_equipo FROM equipo WHERE huella = p_huella AND baja_en IS NULL FOR UPDATE;
  IF NOT FOUND OR NOT comprobar_clave(v_equipo, p_usuario, p_clave) THEN
    RETURN NULL;
  END IF;
  PERFORM cerrar_sesiones(NULL, v_equipo, 'relevo');
  INSERT INTO sesion (equipo_id, usuario_id) VALUES (v_equipo, p_usuario) RETURNING id INTO v_sesion;
  RETURN v_sesion;
END $$;

-- Comprueba la clave de una persona en el momento, sin abrir sesión: es como se autoriza.
CREATE FUNCTION verificar_clave(p_huella text, p_usuario bigint, p_clave text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_equipo uuid := equipo_vigente(p_huella);
BEGIN
  RETURN v_equipo IS NOT NULL AND comprobar_clave(v_equipo, p_usuario, p_clave);
END $$;

-- Quién atiende en esa sesión, si sigue vigente; y de paso la cuenta como actividad.
-- Si ya venció —por inactividad o por duración— la cierra, y cerrada no revive.
CREATE FUNCTION sesion_vigente(p_huella text, p_sesion uuid,
                               p_inactividad interval DEFAULT interval '30 minutes',
                               p_duracion interval DEFAULT interval '12 hours')
RETURNS TABLE (usuario_id bigint, nombre text, rol text, puede_autorizar boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  s        sesion;
  v_equipo uuid := equipo_vigente(p_huella);
  v_motivo text;
BEGIN
  IF v_equipo IS NULL THEN
    RETURN;
  END IF;
  SELECT * INTO s FROM sesion se WHERE se.id = p_sesion AND se.equipo_id = v_equipo AND se.cerrada_en IS NULL FOR UPDATE;
  IF NOT FOUND THEN
    RETURN;
  END IF;
  v_motivo := CASE
    WHEN clock_timestamp() - s.vista_en > p_inactividad THEN 'inactividad'
    WHEN clock_timestamp() - s.abierta_en > p_duracion THEN 'duración'
    WHEN NOT EXISTS (SELECT 1 FROM usuario u WHERE u.id = s.usuario_id AND u.activo) THEN 'baja'
  END;
  IF v_motivo IS NOT NULL THEN
    UPDATE sesion se SET cerrada_en = clock_timestamp(), motivo_cierre = v_motivo WHERE se.id = s.id;
    RETURN;
  END IF;
  UPDATE sesion se SET vista_en = clock_timestamp() WHERE se.id = s.id;
  RETURN QUERY SELECT u.id, u.nombre, u.rol, u.puede_autorizar FROM usuario u WHERE u.id = s.usuario_id;
END $$;

CREATE FUNCTION salir(p_huella text, p_sesion uuid) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  UPDATE sesion SET cerrada_en = clock_timestamp(), motivo_cierre = 'salida'
  WHERE id = p_sesion AND cerrada_en IS NULL AND equipo_id = equipo_vigente(p_huella);
$$;

-- ── la consola de administración ────────────────────────────────────────────
-- p_autor es la persona que lo pide cuando lo pide alguien dado de alta; vacío, la consola.

CREATE FUNCTION fijar_clave(p_usuario bigint, p_clave text, p_autor bigint DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  u usuario;
BEGIN
  SELECT * INTO u FROM usuario WHERE id = p_usuario;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'La persona % no existe', p_usuario USING ERRCODE = 'RC005';
  END IF;
  PERFORM exigir_clave(p_clave, u.rol);
  INSERT INTO credencial (usuario_id, huella) VALUES (p_usuario, extensiones.crypt(p_clave, extensiones.gen_salt('bf', 10)))
  ON CONFLICT (usuario_id) DO UPDATE
    SET huella = EXCLUDED.huella, fallos = 0, bloqueos = 0, bloqueada_hasta = NULL, cambiada_en = clock_timestamp();
  -- Quien tenía la clave anterior ya no sigue adentro.
  PERFORM cerrar_sesiones(p_usuario, NULL, 'cambio de clave');
  PERFORM anotar(p_autor, 'clave', 'credencial', p_usuario::text);
END $$;

CREATE FUNCTION alta_persona(p_nombre text, p_rol text, p_puede_autorizar boolean, p_clave text,
                             p_autor bigint DEFAULT NULL) RETURNS usuario
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  u             usuario;
  v_nombre      text := btrim(coalesce(p_nombre, ''));
  v_restriccion text;
BEGIN
  IF v_nombre = '' OR char_length(v_nombre) > 40 THEN
    RAISE EXCEPTION 'El nombre de la persona lleva de una a 40 letras' USING ERRCODE = 'RC005';
  END IF;
  IF p_rol IS NULL OR p_rol NOT IN ('responsable', 'mostrador', 'patio', 'consulta', 'administracion') THEN
    RAISE EXCEPTION 'El rol % no existe', p_rol USING ERRCODE = 'RC005';
  END IF;
  IF coalesce(p_puede_autorizar, false) AND p_rol <> 'responsable' THEN
    RAISE EXCEPTION 'Solo un responsable puede autorizar' USING ERRCODE = 'RC005';
  END IF;
  -- En la pantalla la persona se elige por su nombre: no puede haber dos iguales.
  IF EXISTS (SELECT 1 FROM usuario WHERE activo AND lower(btrim(nombre)) = lower(v_nombre)) THEN
    RAISE EXCEPTION 'Ya hay una persona activa que se llama %', v_nombre USING ERRCODE = 'RC005';
  END IF;
  PERFORM exigir_clave(p_clave, p_rol);
  PERFORM set_config('feruga.usuario', coalesce(p_autor::text, ''), true);
  BEGIN
    INSERT INTO usuario (sucursal_id, nombre, rol, puede_autorizar)
    VALUES (1, v_nombre, p_rol, coalesce(p_puede_autorizar, false)) RETURNING * INTO u;
  EXCEPTION WHEN unique_violation THEN
    -- Otra alta con ese nombre se adelantó mientras esta esperaba.
    GET STACKED DIAGNOSTICS v_restriccion = CONSTRAINT_NAME;
    IF v_restriccion = 'usuario_nombre_activo' THEN
      RAISE EXCEPTION 'Ya hay una persona activa que se llama %', v_nombre USING ERRCODE = 'RC005';
    END IF;
    RAISE;
  END;
  PERFORM fijar_clave(u.id, p_clave, p_autor);
  RETURN u;
END $$;

CREATE FUNCTION baja_persona(p_usuario bigint, p_autor bigint DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM set_config('feruga.usuario', coalesce(p_autor::text, ''), true);
  UPDATE usuario SET activo = false, puede_autorizar = false WHERE id = p_usuario AND activo;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'La persona % no existe o ya estaba dada de baja', p_usuario USING ERRCODE = 'RC005';
  END IF;
  PERFORM cerrar_sesiones(p_usuario, NULL, 'baja');
  PERFORM anotar(p_autor, 'baja', 'usuario', p_usuario::text);
END $$;

-- Genera un código para dar de alta un equipo y lo devuelve: es la única vez que se ve.
-- Diez caracteres de un alfabeto de 32 sin letras que se confundan: 50 bits, quince minutos.
CREATE FUNCTION crear_codigo_alta(p_nombre_equipo text, p_autor bigint DEFAULT NULL,
                                  p_vigencia interval DEFAULT interval '15 minutes') RETURNS text
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  ALFABETO CONSTANT text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_azar   bytea := extensiones.gen_random_bytes(10);
  v_codigo text := '';
  v_nombre text := btrim(coalesce(p_nombre_equipo, ''));
BEGIN
  IF v_nombre = '' OR char_length(v_nombre) > 40 THEN
    RAISE EXCEPTION 'El nombre del equipo lleva de una a 40 letras' USING ERRCODE = 'RC005';
  END IF;
  FOR k IN 0..9 LOOP
    v_codigo := v_codigo || substr(ALFABETO, (get_byte(v_azar, k) & 31) + 1, 1);
  END LOOP;
  INSERT INTO codigo_alta (huella, sucursal_id, nombre_equipo, creado_por, vence_en)
  VALUES (huella_de(v_codigo), 1, v_nombre, p_autor, clock_timestamp() + p_vigencia);
  RETURN v_codigo;
END $$;

CREATE FUNCTION baja_equipo(p_equipo uuid, p_autor bigint DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  UPDATE equipo SET baja_en = clock_timestamp() WHERE id = p_equipo AND baja_en IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ese equipo no existe o ya estaba dado de baja' USING ERRCODE = 'RC005';
  END IF;
  PERFORM cerrar_sesiones(NULL, p_equipo, 'baja de equipo');
  PERFORM anotar(p_autor, 'baja', 'equipo', p_equipo::text);
END $$;

-- ── permisos ────────────────────────────────────────────────────────────────
-- La aplicación no recibe nada sobre las tablas, ni lectura. Solo estas preguntas.

GRANT EXECUTE ON FUNCTION
  equipo_vigente(text),
  canjear_codigo(text, text),
  entrar(text, bigint, text),
  verificar_clave(text, bigint, text),
  sesion_vigente(text, uuid, interval, interval),
  salir(text, uuid)
TO feruga_app;
