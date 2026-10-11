-- Separar material mezclado: consume un material y produce otros. No es entrada ni salida del
-- patio. Entra completa por esta función, que la valida y la escribe en una transacción.
-- La merma no se recibe: es el origen menos los productos, así el encabezado no puede
-- contradecir lo que dice el libro. Las cantidades se llevan a gramos una sola vez y la
-- conservación se comprueba sobre lo que de verdad se guarda.

CREATE FUNCTION registrar_transformacion(p_origen int, p_kg numeric, p_productos jsonb, p_nota text, p_usuario bigint)
RETURNS transformacion
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  t          transformacion;
  v_sucursal smallint;
  v_jornada  bigint;
  v_kg       numeric(12,3) := round(p_kg, 3);
  v_prod     numeric(14,3);
  v_invalido boolean;
  v_repite   boolean;
  r          record;
BEGIN
  PERFORM exigir_rol(p_usuario, 'mostrador', 'responsable');
  SELECT sucursal_id INTO v_sucursal FROM material WHERE id = p_origen;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'El material de origen % no existe', p_origen USING ERRCODE = 'RC005';
  END IF;
  IF v_kg IS NULL OR v_kg = 'NaN' OR v_kg <= 0 THEN
    RAISE EXCEPTION 'Lo que se separa tiene que ser más de cero kilos' USING ERRCODE = 'RC007';
  END IF;
  IF p_productos IS NULL OR jsonb_typeof(p_productos) <> 'array' OR jsonb_array_length(p_productos) = 0 THEN
    RAISE EXCEPTION 'Una separación necesita al menos un producto' USING ERRCODE = 'RC007';
  END IF;

  SELECT sum(round(x.kg, 3)),
         bool_or(x.material IS NULL OR x.kg IS NULL OR round(x.kg, 3) <= 0),
         bool_or(x.material = p_origen)
  INTO v_prod, v_invalido, v_repite
  FROM jsonb_to_recordset(p_productos) AS x(material int, kg numeric);
  IF v_invalido THEN
    RAISE EXCEPTION 'Cada producto lleva su material y más de cero kilos' USING ERRCODE = 'RC007';
  END IF;
  IF v_repite THEN
    RAISE EXCEPTION 'El material de origen no puede ser uno de los productos' USING ERRCODE = 'RC007';
  END IF;
  IF v_prod > v_kg THEN
    RAISE EXCEPTION 'Los productos pesan % kg y el material del que salieron, % kg', v_prod, v_kg USING ERRCODE = 'RC007';
  END IF;

  v_jornada := jornada_abierta(v_sucursal);
  INSERT INTO transformacion (sucursal_id, jornada_id, merma_kg, nota, creada_por)
  VALUES (v_sucursal, v_jornada, v_kg - v_prod, p_nota, p_usuario)
  RETURNING * INTO t;

  INSERT INTO movimiento_inventario (sucursal_id, material_id, tipo, cantidad_kg, jornada_id, transformacion_id, creado_por)
  VALUES (v_sucursal, p_origen, 'transformacion', -v_kg, v_jornada, t.id, p_usuario);
  FOR r IN
    SELECT x.material, round(x.kg, 3) AS kg
    FROM jsonb_to_recordset(p_productos) AS x(material int, kg numeric)
    ORDER BY x.material
  LOOP
    INSERT INTO movimiento_inventario (sucursal_id, material_id, tipo, cantidad_kg, jornada_id, transformacion_id, creado_por)
    VALUES (v_sucursal, r.material, 'transformacion', r.kg, v_jornada, t.id, p_usuario);
  END LOOP;

  PERFORM anotar(p_usuario, 'transformar', 'transformacion', t.id::text,
                 jsonb_build_object('origen', p_origen, 'kg', v_kg, 'productos', p_productos, 'merma', t.merma_kg));
  RETURN t;
END $$;

CREATE TRIGGER transformacion_inmutable BEFORE UPDATE OR DELETE ON transformacion
  FOR EACH ROW EXECUTE FUNCTION rechazar_cambio();
CREATE TRIGGER transformacion_sin_vaciar BEFORE TRUNCATE ON transformacion
  FOR EACH STATEMENT EXECUTE FUNCTION rechazar_cambio();
