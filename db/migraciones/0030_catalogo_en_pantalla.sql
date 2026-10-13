-- El responsable administra el catálogo desde la pantalla. Los nombres no cambian: los
-- comprobantes antiguos los leen del catálogo de hoy. Para otro nombre se crea otro material.
-- La unicidad también comprende las bajas; dos altas simultáneas reciben el mismo mensaje
-- de negocio, sin dejar escapar una restricción. La aplicación sigue sin escribir la tabla.

CREATE UNIQUE INDEX material_nombre_sin_mayusculas ON material (sucursal_id, lower(nombre));

CREATE FUNCTION alta_material(p_familia smallint, p_nombre text, p_nombre_corto text, p_frecuente boolean, p_usuario bigint)
RETURNS material
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  m material;
  v_nombre text;
  v_corto text;
BEGIN
  PERFORM exigir_rol(p_usuario, 'responsable');
  -- Se juntan espacios, pero no se convierten controles en nombres válidos.
  v_nombre := regexp_replace(btrim(coalesce(p_nombre, '')), ' +', ' ', 'g');
  v_corto := regexp_replace(btrim(coalesce(p_nombre_corto, '')), ' +', ' ', 'g');
  IF char_length(v_nombre) NOT BETWEEN 2 AND 40 OR v_nombre ~ '[[:cntrl:]]' THEN
    RAISE EXCEPTION 'El nombre lleva de 2 a 40 caracteres, sin saltos de línea ni tabuladores' USING ERRCODE = 'RC005';
  END IF;
  IF char_length(v_corto) NOT BETWEEN 1 AND 24 OR v_corto ~ '[[:cntrl:]]' THEN
    RAISE EXCEPTION 'El nombre corto lleva de 1 a 24 caracteres, sin saltos de línea ni tabuladores' USING ERRCODE = 'RC005';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM familia WHERE id = p_familia) THEN
    RAISE EXCEPTION 'Esa familia no existe' USING ERRCODE = 'RC005';
  END IF;

  PERFORM set_config('feruga.usuario', p_usuario::text, true);
  INSERT INTO material (sucursal_id, familia_id, nombre, nombre_corto, frecuente)
  VALUES (1, p_familia, v_nombre, v_corto, coalesce(p_frecuente, false))
  ON CONFLICT DO NOTHING RETURNING * INTO m;
  IF FOUND THEN RETURN m; END IF;

  -- El INSERT espera a la otra alta; esta consulta ya ve el material que ganó.
  SELECT * INTO m FROM material WHERE sucursal_id = 1 AND lower(nombre) = lower(v_nombre);
  IF m.activo THEN
    RAISE EXCEPTION 'Ya hay un material que se llama «%»', m.nombre USING ERRCODE = 'RC005';
  END IF;
  RAISE EXCEPTION '«%» está dado de baja: reactívalo en vez de crear otro', m.nombre USING ERRCODE = 'RC005';
END $$;

CREATE FUNCTION cambiar_material(p_material int, p_activo boolean, p_frecuente boolean, p_usuario bigint)
RETURNS material
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  m material;
  v_kg numeric(14,3);
BEGIN
  PERFORM exigir_rol(p_usuario, 'responsable');
  SELECT * INTO m FROM material WHERE id = p_material AND sucursal_id = 1 FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ese material no existe' USING ERRCODE = 'RC005';
  END IF;
  IF coalesce(p_activo, m.activo) = m.activo AND coalesce(p_frecuente, m.frecuente) = m.frecuente THEN
    RETURN m;
  END IF;
  IF m.activo AND p_activo = false THEN
    SELECT kg INTO v_kg FROM existencia WHERE material_id = m.id;
    IF v_kg <> 0 THEN
      RAISE EXCEPTION 'Todavía hay % kg de % en el patio: primero hay que venderlo, darlo de baja del inventario o corregirlo', v_kg, m.nombre
        USING ERRCODE = 'RC005';
    END IF;
    IF EXISTS (SELECT 1 FROM operacion_linea l JOIN operacion o ON o.id = l.operacion_id
               WHERE l.material_id = m.id AND o.estado = 'borrador') THEN
      RAISE EXCEPTION '% está en una cuenta abierta: termínala o quítalo de ahí primero', m.nombre USING ERRCODE = 'RC005';
    END IF;
  END IF;
  PERFORM set_config('feruga.usuario', p_usuario::text, true);
  UPDATE material SET activo = coalesce(p_activo, m.activo), frecuente = coalesce(p_frecuente, m.frecuente)
  WHERE id = m.id RETURNING * INTO m;
  RETURN m;
END $$;

GRANT EXECUTE ON FUNCTION
  alta_material(smallint, text, text, boolean, bigint),
  cambiar_material(int, boolean, boolean, bigint)
TO feruga_app;
