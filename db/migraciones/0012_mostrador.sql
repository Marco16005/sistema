-- Las entradas del mostrador. Cada acción de la pantalla —poner un precio, abrir una cuenta,
-- agregar un material con su peso, la segunda pesada de un vehículo, quitar, descontar, etiquetar,
-- descartar— es una función que recibe a la persona, valida su rol y hace la acción completa.
--
-- Hasta aquí la aplicación componía esas acciones con escrituras directas, que no decían quién
-- las hacía ni comprobaban su rol. Ahora se le retiran: no puede escribir en cuentas, renglones,
-- pesadas, precios ni catálogo si no es por estas funciones.
--
-- Todas se pueden repetir: el identificador de la cuenta, del material y de la pesada lo pone
-- quien envía, y lo que llega queda registrado con su contenido. Si el mismo envío llega otra vez
-- igual, se devuelve lo que hay; si llega con otro contenido, se rechaza; y si lo que creó ya se
-- descartó o se quitó, se rechaza también, en vez de volver a crearlo. Así un reintento por una
-- respuesta perdida no duplica nada ni revive lo que se borró.
--
-- Todas toman primero la cuenta y después lo demás: el mismo orden de candados que confirmar.

-- Toda función que se cree de aquí en adelante nace sin permiso para nadie: quien deba ejecutarla
-- lo recibe de forma explícita. La migración anterior quiso lograrlo con una regla por esquema,
-- pero Postgres no deja retirar por esquema lo que concede de forma global; esta sí surte efecto.
-- Vale para lo que cree el usuario que migra: las migraciones corren siempre con el mismo.
ALTER DEFAULT PRIVILEGES REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

-- Un peso que entra tecleado: un número mayor que cero con no más de tres decimales. Se rechaza
-- aquí en vez de dejar que la columna lo redondee en silencio.
CREATE FUNCTION exigir_kilos(p_kg numeric) RETURNS void
LANGUAGE plpgsql IMMUTABLE SET search_path = public, pg_temp AS $$
BEGIN
  IF p_kg IS NULL OR p_kg IN ('NaN', 'Infinity', '-Infinity') THEN
    RAISE EXCEPTION 'El peso tiene que ser un número' USING ERRCODE = 'RC004';
  END IF;
  IF p_kg <= 0 THEN
    RAISE EXCEPTION 'El peso tiene que ser mayor que cero' USING ERRCODE = 'RC004';
  END IF;
  -- El tope va antes de tocar una columna: pasado de ahí la base contestaría con un desbordamiento.
  IF p_kg > 999999 THEN
    RAISE EXCEPTION 'El peso no puede pasar de 999 999 kg' USING ERRCODE = 'RC004';
  END IF;
  IF p_kg <> round(p_kg, 3) THEN
    RAISE EXCEPTION 'El peso lleva hasta tres decimales y llegó %', p_kg USING ERRCODE = 'RC004';
  END IF;
END $$;

-- Lo que ya llegó. Cada cuenta y cada material que la aplicación envía deja aquí su
-- identificador con el contenido con que llegó, y no se borra aunque la cuenta se descarte o el
-- material se quite: es la memoria que distingue un reintento de un envío nuevo.
CREATE TABLE envio (
  id          uuid PRIMARY KEY,
  clase       text NOT NULL CHECK (clase IN ('cuenta', 'material')),
  contenido   jsonb NOT NULL,
  recibido_en timestamptz NOT NULL DEFAULT clock_timestamp(),
  recibido_de bigint NOT NULL REFERENCES usuario
);
CREATE TRIGGER envio_inmutable BEFORE UPDATE OR DELETE ON envio
  FOR EACH ROW EXECUTE FUNCTION rechazar_cambio();
CREATE TRIGGER envio_sin_vaciar BEFORE TRUNCATE ON envio
  FOR EACH STATEMENT EXECUTE FUNCTION rechazar_cambio();

-- Registra el envío. Dice si es nuevo; si ya estaba con el mismo contenido, dice que no; si ya
-- estaba con otro, lo rechaza. Dos envíos a la vez con el mismo identificador pasan de uno en uno:
-- el segundo espera aquí al primero, sean de la cuenta que sean.
CREATE FUNCTION reservar_envio(p_id uuid, p_clase text, p_contenido jsonb, p_usuario bigint) RETURNS boolean
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  e envio;
BEGIN
  INSERT INTO envio (id, clase, contenido, recibido_de) VALUES (p_id, p_clase, p_contenido, p_usuario)
  ON CONFLICT (id) DO NOTHING;
  IF FOUND THEN
    RETURN true;
  END IF;
  SELECT * INTO e FROM envio WHERE id = p_id;
  IF e.clase <> p_clase OR e.contenido <> p_contenido THEN
    RAISE EXCEPTION 'Ese envío ya se había recibido con otros datos' USING ERRCODE = 'RC005';
  END IF;
  RETURN false;
END $$;

-- ── precios ─────────────────────────────────────────────────────────────────

-- Pone o cambia el precio de un material en la lista de hoy, mientras no se haya publicado.
CREATE FUNCTION fijar_precio(p_material int, p_compra numeric, p_venta numeric, p_usuario bigint) RETURNS precio
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  u       usuario;
  v_lista bigint;
  p       precio;
BEGIN
  u := exigir_rol(p_usuario, 'responsable');
  IF p_compra IS NULL OR p_venta IS NULL
     OR p_compra IN ('NaN', 'Infinity', '-Infinity') OR p_venta IN ('NaN', 'Infinity', '-Infinity') THEN
    RAISE EXCEPTION 'El precio tiene que ser un número' USING ERRCODE = 'RC009';
  END IF;
  IF p_compra < 0 OR p_venta < 0 THEN
    RAISE EXCEPTION 'El precio no puede ser negativo' USING ERRCODE = 'RC009';
  END IF;
  -- Con este tope y el de los kilos, un importe siempre cabe.
  IF p_compra > 99999.9999 OR p_venta > 99999.9999 THEN
    RAISE EXCEPTION 'El precio no puede pasar de 99 999.9999 pesos por kilo' USING ERRCODE = 'RC009';
  END IF;
  IF p_compra <> round(p_compra, 4) OR p_venta <> round(p_venta, 4) THEN
    RAISE EXCEPTION 'El precio lleva hasta cuatro decimales' USING ERRCODE = 'RC009';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM material WHERE id = p_material AND sucursal_id = u.sucursal_id AND activo) THEN
    RAISE EXCEPTION 'Ese material no existe o está dado de baja' USING ERRCODE = 'RC005';
  END IF;
  -- Quien cambia precios toma primero la lista entera: dos que guardan a la vez pasan uno tras
  -- otro, en vez de trabarse cada uno con un material que el otro ya tocó.
  SELECT id INTO v_lista FROM lista_precios WHERE jornada_id = jornada_abierta(u.sucursal_id) FOR UPDATE;
  INSERT INTO precio (lista_id, material_id, compra, venta) VALUES (v_lista, p_material, p_compra, p_venta)
  ON CONFLICT (lista_id, material_id) DO UPDATE SET compra = EXCLUDED.compra, venta = EXCLUDED.venta
  RETURNING * INTO p;
  RETURN p;
END $$;

-- Deja a un material sin precio en la lista de hoy: ese día no se compra ni se vende.
CREATE FUNCTION quitar_precio(p_material int, p_usuario bigint) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  u       usuario;
  v_lista bigint;
BEGIN
  u := exigir_rol(p_usuario, 'responsable');
  SELECT id INTO v_lista FROM lista_precios WHERE jornada_id = jornada_abierta(u.sucursal_id) FOR UPDATE;
  DELETE FROM precio WHERE material_id = p_material AND lista_id = v_lista;
  RETURN FOUND;
END $$;

-- ── cuentas ─────────────────────────────────────────────────────────────────

CREATE FUNCTION etiqueta_limpia(p_etiqueta text) RETURNS text
LANGUAGE plpgsql IMMUTABLE SET search_path = public, pg_temp AS $$
DECLARE
  v text := nullif(btrim(p_etiqueta), '');
BEGIN
  IF char_length(v) > 40 THEN
    RAISE EXCEPTION 'La etiqueta de la cuenta lleva hasta 40 letras' USING ERRCODE = 'RC005';
  END IF;
  RETURN v;
END $$;

-- Abre una cuenta en la jornada de hoy. Cuántas puede haber abiertas a la vez es regla de la pantalla.
CREATE FUNCTION abrir_cuenta(p_id uuid, p_tipo text, p_etiqueta text, p_usuario bigint) RETURNS operacion
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  u          usuario;
  op         operacion;
  v_etiqueta text := etiqueta_limpia(p_etiqueta);
BEGIN
  u := exigir_rol(p_usuario, 'mostrador', 'responsable', 'patio');
  IF p_id IS NULL THEN
    RAISE EXCEPTION 'La cuenta llegó sin identificador' USING ERRCODE = 'RC005';
  END IF;
  IF p_tipo IS NULL OR p_tipo NOT IN ('compra', 'venta') THEN
    RAISE EXCEPTION 'Una cuenta es de compra o de venta' USING ERRCODE = 'RC005';
  END IF;
  IF reservar_envio(p_id, 'cuenta', jsonb_build_object('tipo', p_tipo, 'etiqueta', v_etiqueta), p_usuario) THEN
    INSERT INTO operacion (id, sucursal_id, jornada_id, tipo, etiqueta, creada_por)
    VALUES (p_id, u.sucursal_id, jornada_abierta(u.sucursal_id), p_tipo, v_etiqueta, p_usuario)
    RETURNING * INTO op;
    RETURN op;
  END IF;
  -- El mismo envío, otra vez: se devuelve la cuenta como esté ahora.
  SELECT * INTO op FROM operacion WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Esa cuenta ya se descartó: para seguir se abre otra' USING ERRCODE = 'RC005';
  END IF;
  RETURN op;
END $$;

-- Agrega un material con su peso: el renglón, la pesada y su asiento en el renglón, o nada.
-- En la báscula grande esta es la primera pesada, y el material queda esperando la segunda.
CREATE FUNCTION agregar_material(p_cuenta uuid, p_linea uuid, p_material int, p_instrumento smallint,
                                 p_captura uuid, p_kg numeric, p_usuario bigint) RETURNS operacion_linea
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  l             operacion_linea;
  v_restriccion text;
BEGIN
  PERFORM exigir_rol(p_usuario, 'mostrador', 'responsable', 'patio');
  PERFORM exigir_kilos(p_kg);
  IF p_linea IS NULL OR p_captura IS NULL THEN
    RAISE EXCEPTION 'El material llegó sin identificador' USING ERRCODE = 'RC005';
  END IF;
  PERFORM 1 FROM operacion WHERE id = p_cuenta FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Esa cuenta no existe' USING ERRCODE = 'RC005';
  END IF;

  IF NOT reservar_envio(p_linea, 'material',
                        jsonb_build_object('cuenta', p_cuenta, 'material', p_material, 'bascula', p_instrumento,
                                           'pesada', p_captura, 'kg', trim_scale(p_kg)::text),
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
  SELECT * INTO l FROM operacion_linea WHERE id = p_linea;
  RETURN l;
END $$;

-- La segunda pesada de un vehículo. Se admite aunque la jornada de la cuenta ya haya cerrado:
-- es el vehículo que volvió otro día.
CREATE FUNCTION segunda_pesada(p_linea uuid, p_captura uuid, p_kg numeric, p_usuario bigint) RETURNS operacion_linea
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  l         operacion_linea;
  v_cuenta  uuid;
  v_captura uuid;
  v_kg      numeric;
  v_restriccion text;
BEGIN
  PERFORM exigir_rol(p_usuario, 'mostrador', 'responsable', 'patio');
  PERFORM exigir_kilos(p_kg);
  IF p_captura IS NULL THEN
    RAISE EXCEPTION 'La pesada llegó sin identificador' USING ERRCODE = 'RC005';
  END IF;
  SELECT operacion_id INTO v_cuenta FROM operacion_linea WHERE id = p_linea;
  IF FOUND THEN
    PERFORM 1 FROM operacion WHERE id = v_cuenta FOR UPDATE;
    -- Mientras se esperaba la cuenta, el material pudo quitarse.
    SELECT * INTO l FROM operacion_linea WHERE id = p_linea;
  END IF;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ese material no está en ninguna cuenta' USING ERRCODE = 'RC005';
  END IF;

  SELECT lp.captura_id, c.valor_kg INTO v_captura, v_kg
  FROM linea_pesada lp JOIN captura_peso c ON c.id = lp.captura_id
  WHERE lp.linea_id = p_linea AND lp.orden = 2;
  IF FOUND THEN
    IF v_captura = p_captura AND v_kg = p_kg THEN
      RETURN l;     -- el mismo envío, otra vez
    END IF;
    RAISE EXCEPTION 'Ese material ya tiene su segunda pesada' USING ERRCODE = 'RC005';
  END IF;

  BEGIN
    INSERT INTO captura_peso (id, instrumento_id, valor_kg, origen, tomada_por)
    VALUES (p_captura, l.instrumento_id, p_kg, 'tecleada', p_usuario);
  EXCEPTION WHEN unique_violation THEN
    GET STACKED DIAGNOSTICS v_restriccion = CONSTRAINT_NAME;
    IF v_restriccion = 'captura_peso_pkey' THEN
      RAISE EXCEPTION 'Esa pesada ya se usó: hay que volver a pesar' USING ERRCODE = 'RC005';
    END IF;
    RAISE;
  END;
  INSERT INTO linea_pesada (linea_id, orden, captura_id) VALUES (p_linea, 2, p_captura);
  SELECT * INTO l FROM operacion_linea WHERE id = p_linea;
  RETURN l;
END $$;

-- Quita un material de una cuenta abierta. Dice si lo quitó: repetirlo no falla.
CREATE FUNCTION quitar_material(p_linea uuid, p_usuario bigint) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_cuenta uuid;
BEGIN
  PERFORM exigir_rol(p_usuario, 'mostrador', 'responsable', 'patio');
  SELECT operacion_id INTO v_cuenta FROM operacion_linea WHERE id = p_linea;
  IF NOT FOUND THEN
    RETURN false;
  END IF;
  PERFORM 1 FROM operacion WHERE id = v_cuenta FOR UPDATE;
  DELETE FROM operacion_linea WHERE id = p_linea;
  RETURN FOUND;
END $$;

-- Kilos que se pesaron pero no se pagan (tierra, agua, lo que no es material). Bajan lo que se
-- liquida, no lo que entra al patio. Es decisión de quien cobra, no de quien pesa.
CREATE FUNCTION poner_descuento(p_linea uuid, p_kg numeric, p_usuario bigint) RETURNS operacion_linea
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  l        operacion_linea;
  v_cuenta uuid;
BEGIN
  PERFORM exigir_rol(p_usuario, 'mostrador', 'responsable');
  IF p_kg IS NULL OR p_kg IN ('NaN', 'Infinity', '-Infinity') OR p_kg < 0 OR p_kg <> round(p_kg, 3) THEN
    RAISE EXCEPTION 'El descuento es en kilos, de cero en adelante y con hasta tres decimales' USING ERRCODE = 'RC004';
  END IF;
  SELECT operacion_id INTO v_cuenta FROM operacion_linea WHERE id = p_linea;
  IF FOUND THEN
    PERFORM 1 FROM operacion WHERE id = v_cuenta FOR UPDATE;
    SELECT * INTO l FROM operacion_linea WHERE id = p_linea;
  END IF;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ese material no está en ninguna cuenta' USING ERRCODE = 'RC005';
  END IF;
  IF l.descuento_kg = p_kg THEN
    RETURN l;       -- ya estaba así: no es un cambio de la cuenta
  END IF;
  IF l.peso_recibido IS NULL THEN
    RAISE EXCEPTION 'Ese material todavía no termina de pesarse' USING ERRCODE = 'RC004';
  END IF;
  IF p_kg > l.peso_recibido THEN
    RAISE EXCEPTION 'El descuento (% kg) no puede ser mayor que lo que pesó (% kg)', p_kg, l.peso_recibido
      USING ERRCODE = 'RC004';
  END IF;
  UPDATE operacion_linea SET descuento_kg = p_kg WHERE id = p_linea RETURNING * INTO l;
  RETURN l;
END $$;

-- El nombre con que el mostrador reconoce la cuenta: «camioneta roja», «don Chuy».
CREATE FUNCTION etiquetar_cuenta(p_cuenta uuid, p_etiqueta text, p_usuario bigint) RETURNS operacion
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  op         operacion;
  v_etiqueta text := etiqueta_limpia(p_etiqueta);
BEGIN
  PERFORM exigir_rol(p_usuario, 'mostrador', 'responsable', 'patio');
  SELECT * INTO op FROM operacion WHERE id = p_cuenta FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Esa cuenta no existe' USING ERRCODE = 'RC005';
  END IF;
  IF op.etiqueta IS NOT DISTINCT FROM v_etiqueta THEN
    RETURN op;      -- ya estaba así: no es un cambio de la cuenta
  END IF;
  UPDATE operacion SET etiqueta = v_etiqueta WHERE id = p_cuenta RETURNING * INTO op;
  RETURN op;
END $$;

-- Descarta una cuenta abierta con todo lo que tenía. Dice si la descartó: repetirlo no falla.
-- Si ya tenía materiales pesados queda anotado: esa cuenta existió, pesó eso y no se cobró.
CREATE FUNCTION descartar_cuenta(p_cuenta uuid, p_usuario bigint) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  op           operacion;
  v_materiales int;
  v_suma       numeric(14,2);
BEGIN
  PERFORM exigir_rol(p_usuario, 'mostrador', 'responsable', 'patio');
  SELECT * INTO op FROM operacion WHERE id = p_cuenta FOR UPDATE;
  IF NOT FOUND THEN
    RETURN false;
  END IF;
  SELECT count(*), coalesce(sum(importe), 0) INTO v_materiales, v_suma FROM operacion_linea WHERE operacion_id = p_cuenta;
  DELETE FROM operacion WHERE id = p_cuenta;
  IF v_materiales > 0 THEN
    PERFORM anotar(p_usuario, 'descartar', 'operacion', p_cuenta::text,
                   jsonb_build_object('tipo', op.tipo, 'etiqueta', op.etiqueta, 'materiales', v_materiales, 'suma', v_suma));
  END IF;
  RETURN true;
END $$;

-- ── el resumen de una cuenta ────────────────────────────────────────────────

-- Lo que la pantalla muestra al pie de una cuenta abierta: cuántos materiales lleva, cuántos
-- faltan por pesar y, con lo ya pesado, la suma, el ajuste y el total en pesos cerrados. La
-- cuenta se hace aquí, con la misma regla que al confirmar, para que la pantalla no la repita.
CREATE VIEW cuenta_resumen AS
SELECT o.id AS operacion_id,
       count(l.id)::int AS materiales,
       (count(l.id) FILTER (WHERE l.peso_bruto IS NULL))::int AS por_pesar,
       coalesce(sum(l.importe), 0)::numeric(14,2) AS suma,
       (round(coalesce(sum(l.importe), 0)) - coalesce(sum(l.importe), 0))::numeric(14,2) AS ajuste_redondeo,
       round(coalesce(sum(l.importe), 0))::numeric(14,0) AS total
FROM operacion o
LEFT JOIN operacion_linea l ON l.operacion_id = o.id
GROUP BY o.id;

-- ── permisos ────────────────────────────────────────────────────────────────

-- Lo que la aplicación componía por su cuenta, ya no. Retirar el permiso de la tabla retira
-- también los que tenía por columna.
REVOKE INSERT, UPDATE, DELETE ON precio, operacion, operacion_linea, linea_pesada, captura_peso, material FROM feruga_app;
REVOKE EXECUTE ON FUNCTION quitar_renglon(uuid), fijar_descuento(uuid, numeric) FROM feruga_app;

GRANT SELECT ON cuenta_resumen TO feruga_app;
GRANT EXECUTE ON FUNCTION
  fijar_precio(int, numeric, numeric, bigint),
  quitar_precio(int, bigint),
  abrir_cuenta(uuid, text, text, bigint),
  agregar_material(uuid, uuid, int, smallint, uuid, numeric, bigint),
  segunda_pesada(uuid, uuid, numeric, bigint),
  quitar_material(uuid, bigint),
  poner_descuento(uuid, numeric, bigint),
  etiquetar_cuenta(uuid, text, bigint),
  descartar_cuenta(uuid, bigint)
TO feruga_app;
