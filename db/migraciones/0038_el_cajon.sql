-- El cajón: lo contado, lo que se mueve con clave y el corte que acompaña cada cierre.
-- El efectivo se calcula del libro, nunca de un saldo que pueda quedar desacompasado.
-- Las entradas validan los centavos antes de escribir numeric(14,2): una columna sola redondearía.

ALTER TABLE usuario ADD COLUMN hace_corte boolean NOT NULL DEFAULT false,
  ADD CONSTRAINT corte_solo_mostrador CHECK (NOT hace_corte OR rol = 'mostrador');

CREATE FUNCTION puede_hacer_corte(p_usuario bigint) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT coalesce((SELECT activo AND (rol = 'responsable' OR (rol = 'mostrador' AND hace_corte))
                   FROM usuario WHERE id = p_usuario), false);
$$;

CREATE FUNCTION permiso_de_corte(p_huella text, p_usuario bigint, p_clave text, p_persona bigint, p_puede boolean)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  u usuario;
BEGIN
  PERFORM exigir_quien_administra(p_usuario);
  u := persona_que_se_administra(p_persona);
  IF u.rol <> 'mostrador' THEN
    RAISE EXCEPTION 'El permiso de corte solo se da a una persona de mostrador' USING ERRCODE = 'RC008';
  END IF;
  IF p_puede IS NULL THEN
    RAISE EXCEPTION 'Falta decir si se da o se quita el permiso de corte' USING ERRCODE = 'RC005';
  END IF;
  IF NOT autorizo_con_clave(p_huella, p_usuario, p_clave) THEN RETURN false; END IF;
  PERFORM 1 FROM usuario WHERE id = p_persona FOR UPDATE;
  u := persona_que_se_administra(p_persona);
  IF u.rol <> 'mostrador' THEN
    RAISE EXCEPTION 'El permiso de corte solo se da a una persona de mostrador' USING ERRCODE = 'RC008';
  END IF;
  IF u.hace_corte = p_puede THEN RETURN true; END IF;
  UPDATE usuario SET hace_corte = p_puede WHERE id = p_persona;
  PERFORM anotar(p_usuario, 'permiso_de_corte', 'usuario', p_persona::text, jsonb_build_object('puede', p_puede));
  RETURN true;
END $$;

DROP FUNCTION personas_para_administrar(bigint);
CREATE FUNCTION personas_para_administrar(p_usuario bigint)
RETURNS TABLE (id bigint, nombre text, rol text, puede_autorizar boolean, activo boolean, bloqueada boolean,
               adentro_de text, se_administra boolean, hace_corte boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM exigir_quien_administra(p_usuario);
  RETURN QUERY
    SELECT u.id, u.nombre, u.rol, u.puede_autorizar, u.activo,
           u.activo AND coalesce((SELECT i.bloqueada_hasta FROM intentos_de(u.id) i) > clock_timestamp(), false),
           (SELECT e.nombre FROM sesion s JOIN equipo e ON e.id = s.equipo_id
            WHERE s.usuario_id = u.id AND s.cerrada_en IS NULL AND e.baja_en IS NULL
            ORDER BY s.vista_en DESC LIMIT 1),
           u.activo AND u.rol IN ('mostrador', 'patio', 'consulta'), puede_hacer_corte(u.id)
    FROM usuario u WHERE u.sucursal_id = 1
    ORDER BY u.activo DESC, lower(u.nombre), u.id;
END $$;

-- Las cuentas de antes fueron en efectivo. El guardián se aparta solo para completar ese dato.
ALTER TABLE operacion ADD COLUMN forma_de_pago text;
ALTER TABLE operacion DISABLE TRIGGER operacion_cambia;
-- El vínculo diferido con el cliente también se revisa al actualizar una cuenta.
-- Se resuelve aquí para no dejar eventos pendientes al volver a activar su guardián.
SET CONSTRAINTS cuenta_con_su_cliente IMMEDIATE;
UPDATE operacion SET forma_de_pago = 'efectivo' WHERE estado = 'confirmada';
ALTER TABLE operacion ENABLE TRIGGER operacion_cambia;
SET CONSTRAINTS cuenta_con_su_cliente DEFERRED;
ALTER TABLE operacion ADD CONSTRAINT forma_al_confirmar CHECK (
  (estado = 'borrador' AND forma_de_pago IS NULL) OR
  (estado = 'confirmada' AND forma_de_pago IS NOT NULL AND forma_de_pago IN ('efectivo', 'transferencia'))
);

CREATE FUNCTION exigir_forma_de_pago(p_forma text) RETURNS void
LANGUAGE plpgsql IMMUTABLE SET search_path = public, pg_temp AS $$
BEGIN
  IF p_forma IS NULL OR p_forma NOT IN ('efectivo', 'transferencia') THEN
    RAISE EXCEPTION 'La forma de pago es efectivo o transferencia' USING ERRCODE = 'RC005';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION operacion_cambia() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.estado = 'confirmada' THEN
      RAISE EXCEPTION 'La operación con folio % está confirmada y no se borra', OLD.folio USING ERRCODE = 'RC001';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.estado = 'confirmada' THEN
    -- De una operación confirmada solo puede cambiar su estado de pago.
    IF ROW(NEW.id, NEW.sucursal_id, NEW.jornada_id, NEW.lista_id, NEW.tipo, NEW.etiqueta, NEW.estado, NEW.creada_en,
           NEW.creada_por, NEW.folio, NEW.suma, NEW.ajuste_redondeo, NEW.total, NEW.confirmada_en, NEW.confirmada_por,
           NEW.confirmada_en_jornada, NEW.revision, NEW.cliente_id, NEW.cliente_nombre, NEW.forma_de_pago)
       IS DISTINCT FROM
       ROW(OLD.id, OLD.sucursal_id, OLD.jornada_id, OLD.lista_id, OLD.tipo, OLD.etiqueta, OLD.estado, OLD.creada_en,
           OLD.creada_por, OLD.folio, OLD.suma, OLD.ajuste_redondeo, OLD.total, OLD.confirmada_en, OLD.confirmada_por,
           OLD.confirmada_en_jornada, OLD.revision, OLD.cliente_id, OLD.cliente_nombre, OLD.forma_de_pago)
    THEN
      RAISE EXCEPTION 'La operación con folio % está confirmada y no se modifica', OLD.folio USING ERRCODE = 'RC001';
    END IF;
    RETURN NEW;
  END IF;
  IF ROW(NEW.id, NEW.sucursal_id, NEW.jornada_id, NEW.lista_id, NEW.tipo)
     IS DISTINCT FROM ROW(OLD.id, OLD.sucursal_id, OLD.jornada_id, OLD.lista_id, OLD.tipo) THEN
    RAISE EXCEPTION 'A una cuenta abierta no se le cambia el sentido, la jornada ni la lista: se descarta y se abre otra'
      USING ERRCODE = 'RC005';
  END IF;
  -- La etiqueta también es contenido de la cuenta: cambiarla sube la revisión.
  IF NEW.estado = 'borrador' AND NEW.etiqueta IS DISTINCT FROM OLD.etiqueta THEN
    NEW.revision := OLD.revision + 1;
  END IF;
  -- El nombre del cliente se guarda al cobrar, como esté en ese momento; antes, no hay nombre guardado.
  NEW.cliente_nombre := CASE WHEN NEW.estado = 'confirmada' THEN (SELECT nombre FROM cliente WHERE id = NEW.cliente_id) END;
  RETURN NEW;
END $$;


-- La forma se fija junto con el folio, sin una revisión intermedia.
CREATE FUNCTION confirmar_operacion(p_operacion uuid, p_usuario bigint, p_revision int, p_forma text) RETURNS operacion
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  op      operacion;
  l       operacion_linea;
  v_suma  numeric(14,2);
  v_total numeric(14,0);
  v_jornada   bigint;
  v_excepcion jsonb := '{}';
BEGIN
  PERFORM exigir_forma_de_pago(p_forma);
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

-- La consola y los apoyos antiguos conservan su entrada de tres argumentos, con efectivo.
-- Ninguna de las dos funciones internas se concede a la aplicación.
CREATE OR REPLACE FUNCTION confirmar_operacion(p_operacion uuid, p_usuario bigint, p_revision int) RETURNS operacion
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT * FROM confirmar_operacion(p_operacion, p_usuario, p_revision, 'efectivo');
$$;

DROP FUNCTION confirmar_cuenta(uuid, bigint, int);
CREATE FUNCTION confirmar_cuenta(p_cuenta uuid, p_usuario bigint, p_revision int, p_forma text DEFAULT 'efectivo')
RETURNS operacion LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE op operacion;
BEGIN
  PERFORM exigir_forma_de_pago(p_forma);
  PERFORM exigir_rol(p_usuario, 'mostrador', 'responsable');
  SELECT * INTO op FROM operacion WHERE id = p_cuenta FOR UPDATE;
  IF FOUND AND op.estado = 'borrador'
     AND (SELECT cerrada_en FROM jornada WHERE id = op.jornada_id) IS NOT NULL THEN
    RAISE EXCEPTION 'Esta cuenta quedó de otra jornada: la termina un responsable tecleando su clave'
      USING ERRCODE = 'RC008';
  END IF;
  RETURN confirmar_operacion(p_cuenta, p_usuario, p_revision, p_forma);
END $$;

DROP FUNCTION terminar_vehiculo(uuid, int, bigint, text, text);
CREATE FUNCTION terminar_vehiculo(p_cuenta uuid, p_revision int, p_responsable bigint, p_clave text, p_huella text,
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
  IF op.estado = 'confirmada' THEN RETURN op; END IF;
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
  v_equipo := equipo_vigente(p_huella);
  IF v_equipo IS NULL OR NOT comprobar_clave(v_equipo, p_responsable, p_clave) THEN RETURN NULL; END IF;
  RETURN confirmar_operacion(p_cuenta, p_responsable, p_revision, p_forma);
END $$;

CREATE FUNCTION exigir_dinero(p_importe numeric) RETURNS void
LANGUAGE plpgsql IMMUTABLE SET search_path = public, pg_temp AS $$
BEGIN
  IF p_importe IS NULL OR p_importe IN ('NaN', 'Infinity', '-Infinity')
     OR p_importe < 0 OR p_importe > 99999999.99 OR p_importe <> round(p_importe, 2) THEN
    RAISE EXCEPTION 'El dinero debe ir de cero a 99 999 999.99, con hasta dos decimales' USING ERRCODE = 'RC004';
  END IF;
END $$;

ALTER TABLE envio DROP CONSTRAINT envio_clase_check;
ALTER TABLE envio ADD CONSTRAINT envio_clase_check CHECK (clase IN (
  'cuenta', 'material', 'conteo', 'merma', 'separacion', 'correccion', 'cancelado', 'cierre', 'reapertura', 'precio',
  'caja_apertura', 'caja_movimiento', 'caja_corte'
));

CREATE TABLE caja_apertura (
  jornada_id bigint PRIMARY KEY REFERENCES jornada,
  contado numeric(14,2) NOT NULL CHECK (contado BETWEEN 0 AND 99999999.99),
  anterior numeric(14,2) CHECK (anterior BETWEEN 0 AND 99999999.99),
  contado_por bigint NOT NULL REFERENCES usuario,
  contado_en timestamptz NOT NULL DEFAULT clock_timestamp(),
  envio_id uuid NOT NULL UNIQUE REFERENCES envio
);
CREATE TABLE caja_movimiento (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  jornada_id bigint NOT NULL REFERENCES jornada,
  tipo text NOT NULL CHECK (tipo IN ('sacar', 'meter')),
  importe numeric(14,2) NOT NULL CHECK (importe > 0 AND importe <= 99999999.99),
  motivo text NOT NULL CHECK (motivo = btrim(motivo) AND char_length(motivo) BETWEEN 1 AND 200),
  registrado_por bigint NOT NULL REFERENCES usuario,
  autorizado_por bigint NOT NULL REFERENCES usuario,
  creado_en timestamptz NOT NULL DEFAULT clock_timestamp(),
  envio_id uuid NOT NULL UNIQUE REFERENCES envio
);
CREATE INDEX caja_movimiento_por_jornada ON caja_movimiento (jornada_id);
CREATE TABLE caja_corte (
  jornada_id bigint NOT NULL REFERENCES jornada,
  cierre int NOT NULL CHECK (cierre > 0),
  -- Lo esperado y la diferencia pueden ser negativos: no se oculta un faltante ni se impide sacar.
  esperado numeric(14,2) NOT NULL CHECK (esperado NOT IN ('NaN', 'Infinity', '-Infinity')),
  contado numeric(14,2) NOT NULL CHECK (contado BETWEEN 0 AND 99999999.99),
  diferencia numeric(14,2) NOT NULL CHECK (diferencia = contado - esperado),
  se_queda numeric(14,2) NOT NULL CHECK (se_queda BETWEEN 0 AND contado),
  retirado numeric(14,2) NOT NULL CHECK (retirado = contado - se_queda),
  hecho_por bigint NOT NULL REFERENCES usuario,
  registrado_por bigint NOT NULL REFERENCES usuario,
  hecho_en timestamptz NOT NULL DEFAULT clock_timestamp(),
  envio_id uuid NOT NULL UNIQUE REFERENCES envio,
  PRIMARY KEY (jornada_id, cierre)
);
CREATE TABLE aviso (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  clase text NOT NULL CHECK (clase IN ('corte', 'apertura')),
  jornada_id bigint NOT NULL REFERENCES jornada,
  diferencia numeric(14,2) NOT NULL CHECK (diferencia <> 0 AND diferencia NOT IN ('NaN', 'Infinity', '-Infinity')),
  creado_en timestamptz NOT NULL DEFAULT clock_timestamp(),
  creado_por bigint NOT NULL REFERENCES usuario,
  visto_por bigint REFERENCES usuario,
  visto_en timestamptz,
  enviado_en timestamptz,
  CHECK ((visto_por IS NULL) = (visto_en IS NULL))
);
CREATE INDEX aviso_sin_ver ON aviso (id) WHERE visto_en IS NULL;

CREATE TRIGGER caja_apertura_inmutable BEFORE UPDATE OR DELETE ON caja_apertura
  FOR EACH ROW EXECUTE FUNCTION rechazar_cambio();
CREATE TRIGGER caja_apertura_sin_vaciar BEFORE TRUNCATE ON caja_apertura
  FOR EACH STATEMENT EXECUTE FUNCTION rechazar_cambio();
CREATE TRIGGER caja_movimiento_inmutable BEFORE UPDATE OR DELETE ON caja_movimiento
  FOR EACH ROW EXECUTE FUNCTION rechazar_cambio();
CREATE TRIGGER caja_movimiento_sin_vaciar BEFORE TRUNCATE ON caja_movimiento
  FOR EACH STATEMENT EXECUTE FUNCTION rechazar_cambio();
CREATE TRIGGER caja_corte_inmutable BEFORE UPDATE OR DELETE ON caja_corte
  FOR EACH ROW EXECUTE FUNCTION rechazar_cambio();
CREATE TRIGGER caja_corte_sin_vaciar BEFORE TRUNCATE ON caja_corte
  FOR EACH STATEMENT EXECUTE FUNCTION rechazar_cambio();

CREATE FUNCTION aviso_cambia() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF (to_jsonb(NEW) - 'visto_por' - 'visto_en' - 'enviado_en') IS DISTINCT FROM
     (to_jsonb(OLD) - 'visto_por' - 'visto_en' - 'enviado_en')
     OR (OLD.visto_en IS NOT NULL AND ROW(NEW.visto_por, NEW.visto_en) IS DISTINCT FROM ROW(OLD.visto_por, OLD.visto_en)) THEN
    RAISE EXCEPTION 'El aviso conserva lo que pasó y quién lo vio por primera vez' USING ERRCODE = 'RC001';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER aviso_cambia BEFORE UPDATE ON aviso FOR EACH ROW EXECUTE FUNCTION aviso_cambia();
CREATE TRIGGER aviso_no_se_borra BEFORE DELETE ON aviso FOR EACH ROW EXECUTE FUNCTION rechazar_cambio();
CREATE TRIGGER aviso_sin_vaciar BEFORE TRUNCATE ON aviso FOR EACH STATEMENT EXECUTE FUNCTION rechazar_cambio();

-- Se aparta el identificador antes de mirar el resultado, incluso si el primer intento aún
-- está en camino. El candado no reserva un envío: una clave mala lo deja libre para reintentar.
-- Lo ya recibido (también lo cancelado) se comprueba con reservar_envio. Lo nuevo se reserva
-- después de la clave y antes de escribir el libro, de modo que cancelar_envio siempre decide.
CREATE FUNCTION envio_del_cajon(p_envio uuid, p_clase text, p_contenido jsonb, p_usuario bigint) RETURNS boolean
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF p_envio IS NULL THEN
    RAISE EXCEPTION 'El envío del cajón llegó sin identificador' USING ERRCODE = 'RC005';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_envio::text, 38));
  IF EXISTS (SELECT 1 FROM envio WHERE id = p_envio) THEN
    PERFORM reservar_envio(p_envio, p_clase, p_contenido, p_usuario);
    RETURN true;
  END IF;
  RETURN false;
END $$;

CREATE FUNCTION abrir_el_cajon(p_envio uuid, p_jornada bigint, p_contado numeric, p_usuario bigint)
RETURNS caja_apertura LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  u usuario;
  j jornada;
  a caja_apertura;
  v_anterior numeric(14,2);
  v_contenido jsonb;
BEGIN
  u := exigir_rol(p_usuario, 'mostrador', 'responsable');
  PERFORM exigir_dinero(p_contado);
  v_contenido := jsonb_build_object('jornada', p_jornada, 'contado', p_contado);
  IF envio_del_cajon(p_envio, 'caja_apertura', v_contenido, p_usuario) THEN
    SELECT * INTO a FROM caja_apertura WHERE envio_id = p_envio;
    RETURN a;
  END IF;
  -- Además del cierre, se espera a otro conteo: el segundo dice quién contó y a qué hora.
  SELECT * INTO j FROM jornada WHERE id = p_jornada AND sucursal_id = u.sucursal_id FOR UPDATE;
  IF NOT FOUND OR j.cerrada_en IS NOT NULL THEN
    RAISE EXCEPTION 'Esa jornada no es la que está abierta' USING ERRCODE = 'RC006';
  END IF;
  SELECT * INTO a FROM caja_apertura WHERE jornada_id = j.id;
  IF FOUND THEN
    RAISE EXCEPTION 'El cajón ya lo contó % a las %', (SELECT nombre FROM usuario WHERE id = a.contado_por),
      to_char(a.contado_en AT TIME ZONE (SELECT zona FROM sucursal WHERE id = j.sucursal_id), 'HH24:MI')
      USING ERRCODE = 'RC005';
  END IF;
  SELECT c.se_queda INTO v_anterior FROM caja_corte c JOIN jornada x ON x.id = c.jornada_id
  WHERE x.sucursal_id = j.sucursal_id AND x.fecha < j.fecha ORDER BY x.fecha DESC, c.cierre DESC LIMIT 1;
  PERFORM reservar_envio(p_envio, 'caja_apertura', v_contenido, p_usuario);
  INSERT INTO caja_apertura (jornada_id, contado, anterior, contado_por, envio_id)
  VALUES (j.id, p_contado, v_anterior, p_usuario, p_envio) RETURNING * INTO a;
  IF v_anterior IS NOT NULL AND p_contado <> v_anterior THEN
    INSERT INTO aviso (clase, jornada_id, diferencia, creado_por)
    VALUES ('apertura', j.id, p_contado - v_anterior, p_usuario);
  END IF;
  PERFORM anotar(p_usuario, 'contar', 'cajon', j.id::text, jsonb_build_object('contado', p_contado, 'anterior', v_anterior));
  RETURN a;
END $$;

CREATE FUNCTION mover_caja(p_envio uuid, p_jornada bigint, p_tipo text, p_importe numeric, p_motivo text,
                          p_autoriza bigint, p_clave text, p_huella text, p_usuario bigint)
RETURNS caja_movimiento LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  u usuario;
  j jornada;
  m caja_movimiento;
  v_motivo text := btrim(regexp_replace(p_motivo, '[[:space:]]+', ' ', 'g'));
  v_contenido jsonb;
  v_equipo uuid;
  v_detalle jsonb;
BEGIN
  u := exigir_rol(p_usuario, 'mostrador', 'responsable');
  PERFORM exigir_dinero(p_importe);
  IF p_importe = 0 THEN
    RAISE EXCEPTION 'Se saca o se mete una cantidad mayor que cero' USING ERRCODE = 'RC004';
  END IF;
  IF p_tipo IS NULL OR p_tipo NOT IN ('sacar', 'meter') THEN
    RAISE EXCEPTION 'El movimiento debe decir sacar o meter' USING ERRCODE = 'RC005';
  END IF;
  IF v_motivo IS NULL OR char_length(v_motivo) NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'El motivo lleva de una a 200 letras' USING ERRCODE = 'RC005';
  END IF;
  v_contenido := jsonb_build_object('jornada', p_jornada, 'tipo', p_tipo, 'importe', p_importe,
                                   'motivo', v_motivo, 'autoriza', p_autoriza);
  IF envio_del_cajon(p_envio, 'caja_movimiento', v_contenido, p_usuario) THEN
    SELECT * INTO m FROM caja_movimiento WHERE envio_id = p_envio;
    RETURN m;
  END IF;
  PERFORM exigir_rol(p_autoriza, 'responsable');
  SELECT * INTO j FROM jornada WHERE id = p_jornada AND sucursal_id = u.sucursal_id FOR UPDATE;
  IF NOT FOUND OR j.cerrada_en IS NOT NULL THEN
    RAISE EXCEPTION 'Esa jornada no es la que está abierta' USING ERRCODE = 'RC006';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM caja_apertura WHERE jornada_id = j.id) THEN
    RAISE EXCEPTION 'Primero se cuenta el cajón al abrir' USING ERRCODE = 'RC006';
  END IF;
  v_equipo := equipo_vigente(p_huella);
  IF v_equipo IS NULL OR NOT comprobar_clave(v_equipo, p_autoriza, p_clave) THEN RETURN NULL; END IF;
  PERFORM reservar_envio(p_envio, 'caja_movimiento', v_contenido, p_usuario);
  INSERT INTO caja_movimiento (jornada_id, tipo, importe, motivo, registrado_por, autorizado_por, envio_id)
  VALUES (j.id, p_tipo, p_importe, v_motivo, p_usuario, p_autoriza, p_envio) RETURNING * INTO m;
  v_detalle := jsonb_build_object('importe', p_importe, 'motivo', v_motivo, 'autoriza', p_autoriza);
  IF p_tipo = 'sacar' THEN
    PERFORM anotar(p_usuario, 'sacar', 'caja', m.id::text, v_detalle);
  ELSE
    PERFORM anotar(p_usuario, 'meter', 'caja', m.id::text, v_detalle);
  END IF;
  RETURN m;
END $$;

-- Una fórmula para la pantalla y para el corte. Es VOLATILE para ver las confirmaciones que
-- terminaron mientras se esperaba el candado de la jornada, en la misma orden de cierre.
CREATE FUNCTION esperado_en_cajon(p_jornada bigint) RETURNS numeric
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT a.contado
    + coalesce((SELECT sum(CASE tipo WHEN 'venta' THEN total ELSE -total END) FROM operacion
                WHERE confirmada_en_jornada = p_jornada AND estado = 'confirmada' AND forma_de_pago = 'efectivo'), 0)
    + coalesce((SELECT sum(CASE tipo WHEN 'meter' THEN importe ELSE -importe END) FROM caja_movimiento
                WHERE jornada_id = p_jornada), 0)
    - coalesce((SELECT sum(retirado) FROM caja_corte WHERE jornada_id = p_jornada), 0)
  FROM caja_apertura a WHERE a.jornada_id = p_jornada;
$$;

CREATE FUNCTION cerrar_el_dia(p_envio uuid, p_jornada bigint, p_cierres int, p_contado numeric, p_se_queda numeric,
                             p_hace bigint, p_clave text, p_huella text, p_usuario bigint)
RETURNS cierre_hecho LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  u usuario;
  j jornada;
  c caja_corte;
  v_contenido jsonb;
  v_esperado numeric(14,2);
  v_equipo uuid;
  v_abiertas int;
BEGIN
  u := exigir_rol(p_usuario, 'mostrador', 'responsable');
  IF p_jornada IS NULL OR p_cierres IS NULL OR p_cierres < 0 THEN
    RAISE EXCEPTION 'Falta decir cuál jornada se cierra y cuántos cierres llevaba' USING ERRCODE = 'RC005';
  END IF;
  PERFORM exigir_dinero(p_contado);
  PERFORM exigir_dinero(p_se_queda);
  IF p_se_queda > p_contado THEN
    RAISE EXCEPTION 'No puede quedarse más dinero del que se contó' USING ERRCODE = 'RC004';
  END IF;
  v_contenido := jsonb_build_object('jornada', p_jornada, 'cierres', p_cierres, 'contado', p_contado,
                                   'se_queda', p_se_queda, 'hace', p_hace);
  IF envio_del_cajon(p_envio, 'caja_corte', v_contenido, p_usuario) THEN
    SELECT * INTO c FROM caja_corte WHERE envio_id = p_envio;
    RETURN ROW(c.jornada_id, c.cierre)::cierre_hecho;
  END IF;
  IF NOT puede_hacer_corte(p_hace) THEN
    RAISE EXCEPTION 'Esa persona no tiene permiso para hacer el corte' USING ERRCODE = 'RC008';
  END IF;
  SELECT * INTO j FROM jornada WHERE id = p_jornada AND sucursal_id = u.sucursal_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'La jornada % no existe', p_jornada USING ERRCODE = 'RC006';
  END IF;
  IF j.cerrada_en IS NOT NULL OR j.cierres <> p_cierres THEN
    RAISE EXCEPTION 'El día ya se cerró o se reabrió desde que se vio: hay que volver a verlo' USING ERRCODE = 'RC011';
  END IF;
  v_esperado := esperado_en_cajon(j.id);
  IF v_esperado IS NULL THEN
    RAISE EXCEPTION 'Primero se cuenta el cajón al abrir' USING ERRCODE = 'RC006';
  END IF;
  -- El cierre que ya sabemos imposible tampoco consume un intento de clave.
  SELECT count(*) INTO v_abiertas FROM cuenta_pendiente WHERE jornada_id = j.id AND NOT espera_vehiculo;
  IF v_abiertas > 0 THEN
    RAISE EXCEPTION 'Hay % cuentas abiertas: se terminan o se descartan antes de cerrar', v_abiertas USING ERRCODE = 'RC006';
  END IF;
  v_equipo := equipo_vigente(p_huella);
  IF v_equipo IS NULL OR NOT comprobar_clave(v_equipo, p_hace, p_clave) THEN RETURN NULL; END IF;
  PERFORM reservar_envio(p_envio, 'caja_corte', v_contenido, p_usuario);
  j := cerrar_jornada(j.id, p_hace);
  INSERT INTO caja_corte (jornada_id, cierre, esperado, contado, diferencia, se_queda, retirado, hecho_por, registrado_por, envio_id)
  VALUES (j.id, j.cierres, v_esperado, p_contado, p_contado - v_esperado, p_se_queda, p_contado - p_se_queda, p_hace, p_usuario, p_envio)
  RETURNING * INTO c;
  IF c.diferencia <> 0 THEN
    INSERT INTO aviso (clase, jornada_id, diferencia, creado_por) VALUES ('corte', j.id, c.diferencia, p_hace);
  END IF;
  PERFORM anotar(p_hace, 'corte', 'jornada', j.id::text,
    jsonb_build_object('esperado', v_esperado, 'contado', p_contado, 'diferencia', c.diferencia, 'se_queda', p_se_queda, 'registro', p_usuario));
  RETURN ROW(j.id, j.cierres)::cierre_hecho;
END $$;

CREATE FUNCTION ver_aviso(p_aviso bigint, p_usuario bigint) RETURNS aviso
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE a aviso;
BEGIN
  PERFORM exigir_rol(p_usuario, 'responsable');
  SELECT * INTO a FROM aviso WHERE id = p_aviso FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ese aviso no existe' USING ERRCODE = 'RC005';
  END IF;
  IF a.visto_en IS NOT NULL THEN RETURN a; END IF;
  UPDATE aviso SET visto_por = p_usuario, visto_en = clock_timestamp() WHERE id = p_aviso RETURNING * INTO a;
  PERFORM anotar(p_usuario, 'ver', 'aviso', a.id::text);
  RETURN a;
END $$;

-- La entrada antigua queda para la consola y las pruebas del dueño. La aplicación solo cierra
-- con corte. cerrar_jornada_abierta ya se eliminó en 0024; cerrar_jornada es interna desde 0012.
REVOKE EXECUTE ON FUNCTION cerrar_el_dia(uuid, bigint, int, bigint), cerrar_jornada(bigint, bigint) FROM feruga_app;
REVOKE EXECUTE ON FUNCTION confirmar_operacion(uuid, bigint, int), confirmar_operacion(uuid, bigint, int, text) FROM feruga_app;
GRANT SELECT ON caja_apertura, caja_movimiento, caja_corte, aviso TO feruga_app;
GRANT EXECUTE ON FUNCTION
  puede_hacer_corte(bigint), permiso_de_corte(text, bigint, text, bigint, boolean), personas_para_administrar(bigint),
  confirmar_cuenta(uuid, bigint, int, text), terminar_vehiculo(uuid, int, bigint, text, text, text),
  abrir_el_cajon(uuid, bigint, numeric, bigint), mover_caja(uuid, bigint, text, numeric, text, bigint, text, text, bigint),
  esperado_en_cajon(bigint), cerrar_el_dia(uuid, bigint, int, numeric, numeric, bigint, text, text, bigint), ver_aviso(bigint, bigint)
TO feruga_app;
