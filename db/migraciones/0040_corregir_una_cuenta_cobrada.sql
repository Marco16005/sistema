-- Corregir un error de registro después de cobrar liquida solo la diferencia. El comprobante,
-- sus renglones, sus precios y sus movimientos originales siguen intactos. No es una cancelación:
-- los kilos corregidos son mayores que cero. «Pendiente» solo deja constancia, no mueve efectivo.

ALTER TABLE envio DROP CONSTRAINT envio_clase_check;
ALTER TABLE envio ADD CONSTRAINT envio_clase_check CHECK (clase IN (
  'cuenta', 'material', 'conteo', 'merma', 'separacion', 'correccion', 'cancelado', 'cierre', 'reapertura', 'precio',
  'caja_apertura', 'caja_movimiento', 'caja_corte', 'correccion_cuenta'
));

CREATE TABLE correccion_de_cuenta (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  operacion_id uuid NOT NULL REFERENCES operacion,
  linea_id uuid NOT NULL REFERENCES operacion_linea,
  numero int NOT NULL CHECK (numero > 0),
  material_antes int NOT NULL REFERENCES material,
  material_despues int NOT NULL REFERENCES material,
  kg_antes numeric(12,3) NOT NULL CHECK (kg_antes >= 0 AND kg_antes <= 999999),
  kg_despues numeric(12,3) NOT NULL CHECK (kg_despues > 0 AND kg_despues <= 999999),
  precio numeric(14,4) NOT NULL CHECK (precio > 0 AND precio <= 99999.9999),
  importe_antes numeric(14,2) NOT NULL CHECK (importe_antes >= 0 AND importe_antes <> 'NaN'),
  importe_despues numeric(14,2) NOT NULL CHECK (importe_despues = round(kg_despues * precio, 2)),
  diferencia numeric(14,2) GENERATED ALWAYS AS (importe_despues - importe_antes) STORED,
  liquidacion text NOT NULL CHECK (liquidacion IN ('efectivo', 'transferencia', 'pendiente')),
  jornada_id bigint NOT NULL REFERENCES jornada,
  motivo text NOT NULL CHECK (char_length(btrim(motivo)) BETWEEN 1 AND 200),
  autorizado_por bigint NOT NULL REFERENCES usuario,
  registrado_por bigint NOT NULL REFERENCES usuario,
  creado_en timestamptz NOT NULL DEFAULT clock_timestamp(),
  envio_id uuid NOT NULL UNIQUE REFERENCES envio,
  UNIQUE (linea_id, numero),
  CHECK (material_antes <> material_despues OR kg_antes <> kg_despues)
);
CREATE INDEX correccion_de_cuenta_por_operacion ON correccion_de_cuenta (operacion_id);
CREATE INDEX correccion_de_cuenta_por_jornada ON correccion_de_cuenta (jornada_id);
CREATE TRIGGER correccion_de_cuenta_inmutable BEFORE UPDATE OR DELETE ON correccion_de_cuenta
  FOR EACH ROW EXECUTE FUNCTION rechazar_cambio();
CREATE TRIGGER correccion_de_cuenta_sin_vaciar BEFORE TRUNCATE ON correccion_de_cuenta
  FOR EACH STATEMENT EXECUTE FUNCTION rechazar_cambio();

CREATE FUNCTION corregir_cuenta(
  p_envio uuid, p_linea uuid, p_kg numeric, p_material int, p_vistas int,
  p_liquidacion text, p_motivo text, p_autoriza bigint, p_clave text, p_huella text, p_usuario bigint
) RETURNS correccion_de_cuenta
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  u usuario;
  op operacion;
  l operacion_linea;
  j jornada;
  original movimiento_inventario;
  anterior correccion_de_cuenta;
  c correccion_de_cuenta;
  d record;
  v_numero int;
  v_material int;
  v_kg numeric;
  v_precio numeric;
  v_importe numeric;
  v_signo int;
  v_diferencias jsonb;
  v_motivo text := texto_limpio(p_motivo, 'El motivo');
  v_contenido jsonb;
BEGIN
  u := exigir_rol(p_usuario, 'mostrador', 'responsable');
  PERFORM exigir_kilos(p_kg);
  IF p_linea IS NULL OR p_material IS NULL OR p_vistas IS NULL OR p_vistas < 0 OR v_motivo IS NULL THEN
    RAISE EXCEPTION 'La corrección lleva renglón, material, correcciones vistas y motivo' USING ERRCODE = 'RC005';
  END IF;
  IF p_liquidacion IS NULL OR p_liquidacion NOT IN ('efectivo', 'transferencia', 'pendiente') THEN
    RAISE EXCEPTION 'La diferencia se liquida en efectivo, por transferencia o queda pendiente' USING ERRCODE = 'RC005';
  END IF;
  v_contenido := jsonb_build_object('linea', p_linea, 'kg', trim_scale(p_kg)::text, 'material', p_material,
    'vistas', p_vistas, 'liquidacion', p_liquidacion, 'motivo', v_motivo, 'autoriza', p_autoriza);
  -- El mismo candado y protocolo de 0038: un reintento devuelve incluso un resultado antiguo,
  -- sin volver a mirar la clave ni exigir que siga abierta aquella jornada.
  IF envio_del_cajon(p_envio, 'correccion_cuenta', v_contenido, p_usuario) THEN
    SELECT * INTO c FROM correccion_de_cuenta WHERE envio_id = p_envio;
    RETURN c;
  END IF;

  SELECT * INTO l FROM operacion_linea WHERE id = p_linea;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ese renglón no existe' USING ERRCODE = 'RC005';
  END IF;
  SELECT * INTO op FROM operacion WHERE id = l.operacion_id;
  IF op.estado <> 'confirmada' OR op.sucursal_id <> u.sucursal_id THEN
    RAISE EXCEPTION 'Solo se corrige una cuenta ya confirmada de esta sucursal' USING ERRCODE = 'RC005';
  END IF;
  -- Jornada antes que patio: el corte espera todo el ajuste, incluido el dinero, o la corrección
  -- encuentra cerrada la jornada. La selección se vuelve a comprobar tras cualquier espera.
  SELECT * INTO j FROM jornada WHERE id = jornada_abierta(op.sucursal_id) FOR SHARE;
  IF NOT FOUND OR j.cerrada_en IS NOT NULL THEN
    RAISE EXCEPTION 'La corrección se registra en una jornada abierta' USING ERRCODE = 'RC006';
  END IF;
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'El libro de inventario solo se escribe en READ COMMITTED' USING ERRCODE = 'RC010';
  END IF;
  PERFORM pg_advisory_xact_lock(7151, op.sucursal_id);
  -- Con el turno del patio ganado, otra corrección de este renglón ya es visible. El índice
  -- único respalda la numeración, pero una vista vieja recibe RC011 antes de probar la clave.
  SELECT * INTO anterior FROM correccion_de_cuenta WHERE linea_id = l.id ORDER BY numero DESC LIMIT 1;
  v_numero := coalesce(anterior.numero, 0);
  IF p_vistas <> v_numero THEN
    RAISE EXCEPTION 'Ese renglón se corrigió desde que se revisó: tenía % correcciones y ahora %',
      p_vistas, v_numero USING ERRCODE = 'RC011';
  END IF;
  v_material := coalesce(anterior.material_despues, l.material_id);
  v_kg := coalesce(anterior.kg_despues, l.peso_liquidable);
  v_importe := coalesce(anterior.importe_despues, l.importe);
  IF p_material = v_material AND p_kg = v_kg THEN
    RAISE EXCEPTION 'El renglón ya tiene esos kilos y ese material' USING ERRCODE = 'RC005';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM material WHERE id = p_material AND activo AND sucursal_id = op.sucursal_id) THEN
    RAISE EXCEPTION 'Ese material no existe o está dado de baja' USING ERRCODE = 'RC005';
  END IF;
  IF p_material = v_material THEN
    v_precio := coalesce(anterior.precio, l.precio_unitario); -- conserva también el especial cobrado
  ELSE
    SELECT CASE op.tipo WHEN 'compra' THEN compra ELSE venta END INTO v_precio
    FROM precio WHERE lista_id = op.lista_id AND material_id = p_material;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Ese material no tenía precio en la lista de la cuenta' USING ERRCODE = 'RC009';
    END IF;
  END IF;
  SELECT * INTO original FROM movimiento_inventario WHERE linea_id = l.id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'El renglón no tiene su movimiento de inventario' USING ERRCODE = 'RC005';
  END IF;
  v_signo := CASE op.tipo WHEN 'compra' THEN 1 ELSE -1 END;
  -- Los kilos de esta entrada son liquidables. La diferencia no reescribe el descuento ni la
  -- tara originales: mismo material mueve solo el delta; otro retira lo vigente y agrega lo nuevo.
  SELECT jsonb_object_agg(material::text, kg) INTO v_diferencias FROM (
    SELECT material, sum(kg) AS kg FROM (VALUES
      (v_material, -v_signo * v_kg), (p_material, v_signo * p_kg)
    ) AS x(material, kg) GROUP BY material HAVING sum(kg) <> 0
  ) AS cambios;
  -- Como en 0017: un conteo posterior ya fijó la existencia; no se corrige dos veces lo contado.
  IF EXISTS (SELECT 1 FROM conteo WHERE material_id IN (SELECT key::int FROM jsonb_each(v_diferencias))
             AND contado_en >= original.efectivo_en) THEN
    RAISE EXCEPTION 'Después de ese movimiento ya se contó el material: hay que revisar el inventario'
      USING ERRCODE = 'RC005';
  END IF;
  FOR d IN SELECT key::int AS material, value::numeric AS kg FROM jsonb_each_text(v_diferencias) LOOP
    IF d.kg < 0 AND (SELECT coalesce(sum(cantidad_kg), 0) FROM movimiento_inventario WHERE material_id = d.material) + d.kg < 0 THEN
      RAISE EXCEPTION 'No alcanza el material % para la corrección', d.material USING ERRCODE = 'RC002';
    END IF;
  END LOOP;

  IF NOT autorizo_con_clave(p_huella, p_autoriza, p_clave) THEN RETURN NULL; END IF;
  PERFORM reservar_envio(p_envio, 'correccion_cuenta', v_contenido, p_usuario);
  INSERT INTO correccion_de_cuenta (operacion_id, linea_id, numero, material_antes, material_despues,
    kg_antes, kg_despues, precio, importe_antes, importe_despues, liquidacion, jornada_id, motivo,
    autorizado_por, registrado_por, envio_id)
  VALUES (op.id, l.id, v_numero + 1, v_material, p_material, v_kg, p_kg, v_precio, v_importe,
    round(p_kg * v_precio, 2), p_liquidacion, j.id, v_motivo, p_autoriza, p_usuario, p_envio)
  RETURNING * INTO c;
  FOR d IN SELECT key::int AS material, value::numeric AS kg FROM jsonb_each_text(v_diferencias) ORDER BY key::int LOOP
    -- movimiento_valorar (0039) calcula el costo de cada ajuste: promedio vigente al sacar o
    -- agregar; sin kilos, precio de compra de la lista correspondiente al ajuste.
    INSERT INTO movimiento_inventario (sucursal_id, material_id, tipo, cantidad_kg, jornada_id,
      referencia_id, motivo, autorizado_por, creado_por)
    VALUES (op.sucursal_id, d.material, 'ajuste', d.kg, j.id, original.id,
      format('Corrección %s de cuenta %s, renglón %s: %s', c.numero, op.folio, l.id, v_motivo), p_autoriza, p_usuario);
  END LOOP;
  PERFORM anotar(p_usuario, 'corregir', 'operacion', op.id::text,
    jsonb_build_object('folio', op.folio, 'renglón', l.id,
      'antes', jsonb_build_object('material', v_material, 'kg', v_kg, 'importe', v_importe),
      'después', jsonb_build_object('material', p_material, 'kg', p_kg, 'precio', v_precio, 'importe', c.importe_despues),
      'diferencia', c.diferencia, 'liquidación', p_liquidacion, 'autoriza', p_autoriza, 'motivo', v_motivo));
  RETURN c;
END $$;

CREATE OR REPLACE FUNCTION esperado_en_cajon(p_jornada bigint) RETURNS numeric
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT a.contado
    + coalesce((SELECT sum(CASE tipo WHEN 'venta' THEN total ELSE -total END) FROM operacion
                WHERE confirmada_en_jornada = p_jornada AND estado = 'confirmada' AND forma_de_pago = 'efectivo'), 0)
    + coalesce((SELECT sum(CASE tipo WHEN 'meter' THEN importe ELSE -importe END) FROM caja_movimiento
                WHERE jornada_id = p_jornada), 0)
    -- Compra: diferencia positiva sale (se completa lo pagado de menos), negativa entra
    -- (el vendedor devuelve). Venta: al revés. Cuenta en la jornada de la corrección, solo efectivo.
    + coalesce((SELECT sum(CASE o.tipo WHEN 'venta' THEN c.diferencia ELSE -c.diferencia END)
                FROM correccion_de_cuenta c JOIN operacion o ON o.id = c.operacion_id
                WHERE c.jornada_id = p_jornada AND c.liquidacion = 'efectivo'), 0)
    - coalesce((SELECT sum(retirado) FROM caja_corte WHERE jornada_id = p_jornada), 0)
  FROM caja_apertura a WHERE a.jornada_id = p_jornada;
$$;

GRANT SELECT ON correccion_de_cuenta TO feruga_app;
GRANT EXECUTE ON FUNCTION corregir_cuenta(uuid, uuid, numeric, int, int, text, text, bigint, text, text, bigint)
TO feruga_app;
