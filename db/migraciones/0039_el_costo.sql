-- Lo que costó el patio, en pesos con centavos. El promedio móvil sigue el orden de asiento
-- (id), no efectivo_en: corregir kilos no reescribe el costo ni la ganancia de días anteriores.
-- El libro sigue siendo la fuente; costo_material es su acumulado, escrito solo por el disparador.

ALTER TABLE movimiento_inventario ADD COLUMN costo numeric(16,2);
CREATE TABLE costo_material (
  material_id int PRIMARY KEY REFERENCES material,
  kg numeric(14,3) NOT NULL DEFAULT 0 CHECK (kg >= 0 AND kg <> 'NaN'),
  valor numeric(16,2) NOT NULL DEFAULT 0 CHECK (valor >= 0 AND valor <> 'NaN'),
  CONSTRAINT sin_kilos_sin_valor CHECK (kg <> 0 OR valor = 0)
);
INSERT INTO costo_material (material_id) SELECT id FROM material;
GRANT SELECT ON costo_material TO feruga_app;

-- El denominador del reparto debe conocerse antes de asentar el primer producto. El encabezado
-- conserva los productos en su orden de asiento, ya redondeados a gramos, sin precios mutables.
-- La basura solo está en merma_kg: no participa en este reparto.
CREATE INDEX movimiento_por_transformacion ON movimiento_inventario (transformacion_id, id)
  WHERE transformacion_id IS NOT NULL;
ALTER TABLE transformacion ADD COLUMN productos_costo jsonb;
ALTER TABLE transformacion DISABLE TRIGGER transformacion_inmutable;
UPDATE transformacion t SET productos_costo = (
  SELECT jsonb_agg(jsonb_build_object('material', material_id, 'kg', cantidad_kg) ORDER BY id)
  FROM movimiento_inventario WHERE transformacion_id = t.id AND cantidad_kg > 0
);
ALTER TABLE transformacion ENABLE TRIGGER transformacion_inmutable;
ALTER TABLE transformacion ALTER COLUMN productos_costo SET NOT NULL;

-- Una lista del día, o la última anterior si se pide respaldo. Nunca una lista futura.
-- La apertura tiene otra regla: la primera lista publicada que sí contiene ese material.
CREATE FUNCTION precio_para_costo(p_material int, p_jornada bigint, p_apertura boolean DEFAULT false)
RETURNS numeric LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  SELECT coalesce(CASE WHEN p_apertura THEN (
    SELECT p.compra FROM precio p JOIN lista_precios l ON l.id = p.lista_id
    JOIN jornada j ON j.id = l.jornada_id JOIN material m ON m.id = p.material_id
    WHERE p.material_id = p_material AND l.publicada_en IS NOT NULL AND j.sucursal_id = m.sucursal_id
    ORDER BY j.fecha, l.id LIMIT 1
  ) ELSE (
    SELECT p.compra FROM precio p WHERE p.material_id = p_material AND p.lista_id = (
      SELECT l.id FROM lista_precios l JOIN jornada j ON j.id = l.jornada_id
      JOIN jornada del_movimiento ON del_movimiento.id = p_jornada
      WHERE l.publicada_en IS NOT NULL AND j.sucursal_id = del_movimiento.sucursal_id
        AND j.fecha <= del_movimiento.fecha
      ORDER BY j.fecha DESC, l.id DESC LIMIT 1
    )
  ) END, 0);
$$;

-- Una sola cuenta, tanto para el disparador como para reconstruir la historia. Actualiza el
-- acumulado y devuelve el costo firmado. No es entrada de la aplicación.
CREATE FUNCTION asentar_costo(p movimiento_inventario) RETURNS numeric
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  s costo_material;
  v_costo numeric(16,2);
  v_productos jsonb;
  v_total numeric;
  v_repartido numeric;
  v_peso numeric;
  v_pesos numeric;
  v_orden int;
  v_numero int;
BEGIN
  INSERT INTO costo_material (material_id) VALUES (p.material_id) ON CONFLICT DO NOTHING;
  SELECT * INTO s FROM costo_material WHERE material_id = p.material_id FOR UPDATE;

  IF p.cantidad_kg < 0 THEN
    IF s.kg < -p.cantidad_kg THEN
      RAISE EXCEPTION 'El libro en orden de asiento saca más kilos de los que hay para el material %', p.material_id
        USING ERRCODE = 'RC002';
    END IF;
    v_costo := CASE WHEN s.kg = -p.cantidad_kg THEN -s.valor
                    ELSE round(p.cantidad_kg * s.valor / s.kg, 2) END;
  ELSIF p.tipo = 'compra' THEN
    SELECT importe INTO STRICT v_costo FROM operacion_linea WHERE id = p.linea_id;
  ELSIF p.tipo = 'apertura' THEN
    v_costo := round(p.cantidad_kg * precio_para_costo(p.material_id, p.jornada_id, true), 2);
  ELSIF p.tipo = 'transformacion' THEN
    SELECT productos_costo INTO v_productos FROM transformacion WHERE id = p.transformacion_id;
    -- Solo movimientos anteriores: al migrar los productos posteriores ya existen en la tabla.
    SELECT -sum(costo) FILTER (WHERE cantidad_kg < 0),
           coalesce(sum(costo) FILTER (WHERE cantidad_kg > 0), 0),
           count(*) FILTER (WHERE cantidad_kg > 0) + 1
    INTO v_total, v_repartido, v_orden
    FROM movimiento_inventario WHERE transformacion_id = p.transformacion_id AND id < p.id;
    v_numero := jsonb_array_length(v_productos);
    IF v_total IS NULL OR v_orden > v_numero
       OR (v_productos->(v_orden-1)->>'material')::int IS DISTINCT FROM p.material_id
       OR (v_productos->(v_orden-1)->>'kg')::numeric IS DISTINCT FROM p.cantidad_kg THEN
      RAISE EXCEPTION 'El producto no coincide con la separación que se está asentando' USING ERRCODE = 'RC007';
    END IF;
    IF v_orden = v_numero THEN
      v_costo := v_total - v_repartido; -- todos los centavos restantes al último producto
    ELSE
      SELECT sum((x.producto->>'kg')::numeric * coalesce(pr.compra, 0)),
             sum((x.producto->>'kg')::numeric * coalesce(pr.compra, 0)) FILTER (WHERE x.orden = v_orden)
      INTO v_pesos, v_peso
      FROM jsonb_array_elements(v_productos) WITH ORDINALITY AS x(producto, orden)
      LEFT JOIN lista_precios l ON l.jornada_id = p.jornada_id AND l.publicada_en IS NOT NULL
      LEFT JOIN precio pr ON pr.lista_id = l.id AND pr.material_id = (x.producto->>'material')::int;
      IF v_pesos = 0 THEN
        SELECT sum((x->>'kg')::numeric) INTO v_pesos FROM jsonb_array_elements(v_productos) x;
        v_peso := p.cantidad_kg;
      END IF;
      -- Con muchos productos de fracciones de centavo, no repartir más de lo disponible.
      v_costo := least(round(v_total * v_peso / v_pesos, 2), v_total - v_repartido);
    END IF;
  ELSE -- ajuste que agrega kilos: promedio vigente; sin kilos, precio de la lista.
    v_costo := round(p.cantidad_kg * CASE WHEN s.kg > 0 THEN s.valor / s.kg
                       ELSE precio_para_costo(p.material_id, p.jornada_id) END, 2);
  END IF;

  UPDATE costo_material SET kg = s.kg + p.cantidad_kg, valor = s.valor + v_costo
  WHERE material_id = p.material_id;
  RETURN v_costo;
END $$;

-- El ALTER inicial bloquea el libro durante toda la migración. Solo aquí se permite completar
-- la columna de historia, sin alterar kilos, fechas, referencias ni identificadores.
ALTER TABLE movimiento_inventario DISABLE TRIGGER movimiento_inmutable;
DO $$
DECLARE m movimiento_inventario;
BEGIN
  FOR m IN SELECT * FROM movimiento_inventario ORDER BY id LOOP
    UPDATE movimiento_inventario SET costo = asentar_costo(m) WHERE id = m.id;
  END LOOP;
END $$;
ALTER TABLE movimiento_inventario ENABLE TRIGGER movimiento_inmutable;
ALTER TABLE movimiento_inventario ALTER COLUMN costo SET NOT NULL;
ALTER TABLE movimiento_inventario ADD CONSTRAINT costo_con_sentido
  CHECK (costo <> 'NaN' AND (CASE WHEN cantidad_kg > 0 THEN costo >= 0 ELSE costo <= 0 END));

CREATE FUNCTION movimiento_valorar() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  -- movimiento_entra se ejecuta primero (orden alfabético): ya tomó el candado del patio,
  -- comprobó READ COMMITTED y fijó las fechas. El identity provisional se obtuvo ANTES del
  -- candado: otro asiento pudo adelantarlo. El definitivo se toma aquí, con el turno ganado.
  NEW.id := nextval(pg_get_serial_sequence('public.movimiento_inventario', 'id'));
  NEW.costo := asentar_costo(NEW);
  RETURN NEW;
END $$;
CREATE TRIGGER movimiento_valorar BEFORE INSERT ON movimiento_inventario
  FOR EACH ROW EXECUTE FUNCTION movimiento_valorar();

-- Materiales nuevos también se pueden consultar aunque todavía no hayan tenido movimientos.
CREATE FUNCTION material_inicia_costo() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  INSERT INTO costo_material (material_id) VALUES (NEW.id);
  RETURN NEW;
END $$;
CREATE TRIGGER material_inicia_costo AFTER INSERT ON material
  FOR EACH ROW EXECUTE FUNCTION material_inicia_costo();

-- Misma validación y firma de 0009; ahora conserva el reparto antes de escribir el origen.
CREATE OR REPLACE FUNCTION registrar_transformacion(p_origen int, p_kg numeric, p_productos jsonb, p_nota text, p_usuario bigint)
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
  v_productos jsonb;
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
  SELECT jsonb_agg(jsonb_build_object('material', x.material, 'kg', round(x.kg, 3)) ORDER BY x.material, x.orden)
  INTO v_productos
  FROM jsonb_array_elements(p_productos) WITH ORDINALITY AS e(producto, orden)
  CROSS JOIN LATERAL (SELECT (e.producto->>'material')::int AS material, (e.producto->>'kg')::numeric AS kg, e.orden) x;
  INSERT INTO transformacion (sucursal_id, jornada_id, merma_kg, nota, creada_por, productos_costo)
  VALUES (v_sucursal, v_jornada, v_kg - v_prod, p_nota, p_usuario, v_productos)
  RETURNING * INTO t;

  INSERT INTO movimiento_inventario (sucursal_id, material_id, tipo, cantidad_kg, jornada_id, transformacion_id, creado_por)
  VALUES (v_sucursal, p_origen, 'transformacion', -v_kg, v_jornada, t.id, p_usuario);
  FOR r IN
    SELECT x.material, round(x.kg, 3) AS kg
    FROM jsonb_to_recordset(v_productos) AS x(material int, kg numeric)
  LOOP
    INSERT INTO movimiento_inventario (sucursal_id, material_id, tipo, cantidad_kg, jornada_id, transformacion_id, creado_por)
    VALUES (v_sucursal, r.material, 'transformacion', r.kg, v_jornada, t.id, p_usuario);
  END LOOP;

  PERFORM anotar(p_usuario, 'transformar', 'transformacion', t.id::text,
                 jsonb_build_object('origen', p_origen, 'kg', v_kg, 'productos', p_productos, 'merma', t.merma_kg));
  RETURN t;
END $$;

