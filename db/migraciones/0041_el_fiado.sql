-- Fiado: solo ventas autorizadas, sin adelantos. El responsable decide si el volumen y el
-- cliente ameritan crédito; no se inventa un umbral de kilos ni un plazo universal.
-- Crédito y abono son libros inmutables: el saldo se calcula, nunca se guarda.

ALTER TABLE operacion DROP CONSTRAINT forma_al_confirmar;
ALTER TABLE operacion ADD CONSTRAINT forma_al_confirmar CHECK (
  (estado = 'borrador' AND forma_de_pago IS NULL) OR
  (estado = 'confirmada' AND forma_de_pago IS NOT NULL AND
    (forma_de_pago IN ('efectivo', 'transferencia') OR (forma_de_pago = 'credito' AND tipo = 'venta')))
);

CREATE TABLE credito (
  operacion_id uuid PRIMARY KEY REFERENCES operacion,
  cliente_id bigint NOT NULL REFERENCES cliente,
  importe numeric(14,2) NOT NULL CHECK (importe >= 0 AND importe <> 'NaN'),
  vence_el date CHECK (isfinite(vence_el)),
  autorizado_por bigint NOT NULL REFERENCES usuario,
  creado_en timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX credito_por_cliente ON credito (cliente_id, creado_en, operacion_id);
CREATE TRIGGER credito_inmutable BEFORE UPDATE OR DELETE ON credito
  FOR EACH ROW EXECUTE FUNCTION rechazar_cambio();
CREATE TRIGGER credito_sin_vaciar BEFORE TRUNCATE ON credito
  FOR EACH STATEMENT EXECUTE FUNCTION rechazar_cambio();

ALTER TABLE envio DROP CONSTRAINT envio_clase_check;
ALTER TABLE envio ADD CONSTRAINT envio_clase_check CHECK (clase IN (
  'cuenta', 'material', 'conteo', 'merma', 'separacion', 'correccion', 'cancelado', 'cierre', 'reapertura', 'precio',
  'caja_apertura', 'caja_movimiento', 'caja_corte', 'correccion_cuenta', 'abono'
));
CREATE TABLE abono (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  cliente_id bigint NOT NULL REFERENCES cliente,
  importe numeric(14,2) NOT NULL CHECK (importe > 0 AND importe <= 99999999.99),
  forma text NOT NULL CHECK (forma IN ('efectivo', 'transferencia')),
  jornada_id bigint NOT NULL REFERENCES jornada,
  nota text CHECK (nota = btrim(regexp_replace(nota, '[[:space:]]+', ' ', 'g')) AND char_length(nota) BETWEEN 1 AND 200),
  registrado_por bigint NOT NULL REFERENCES usuario,
  creado_en timestamptz NOT NULL DEFAULT clock_timestamp(),
  envio_id uuid NOT NULL UNIQUE REFERENCES envio
);
CREATE INDEX abono_por_cliente ON abono (cliente_id, creado_en, id);
CREATE INDEX abono_por_jornada ON abono (jornada_id) WHERE forma = 'efectivo';
CREATE TRIGGER abono_inmutable BEFORE UPDATE OR DELETE ON abono
  FOR EACH ROW EXECUTE FUNCTION rechazar_cambio();
CREATE TRIGGER abono_sin_vaciar BEFORE TRUNCATE ON abono
  FOR EACH STATEMENT EXECUTE FUNCTION rechazar_cambio();

-- El cliente sigue siendo el de los precios especiales, salvo una venta fiada: en ella es el
-- del crédito y, si hay precios especiales, ambos coinciden. También se comprueba el importe.
-- Diferido: cobrar_a_credito escribe el crédito y confirma dentro de la misma transacción.
CREATE OR REPLACE FUNCTION cuenta_con_su_cliente() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_cuenta uuid;
  op operacion;
  cr credito;
  v_clientes bigint[];
BEGIN
  IF TG_TABLE_NAME = 'operacion' THEN v_cuenta := NEW.id;
  ELSIF TG_OP = 'DELETE' THEN v_cuenta := OLD.operacion_id;
  ELSE v_cuenta := NEW.operacion_id;
  END IF;
  SELECT * INTO op FROM operacion WHERE id = v_cuenta;
  IF NOT FOUND THEN RETURN NULL; END IF;
  v_clientes := clientes_de_cuenta(v_cuenta);
  IF cardinality(v_clientes) > 1 THEN
    RAISE EXCEPTION 'Una cuenta es de un solo cliente: no lleva precios especiales de dos' USING ERRCODE = 'RC005';
  END IF;
  SELECT * INTO cr FROM credito WHERE operacion_id = v_cuenta;
  IF op.forma_de_pago = 'credito' OR cr.operacion_id IS NOT NULL THEN
    IF op.estado <> 'confirmada' OR op.tipo <> 'venta' OR op.forma_de_pago IS DISTINCT FROM 'credito'
       OR cr.operacion_id IS NULL OR op.cliente_id IS DISTINCT FROM cr.cliente_id OR op.total IS DISTINCT FROM cr.importe
       OR (cardinality(v_clientes) > 0 AND op.cliente_id IS DISTINCT FROM v_clientes[1]) THEN
      RAISE EXCEPTION 'El crédito debe corresponder a la venta, su importe y su único cliente' USING ERRCODE = 'RC005';
    END IF;
  ELSIF op.cliente_id IS DISTINCT FROM v_clientes[1] THEN
    RAISE EXCEPTION 'El cliente de una cuenta es el de sus precios especiales, o ninguno' USING ERRCODE = 'RC005';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER credito_con_su_cuenta AFTER INSERT ON credito
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION cuenta_con_su_cliente();

-- La confirmación interna conserva el inventario, folio, redondeo y bitácora de 0038. Acepta
-- crédito solo si cobrar_a_credito ya escribió su autorización; las entradas ordinarias siguen
-- exigiendo efectivo o transferencia. No se concede esta función interna a la aplicación.
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

CREATE FUNCTION cobrar_a_credito(
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
BEGIN
  u := exigir_rol(p_usuario, 'mostrador', 'responsable');
  SELECT * INTO op FROM operacion WHERE id = p_cuenta FOR UPDATE;
  IF NOT FOUND OR op.sucursal_id <> u.sucursal_id THEN
    RAISE EXCEPTION 'Esa cuenta no existe en esta sucursal' USING ERRCODE = 'RC005';
  END IF;
  -- Repetir una confirmación es leerla, aun con datos de una pantalla vieja.
  IF op.estado = 'confirmada' THEN RETURN op; END IF;
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

CREATE FUNCTION registrar_abono(p_envio uuid, p_cliente bigint, p_importe numeric, p_forma text, p_nota text, p_usuario bigint)
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
  SELECT coalesce((SELECT sum(importe) FROM credito WHERE cliente_id = c.id), 0)
       - coalesce((SELECT sum(importe) FROM abono WHERE cliente_id = c.id), 0) INTO v_debe;
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

-- Todos los clientes con alguna venta fiada, incluidos los liquidados. tiene_deuda permite
-- filtrar pendientes sin perder su historia. FIFO por creación de venta fiada (no por plazo).
-- Primero se agregan los abonos: unir ambos libros en bruto multiplicaría sus importes.
CREATE VIEW saldo_de_clientes AS
WITH pagos AS (
  SELECT cliente_id, sum(importe) AS abonado, max(creado_en) AS ultimo_abono FROM abono GROUP BY cliente_id
), ordenados AS (
  SELECT cr.*, sum(importe) OVER (PARTITION BY cliente_id ORDER BY creado_en, operacion_id
    ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) - importe AS anterior
  FROM credito cr
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

-- Conserva las cuatro fuentes de 0040 (incluidas correcciones y retiros de cortes anteriores),
-- agrega los abonos en efectivo. Las ventas a crédito no pasan el filtro de efectivo.
CREATE OR REPLACE FUNCTION esperado_en_cajon(p_jornada bigint) RETURNS numeric
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT a.contado
    + coalesce((SELECT sum(CASE tipo WHEN 'venta' THEN total ELSE -total END) FROM operacion
                WHERE confirmada_en_jornada = p_jornada AND estado = 'confirmada' AND forma_de_pago = 'efectivo'), 0)
    + coalesce((SELECT sum(CASE tipo WHEN 'meter' THEN importe ELSE -importe END) FROM caja_movimiento
                WHERE jornada_id = p_jornada), 0)
    + coalesce((SELECT sum(CASE o.tipo WHEN 'venta' THEN c.diferencia ELSE -c.diferencia END)
                FROM correccion_de_cuenta c JOIN operacion o ON o.id = c.operacion_id
                WHERE c.jornada_id = p_jornada AND c.liquidacion = 'efectivo'), 0)
    + coalesce((SELECT sum(importe) FROM abono WHERE jornada_id = p_jornada AND forma = 'efectivo'), 0)
    - coalesce((SELECT sum(retirado) FROM caja_corte WHERE jornada_id = p_jornada), 0)
  FROM caja_apertura a WHERE a.jornada_id = p_jornada;
$$;

GRANT SELECT ON credito, abono, saldo_de_clientes TO feruga_app;
GRANT EXECUTE ON FUNCTION
  cobrar_a_credito(uuid, bigint, int, bigint, text, date, bigint, text, text),
  registrar_abono(uuid, bigint, numeric, text, text, bigint)
TO feruga_app;
