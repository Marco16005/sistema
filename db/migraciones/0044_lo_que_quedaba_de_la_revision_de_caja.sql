-- Lo que quedaba de la revisión de la caja, según la segunda pasada de Codex (informe 33, 22 de
-- octubre de 2026; docs/revisiones/2026-10-22-codex-revision-de-pantallas-y-recipiente.md). Cada
-- función se vuelve a escribir desde su última versión (0043), cambiando solo esto:
--
--   R33-1  Contar un material y corregir un movimiento de inventario toman la jornada ANTES que el
--          patio y la clave, como todo lo demás. La tomaban después —al asentar— y se podían esperar
--          con mover dinero o cerrar, que toman la jornada y luego la clave.
--   R33-2  Repetir «terminar un vehículo» con otra persona firmando es otro pedido: se rechaza.

-- contar_material, de 0043: la jornada primero (R33-1).
CREATE OR REPLACE FUNCTION contar_material(
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

  -- R33-1: la jornada, después el patio, y al final la clave. asentar_conteo los vuelve a pedir: ya son suyos.
  PERFORM 1 FROM jornada WHERE id = jornada_abierta((SELECT sucursal_id FROM usuario WHERE id = p_usuario)) FOR SHARE;
  PERFORM pg_advisory_xact_lock(7151, (SELECT sucursal_id FROM usuario WHERE id = p_usuario));
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

-- corregir_movimiento, de 0043: la jornada primero (R33-1).
CREATE OR REPLACE FUNCTION corregir_movimiento(
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

  -- R33-1: la jornada, después el patio, y al final la clave. Más abajo se vuelven a pedir: ya son suyos.
  PERFORM 1 FROM jornada WHERE id = jornada_abierta(o.sucursal_id) FOR SHARE;
  PERFORM pg_advisory_xact_lock(7151, o.sucursal_id);
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

-- terminar_vehiculo, de 0043: otra firma al repetir se rechaza (R33-2).
CREATE OR REPLACE FUNCTION terminar_vehiculo(p_cuenta uuid, p_revision int, p_responsable bigint, p_clave text, p_huella text,
                                 p_forma text DEFAULT 'efectivo')
RETURNS operacion LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  op operacion;
  v_equipo uuid;
  v_jornada bigint;
BEGIN
  PERFORM exigir_forma_de_pago(p_forma);
  SELECT * INTO op FROM operacion WHERE id = p_cuenta FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'La cuenta % no existe', p_cuenta USING ERRCODE = 'RC005';
  END IF;
  IF op.estado = 'confirmada' THEN
    IF op.forma_de_pago IS DISTINCT FROM p_forma THEN   -- H3
      RAISE EXCEPTION 'Esa cuenta ya se terminó, %: hay que volver a verla', forma_en_palabras(op.forma_de_pago) USING ERRCODE = 'RC011';
    END IF;
    IF op.confirmada_por IS DISTINCT FROM p_responsable THEN   -- R33-2: la terminó otra persona
      RAISE EXCEPTION 'Esa cuenta ya la terminó otra persona: hay que volver a verla' USING ERRCODE = 'RC011';
    END IF;
    RETURN op;
  END IF;
  PERFORM exigir_rol(p_responsable, 'responsable');
  IF (SELECT cerrada_en FROM jornada WHERE id = op.jornada_id) IS NULL THEN
    RAISE EXCEPTION 'Esta cuenta no es de otra jornada: la termina quien atiende, a su nombre' USING ERRCODE = 'RC005';
  END IF;
  IF p_revision IS DISTINCT FROM op.revision THEN
    RAISE EXCEPTION 'La cuenta cambió desde que se revisó: hay que volver a verla' USING ERRCODE = 'RC011';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM operacion_linea l JOIN instrumento i ON i.id = l.instrumento_id
                 WHERE l.operacion_id = op.id AND i.doble_pesaje)
     OR EXISTS (SELECT 1 FROM operacion_linea WHERE operacion_id = op.id AND peso_bruto IS NULL) THEN
    RAISE EXCEPTION 'El vehículo todavía no termina de pesarse' USING ERRCODE = 'RC005';
  END IF;
  -- Siempre jornada antes que credencial, también en mover y cerrar: evita que dos firmas
  -- se esperen una a otra con esos candados tomados al revés.
  SELECT id INTO v_jornada FROM jornada WHERE sucursal_id = op.sucursal_id AND cerrada_en IS NULL FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No hay jornada abierta para terminar el vehículo' USING ERRCODE = 'RC006';
  END IF;
  -- H1: el patio antes que la clave, como al corregir y al fiar.
  PERFORM pg_advisory_xact_lock(7151, op.sucursal_id);
  v_equipo := equipo_vigente(p_huella);
  IF v_equipo IS NULL OR NOT comprobar_clave(v_equipo, p_responsable, p_clave) THEN RETURN NULL; END IF;
  RETURN confirmar_operacion(p_cuenta, p_responsable, p_revision, p_forma);
END $$;
