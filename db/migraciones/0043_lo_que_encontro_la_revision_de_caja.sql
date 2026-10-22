-- Lo que encontró la revisión de Codex de la caja y la ganancia (informe 31, 21 de octubre de 2026;
-- docs/revisiones/2026-10-21-codex-revision-de-caja-y-ganancia-incompleta.md). Cada función se
-- vuelve a escribir desde su última versión, cambiando solo lo que se dice aquí:
--
--   H1  Un solo orden de candados: jornada, patio y al final la clave. Terminar un vehículo, contar
--       un material y corregir un movimiento tomaban la clave antes que el patio, y corregir una
--       cuenta y fiar, al revés: con la misma persona firmando en dos equipos, se esperaban una a otra.
--   H3  Repetir un cobro con otro contenido —otra forma de pago, otro cliente, otro plazo, otra
--       firma— ya no devuelve el cobro que se hizo como si fuera ese: se rechaza (RC011).
--   H4  Cada ajuste de inventario que sale de corregir una cuenta dice de qué corrección es
--       (movimiento_inventario.correccion_id): la ganancia lo cuenta con su dinero, no como baja.
--   H7  Una venta fiada se corrige sobre lo que debe el cliente («a lo fiado»), o se liquida en el
--       momento; ya no se deja «pendiente», que no cambiaba la deuda. Lo que debe toma en cuenta lo
--       corregido, y no puede quedar a su favor: no hay adelantos.

-- ── H4: el ajuste sabe de qué corrección es ──────────────────────────────────

ALTER TABLE movimiento_inventario ADD COLUMN correccion_id bigint REFERENCES correccion_de_cuenta;
ALTER TABLE movimiento_inventario ADD CONSTRAINT correccion_es_ajuste CHECK (correccion_id IS NULL OR tipo = 'ajuste');
CREATE INDEX movimiento_por_correccion ON movimiento_inventario (correccion_id) WHERE correccion_id IS NOT NULL;

-- Las que ya hay se reconocen por lo que corregir_cuenta (0040) escribió en cada una: su jornada, el
-- movimiento del renglón que corrige y su motivo, que lleva el número de la corrección.
ALTER TABLE movimiento_inventario DISABLE TRIGGER movimiento_inmutable;
UPDATE movimiento_inventario mi SET correccion_id = c.id
FROM correccion_de_cuenta c JOIN operacion o ON o.id = c.operacion_id
WHERE mi.tipo = 'ajuste' AND mi.jornada_id = c.jornada_id
  AND mi.referencia_id = (SELECT id FROM movimiento_inventario WHERE linea_id = c.linea_id)
  AND mi.motivo LIKE format('Corrección %s de cuenta %s, renglón %s: %%', c.numero, o.folio, c.linea_id);
ALTER TABLE movimiento_inventario ENABLE TRIGGER movimiento_inmutable;

-- ── H7: lo fiado que se corrige ──────────────────────────────────────────────

ALTER TABLE correccion_de_cuenta DROP CONSTRAINT correccion_de_cuenta_liquidacion_check;
ALTER TABLE correccion_de_cuenta ADD CONSTRAINT correccion_de_cuenta_liquidacion_check
  CHECK (liquidacion IN ('efectivo', 'transferencia', 'pendiente', 'credito'));

-- Lo que debe un cliente: lo fiado, con lo que le cambiaron las correcciones «a lo fiado», menos
-- lo que ha abonado. Quien lo use para decidir tiene tomado el renglón del cliente.
CREATE FUNCTION lo_que_debe(p_cliente bigint) RETURNS numeric
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  SELECT coalesce((SELECT sum(importe) FROM credito WHERE cliente_id = p_cliente), 0)
       + coalesce((SELECT sum(c.diferencia) FROM correccion_de_cuenta c JOIN credito cr ON cr.operacion_id = c.operacion_id
                   WHERE cr.cliente_id = p_cliente AND c.liquidacion = 'credito'), 0)
       - coalesce((SELECT sum(importe) FROM abono WHERE cliente_id = p_cliente), 0);
$$;

-- corregir_cuenta, de 0040: con «a lo fiado» (H7) y con cada ajuste ligado a su corrección (H4).
CREATE OR REPLACE FUNCTION corregir_cuenta(
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
  cl cliente;
  v_debe numeric;
BEGIN
  u := exigir_rol(p_usuario, 'mostrador', 'responsable');
  PERFORM exigir_kilos(p_kg);
  IF p_linea IS NULL OR p_material IS NULL OR p_vistas IS NULL OR p_vistas < 0 OR v_motivo IS NULL THEN
    RAISE EXCEPTION 'La corrección lleva renglón, material, correcciones vistas y motivo' USING ERRCODE = 'RC005';
  END IF;
  IF p_liquidacion IS NULL OR p_liquidacion NOT IN ('efectivo', 'transferencia', 'pendiente', 'credito') THEN
    RAISE EXCEPTION 'La diferencia se liquida en efectivo, por transferencia, a lo fiado o queda pendiente' USING ERRCODE = 'RC005';
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
  -- H7: una venta fiada se corrige sobre lo que debe el cliente, o se liquida en el momento.
  -- «Pendiente» dejaría su deuda sin cuadrar. Y solo una venta fiada va a lo fiado.
  IF op.forma_de_pago = 'credito' AND p_liquidacion = 'pendiente' THEN
    RAISE EXCEPTION 'Una venta fiada no se deja pendiente: la diferencia va a lo que debe el cliente, o se liquida en efectivo o por transferencia'
      USING ERRCODE = 'RC005';
  END IF;
  IF p_liquidacion = 'credito' AND op.forma_de_pago IS DISTINCT FROM 'credito' THEN
    RAISE EXCEPTION 'Solo la corrección de una venta fiada va a lo que debe el cliente' USING ERRCODE = 'RC005';
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
  -- H7: el cliente antes que el patio, como al fiar y al abonar: lo que debe se lee con su renglón tomado.
  IF p_liquidacion = 'credito' THEN
    SELECT * INTO cl FROM cliente WHERE id = (SELECT cliente_id FROM credito WHERE operacion_id = op.id) FOR UPDATE;
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

  -- H7: bajar lo fiado no puede dejar al cliente con saldo a favor: lo que ya pagó de más se le devuelve.
  IF p_liquidacion = 'credito' THEN
    v_debe := lo_que_debe(cl.id) + (round(p_kg * v_precio, 2) - v_importe);
    IF v_debe < 0 THEN
      RAISE EXCEPTION 'El cliente ya pagó % de más de lo que quedaría: esa parte se le devuelve en efectivo o por transferencia', -v_debe
        USING ERRCODE = 'RC004';
    END IF;
  END IF;
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
      referencia_id, correccion_id, motivo, autorizado_por, creado_por)
    VALUES (op.sucursal_id, d.material, 'ajuste', d.kg, j.id, original.id, c.id,
      format('Corrección %s de cuenta %s, renglón %s: %s', c.numero, op.folio, l.id, v_motivo), p_autoriza, p_usuario);
  END LOOP;
  PERFORM anotar(p_usuario, 'corregir', 'operacion', op.id::text,
    jsonb_build_object('folio', op.folio, 'renglón', l.id,
      'antes', jsonb_build_object('material', v_material, 'kg', v_kg, 'importe', v_importe),
      'después', jsonb_build_object('material', p_material, 'kg', p_kg, 'precio', v_precio, 'importe', c.importe_despues),
      'diferencia', c.diferencia, 'liquidación', p_liquidacion, 'autoriza', p_autoriza, 'motivo', v_motivo));
  RETURN c;
END $$;

-- registrar_abono, de 0041: el tope es lo que debe con lo corregido (H7).
CREATE OR REPLACE FUNCTION registrar_abono(p_envio uuid, p_cliente bigint, p_importe numeric, p_forma text, p_nota text, p_usuario bigint)
RETURNS abono LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  u usuario;
  c cliente;
  j jornada;
  a abono;
  v_nota text := nullif(btrim(regexp_replace(p_nota, '[[:space:]]+', ' ', 'g')), '');
  v_contenido jsonb;
  v_debe numeric;
BEGIN
  u := exigir_rol(p_usuario, 'mostrador', 'responsable');
  PERFORM exigir_dinero(p_importe);
  IF p_importe = 0 THEN
    RAISE EXCEPTION 'El abono debe ser mayor que cero' USING ERRCODE = 'RC004';
  END IF;
  PERFORM exigir_forma_de_pago(p_forma);
  IF char_length(v_nota) > 200 THEN
    RAISE EXCEPTION 'La nota lleva hasta 200 letras' USING ERRCODE = 'RC005';
  END IF;
  v_contenido := jsonb_build_object('cliente', p_cliente, 'importe', round(p_importe, 2)::text, 'forma', p_forma, 'nota', v_nota);
  IF envio_del_cajon(p_envio, 'abono', v_contenido, p_usuario) THEN
    SELECT * INTO a FROM abono WHERE envio_id = p_envio;
    RETURN a;
  END IF;
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'Los abonos solo se registran en READ COMMITTED' USING ERRCODE = 'RC010';
  END IF;
  SELECT * INTO j FROM jornada WHERE id = jornada_abierta(u.sucursal_id) FOR SHARE;
  IF NOT FOUND OR j.cerrada_en IS NOT NULL THEN
    RAISE EXCEPTION 'El abono se registra en una jornada abierta' USING ERRCODE = 'RC006';
  END IF;
  IF p_forma = 'efectivo' AND NOT EXISTS (SELECT 1 FROM caja_apertura WHERE jornada_id = j.id) THEN
    RAISE EXCEPTION 'Primero hay que contar el cajón de esta jornada' USING ERRCODE = 'RC006';
  END IF;
  -- Mismo cliente, un abono a la vez. La suma se lee DESPUÉS de ganar el candado: el segundo
  -- ve el abono que acaba de confirmar el primero. La baja no impide pagar una deuda.
  SELECT * INTO c FROM cliente WHERE id = p_cliente FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ese cliente no existe' USING ERRCODE = 'RC005';
  END IF;
  v_debe := lo_que_debe(c.id);  -- H7: con lo corregido
  IF p_importe > v_debe THEN
    RAISE EXCEPTION 'El cliente debe %: el abono no puede pasar de esa cantidad', v_debe USING ERRCODE = 'RC004';
  END IF;
  IF NOT reservar_envio(p_envio, 'abono', v_contenido, p_usuario) THEN
    SELECT * INTO a FROM abono WHERE envio_id = p_envio;
    RETURN a;
  END IF;
  INSERT INTO abono (cliente_id, importe, forma, jornada_id, nota, registrado_por, envio_id)
  VALUES (c.id, p_importe, p_forma, j.id, v_nota, p_usuario, p_envio) RETURNING * INTO a;
  PERFORM anotar(p_usuario, 'abonar', 'cliente', c.id::text,
    jsonb_build_object('cliente', c.id, 'importe', a.importe, 'forma', a.forma, 'nota', a.nota, 'abono', a.id));
  RETURN a;
END $$;

-- saldo_de_clientes, de 0041: cada venta fiada vale lo que quedó después de sus correcciones
-- «a lo fiado» (H7), también para lo vencido. Las mismas columnas.
CREATE OR REPLACE VIEW saldo_de_clientes AS
WITH pagos AS (
  SELECT cliente_id, sum(importe) AS abonado, max(creado_en) AS ultimo_abono FROM abono GROUP BY cliente_id
), corregido AS (
  SELECT operacion_id, sum(diferencia) AS diferencia FROM correccion_de_cuenta WHERE liquidacion = 'credito' GROUP BY operacion_id
), creditos AS (
  SELECT cr.operacion_id, cr.cliente_id, cr.importe + coalesce(k.diferencia, 0) AS importe, cr.vence_el, cr.creado_en
  FROM credito cr LEFT JOIN corregido k USING (operacion_id)
), ordenados AS (
  SELECT cr.*, sum(importe) OVER (PARTITION BY cliente_id ORDER BY creado_en, operacion_id
    ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) - importe AS anterior
  FROM creditos cr
), resumen AS (
  SELECT cr.cliente_id, sum(cr.importe) AS fiado,
    sum(CASE WHEN cr.vence_el < hoy_en(1::smallint)
        THEN greatest(cr.importe - greatest(coalesce(p.abonado, 0) - cr.anterior, 0), 0) ELSE 0 END) AS vencido,
    min(cr.creado_en) AS primera_venta, max(cr.creado_en) AS ultima_venta
  FROM ordenados cr LEFT JOIN pagos p USING (cliente_id) GROUP BY cr.cliente_id
)
SELECT r.cliente_id, c.nombre, r.fiado, coalesce(p.abonado, 0) AS abonado,
  r.fiado - coalesce(p.abonado, 0) AS debe, r.vencido, r.primera_venta, r.ultima_venta, p.ultimo_abono,
  r.fiado > coalesce(p.abonado, 0) AS tiene_deuda
FROM resumen r JOIN cliente c ON c.id = r.cliente_id LEFT JOIN pagos p ON p.cliente_id = r.cliente_id;

-- ── H3: un cobro repetido con otro contenido es otro pedido ──────────────────

CREATE FUNCTION forma_en_palabras(p_forma text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $$
  SELECT CASE p_forma WHEN 'efectivo' THEN 'en efectivo' WHEN 'transferencia' THEN 'por transferencia'
                      WHEN 'credito' THEN 'a crédito' ELSE coalesce(p_forma, 'sin forma de pago') END;
$$;

-- confirmar_operacion, de 0041: el reintento con otra forma de pago se rechaza (H3).
CREATE OR REPLACE FUNCTION confirmar_operacion(p_operacion uuid, p_usuario bigint, p_revision int, p_forma text) RETURNS operacion
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  op      operacion;
  l       operacion_linea;
  v_suma  numeric(14,2);
  v_total numeric(14,0);
  v_jornada   bigint;
  v_excepcion jsonb := '{}';
BEGIN
  IF p_forma = 'credito' THEN
    IF NOT EXISTS (SELECT 1 FROM credito WHERE operacion_id = p_operacion) THEN
      RAISE EXCEPTION 'El crédito se autoriza por cobrar_a_credito' USING ERRCODE = 'RC005';
    END IF;
  ELSE
    PERFORM exigir_forma_de_pago(p_forma);
  END IF;
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
  -- Un reintento devuelve lo ya confirmado y no escribe nada. Con otra forma de pago es otro pedido (H3).
  IF op.estado = 'confirmada' THEN
    IF op.forma_de_pago IS DISTINCT FROM p_forma THEN
      RAISE EXCEPTION 'Esa cuenta ya se % %: hay que volver a verla',
        CASE op.tipo WHEN 'compra' THEN 'pagó' ELSE 'cobró' END, forma_en_palabras(op.forma_de_pago) USING ERRCODE = 'RC011';
    END IF;
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

  -- La jornada se toma antes de escribir dinero. El corte espera esta confirmación,
  -- o la confirmación espera el corte y encuentra cerrada la jornada.
  IF (SELECT cerrada_en FROM jornada WHERE id = v_jornada FOR SHARE) IS NOT NULL THEN
    RAISE EXCEPTION 'La jornada ya está cerrada' USING ERRCODE = 'RC006';
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
      confirmada_en_jornada = v_jornada, forma_de_pago = p_forma
  WHERE id = op.id
  RETURNING * INTO op;

  PERFORM anotar(p_usuario, 'confirmar', 'operacion', op.id::text,
                 jsonb_build_object('folio', op.folio, 'tipo', op.tipo, 'total', op.total) || v_excepcion);
  RETURN op;
END $$;

-- cobrar_a_credito, de 0041: el reintento con otros datos se rechaza (H3).
CREATE OR REPLACE FUNCTION cobrar_a_credito(
  p_cuenta uuid, p_usuario bigint, p_revision int, p_cliente bigint, p_cliente_nuevo text,
  p_vence date, p_autoriza bigint, p_clave text, p_huella text
) RETURNS operacion
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  u usuario;
  op operacion;
  c cliente;
  j jornada;
  v_nombre text;
  v_total numeric;
  l record;
  v_hay numeric;
  cr credito;
BEGIN
  u := exigir_rol(p_usuario, 'mostrador', 'responsable');
  SELECT * INTO op FROM operacion WHERE id = p_cuenta FOR UPDATE;
  IF NOT FOUND OR op.sucursal_id <> u.sucursal_id THEN
    RAISE EXCEPTION 'Esa cuenta no existe en esta sucursal' USING ERRCODE = 'RC005';
  END IF;
  -- Repetir el mismo fiado es leerlo, aun con datos de una pantalla vieja. Otra forma de pago,
  -- otro cliente, otro plazo u otra firma es otro pedido (H3).
  IF op.estado = 'confirmada' THEN
    SELECT * INTO cr FROM credito WHERE operacion_id = op.id;
    IF NOT FOUND OR cr.autorizado_por IS DISTINCT FROM p_autoriza OR cr.vence_el IS DISTINCT FROM p_vence
       OR (p_cliente IS NOT NULL AND cr.cliente_id IS DISTINCT FROM p_cliente)
       OR (p_cliente IS NULL AND NOT EXISTS (SELECT 1 FROM cliente WHERE id = cr.cliente_id
                                             AND lower(nombre) = lower(nombre_de_cliente(p_cliente_nuevo)))) THEN
      RAISE EXCEPTION 'Esa venta ya se cobró %: hay que volver a verla',
        CASE WHEN cr.operacion_id IS NULL THEN forma_en_palabras(op.forma_de_pago) ELSE 'a crédito, con otros datos' END
        USING ERRCODE = 'RC011';
    END IF;
    RETURN op;
  END IF;
  IF op.tipo <> 'venta' THEN
    RAISE EXCEPTION 'Solo se fían ventas: no hay compras a crédito' USING ERRCODE = 'RC005';
  END IF;
  IF p_revision IS DISTINCT FROM op.revision THEN
    RAISE EXCEPTION 'La cuenta cambió desde que se revisó: hay que volver a verla' USING ERRCODE = 'RC011';
  END IF;
  v_nombre := nombre_de_cliente(p_cliente_nuevo);
  IF (p_cliente IS NULL) = (v_nombre IS NULL) THEN
    RAISE EXCEPTION 'El fiado lleva un cliente de la lista o el nombre de uno nuevo, exactamente uno' USING ERRCODE = 'RC005';
  END IF;
  IF p_vence IS NOT NULL AND (NOT isfinite(p_vence) OR p_vence < hoy_en(op.sucursal_id)) THEN
    RAISE EXCEPTION 'La fecha de pago no puede ser anterior a hoy ni infinita' USING ERRCODE = 'RC005';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM operacion_linea WHERE operacion_id = op.id)
     OR EXISTS (SELECT 1 FROM operacion_linea WHERE operacion_id = op.id AND peso_bruto IS NULL) THEN
    RAISE EXCEPTION 'La cuenta debe tener materiales que ya terminaron de pesarse' USING ERRCODE = 'RC005';
  END IF;
  -- Como confirmar_cuenta, no termina cuentas de otra jornada: esa excepción sigue siendo de
  -- terminar_vehiculo. Jornada antes que credencial y patio, para no cruzarse con el corte.
  SELECT * INTO j FROM jornada WHERE id = op.jornada_id FOR SHARE;
  IF j.cerrada_en IS NOT NULL THEN
    RAISE EXCEPTION 'Esta cuenta quedó de otra jornada: la termina un responsable tecleando su clave' USING ERRCODE = 'RC008';
  END IF;
  IF p_cliente IS NOT NULL THEN
    SELECT * INTO c FROM cliente WHERE id = p_cliente FOR SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Ese cliente no existe' USING ERRCODE = 'RC005';
    END IF;
  ELSE
    -- Igual que el precio especial: un nombre ya conocido resuelve al mismo cliente.
    SELECT * INTO c FROM cliente WHERE lower(nombre) = lower(v_nombre) FOR SHARE;
  END IF;
  IF c.id IS NOT NULL AND NOT c.activo THEN
    RAISE EXCEPTION 'Ese cliente está dado de baja: no recibe crédito nuevo' USING ERRCODE = 'RC005';
  END IF;
  IF op.cliente_id IS NOT NULL AND op.cliente_id IS DISTINCT FROM c.id THEN
    RAISE EXCEPTION 'Esta cuenta ya tiene precio especial para otro cliente' USING ERRCODE = 'RC005';
  END IF;
  PERFORM exigir_rol(p_autoriza, 'responsable');
  IF NOT EXISTS (SELECT 1 FROM usuario WHERE id = p_autoriza AND activo AND puede_autorizar) THEN
    RAISE EXCEPTION 'El fiado lo autoriza un responsable facultado' USING ERRCODE = 'RC008';
  END IF;
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'El fiado solo se registra en READ COMMITTED' USING ERRCODE = 'RC010';
  END IF;
  -- Comprueba la existencia con el mismo candado del libro, antes de probar una clave.
  -- Agrupa materiales: dos renglones del mismo material no pueden gastar dos veces lo mismo.
  PERFORM pg_advisory_xact_lock(7151, op.sucursal_id);
  FOR l IN SELECT material_id, sum(peso_recibido) AS kg FROM operacion_linea
           WHERE operacion_id = op.id GROUP BY material_id ORDER BY material_id LOOP
    SELECT coalesce(sum(cantidad_kg), 0) INTO v_hay FROM movimiento_inventario WHERE material_id = l.material_id;
    IF l.kg > v_hay THEN
      RAISE EXCEPTION 'No alcanza el material: hay % kg y se quieren sacar % kg', v_hay, l.kg USING ERRCODE = 'RC002';
    END IF;
  END LOOP;
  SELECT round(sum(importe)) INTO v_total FROM operacion_linea WHERE operacion_id = op.id;
  IF NOT autorizo_con_clave(p_huella, p_autoriza, p_clave) THEN RETURN NULL; END IF;
  IF c.id IS NULL THEN
    INSERT INTO cliente (nombre, creado_por) VALUES (v_nombre, p_usuario) ON CONFLICT (lower(nombre)) DO NOTHING;
    SELECT * INTO c FROM cliente WHERE lower(nombre) = lower(v_nombre) FOR SHARE;
    IF NOT c.activo THEN
      RAISE EXCEPTION 'Ese cliente está dado de baja: no recibe crédito nuevo' USING ERRCODE = 'RC005';
    END IF;
  END IF;
  UPDATE operacion SET cliente_id = c.id WHERE id = op.id;
  INSERT INTO credito (operacion_id, cliente_id, importe, vence_el, autorizado_por)
  VALUES (op.id, c.id, v_total, p_vence, p_autoriza);
  op := confirmar_operacion(op.id, p_usuario, p_revision, 'credito');
  PERFORM anotar(p_usuario, 'fiar', 'operacion', op.id::text,
    jsonb_build_object('folio', op.folio, 'cliente', c.id, 'importe', op.total, 'vence', p_vence, 'autoriza', p_autoriza));
  RETURN op;
END $$;

-- ── H1: un solo orden de candados ────────────────────────────────────────────

-- terminar_vehiculo, de 0038: el patio antes que la clave (H1), y otra forma de pago al repetir se rechaza (H3).
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

-- contar_material, de 0017: el patio antes que la clave (H1).
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

  -- H1: el patio antes que la clave. asentar_conteo lo vuelve a pedir: ya es suyo.
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

-- corregir_movimiento, de 0017: el patio antes que la clave (H1).
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

  -- H1: el patio antes que la clave; más abajo se vuelve a pedir, y ya es suyo.
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
