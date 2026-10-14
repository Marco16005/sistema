-- El recipiente en la báscula chica: el costal, la carretilla o la cubeta en que llega o se lleva
-- el material.
--
-- Cambia lo que quedó en la especificación (P7: «no se usan taras; tara en cero por omisión»).
-- El dueño lo pidió el 14 de octubre de 2026, después de revisar el sistema con su gente: un
-- costal de unos 200 g sobre kilos de cobre de primera se pagaba como cobre, y lo que se traía en
-- una carretilla, igual. Corregirlo después en el inventario es tarde.
--
-- Lo que pesa vacío el recipiente se teclea al pesar —o después, desde la cuenta, mientras siga
-- abierta— y es la tara del renglón. Así se descuenta de lo que se paga o se cobra (el peso
-- liquidable) y también de lo que entra o sale del patio (el peso recibido), desde el principio.
--
-- No hay lista de recipientes con su peso: el dueño prefirió teclearlo cada vez, porque cada
-- costal y cada carretilla pesa distinto. En la báscula grande no cambia nada: ahí la tara es el
-- vehículo vacío, y se mide con la segunda pesada.
--
-- agregar_material recibe el recipiente como octava entrada, con cero si no se dice: lo que la
-- llamaba con siete sigue igual, y su envío se guarda igual que antes. Cuando sí lleva recipiente,
-- el recipiente es parte del envío: repetirlo con otro peso se rechaza como cualquier envío que
-- cambió.

-- Lo que pesa un recipiente tecleado: un número de cero en adelante con no más de tres decimales.
-- Cero es «sin recipiente». Se rechaza aquí en vez de dejar que la columna lo redondee.
CREATE FUNCTION exigir_recipiente(p_kg numeric) RETURNS void
LANGUAGE plpgsql IMMUTABLE SET search_path = public, pg_temp AS $$
BEGIN
  IF p_kg IS NULL OR p_kg IN ('NaN', 'Infinity', '-Infinity') THEN
    RAISE EXCEPTION 'Lo que pesa el recipiente tiene que ser un número' USING ERRCODE = 'RC004';
  END IF;
  IF p_kg < 0 THEN
    RAISE EXCEPTION 'Lo que pesa el recipiente no puede ser negativo' USING ERRCODE = 'RC004';
  END IF;
  IF p_kg > 999999 THEN
    RAISE EXCEPTION 'Lo que pesa el recipiente no puede pasar de 999 999 kg' USING ERRCODE = 'RC004';
  END IF;
  IF p_kg <> round(p_kg, 3) THEN
    RAISE EXCEPTION 'Lo que pesa el recipiente lleva hasta tres decimales y llegó %', p_kg USING ERRCODE = 'RC004';
  END IF;
END $$;

-- Pone, cambia o quita (con cero) lo que pesa el recipiente de un material ya pesado en la báscula
-- chica. Lo hace quien pesa, igual que agregar el material.
CREATE FUNCTION poner_recipiente(p_linea uuid, p_kg numeric, p_usuario bigint) RETURNS operacion_linea
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  l        operacion_linea;
  v_cuenta uuid;
BEGIN
  PERFORM exigir_rol(p_usuario, 'mostrador', 'responsable', 'patio');
  PERFORM exigir_recipiente(p_kg);
  SELECT operacion_id INTO v_cuenta FROM operacion_linea WHERE id = p_linea;
  IF FOUND THEN
    PERFORM 1 FROM operacion WHERE id = v_cuenta FOR UPDATE;
    SELECT * INTO l FROM operacion_linea WHERE id = p_linea;
  END IF;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ese material no está en ninguna cuenta' USING ERRCODE = 'RC005';
  END IF;
  IF (SELECT doble_pesaje FROM instrumento WHERE id = l.instrumento_id) THEN
    RAISE EXCEPTION 'En la báscula grande no se pone recipiente: el vehículo se pesa lleno y vacío' USING ERRCODE = 'RC004';
  END IF;
  IF l.tara = p_kg THEN
    RETURN l;       -- ya estaba así: no es un cambio de la cuenta
  END IF;
  IF l.peso_bruto IS NULL THEN
    RAISE EXCEPTION 'Ese material todavía no termina de pesarse' USING ERRCODE = 'RC004';
  END IF;
  IF p_kg >= l.peso_bruto THEN
    RAISE EXCEPTION 'El recipiente (% kg) tiene que pesar menos que lo que marcó la báscula (% kg)',
      trim_scale(p_kg), trim_scale(l.peso_bruto) USING ERRCODE = 'RC004';
  END IF;
  IF p_kg > l.peso_bruto - l.descuento_kg THEN
    RAISE EXCEPTION 'Con el descuento de % kg, el recipiente no puede pasar de % kg',
      trim_scale(l.descuento_kg), trim_scale(l.peso_bruto - l.descuento_kg) USING ERRCODE = 'RC004';
  END IF;
  -- Si la cuenta ya se cobró, el guardián de los renglones lo rechaza.
  UPDATE operacion_linea SET tara = p_kg WHERE id = p_linea RETURNING * INTO l;
  RETURN l;
END $$;

-- Agrega un material con su peso, y con lo que pesa su recipiente si viene en uno: el renglón, la
-- pesada, su asiento en el renglón y el recipiente, o nada. Lo demás, como en la 0012.
DROP FUNCTION agregar_material(uuid, uuid, int, smallint, uuid, numeric, bigint);
CREATE FUNCTION agregar_material(p_cuenta uuid, p_linea uuid, p_material int, p_instrumento smallint,
                                 p_captura uuid, p_kg numeric, p_usuario bigint, p_recipiente numeric DEFAULT 0)
RETURNS operacion_linea
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  l             operacion_linea;
  v_restriccion text;
BEGIN
  PERFORM exigir_rol(p_usuario, 'mostrador', 'responsable', 'patio');
  PERFORM exigir_kilos(p_kg);
  PERFORM exigir_recipiente(p_recipiente);
  IF p_linea IS NULL OR p_captura IS NULL THEN
    RAISE EXCEPTION 'El material llegó sin identificador' USING ERRCODE = 'RC005';
  END IF;
  PERFORM 1 FROM operacion WHERE id = p_cuenta FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Esa cuenta no existe' USING ERRCODE = 'RC005';
  END IF;

  -- Sin recipiente, el envío se guarda como antes de que los hubiera.
  IF NOT reservar_envio(p_linea, 'material',
                        jsonb_build_object('cuenta', p_cuenta, 'material', p_material, 'bascula', p_instrumento,
                                           'pesada', p_captura, 'kg', trim_scale(p_kg)::text)
                        || CASE WHEN p_recipiente > 0 THEN jsonb_build_object('recipiente', trim_scale(p_recipiente)::text)
                                ELSE '{}'::jsonb END,
                        p_usuario) THEN
    -- El mismo envío, otra vez: se devuelve el material como esté ahora.
    SELECT * INTO l FROM operacion_linea WHERE id = p_linea;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Ese material ya se quitó de la cuenta: se pesa y se agrega de nuevo' USING ERRCODE = 'RC005';
    END IF;
    RETURN l;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM instrumento WHERE id = p_instrumento) THEN
    RAISE EXCEPTION 'Esa báscula no existe' USING ERRCODE = 'RC004';
  END IF;
  IF p_recipiente > 0 AND (SELECT doble_pesaje FROM instrumento WHERE id = p_instrumento) THEN
    RAISE EXCEPTION 'En la báscula grande no se pone recipiente: el vehículo se pesa lleno y vacío' USING ERRCODE = 'RC004';
  END IF;

  INSERT INTO operacion_linea (id, operacion_id, material_id, instrumento_id)
  VALUES (p_linea, p_cuenta, p_material, p_instrumento);
  BEGIN
    INSERT INTO captura_peso (id, instrumento_id, valor_kg, origen, tomada_por)
    VALUES (p_captura, p_instrumento, p_kg, 'tecleada', p_usuario);
  EXCEPTION WHEN unique_violation THEN
    -- Solo esta colisión es del negocio: la pesada ya existe. Cualquier otra sigue de largo.
    GET STACKED DIAGNOSTICS v_restriccion = CONSTRAINT_NAME;
    IF v_restriccion = 'captura_peso_pkey' THEN
      RAISE EXCEPTION 'Esa pesada ya se usó: hay que volver a pesar' USING ERRCODE = 'RC005';
    END IF;
    RAISE;
  END;
  INSERT INTO linea_pesada (linea_id, orden, captura_id) VALUES (p_linea, 1, p_captura);
  IF p_recipiente > 0 THEN
    l := poner_recipiente(p_linea, p_recipiente, p_usuario);
  ELSE
    SELECT * INTO l FROM operacion_linea WHERE id = p_linea;
  END IF;
  RETURN l;
END $$;

GRANT EXECUTE ON FUNCTION
  agregar_material(uuid, uuid, int, smallint, uuid, numeric, bigint, numeric),
  poner_recipiente(uuid, numeric, bigint)
TO feruga_app;
