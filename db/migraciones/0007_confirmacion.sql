-- Confirmar una cuenta: el punto de no retorno. En una sola transacción se asientan los
-- movimientos de inventario, se calcula lo que se paga en pesos cerrados con su ajuste, y se
-- asigna el folio. Si algo falla, no queda nada escrito.

-- p_revision es la revisión de la cuenta que quien confirma tenía a la vista, y es obligatoria.
-- Si la cuenta ya no está en esa revisión —alguien agregó, quitó o cambió algo desde otra
-- pantalla—, no se confirma: se vuelve a revisar.
CREATE FUNCTION confirmar_operacion(p_operacion uuid, p_usuario bigint, p_revision int) RETURNS operacion
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  op      operacion;
  l       operacion_linea;
  v_suma  numeric(14,2);
  v_total numeric(14,0);
  v_jornada   bigint;
  v_excepcion jsonb := '{}';
BEGIN
  PERFORM exigir_rol(p_usuario, 'mostrador', 'responsable');

  SELECT * INTO op FROM operacion WHERE id = p_operacion FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'La cuenta % no existe', p_operacion USING ERRCODE = 'RC005';
  END IF;
  IF p_revision IS DISTINCT FROM op.revision THEN
    RAISE EXCEPTION 'La cuenta cambió desde que se revisó (revisión % contra %): hay que volver a verla',
      p_revision, op.revision USING ERRCODE = 'RC011';
  END IF;
  SELECT sum(importe) INTO v_suma FROM operacion_linea WHERE operacion_id = op.id;
  -- Un reintento devuelve lo ya confirmado y no escribe nada.
  IF op.estado = 'confirmada' THEN
    RETURN op;
  END IF;
  v_jornada := op.jornada_id;
  IF (SELECT cerrada_en FROM jornada WHERE id = op.jornada_id) IS NOT NULL THEN
    -- Solo sobrevive al cierre la cuenta de un vehículo que no volvió a pesarse el mismo día.
    IF NOT EXISTS (
      SELECT 1 FROM operacion_linea ren JOIN instrumento ins ON ins.id = ren.instrumento_id
      WHERE ren.operacion_id = op.id AND ins.doble_pesaje
    ) THEN
      RAISE EXCEPTION 'La jornada de esta cuenta ya está cerrada' USING ERRCODE = 'RC006';
    END IF;
    -- Terminarla otro día es una excepción: la autoriza un responsable y se asienta en la jornada de hoy.
    PERFORM exigir_rol(p_usuario, 'responsable');
    v_jornada := jornada_abierta(op.sucursal_id);
    v_excepcion := jsonb_build_object('excepcion', 'segunda pesada en otra jornada', 'jornada_original', op.jornada_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM operacion_linea WHERE operacion_id = op.id) THEN
    RAISE EXCEPTION 'La cuenta no tiene materiales' USING ERRCODE = 'RC005';
  END IF;
  IF EXISTS (SELECT 1 FROM operacion_linea WHERE operacion_id = op.id AND peso_bruto IS NULL) THEN
    RAISE EXCEPTION 'Hay un material que todavía no termina de pesarse' USING ERRCODE = 'RC005';
  END IF;

  -- Siempre en el mismo orden de material, para que dos confirmaciones no se bloqueen entre sí.
  FOR l IN SELECT * FROM operacion_linea WHERE operacion_id = op.id ORDER BY material_id, id LOOP
    INSERT INTO movimiento_inventario (sucursal_id, material_id, tipo, cantidad_kg, jornada_id, linea_id, creado_por)
    VALUES (op.sucursal_id, l.material_id, op.tipo,
            CASE op.tipo WHEN 'compra' THEN l.peso_recibido ELSE -l.peso_recibido END,
            v_jornada, l.id, p_usuario);
  END LOOP;

  v_total := round(v_suma);       -- pesos cerrados; el medio peso sube

  UPDATE operacion
  SET estado = 'confirmada', folio = nextval('folio_operacion'), suma = v_suma, total = v_total,
      ajuste_redondeo = v_total - v_suma, confirmada_en = now(), confirmada_por = p_usuario,
      confirmada_en_jornada = v_jornada
  WHERE id = op.id
  RETURNING * INTO op;

  PERFORM anotar(p_usuario, 'confirmar', 'operacion', op.id::text,
                 jsonb_build_object('folio', op.folio, 'tipo', op.tipo, 'total', op.total) || v_excepcion);
  RETURN op;
END $$;
