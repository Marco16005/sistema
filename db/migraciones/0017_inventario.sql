-- Las entradas de inventario: contar, dar merma, separar material y corregir lo ya asentado.
--
-- El núcleo ya sabía hacer estas cosas, pero sus funciones no eran para llamarse desde la
-- aplicación: repetidas se asentaban dos veces, redondeaban en silencio, y la corrección de
-- material movía la cantidad original aunque antes se hubiera corregido el peso. Aquí cada acción
-- tiene su entrada, con las mismas garantías que las del mostrador:
--
--   · recibe a la persona y comprueba su rol;
--   · valida forma y rango antes de tocar una columna, y contesta con códigos RC;
--   · se puede repetir: el mismo envío devuelve lo que ya hizo, y con otro contenido se rechaza;
--   · cuando pide autorización, comprueba ella misma la clave de quien autoriza, en la misma
--     transacción en que escribe. Si la clave no pasa contesta «no» sin lanzar error, de modo que el
--     intento fallido queda contado. Lo que no procede se rechaza antes de mirar la clave.
--
-- Corregir es una sola cosa: decir cómo debió quedar el movimiento. Las dos funciones viejas que
-- corregían sumando una cantidad suelta o moviendo la cantidad original se eliminan.

-- ── lo que ya llegó, y qué produjo ──────────────────────────────────────────

ALTER TABLE envio DROP CONSTRAINT envio_clase_check;
ALTER TABLE envio ADD CONSTRAINT envio_clase_check
  CHECK (clase IN ('cuenta', 'material', 'conteo', 'merma', 'separacion', 'correccion'));

-- Qué dejó cada envío de inventario, para devolverlo igual si el envío se repite. Va aparte de los
-- libros, que no se tocan. De una corrección se guardan el original y los ajustes que asentó; la
-- lista va vacía cuando el movimiento ya estaba como se pidió.
CREATE TABLE envio_resultado (
  envio_id          uuid PRIMARY KEY REFERENCES envio,
  conteo_id         bigint REFERENCES conteo,
  movimiento_id     bigint REFERENCES movimiento_inventario,
  transformacion_id uuid REFERENCES transformacion,
  ajustes           bigint[],
  CONSTRAINT un_resultado CHECK (num_nonnulls(conteo_id, movimiento_id, transformacion_id) = 1),
  CONSTRAINT ajustes_solo_de_correccion CHECK (ajustes IS NULL OR movimiento_id IS NOT NULL)
);
CREATE TRIGGER envio_resultado_inmutable BEFORE UPDATE OR DELETE ON envio_resultado
  FOR EACH ROW EXECUTE FUNCTION rechazar_cambio();
CREATE TRIGGER envio_resultado_sin_vaciar BEFORE TRUNCATE ON envio_resultado
  FOR EACH STATEMENT EXECUTE FUNCTION rechazar_cambio();

-- Las correcciones de un movimiento se buscan por el original.
CREATE INDEX movimiento_por_referencia ON movimiento_inventario (referencia_id) WHERE referencia_id IS NOT NULL;

-- ── piezas comunes ──────────────────────────────────────────────────────────

-- Kilos que pueden ser cero: lo contado (el material se acabó) y el objetivo de una corrección
-- (no debió registrarse). Para todo lo demás está exigir_kilos, que pide más de cero.
CREATE FUNCTION exigir_kilos_o_cero(p_kg numeric) RETURNS void
LANGUAGE plpgsql IMMUTABLE SET search_path = public, pg_temp AS $$
BEGIN
  IF p_kg IS NULL OR p_kg IN ('NaN', 'Infinity', '-Infinity') THEN
    RAISE EXCEPTION 'Los kilos tienen que ser un número' USING ERRCODE = 'RC004';
  END IF;
  IF p_kg < 0 THEN
    RAISE EXCEPTION 'Los kilos no pueden ser negativos' USING ERRCODE = 'RC004';
  END IF;
  IF p_kg > 999999 THEN
    RAISE EXCEPTION 'Los kilos no pueden pasar de 999 999' USING ERRCODE = 'RC004';
  END IF;
  IF p_kg <> round(p_kg, 3) THEN
    RAISE EXCEPTION 'Los kilos llevan hasta tres decimales y llegó %', p_kg USING ERRCODE = 'RC004';
  END IF;
END $$;

-- Un motivo o una nota: sin espacios de sobra; vacío si no dice nada.
CREATE FUNCTION texto_limpio(p_texto text, p_que text) RETURNS text
LANGUAGE plpgsql IMMUTABLE SET search_path = public, pg_temp AS $$
DECLARE
  v text := nullif(btrim(p_texto), '');
BEGIN
  IF char_length(v) > 200 THEN
    RAISE EXCEPTION '% lleva hasta 200 letras', p_que USING ERRCODE = 'RC005';
  END IF;
  RETURN v;
END $$;

-- ¿Autorizó de verdad esa persona? Primero, que sea de las facultadas: si no lo es se rechaza sin
-- mirar su clave. Después su clave, desde un equipo dado de alta. Contesta sí o no; el no deja
-- contado el intento.
CREATE FUNCTION autorizo_con_clave(p_huella text, p_autoriza bigint, p_clave text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_equipo uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM usuario WHERE id = p_autoriza AND puede_autorizar AND activo) THEN
    RAISE EXCEPTION 'Esto lo autoriza una de las personas facultadas' USING ERRCODE = 'RC008';
  END IF;
  v_equipo := equipo_vigente(p_huella);
  RETURN v_equipo IS NOT NULL AND comprobar_clave(v_equipo, p_autoriza, p_clave);
END $$;

-- ── contar ──────────────────────────────────────────────────────────────────

-- Asienta un conteo y devuelve su registro. Es el corazón de registrar_conteo, con dos cambios:
-- devuelve el conteo —no solo la diferencia— y bloquea la jornada antes de asentar, haya o no
-- diferencia: sin eso, un conteo sin diferencia podía entrar en una jornada que se estaba cerrando.
CREATE FUNCTION asentar_conteo(
  p_material int, p_contado numeric, p_autoriza bigint, p_usuario bigint, p_nota text, p_contado_en timestamptz
) RETURNS conteo
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  c          conteo;
  v_sucursal smallint;
  v_jornada  bigint;
  v_abierta  timestamptz;
  v_cerrada  timestamptz;
  v_contado  numeric(12,3) := round(p_contado, 3);
  v_entonces numeric(14,3);
  v_dif      numeric;
  v_mov      bigint;
BEGIN
  PERFORM exigir_rol(p_usuario, 'mostrador', 'responsable');
  IF NOT EXISTS (SELECT 1 FROM usuario WHERE id = p_autoriza AND puede_autorizar AND activo) THEN
    RAISE EXCEPTION 'Un conteo lo autoriza una de las personas facultadas' USING ERRCODE = 'RC008';
  END IF;
  IF v_contado IS NULL OR v_contado = 'NaN' OR v_contado < 0 THEN
    RAISE EXCEPTION 'Lo contado tiene que ser un número de kilos, cero o más' USING ERRCODE = 'RC005';
  END IF;
  IF p_contado_en IS NULL THEN
    RAISE EXCEPTION 'Falta el momento en que se contó' USING ERRCODE = 'RC005';
  END IF;
  IF p_contado_en > clock_timestamp() THEN
    RAISE EXCEPTION 'El momento del conteo no puede estar en el futuro' USING ERRCODE = 'RC005';
  END IF;
  SELECT sucursal_id INTO v_sucursal FROM material WHERE id = p_material;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'El material % no existe', p_material USING ERRCODE = 'RC005';
  END IF;
  -- La jornada se bloquea contra su cierre y se vuelve a mirar: si se estaba cerrando, aquí se espera
  -- y se la encuentra cerrada. El orden es el de siempre: la jornada antes que el patio.
  v_jornada := jornada_abierta(v_sucursal);
  SELECT abierta_en, cerrada_en INTO v_abierta, v_cerrada FROM jornada WHERE id = v_jornada FOR SHARE;
  IF v_cerrada IS NOT NULL THEN
    RAISE EXCEPTION 'La jornada ya se cerró: el conteo se registra en la que esté abierta' USING ERRCODE = 'RC006';
  END IF;
  IF p_contado_en < v_abierta THEN
    RAISE EXCEPTION 'El conteo tiene que haberse hecho en la jornada abierta, no antes' USING ERRCODE = 'RC005';
  END IF;
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'El libro de inventario solo se escribe en READ COMMITTED' USING ERRCODE = 'RC010';
  END IF;
  PERFORM pg_advisory_xact_lock(7151, v_sucursal);

  IF EXISTS (SELECT 1 FROM conteo WHERE material_id = p_material AND contado_en > p_contado_en) THEN
    RAISE EXCEPTION 'Ya hay un conteo más reciente de este material: este, más viejo, ya no aplica'
      USING ERRCODE = 'RC005';
  END IF;

  SELECT coalesce(sum(cantidad_kg), 0) INTO v_entonces
  FROM movimiento_inventario WHERE material_id = p_material AND efectivo_en <= p_contado_en;
  v_dif := v_contado - v_entonces;
  IF abs(v_dif) > 999999999 THEN
    RAISE EXCEPTION 'La diferencia entre lo contado y lo registrado es desmedida' USING ERRCODE = 'RC005';
  END IF;

  IF v_dif <> 0 THEN
    INSERT INTO movimiento_inventario
      (sucursal_id, material_id, tipo, cantidad_kg, jornada_id, motivo, autorizado_por, creado_por, efectivo_en)
    VALUES (v_sucursal, p_material, 'ajuste', v_dif, v_jornada,
            format('Conteo físico: el libro decía %s kg y se contaron %s kg', v_entonces, v_contado)
              || coalesce('. ' || nullif(btrim(p_nota), ''), ''),
            p_autoriza, p_usuario, p_contado_en)
    RETURNING id INTO v_mov;
  END IF;
  INSERT INTO conteo (sucursal_id, material_id, jornada_id, contado_kg, contado_en, registrado_kg, diferencia_kg,
                      movimiento_id, nota, autorizado_por, creado_por)
  VALUES (v_sucursal, p_material, v_jornada, v_contado, p_contado_en, v_entonces, v_dif,
          v_mov, nullif(btrim(p_nota), ''), p_autoriza, p_usuario)
  RETURNING * INTO c;

  PERFORM anotar(p_usuario, 'conteo', 'material', p_material::text,
                 jsonb_build_object('contado', v_contado, 'registrado', v_entonces, 'diferencia', v_dif,
                                    'contado_en', p_contado_en, 'autoriza', p_autoriza));
  RETURN c;
END $$;

-- La función de antes, ahora como envoltura: lo que ya la usaba sigue recibiendo la diferencia.
CREATE OR REPLACE FUNCTION registrar_conteo(
  p_material int, p_contado numeric, p_autoriza bigint, p_usuario bigint,
  p_nota text DEFAULT NULL, p_contado_en timestamptz DEFAULT clock_timestamp()
) RETURNS numeric
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  RETURN (asentar_conteo(p_material, p_contado, p_autoriza, p_usuario, p_nota, p_contado_en)).diferencia_kg;
END $$;

-- Lo que la persona ve antes de autorizar un conteo: la hora, ya fija, y lo que el libro decía a
-- esa hora. Sin hora, es ahora. Avisa desde aquí lo que después se rechazaría.
CREATE FUNCTION previa_de_conteo(p_material int, p_contado numeric, p_contado_en timestamptz DEFAULT NULL)
RETURNS TABLE (contado_en timestamptz, registrado_kg numeric, diferencia_kg numeric)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_sucursal smallint;
  v_cuando   timestamptz := coalesce(p_contado_en, clock_timestamp());
BEGIN
  PERFORM exigir_kilos_o_cero(p_contado);
  SELECT sucursal_id INTO v_sucursal FROM material WHERE id = p_material;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'El material % no existe', p_material USING ERRCODE = 'RC005';
  END IF;
  IF v_cuando > clock_timestamp() THEN
    RAISE EXCEPTION 'El momento del conteo no puede estar en el futuro' USING ERRCODE = 'RC005';
  END IF;
  IF v_cuando < (SELECT abierta_en FROM jornada WHERE id = jornada_abierta(v_sucursal)) THEN
    RAISE EXCEPTION 'El conteo tiene que haberse hecho en la jornada abierta, no antes' USING ERRCODE = 'RC005';
  END IF;
  IF EXISTS (SELECT 1 FROM conteo c WHERE c.material_id = p_material AND c.contado_en > v_cuando) THEN
    RAISE EXCEPTION 'Ya hay un conteo más reciente de este material: este, más viejo, ya no aplica'
      USING ERRCODE = 'RC005';
  END IF;
  RETURN QUERY
    SELECT v_cuando, coalesce(sum(mv.cantidad_kg), 0)::numeric(14,3),
           (round(p_contado, 3) - coalesce(sum(mv.cantidad_kg), 0))::numeric(14,3)
    FROM movimiento_inventario mv WHERE mv.material_id = p_material AND mv.efectivo_en <= v_cuando;
END $$;

-- Cuenta un material. p_contado_en y p_registrado son los que devolvió la vista previa: si al
-- asentar el libro dice otra cosa, lo que se autorizó ya no es lo que se asentaría, y se rechaza.
-- Devuelve el conteo; o nada, si la clave de quien autoriza no pasó.
CREATE FUNCTION contar_material(
  p_envio uuid, p_material int, p_contado numeric, p_contado_en timestamptz, p_registrado numeric, p_nota text,
  p_autoriza bigint, p_clave text, p_huella text, p_usuario bigint
) RETURNS conteo
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  c           conteo;
  v_nota      text := texto_limpio(p_nota, 'La nota');
  v_contenido jsonb;
BEGIN
  PERFORM exigir_rol(p_usuario, 'mostrador', 'responsable');
  IF p_envio IS NULL THEN
    RAISE EXCEPTION 'El conteo llegó sin identificador' USING ERRCODE = 'RC005';
  END IF;
  PERFORM exigir_kilos_o_cero(p_contado);
  IF p_contado_en IS NULL OR p_registrado IS NULL THEN
    RAISE EXCEPTION 'El conteo llega con lo que se vio antes de autorizarlo' USING ERRCODE = 'RC005';
  END IF;
  v_contenido := jsonb_build_object(
    'material', p_material, 'contado', trim_scale(p_contado)::text,
    'contado_en', to_char(p_contado_en AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US'),
    'nota', v_nota, 'autoriza', p_autoriza);

  -- El mismo envío, otra vez: se devuelve lo que hizo, sin pedir nada más.
  SELECT co.* INTO c FROM envio_resultado r JOIN conteo co ON co.id = r.conteo_id WHERE r.envio_id = p_envio;
  IF FOUND THEN
    PERFORM reservar_envio(p_envio, 'conteo', v_contenido, p_usuario);     -- rechaza si el contenido es otro
    RETURN c;
  END IF;

  IF NOT autorizo_con_clave(p_huella, p_autoriza, p_clave) THEN
    RETURN NULL;
  END IF;
  IF NOT reservar_envio(p_envio, 'conteo', v_contenido, p_usuario) THEN
    -- Otro envío igual se adelantó mientras este esperaba.
    SELECT co.* INTO c FROM envio_resultado r JOIN conteo co ON co.id = r.conteo_id WHERE r.envio_id = p_envio;
    RETURN c;
  END IF;

  c := asentar_conteo(p_material, p_contado, p_autoriza, p_usuario, v_nota, p_contado_en);
  IF c.registrado_kg <> p_registrado THEN
    RAISE EXCEPTION 'Lo que el libro decía cambió desde que se revisó (% kg contra % kg): hay que volver a verlo',
      p_registrado, c.registrado_kg USING ERRCODE = 'RC011';
  END IF;
  INSERT INTO envio_resultado (envio_id, conteo_id) VALUES (p_envio, c.id);
  RETURN c;
END $$;

-- ── merma ───────────────────────────────────────────────────────────────────

CREATE FUNCTION dar_merma(p_envio uuid, p_material int, p_kg numeric, p_motivo text, p_usuario bigint)
RETURNS movimiento_inventario
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  m        movimiento_inventario;
  v_motivo text := texto_limpio(p_motivo, 'El motivo');
BEGIN
  PERFORM exigir_rol(p_usuario, 'mostrador', 'responsable');
  IF p_envio IS NULL THEN
    RAISE EXCEPTION 'La merma llegó sin identificador' USING ERRCODE = 'RC005';
  END IF;
  PERFORM exigir_kilos(p_kg);
  IF v_motivo IS NULL THEN
    RAISE EXCEPTION 'La merma lleva motivo' USING ERRCODE = 'RC005';
  END IF;
  IF NOT reservar_envio(p_envio, 'merma',
                        jsonb_build_object('material', p_material, 'kg', trim_scale(p_kg)::text, 'motivo', v_motivo),
                        p_usuario) THEN
    SELECT mv.* INTO m FROM envio_resultado r JOIN movimiento_inventario mv ON mv.id = r.movimiento_id WHERE r.envio_id = p_envio;
    RETURN m;
  END IF;
  m := registrar_merma(p_material, p_kg, v_motivo, p_usuario);
  INSERT INTO envio_resultado (envio_id, movimiento_id) VALUES (p_envio, m.id);
  RETURN m;
END $$;

-- ── separar ─────────────────────────────────────────────────────────────────

-- Revisa una separación antes de convertir nada, y devuelve sus productos en una sola forma:
-- ordenados por material y con los kilos como número. Así el mismo envío es el mismo aunque los
-- productos lleguen en otro orden o con los kilos escritos de otra manera.
CREATE FUNCTION productos_de_separacion(p_origen int, p_kg numeric, p_productos jsonb) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_limpios jsonb;
  v_suma    numeric;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM material WHERE id = p_origen) THEN
    RAISE EXCEPTION 'El material de origen % no existe', p_origen USING ERRCODE = 'RC005';
  END IF;
  IF p_kg IS NULL OR p_kg IN ('NaN', 'Infinity', '-Infinity') OR p_kg <= 0 OR p_kg > 999999 OR p_kg <> round(p_kg, 3) THEN
    RAISE EXCEPTION 'Lo que se separa son kilos: más de cero, hasta 999 999 y con hasta tres decimales' USING ERRCODE = 'RC007';
  END IF;
  IF p_productos IS NULL OR jsonb_typeof(p_productos) <> 'array' OR jsonb_array_length(p_productos) NOT BETWEEN 1 AND 30 THEN
    RAISE EXCEPTION 'Una separación lleva la lista de lo que salió, con al menos un producto' USING ERRCODE = 'RC007';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_productos) e
    WHERE jsonb_typeof(e) <> 'object'
       OR coalesce(e->>'material', '') !~ '^[0-9]{1,9}$'
       OR coalesce(e->>'kg', '') !~ '^[0-9]{1,6}(\.[0-9]{1,3})?$'
  ) THEN
    RAISE EXCEPTION 'Cada producto lleva su material y sus kilos, con hasta tres decimales' USING ERRCODE = 'RC007';
  END IF;

  SELECT jsonb_agg(jsonb_build_object('material', (e->>'material')::int, 'kg', (e->>'kg')::numeric) ORDER BY (e->>'material')::int),
         sum((e->>'kg')::numeric)
  INTO v_limpios, v_suma
  FROM jsonb_array_elements(p_productos) e;

  IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_limpios) e WHERE (e->>'kg')::numeric <= 0) THEN
    RAISE EXCEPTION 'Cada producto pesa más de cero kilos' USING ERRCODE = 'RC007';
  END IF;
  IF (SELECT count(*) <> count(DISTINCT e->>'material') FROM jsonb_array_elements(v_limpios) e) THEN
    RAISE EXCEPTION 'Un producto viene dos veces en la separación' USING ERRCODE = 'RC007';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_limpios) e WHERE (e->>'material')::int = p_origen) THEN
    RAISE EXCEPTION 'El material de origen no puede ser uno de los productos' USING ERRCODE = 'RC007';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_limpios) e
             WHERE NOT EXISTS (SELECT 1 FROM material m WHERE m.id = (e->>'material')::int)) THEN
    RAISE EXCEPTION 'Uno de los productos no es un material del catálogo' USING ERRCODE = 'RC007';
  END IF;
  IF v_suma > p_kg THEN
    RAISE EXCEPTION 'Los productos pesan % kg y el material del que salieron, % kg', v_suma, p_kg USING ERRCODE = 'RC007';
  END IF;
  RETURN v_limpios;
END $$;

-- Lo que se pierde al separar: el origen menos los productos. Para verlo antes de registrar.
CREATE FUNCTION previa_de_separacion(p_origen int, p_kg numeric, p_productos jsonb) RETURNS numeric
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT (p_kg - (SELECT sum((e->>'kg')::numeric) FROM jsonb_array_elements(productos_de_separacion(p_origen, p_kg, p_productos)) e))::numeric(12,3);
$$;

CREATE FUNCTION separar_material(p_envio uuid, p_origen int, p_kg numeric, p_productos jsonb, p_nota text, p_usuario bigint)
RETURNS transformacion
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  t         transformacion;
  v_limpios jsonb;
  v_nota    text := texto_limpio(p_nota, 'La nota');
BEGIN
  PERFORM exigir_rol(p_usuario, 'mostrador', 'responsable');
  IF p_envio IS NULL THEN
    RAISE EXCEPTION 'La separación llegó sin identificador' USING ERRCODE = 'RC005';
  END IF;
  v_limpios := productos_de_separacion(p_origen, p_kg, p_productos);
  IF NOT reservar_envio(p_envio, 'separacion',
                        jsonb_build_object('origen', p_origen, 'kg', trim_scale(p_kg)::text, 'nota', v_nota,
                                           'productos', (SELECT jsonb_agg(jsonb_build_object('material', e->'material', 'kg', trim_scale((e->>'kg')::numeric)::text)
                                                                          ORDER BY (e->>'material')::int)
                                                         FROM jsonb_array_elements(v_limpios) e)),
                        p_usuario) THEN
    SELECT tr.* INTO t FROM envio_resultado r JOIN transformacion tr ON tr.id = r.transformacion_id WHERE r.envio_id = p_envio;
    RETURN t;
  END IF;
  t := registrar_transformacion(p_origen, p_kg, v_limpios, v_nota, p_usuario);
  INSERT INTO envio_resultado (envio_id, transformacion_id) VALUES (p_envio, t.id);
  RETURN t;
END $$;

-- ── corregir ────────────────────────────────────────────────────────────────

-- Lo que el libro dice hoy de un movimiento: el original más todas sus correcciones, por material.
-- Un movimiento sin corregir da su material y su cantidad; uno que se pasó a otro material, ese
-- otro; uno que se dejó sin efecto, nada.
CREATE FUNCTION estado_de_movimiento(p_movimiento bigint) RETURNS TABLE (material_id int, kg numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT mv.material_id, sum(mv.cantidad_kg)::numeric(14,3)
  FROM movimiento_inventario mv
  WHERE mv.id = p_movimiento OR mv.referencia_id = p_movimiento
  GROUP BY mv.material_id
  HAVING sum(mv.cantidad_kg) <> 0;
$$;

CREATE TYPE correccion AS (original bigint, ajustes bigint[]);

-- Corrige un movimiento diciendo cómo debió quedar: de qué material y de cuántos kilos (cero: no
-- debió registrarse). Asienta la diferencia entre lo que el libro dice hoy de ese movimiento y lo
-- que debe decir, en ajustes que referencian al original. No toca dinero.
--
-- p_correcciones_vistas es cuántas correcciones tenía el movimiento cuando la persona lo revisó:
-- si ya tiene otras, lo que autorizó no es lo que se asentaría, y se rechaza.
-- Devuelve el original y los ajustes asentados; o nada, si la clave de quien autoriza no pasó.
CREATE FUNCTION corregir_movimiento(
  p_envio uuid, p_movimiento bigint, p_material int, p_kg numeric, p_correcciones_vistas int, p_motivo text,
  p_autoriza bigint, p_clave text, p_huella text, p_usuario bigint
) RETURNS correccion
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  o           movimiento_inventario;
  r           envio_resultado;
  d           record;
  v_motivo    text := texto_limpio(p_motivo, 'El motivo');
  v_contenido jsonb;
  v_vistas    int;
  v_objetivo  numeric;
  v_dif       jsonb;
  v_contado   text;
  v_hay       numeric;
  v_jornada   bigint;
  v_id        bigint;
  v_ajustes   bigint[] := '{}';
BEGIN
  PERFORM exigir_rol(p_usuario, 'mostrador', 'responsable');
  IF p_envio IS NULL THEN
    RAISE EXCEPTION 'La corrección llegó sin identificador' USING ERRCODE = 'RC005';
  END IF;
  PERFORM exigir_kilos_o_cero(p_kg);
  IF v_motivo IS NULL THEN
    RAISE EXCEPTION 'La corrección lleva motivo' USING ERRCODE = 'RC005';
  END IF;
  SELECT * INTO o FROM movimiento_inventario WHERE id = p_movimiento;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'El movimiento % no existe', p_movimiento USING ERRCODE = 'RC005';
  END IF;
  IF o.referencia_id IS NOT NULL THEN
    RAISE EXCEPTION 'Eso es una corrección: lo que se corrige es su movimiento original, el %', o.referencia_id
      USING ERRCODE = 'RC005';
  END IF;
  IF o.tipo NOT IN ('apertura', 'compra', 'venta', 'merma') THEN
    RAISE EXCEPTION 'Solo se corrigen el saldo inicial, las compras, las ventas y las mermas; lo demás se arregla contando'
      USING ERRCODE = 'RC005';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM material WHERE id = p_material AND sucursal_id = o.sucursal_id) THEN
    RAISE EXCEPTION 'El material % no existe', p_material USING ERRCODE = 'RC005';
  END IF;
  v_contenido := jsonb_build_object('movimiento', p_movimiento, 'material', p_material, 'kg', trim_scale(p_kg)::text,
                                    'motivo', v_motivo, 'autoriza', p_autoriza);

  -- El mismo envío, otra vez: se devuelve lo que hizo entonces, sin volver a imponerlo sobre lo que haya ahora.
  SELECT * INTO r FROM envio_resultado WHERE envio_id = p_envio;
  IF FOUND THEN
    PERFORM reservar_envio(p_envio, 'correccion', v_contenido, p_usuario);  -- rechaza si el contenido es otro
    RETURN ROW(r.movimiento_id, r.ajustes)::correccion;
  END IF;

  IF NOT autorizo_con_clave(p_huella, p_autoriza, p_clave) THEN
    RETURN NULL;
  END IF;
  IF NOT reservar_envio(p_envio, 'correccion', v_contenido, p_usuario) THEN
    SELECT * INTO r FROM envio_resultado WHERE envio_id = p_envio;
    RETURN ROW(r.movimiento_id, r.ajustes)::correccion;
  END IF;

  -- Primero el candado del patio y después leer: dos correcciones del mismo movimiento pasan una
  -- tras otra, y la segunda ve lo que dejó la primera.
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'El libro de inventario solo se escribe en READ COMMITTED' USING ERRCODE = 'RC010';
  END IF;
  PERFORM pg_advisory_xact_lock(7151, o.sucursal_id);

  SELECT count(*) INTO v_vistas FROM movimiento_inventario WHERE referencia_id = o.id;
  IF p_correcciones_vistas IS DISTINCT FROM v_vistas THEN
    RAISE EXCEPTION 'Ese movimiento se corrigió desde que se revisó (tenía % correcciones y ahora %): hay que volver a verlo',
      p_correcciones_vistas, v_vistas USING ERRCODE = 'RC011';
  END IF;

  -- Una entrada (saldo inicial, compra) queda en positivo; una salida (venta, merma), en negativo.
  v_objetivo := sign(o.cantidad_kg) * round(p_kg, 3);

  -- La diferencia, por material, entre lo que debe decir el libro y lo que dice. (Se lleva en una
  -- variable y no en una tabla temporal: el nombre de una temporal lo puede ocupar antes la sesión.)
  SELECT coalesce(jsonb_object_agg(x.m::text, x.k), '{}'::jsonb) INTO v_dif
  FROM (
    SELECT y.m, sum(y.k) AS k FROM (
      SELECT mv.material_id AS m, -mv.cantidad_kg AS k FROM movimiento_inventario mv WHERE mv.id = o.id OR mv.referencia_id = o.id
      UNION ALL
      SELECT p_material, v_objetivo
    ) y GROUP BY y.m HAVING sum(y.k) <> 0
  ) x;

  -- El conteo manda: si después de este movimiento ya se contó alguno de los materiales que la
  -- corrección tocaría, ese conteo ya puso su existencia donde va. Corregir encima descontaría dos veces.
  -- El límite es el mismo con el que el conteo arma lo que dice el libro (efectivo_en <= contado_en):
  -- un conteo fechado en el instante mismo del movimiento ya lo vio.
  SELECT string_agg(DISTINCT m.nombre, ', ') INTO v_contado
  FROM conteo c JOIN material m ON m.id = c.material_id
  WHERE c.material_id IN (SELECT key::int FROM jsonb_each_text(v_dif)) AND c.contado_en >= o.efectivo_en;
  IF v_contado IS NOT NULL THEN
    RAISE EXCEPTION 'Después de ese movimiento ya se contó %: el conteo ya dejó la existencia donde va. Si algo no cuadra, se cuenta de nuevo',
      v_contado USING ERRCODE = 'RC005';
  END IF;

  -- Que toda salida alcance, antes de asentar nada.
  FOR d IN SELECT x.key::int AS material_id, x.value::numeric AS kg, m.nombre
           FROM jsonb_each_text(v_dif) x JOIN material m ON m.id = x.key::int
           WHERE x.value::numeric < 0 ORDER BY 1 LOOP
    SELECT coalesce(sum(cantidad_kg), 0) INTO v_hay FROM movimiento_inventario WHERE material_id = d.material_id;
    IF v_hay + d.kg < 0 THEN
      RAISE EXCEPTION 'No alcanza: hay % kg de % y la corrección sacaría % kg', v_hay, d.nombre, -d.kg USING ERRCODE = 'RC002';
    END IF;
  END LOOP;

  IF v_dif <> '{}'::jsonb THEN
    -- Los ajustes caen en la jornada abierta; valen desde el momento del original.
    v_jornada := jornada_abierta(o.sucursal_id);
    FOR d IN SELECT x.key::int AS material_id, x.value::numeric AS kg FROM jsonb_each_text(v_dif) x ORDER BY 1 LOOP
      INSERT INTO movimiento_inventario (sucursal_id, material_id, tipo, cantidad_kg, jornada_id, referencia_id, motivo, autorizado_por, creado_por)
      VALUES (o.sucursal_id, d.material_id, 'ajuste', d.kg, v_jornada, o.id, v_motivo, p_autoriza, p_usuario)
      RETURNING id INTO v_id;
      v_ajustes := v_ajustes || v_id;
    END LOOP;
  END IF;

  INSERT INTO envio_resultado (envio_id, movimiento_id, ajustes) VALUES (p_envio, o.id, v_ajustes);
  PERFORM anotar(p_usuario, 'corregir', 'movimiento_inventario', o.id::text,
                 jsonb_build_object('material', p_material, 'kg', round(p_kg, 3), 'motivo', v_motivo,
                                    'autoriza', p_autoriza, 'ajustes', to_jsonb(v_ajustes)));
  RETURN ROW(o.id, v_ajustes)::correccion;
END $$;

-- ── lo que se retira ────────────────────────────────────────────────────────

-- Una sola forma de corregir. Estas dos no se componían con una corrección previa: una movía la
-- cantidad original, la otra sumaba una cantidad suelta.
DROP FUNCTION corregir_material(bigint, int, text, bigint, bigint);
DROP FUNCTION registrar_ajuste(int, numeric, text, bigint, bigint, bigint);

REVOKE EXECUTE ON FUNCTION
  registrar_conteo(int, numeric, bigint, bigint, text, timestamptz),
  registrar_merma(int, numeric, text, bigint),
  registrar_transformacion(int, numeric, jsonb, text, bigint)
FROM feruga_app;

GRANT EXECUTE ON FUNCTION
  previa_de_conteo(int, numeric, timestamptz),
  contar_material(uuid, int, numeric, timestamptz, numeric, text, bigint, text, text, bigint),
  dar_merma(uuid, int, numeric, text, bigint),
  previa_de_separacion(int, numeric, jsonb),
  separar_material(uuid, int, numeric, jsonb, text, bigint),
  estado_de_movimiento(bigint),
  corregir_movimiento(uuid, bigint, int, numeric, int, text, bigint, text, text, bigint)
TO feruga_app;
