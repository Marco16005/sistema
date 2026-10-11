-- Clientes con precio especial.
--
-- A ciertos clientes se les da, en un material de su cuenta, un precio distinto del de la lista
-- del día: una diferencia por kilo, hacia arriba o hacia abajo, al comprar y al vender. Lo decide
-- un dueño en el momento, con su clave. Queda registro de a quién, cuánto y quién lo autorizó, y
-- ese registro no se borra.
--
-- Cómo se guarda:
--   · El renglón lleva los dos precios: el de lista (`precio_lista`, fijado al nacer y que ya no
--     cambia) y el que se cobra (`precio_unitario`). Y lleva quién autorizó el precio especial
--     vigente (`precio_autorizado_por`) y su último evento de precio (`precio_evento`).
--   · Cada cambio de precio es un evento en `precio_especial`: «dar» o «quitar». Cada evento
--     nombra al anterior de su renglón, y el renglón apunta siempre al último: la cadena es una
--     sola. Hay precio especial vigente cuando el último evento es «dar».
--   · La cuenta queda a nombre del cliente (`operacion.cliente_id`) mientras alguno de sus
--     renglones tenga precio especial vigente. Un cliente por cuenta. Al cobrar se guarda su
--     nombre como estaba (`cliente_nombre`): renombrarlo después no cambia lo ya entregado.
--
-- Dar y quitar dicen qué evento vieron en el renglón. Si el renglón ya tiene otro, la petición
-- llegó tarde y se rechaza: así una petición atrasada —de otra pestaña, o un reintento— no pisa
-- ni quita un precio que no vio.
--
--   RC001 · la cuenta ya se cobró
--   RC004 · la diferencia, o el precio que queda, no valen
--   RC005 · lo demás que no procede, y lo que rechazan los guardianes
--   RC006 · no hay jornada abierta hoy
--   RC008 · quien autoriza no está facultado, o quien captura no es de mostrador ni responsable
--   RC011 · el renglón ya tiene otro evento de precio que el que se vio
--   RC012 · ese envío es de otro contenido, o se canceló

-- ── clientes ────────────────────────────────────────────────────────────────

-- El nombre como se guarda: sin espacios de más. Vacío si no dice nada.
CREATE FUNCTION nombre_de_cliente(p_nombre text) RETURNS text
LANGUAGE plpgsql IMMUTABLE SET search_path = public, pg_temp AS $$
DECLARE
  v text := nullif(regexp_replace(btrim(coalesce(p_nombre, '')), '\s+', ' ', 'g'), '');
BEGIN
  IF char_length(v) > 80 THEN
    RAISE EXCEPTION 'El nombre del cliente lleva hasta 80 letras' USING ERRCODE = 'RC005';
  END IF;
  RETURN v;
END $$;

-- Nombre y nada más, por ahora. Es único sin distinguir mayúsculas; los acentos sí distinguen
-- («Jose» y «José» son dos): se arregla renombrando.
CREATE TABLE cliente (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  nombre     text NOT NULL CHECK (nombre = nombre_de_cliente(nombre)),
  activo     boolean NOT NULL DEFAULT true,
  creado_por bigint REFERENCES usuario,
  creado_en  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX cliente_nombre_unico ON cliente (lower(nombre));

-- ── el registro de precios especiales ───────────────────────────────────────

-- La cuenta y el renglón se guardan como datos, no como vínculos: una cuenta descartada se borra
-- y su historia debe quedar. El material, el cliente y las personas sí son vínculos.
CREATE TABLE precio_especial (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  clase           text NOT NULL CHECK (clase IN ('dar', 'quitar')),
  operacion_id    uuid NOT NULL,
  linea_id        uuid NOT NULL,
  material_id     int NOT NULL REFERENCES material,
  cliente_id      bigint NOT NULL REFERENCES cliente,
  cliente_nombre  text NOT NULL,                       -- como se llamaba entonces
  precio_lista    numeric(14,4) NOT NULL,
  precio_anterior numeric(14,4) NOT NULL,
  precio_nuevo    numeric(14,4) NOT NULL CHECK (precio_nuevo > 0 AND precio_nuevo <= 99999.9999),
  capturado_por   bigint NOT NULL REFERENCES usuario,
  -- Al dar: quien autoriza. Al quitar: quien había autorizado lo que se deshace (quitar no es una
  -- autorización nueva).
  autorizado_por  bigint NOT NULL REFERENCES usuario,
  anterior_id     bigint REFERENCES precio_especial,   -- el evento anterior de ese renglón; vacío si es el primero
  creado_en       timestamptz NOT NULL DEFAULT now(),
  transaccion     xid8 NOT NULL DEFAULT pg_current_xact_id(),
  CONSTRAINT dar_cambia_el_precio CHECK (clase <> 'dar' OR precio_nuevo <> precio_lista),
  CONSTRAINT quitar_vuelve_a_la_lista CHECK (clase <> 'quitar' OR (precio_nuevo = precio_lista AND anterior_id IS NOT NULL))
);
CREATE INDEX precio_especial_de_linea ON precio_especial (linea_id);
CREATE INDEX precio_especial_de_cuenta ON precio_especial (operacion_id);
CREATE TRIGGER precio_especial_inmutable BEFORE UPDATE OR DELETE ON precio_especial
  FOR EACH ROW EXECUTE FUNCTION rechazar_cambio();
CREATE TRIGGER precio_especial_sin_vaciar BEFORE TRUNCATE ON precio_especial
  FOR EACH STATEMENT EXECUTE FUNCTION rechazar_cambio();

-- ── el renglón con sus dos precios ──────────────────────────────────────────

ALTER TABLE operacion_linea
  ADD COLUMN precio_lista          numeric(14,4),
  ADD COLUMN precio_autorizado_por bigint REFERENCES usuario,
  ADD COLUMN precio_evento         bigint REFERENCES precio_especial;

-- A los renglones que ya existen, su precio de lista es el que tienen. Las operaciones cobradas no
-- admiten cambios y esto no lo es —no cambia nada de lo cobrado—: se pasa con sus guardianes en
-- pausa, y vuelven a quedar puestos.
ALTER TABLE operacion_linea DISABLE TRIGGER USER;
UPDATE operacion_linea SET precio_lista = precio_unitario;
ALTER TABLE operacion_linea ENABLE TRIGGER USER;
ALTER TABLE operacion_linea
  ALTER COLUMN precio_lista SET NOT NULL,
  ADD CONSTRAINT precio_especial_completo CHECK ((precio_autorizado_por IS NULL) = (precio_unitario = precio_lista)),
  ADD CONSTRAINT autorizado_con_su_evento CHECK (precio_autorizado_por IS NULL OR precio_evento IS NOT NULL);

ALTER TABLE operacion
  ADD COLUMN cliente_id     bigint REFERENCES cliente,
  ADD COLUMN cliente_nombre text,
  ADD CONSTRAINT nombre_del_cliente_al_cobrar
    CHECK (CASE WHEN estado = 'confirmada' THEN (cliente_id IS NULL) = (cliente_nombre IS NULL) ELSE cliente_nombre IS NULL END);

-- Toda cuenta nace anónima; todo renglón, con su precio de lista y sin precio especial.
CREATE OR REPLACE FUNCTION operacion_nace() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  j jornada;
  l lista_precios;
BEGIN
  SELECT * INTO j FROM jornada WHERE id = NEW.jornada_id FOR SHARE;
  IF j.cerrada_en IS NOT NULL THEN
    RAISE EXCEPTION 'La jornada del % ya está cerrada', j.fecha USING ERRCODE = 'RC006';
  END IF;
  IF j.sucursal_id <> NEW.sucursal_id THEN
    RAISE EXCEPTION 'La jornada no es de esta sucursal' USING ERRCODE = 'RC005';
  END IF;
  SELECT * INTO l FROM lista_precios WHERE jornada_id = NEW.jornada_id;
  IF l.publicada_en IS NULL THEN
    RAISE EXCEPTION 'La lista de precios de hoy todavía no está publicada' USING ERRCODE = 'RC009';
  END IF;
  -- Toda cuenta nace abierta y atada a la lista de su jornada, mande lo que mande quien la abre.
  NEW.lista_id := l.id;
  NEW.estado := 'borrador';
  NEW.estado_pago := 'pendiente';
  NEW.revision := 0;
  NEW.folio := NULL; NEW.suma := NULL; NEW.ajuste_redondeo := NULL; NEW.total := NULL;
  NEW.confirmada_en := NULL; NEW.confirmada_por := NULL; NEW.confirmada_en_jornada := NULL;
  NEW.cliente_id := NULL; NEW.cliente_nombre := NULL;
  RETURN NEW;
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
           NEW.confirmada_en_jornada, NEW.revision, NEW.cliente_id, NEW.cliente_nombre)
       IS DISTINCT FROM
       ROW(OLD.id, OLD.sucursal_id, OLD.jornada_id, OLD.lista_id, OLD.tipo, OLD.etiqueta, OLD.estado, OLD.creada_en,
           OLD.creada_por, OLD.folio, OLD.suma, OLD.ajuste_redondeo, OLD.total, OLD.confirmada_en, OLD.confirmada_por,
           OLD.confirmada_en_jornada, OLD.revision, OLD.cliente_id, OLD.cliente_nombre)
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

CREATE OR REPLACE FUNCTION linea_nace() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  op operacion;
  v_precio numeric(14,4);
BEGIN
  SELECT * INTO op FROM operacion WHERE id = NEW.operacion_id FOR UPDATE;
  IF op.estado <> 'borrador' THEN
    RAISE EXCEPTION 'La operación con folio % está confirmada: no admite más renglones', op.folio USING ERRCODE = 'RC001';
  END IF;
  -- Agregar un renglón bloquea la jornada contra su cierre: si se está cerrando, espera, y al
  -- releerla la encuentra cerrada. Sin el bloqueo se leería la jornada de antes del cierre.
  -- El orden es el de confirmar: primero la cuenta, después la jornada.
  IF (SELECT cerrada_en FROM jornada WHERE id = op.jornada_id FOR SHARE) IS NOT NULL THEN
    RAISE EXCEPTION 'La jornada de esta cuenta ya está cerrada: no se le agregan materiales' USING ERRCODE = 'RC006';
  END IF;
  IF NOT (SELECT activo FROM material WHERE id = NEW.material_id) THEN
    RAISE EXCEPTION 'Ese material está dado de baja' USING ERRCODE = 'RC005';
  END IF;
  SELECT CASE op.tipo WHEN 'compra' THEN p.compra ELSE p.venta END INTO v_precio
  FROM precio p WHERE p.lista_id = op.lista_id AND p.material_id = NEW.material_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ese material no tiene precio en la lista de hoy' USING ERRCODE = 'RC009';
  END IF;
  -- El precio queda congelado aquí —el de lista, para siempre—; el peso llegará de la pesada.
  NEW.precio_unitario := v_precio;
  NEW.precio_lista := v_precio;
  NEW.precio_autorizado_por := NULL;
  NEW.precio_evento := NULL;
  NEW.peso_bruto := NULL;
  NEW.tara := 0;
  RETURN NEW;
END $$;

-- El guardián de los renglones. El precio sigue sin poder cambiarse, salvo por una transición
-- exacta y de un solo uso: precio, autorizante vigente y evento cambian juntos o no cambian, y
-- solo de la mano de un evento escrito en esta misma transacción, de este renglón y de esta
-- cuenta, que nombra como anterior al evento que el renglón tenía y cuyos precios son el que el
-- renglón tenía y el que queda. No hay bandera que alguien pueda poner por fuera.
CREATE OR REPLACE FUNCTION linea_cambia() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_estado text;
  v_folio  bigint;
  ev       precio_especial;
BEGIN
  SELECT estado, folio INTO v_estado, v_folio FROM operacion WHERE id = OLD.operacion_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN OLD;          -- la cuenta se está descartando y se lleva sus renglones
  END IF;
  IF v_estado <> 'borrador' THEN
    RAISE EXCEPTION 'La operación con folio % está confirmada: sus renglones no se modifican ni se quitan', v_folio
      USING ERRCODE = 'RC001';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  IF ROW(NEW.id, NEW.operacion_id, NEW.material_id, NEW.instrumento_id, NEW.precio_lista)
     IS DISTINCT FROM ROW(OLD.id, OLD.operacion_id, OLD.material_id, OLD.instrumento_id, OLD.precio_lista) THEN
    RAISE EXCEPTION 'A un renglón no se le cambia el material, la báscula ni el precio de lista: se quita y se agrega otro'
      USING ERRCODE = 'RC005';
  END IF;
  IF ROW(NEW.precio_unitario, NEW.precio_autorizado_por, NEW.precio_evento)
     IS NOT DISTINCT FROM ROW(OLD.precio_unitario, OLD.precio_autorizado_por, OLD.precio_evento) THEN
    RETURN NEW;          -- el precio no se tocó
  END IF;

  SELECT * INTO ev FROM precio_especial WHERE id = NEW.precio_evento;
  IF NOT FOUND
     OR ev.transaccion <> pg_current_xact_id()
     OR ev.linea_id <> OLD.id OR ev.operacion_id <> OLD.operacion_id
     OR ev.anterior_id IS DISTINCT FROM OLD.precio_evento
     OR ev.precio_lista <> OLD.precio_lista
     OR ev.precio_anterior <> OLD.precio_unitario
     OR ev.precio_nuevo <> NEW.precio_unitario
     OR (ev.clase = 'dar' AND NEW.precio_autorizado_por IS DISTINCT FROM ev.autorizado_por)
     OR (ev.clase = 'quitar' AND (NEW.precio_autorizado_por IS NOT NULL OR NEW.precio_unitario <> OLD.precio_lista))
  THEN
    RAISE EXCEPTION 'El precio de un renglón solo cambia al dar o quitar un precio especial, con su registro'
      USING ERRCODE = 'RC005';
  END IF;
  RETURN NEW;
END $$;

-- Un evento solo nace bien formado para su renglón: nombra al evento que el renglón tiene ahora,
-- parte del precio que el renglón tiene ahora, y lleva su precio de lista. Quitar deshace un «dar»
-- y conserva, como historia, a quién se le había dado y quién lo había autorizado.
CREATE FUNCTION precio_especial_nace() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  l   operacion_linea;
  ant precio_especial;
BEGIN
  NEW.transaccion := pg_current_xact_id();
  NEW.creado_en := now();
  SELECT * INTO l FROM operacion_linea WHERE id = NEW.linea_id;
  IF NOT FOUND OR l.operacion_id <> NEW.operacion_id OR l.material_id <> NEW.material_id THEN
    RAISE EXCEPTION 'Ese precio no corresponde a ningún material de esa cuenta' USING ERRCODE = 'RC005';
  END IF;
  IF NEW.anterior_id IS DISTINCT FROM l.precio_evento OR NEW.precio_anterior <> l.precio_unitario OR NEW.precio_lista <> l.precio_lista THEN
    RAISE EXCEPTION 'Ese precio no parte de como está el material ahora' USING ERRCODE = 'RC005';
  END IF;
  IF NEW.clase = 'dar' THEN
    IF NEW.precio_nuevo <> round(NEW.precio_nuevo, 4) THEN
      RAISE EXCEPTION 'El precio lleva hasta cuatro decimales' USING ERRCODE = 'RC004';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM usuario WHERE id = NEW.autorizado_por AND puede_autorizar AND activo) THEN
      RAISE EXCEPTION 'Esto lo autoriza una de las personas facultadas' USING ERRCODE = 'RC008';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM cliente WHERE id = NEW.cliente_id AND activo AND nombre = NEW.cliente_nombre) THEN
      RAISE EXCEPTION 'Ese cliente no existe o está dado de baja' USING ERRCODE = 'RC005';
    END IF;
  ELSE
    SELECT * INTO ant FROM precio_especial WHERE id = NEW.anterior_id;
    IF NOT FOUND OR ant.clase <> 'dar' THEN
      RAISE EXCEPTION 'Ese material no tiene precio especial que quitar' USING ERRCODE = 'RC005';
    END IF;
    NEW.cliente_id := ant.cliente_id;
    NEW.cliente_nombre := ant.cliente_nombre;
    NEW.autorizado_por := ant.autorizado_por;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER precio_especial_nace BEFORE INSERT ON precio_especial
  FOR EACH ROW EXECUTE FUNCTION precio_especial_nace();

-- Y al revés: un evento no puede quedar suelto. Al terminar la transacción, todo evento escrito
-- en ella tiene que alcanzarse desde el último evento de su renglón, siguiendo los anteriores
-- —no basta con que algún otro evento lo cite—, o su renglón ya no existir.
CREATE FUNCTION precio_especial_se_cumple() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v bigint;
BEGIN
  SELECT precio_evento INTO v FROM operacion_linea WHERE id = NEW.linea_id;
  IF NOT FOUND THEN
    RETURN NULL;         -- el material se quitó, o la cuenta se descartó: queda la historia
  END IF;
  WHILE v IS NOT NULL LOOP
    IF v = NEW.id THEN
      RETURN NULL;
    END IF;
    SELECT anterior_id INTO v FROM precio_especial WHERE id = v;
  END LOOP;
  RAISE EXCEPTION 'Quedó un registro de precio especial sin su cambio en el material' USING ERRCODE = 'RC005';
END $$;
CREATE CONSTRAINT TRIGGER precio_especial_se_cumple AFTER INSERT ON precio_especial
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION precio_especial_se_cumple();

-- ── el cliente de la cuenta ─────────────────────────────────────────────────

-- De quién son los precios especiales vigentes de una cuenta. Nada si no hay ninguno.
CREATE FUNCTION clientes_de_cuenta(p_cuenta uuid) RETURNS bigint[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT coalesce(array_agg(DISTINCT pe.cliente_id ORDER BY pe.cliente_id), '{}')
  FROM operacion_linea l JOIN precio_especial pe ON pe.id = l.precio_evento
  WHERE l.operacion_id = p_cuenta AND pe.clase = 'dar';
$$;

-- Lo mantiene la base, en la misma transacción que el cambio que lo causa: se pone al dar el
-- primero y se quita cuando ya no queda ninguno, también si lo que se quita es el material.
CREATE FUNCTION linea_mueve_cliente() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_cuenta  uuid;
  v_cliente bigint;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_cuenta := OLD.operacion_id;
  ELSE
    v_cuenta := NEW.operacion_id;
  END IF;
  v_cliente := (clientes_de_cuenta(v_cuenta))[1];
  UPDATE operacion SET cliente_id = v_cliente
  WHERE id = v_cuenta AND estado = 'borrador' AND cliente_id IS DISTINCT FROM v_cliente;
  RETURN NULL;
END $$;
CREATE TRIGGER linea_mueve_cliente AFTER UPDATE OF precio_evento OR DELETE ON operacion_linea
  FOR EACH ROW EXECUTE FUNCTION linea_mueve_cliente();

-- Y se comprueba al terminar la transacción, lo haya movido quien lo haya movido: el cliente de
-- la cuenta es el de sus precios especiales vigentes —uno solo—, o ninguno.
CREATE FUNCTION cuenta_con_su_cliente() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_cuenta   uuid;
  v_cliente  bigint;
  v_clientes bigint[];
BEGIN
  IF TG_TABLE_NAME = 'operacion' THEN
    v_cuenta := NEW.id;
  ELSIF TG_OP = 'DELETE' THEN
    v_cuenta := OLD.operacion_id;
  ELSE
    v_cuenta := NEW.operacion_id;
  END IF;
  SELECT cliente_id INTO v_cliente FROM operacion WHERE id = v_cuenta;
  IF NOT FOUND THEN
    RETURN NULL;         -- la cuenta se descartó
  END IF;
  v_clientes := clientes_de_cuenta(v_cuenta);
  IF cardinality(v_clientes) > 1 THEN
    RAISE EXCEPTION 'Una cuenta es de un solo cliente: no lleva precios especiales de dos' USING ERRCODE = 'RC005';
  END IF;
  IF v_cliente IS DISTINCT FROM v_clientes[1] THEN
    RAISE EXCEPTION 'El cliente de una cuenta es el de sus precios especiales, o ninguno' USING ERRCODE = 'RC005';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER cuenta_con_su_cliente AFTER INSERT OR UPDATE ON operacion
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION cuenta_con_su_cliente();
CREATE CONSTRAINT TRIGGER renglon_con_su_cliente AFTER UPDATE OR DELETE ON operacion_linea
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION cuenta_con_su_cliente();

-- ── los envíos de dar y de quitar ───────────────────────────────────────────

ALTER TABLE envio DROP CONSTRAINT envio_clase_check;
ALTER TABLE envio ADD CONSTRAINT envio_clase_check
  CHECK (clase IN ('cuenta', 'material', 'conteo', 'merma', 'separacion', 'correccion', 'cancelado', 'cierre', 'reapertura', 'precio'));

ALTER TABLE envio_resultado
  ADD COLUMN precio_especial_id bigint REFERENCES precio_especial,
  DROP CONSTRAINT un_resultado,
  ADD CONSTRAINT un_resultado
    CHECK (num_nonnulls(conteo_id, movimiento_id, transformacion_id, jornada_id, reapertura_id, precio_especial_id) = 1);

-- Lo que dejó un envío de precio, si ya dejó algo. Antes comprueba que el envío sea ese mismo
-- (el mismo contenido): si no lo es, lo rechaza.
CREATE FUNCTION precio_ya_enviado(p_envio uuid, p_contenido jsonb, p_usuario bigint) RETURNS precio_especial
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  r  envio_resultado;
  ev precio_especial;
BEGIN
  SELECT * INTO r FROM envio_resultado WHERE envio_id = p_envio;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  PERFORM reservar_envio(p_envio, 'precio', p_contenido, p_usuario);   -- rechaza si el contenido es otro
  SELECT * INTO ev FROM precio_especial WHERE id = r.precio_especial_id;
  RETURN ev;
END $$;

-- Toma la cuenta y su renglón, en ese orden, y al final la jornada de hoy en modo compartido; y
-- comprueba que todo esté como para cambiar un precio. Qué día es hoy se mira aquí, ya con los
-- candados en la mano y con el reloj de verdad: una petición que esperó hasta pasada la
-- medianoche se rechaza. Cerrar el día toma la jornada en exclusiva y no toma cuentas, así que
-- no hay forma de cruzarse: o el cierre espera, o el precio encuentra el día cerrado.
CREATE FUNCTION renglon_para_precio(p_cuenta uuid, p_linea uuid, p_visto bigint) RETURNS operacion_linea
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  op operacion;
  l  operacion_linea;
  j  jornada;
BEGIN
  SELECT * INTO op FROM operacion WHERE id = p_cuenta FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Esa cuenta no existe' USING ERRCODE = 'RC005';
  END IF;
  IF op.estado <> 'borrador' THEN
    RAISE EXCEPTION 'La operación con folio % ya se cobró: su precio no cambia', op.folio USING ERRCODE = 'RC001';
  END IF;
  SELECT * INTO l FROM operacion_linea WHERE id = p_linea AND operacion_id = p_cuenta FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ese material no está en esa cuenta' USING ERRCODE = 'RC005';
  END IF;
  SELECT * INTO j FROM jornada WHERE sucursal_id = op.sucursal_id AND cerrada_en IS NULL FOR SHARE;
  IF NOT FOUND OR j.fecha <> hoy_en(op.sucursal_id) THEN
    RAISE EXCEPTION 'Para dar o quitar un precio especial hace falta la jornada de hoy abierta' USING ERRCODE = 'RC006';
  END IF;
  IF l.precio_evento IS DISTINCT FROM p_visto THEN
    RAISE EXCEPTION 'El precio de ese material cambió desde que se vio: hay que volver a verlo' USING ERRCODE = 'RC011';
  END IF;
  RETURN l;
END $$;

-- Da un precio especial a un material de una cuenta abierta. Devuelve el evento; vacío si la clave
-- de quien autoriza no pasó (sin lanzar error, para que el intento fallido quede contado).
-- El cliente es uno que ya existe (`p_cliente`) o uno nuevo, por su nombre (`p_cliente_nuevo`).
CREATE FUNCTION dar_precio_especial(
  p_envio uuid, p_cuenta uuid, p_linea uuid, p_visto bigint, p_cliente bigint, p_cliente_nuevo text,
  p_diferencia numeric, p_autoriza bigint, p_clave text, p_huella text, p_usuario bigint
) RETURNS precio_especial
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  l           operacion_linea;
  c           cliente;
  ev          precio_especial;
  v_nombre    text := nombre_de_cliente(p_cliente_nuevo);
  v_contenido jsonb;
  v_precio    numeric;
  v_otro      text;
BEGIN
  PERFORM exigir_rol(p_usuario, 'mostrador', 'responsable');
  IF p_envio IS NULL THEN
    RAISE EXCEPTION 'El precio especial llegó sin identificador' USING ERRCODE = 'RC005';
  END IF;
  IF p_cuenta IS NULL OR p_linea IS NULL OR p_autoriza IS NULL THEN
    RAISE EXCEPTION 'Falta decir a qué material de qué cuenta, y quién autoriza' USING ERRCODE = 'RC005';
  END IF;
  IF (p_cliente IS NULL) = (v_nombre IS NULL) THEN
    RAISE EXCEPTION 'El precio especial es para un cliente: uno de la lista, o uno nuevo con su nombre' USING ERRCODE = 'RC005';
  END IF;
  IF p_diferencia IS NULL OR p_diferencia IN ('NaN', 'Infinity', '-Infinity') OR p_diferencia = 0 OR p_diferencia <> round(p_diferencia, 4) THEN
    RAISE EXCEPTION 'La diferencia es por kilo, distinta de cero y con hasta cuatro decimales' USING ERRCODE = 'RC004';
  END IF;
  v_contenido := jsonb_build_object('accion', 'dar', 'cuenta', p_cuenta, 'linea', p_linea, 'visto', p_visto, 'cliente', p_cliente,
                                    'cliente_nuevo', v_nombre, 'diferencia', round(p_diferencia, 4)::text, 'autoriza', p_autoriza);

  -- El mismo envío, otra vez: se devuelve lo que hizo entonces, sin pedir la clave ni exigir que
  -- quien autorizó siga activo ni que el material exista todavía.
  ev := precio_ya_enviado(p_envio, v_contenido, p_usuario);
  IF ev.id IS NOT NULL THEN
    RETURN ev;
  END IF;

  IF NOT autorizo_con_clave(p_huella, p_autoriza, p_clave) THEN
    RETURN NULL;
  END IF;
  -- Si otro igual va en camino, aquí se le espera; al pasar, ya dejó su resultado.
  IF NOT reservar_envio(p_envio, 'precio', v_contenido, p_usuario) THEN
    RETURN precio_ya_enviado(p_envio, v_contenido, p_usuario);
  END IF;

  l := renglon_para_precio(p_cuenta, p_linea, p_visto);
  v_precio := l.precio_lista + p_diferencia;
  IF v_precio <= 0 OR v_precio > 99999.9999 THEN
    RAISE EXCEPTION 'Con esa diferencia el precio quedaría en %: tiene que ser mayor que cero y de hasta 99,999.9999', v_precio
      USING ERRCODE = 'RC004';
  END IF;

  IF p_cliente IS NOT NULL THEN
    SELECT * INTO c FROM cliente WHERE id = p_cliente FOR SHARE;
    IF NOT FOUND OR NOT c.activo THEN
      RAISE EXCEPTION 'Ese cliente no existe o está dado de baja' USING ERRCODE = 'RC005';
    END IF;
  ELSE
    -- Uno nuevo. Si otro lo está dando de alta a la vez, aquí se le espera, y queda uno solo.
    INSERT INTO cliente (nombre, creado_por) VALUES (v_nombre, p_usuario) ON CONFLICT (lower(nombre)) DO NOTHING;
    SELECT * INTO c FROM cliente WHERE lower(nombre) = lower(v_nombre) FOR SHARE;
    IF NOT c.activo THEN
      RAISE EXCEPTION '«%» está dado de baja: se reactiva por la consola, no se da de alta otro igual', c.nombre USING ERRCODE = 'RC005';
    END IF;
  END IF;

  -- Una cuenta, un cliente: los demás materiales con precio especial tienen que ser suyos.
  SELECT pe.cliente_nombre INTO v_otro
  FROM operacion_linea x JOIN precio_especial pe ON pe.id = x.precio_evento
  WHERE x.operacion_id = p_cuenta AND x.id <> p_linea AND pe.clase = 'dar' AND pe.cliente_id <> c.id
  LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'Esta cuenta ya lleva precio especial para «%»: una cuenta es de un solo cliente', v_otro USING ERRCODE = 'RC005';
  END IF;

  INSERT INTO precio_especial (clase, operacion_id, linea_id, material_id, cliente_id, cliente_nombre, precio_lista, precio_anterior,
                               precio_nuevo, capturado_por, autorizado_por, anterior_id)
  VALUES ('dar', p_cuenta, p_linea, l.material_id, c.id, c.nombre, l.precio_lista, l.precio_unitario, v_precio, p_usuario, p_autoriza, l.precio_evento)
  RETURNING * INTO ev;
  UPDATE operacion_linea SET precio_unitario = v_precio, precio_autorizado_por = p_autoriza, precio_evento = ev.id WHERE id = p_linea;
  INSERT INTO envio_resultado (envio_id, precio_especial_id) VALUES (p_envio, ev.id);
  PERFORM anotar(p_usuario, 'precio_especial', 'operacion', p_cuenta::text,
                 jsonb_build_object('clase', 'dar', 'evento', ev.id, 'linea', p_linea, 'material', l.material_id, 'cliente', c.id,
                                    'cliente_nombre', c.nombre, 'lista', l.precio_lista, 'anterior', l.precio_unitario, 'queda', v_precio,
                                    'autoriza', p_autoriza));
  RETURN ev;
END $$;

-- Quita el precio especial: el material vuelve a su precio de lista. No pide clave —es el precio
-- normal, y no hay autorización nueva que dar—; lo hace quien atiende la cuenta. Queda anotado, y
-- el evento apunta al que deshace.
CREATE FUNCTION quitar_precio_especial(p_envio uuid, p_cuenta uuid, p_linea uuid, p_visto bigint, p_usuario bigint) RETURNS precio_especial
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  l           operacion_linea;
  ant         precio_especial;
  ev          precio_especial;
  v_contenido jsonb;
BEGIN
  PERFORM exigir_rol(p_usuario, 'mostrador', 'responsable');
  IF p_envio IS NULL THEN
    RAISE EXCEPTION 'Quitar el precio especial llegó sin identificador' USING ERRCODE = 'RC005';
  END IF;
  IF p_cuenta IS NULL OR p_linea IS NULL THEN
    RAISE EXCEPTION 'Falta decir a qué material de qué cuenta' USING ERRCODE = 'RC005';
  END IF;
  v_contenido := jsonb_build_object('accion', 'quitar', 'cuenta', p_cuenta, 'linea', p_linea, 'visto', p_visto);

  ev := precio_ya_enviado(p_envio, v_contenido, p_usuario);
  IF ev.id IS NOT NULL THEN
    RETURN ev;
  END IF;
  IF NOT reservar_envio(p_envio, 'precio', v_contenido, p_usuario) THEN
    RETURN precio_ya_enviado(p_envio, v_contenido, p_usuario);
  END IF;

  l := renglon_para_precio(p_cuenta, p_linea, p_visto);
  SELECT * INTO ant FROM precio_especial WHERE id = l.precio_evento;
  IF NOT FOUND OR ant.clase <> 'dar' THEN
    RAISE EXCEPTION 'Ese material no tiene precio especial que quitar' USING ERRCODE = 'RC005';
  END IF;

  INSERT INTO precio_especial (clase, operacion_id, linea_id, material_id, cliente_id, cliente_nombre, precio_lista, precio_anterior,
                               precio_nuevo, capturado_por, autorizado_por, anterior_id)
  VALUES ('quitar', p_cuenta, p_linea, l.material_id, ant.cliente_id, ant.cliente_nombre, l.precio_lista, l.precio_unitario,
          l.precio_lista, p_usuario, ant.autorizado_por, ant.id)
  RETURNING * INTO ev;
  UPDATE operacion_linea SET precio_unitario = l.precio_lista, precio_autorizado_por = NULL, precio_evento = ev.id WHERE id = p_linea;
  INSERT INTO envio_resultado (envio_id, precio_especial_id) VALUES (p_envio, ev.id);
  PERFORM anotar(p_usuario, 'precio_especial', 'operacion', p_cuenta::text,
                 jsonb_build_object('clase', 'quitar', 'evento', ev.id, 'deshace', ant.id, 'linea', p_linea, 'material', l.material_id,
                                    'cliente', ant.cliente_id, 'cliente_nombre', ant.cliente_nombre, 'lista', l.precio_lista,
                                    'anterior', l.precio_unitario));
  RETURN ev;
END $$;

-- ── el cierre ───────────────────────────────────────────────────────────────

-- Los precios especiales vigentes en lo cobrado en esa jornada (la jornada en que se cobró, no en
-- la que nació la cuenta). La diferencia en dinero es el importe cobrado menos el que habría dado
-- la lista, cada uno redondeado a centavos —no «kilos por diferencia», que no siempre da lo
-- mismo—. En una compra, positiva es que se pagó de más; en una venta, que se cobró de más. El
-- redondeo a pesos de la cuenta no se le atribuye a nadie. Lo quitado y lo descartado queda en el
-- registro, no aquí.
CREATE FUNCTION precios_especiales_del_dia(p_jornada bigint)
RETURNS TABLE (
  operacion_id uuid, folio bigint, tipo text, cliente_id bigint, cliente text, material_id int, material text, kg numeric,
  precio_lista numeric, precio_aplicado numeric, importe numeric, importe_de_lista numeric, diferencia numeric,
  autorizo bigint, autorizo_nombre text
)
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  SELECT o.id, o.folio, o.tipo, o.cliente_id, o.cliente_nombre, l.material_id, m.nombre, l.peso_liquidable,
         l.precio_lista, l.precio_unitario, l.importe, round(l.peso_liquidable * l.precio_lista, 2),
         l.importe - round(l.peso_liquidable * l.precio_lista, 2), l.precio_autorizado_por, u.nombre
  FROM operacion o
  JOIN operacion_linea l ON l.operacion_id = o.id
  JOIN material m ON m.id = l.material_id
  JOIN usuario u ON u.id = l.precio_autorizado_por
  WHERE o.estado = 'confirmada' AND o.confirmada_en_jornada = p_jornada
  ORDER BY o.tipo, o.folio, l.creada_en, l.id;
$$;

-- ── la consola: renombrar, dar de baja y reactivar clientes ─────────────────

CREATE FUNCTION renombrar_cliente(p_cliente bigint, p_nombre text) RETURNS cliente
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  c        cliente;
  v_nombre text := nombre_de_cliente(p_nombre);
BEGIN
  IF v_nombre IS NULL THEN
    RAISE EXCEPTION 'Falta el nombre del cliente' USING ERRCODE = 'RC005';
  END IF;
  IF EXISTS (SELECT 1 FROM cliente WHERE lower(nombre) = lower(v_nombre) AND id <> p_cliente) THEN
    RAISE EXCEPTION 'Ya hay un cliente que se llama «%»', v_nombre USING ERRCODE = 'RC005';
  END IF;
  UPDATE cliente SET nombre = v_nombre WHERE id = p_cliente RETURNING * INTO c;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'El cliente % no existe', p_cliente USING ERRCODE = 'RC005';
  END IF;
  RETURN c;
EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION 'Ya hay un cliente que se llama «%»', v_nombre USING ERRCODE = 'RC005';
END $$;

CREATE FUNCTION baja_de_cliente(p_cliente bigint) RETURNS cliente
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  c cliente;
BEGIN
  UPDATE cliente SET activo = false WHERE id = p_cliente RETURNING * INTO c;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'El cliente % no existe', p_cliente USING ERRCODE = 'RC005';
  END IF;
  RETURN c;
END $$;

CREATE FUNCTION reactivar_cliente(p_cliente bigint) RETURNS cliente
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  c cliente;
BEGIN
  UPDATE cliente SET activo = true WHERE id = p_cliente RETURNING * INTO c;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'El cliente % no existe', p_cliente USING ERRCODE = 'RC005';
  END IF;
  RETURN c;
END $$;

-- ── permisos ────────────────────────────────────────────────────────────────

-- La aplicación lee; escribir, solo por las dos acciones. Renombrar, dar de baja y reactivar
-- clientes es de la consola, no de la aplicación.
GRANT SELECT ON cliente, precio_especial TO feruga_app;
GRANT EXECUTE ON FUNCTION
  dar_precio_especial(uuid, uuid, uuid, bigint, bigint, text, numeric, bigint, text, text, bigint),
  quitar_precio_especial(uuid, uuid, uuid, bigint, bigint),
  precios_especiales_del_dia(bigint)
TO feruga_app;
