-- El precio especial, después de la décima revisión. Tres cosas.
--
-- 1 · Un renglón que tuvo precio especial no vuelve a nacer con el mismo identificador.
--     El registro guarda el renglón como dato —su identificador—, no como vínculo: los renglones
--     se quitan y su historia debe quedar. Pero entonces ese identificador tiene que nombrar a un
--     solo renglón para siempre, y no era así. Borrado el renglón y vuelto a crear con el mismo
--     identificador, nacía «limpio», y dentro de la misma transacción el evento de antes le
--     volvía a encajar: aunque el renglón nuevo fuera de otro material, y aunque ese precio ya
--     se hubiera quitado. Ahora un identificador con historia de precios ya no se vuelve a usar.
--     La aplicación nunca lo hace —el identificador del renglón es también el de su envío, que
--     queda gastado—; esto es para quien escriba en la base por fuera de ella.
--     Y para que valga también con dos sesiones a la vez —un evento recién escrito no lo ve nadie
--     más hasta que se confirma—, tanto el nacimiento de un evento como el de un renglón toman la
--     cuenta y apartan el identificador del renglón: quien llega segundo espera, y al pasar ya ve
--     lo que el primero dejó.
--
-- 2 · Lo que no procede se dice antes de mirar la clave.
--     Con un envío cancelado —o con un identificador que ocupa otro envío—, dar un precio
--     miraba primero la clave: si venía mal contestaba «la clave no pasó» y contaba el intento.
--     Cinco, y quedaba bloqueada quien autoriza, por un envío que de todos modos ya no iba a
--     entrar. Y el mismo envío, repetido mientras el primero todavía iba en camino, podía
--     contestar eso mismo con el precio ya dado. Ahora el envío se resuelve primero, y también
--     se revisa antes de la clave todo lo que se puede revisar sin ella: la cuenta, el renglón,
--     lo que se vio, el precio que queda y el cliente.
--
-- 3 · Un solo orden de candados: la cuenta, la credencial, la jornada.
--     Dar un precio tomaba primero la credencial de quien autoriza y después la cuenta; terminar
--     un vehículo, al revés. Si las dos cosas le pasaban a la misma cuenta, con la clave de la
--     misma persona y en el mismo instante, se esperaban una a otra y la base tumbaba a una.
--     Ahora las dos toman la cuenta primero. La jornada sigue al final, después de la clave —en
--     ese orden la toman también reabrir el día y contar—, y ahí se mira qué día es hoy.

-- ── 1 · el renglón ──────────────────────────────────────────────────────────

-- Aparta el identificador de un renglón hasta que termine la transacción. Lo piden quien va a
-- crear un renglón con él y quien le va a escribir un evento de precio, siempre con su cuenta ya
-- tomada: así, de dos que llegan a la vez, el segundo ve lo que hizo el primero, estén o no en la
-- misma cuenta. (Es un candado de aviso de PostgreSQL, sobre una huella del identificador.)
CREATE FUNCTION apartar_renglon(p_linea uuid) RETURNS void
LANGUAGE sql SET search_path = public, pg_temp AS $$
  SELECT pg_advisory_xact_lock(7153, hashtext(p_linea::text));
$$;

-- Todo renglón nace con su precio de lista y sin precio especial; y no nace con el identificador
-- de un renglón que ya tuvo precio especial. Se mira con la cuenta ya tomada: quien le esté dando
-- o quitando un precio a esa cuenta en este momento termina antes, y aquí ya se ve lo que dejó.
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
  PERFORM apartar_renglon(NEW.id);
  IF EXISTS (SELECT 1 FROM precio_especial WHERE linea_id = NEW.id) THEN
    RAISE EXCEPTION 'Ese identificador ya fue de un material con precio especial: un material nuevo lleva identificador nuevo'
      USING ERRCODE = 'RC005';
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

-- Un evento solo nace bien formado para su renglón, como antes. Lo nuevo: antes de mirar el
-- renglón toma su cuenta y aparta su identificador. Sin eso, entre que el evento se escribe y se
-- instala, otra sesión —que no lo ve: todavía no está confirmado— podía borrar el renglón y volver
-- a crearlo con el mismo identificador.
CREATE OR REPLACE FUNCTION precio_especial_nace() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  l   operacion_linea;
  ant precio_especial;
BEGIN
  NEW.transaccion := pg_current_xact_id();
  NEW.creado_en := now();
  PERFORM 1 FROM operacion WHERE id = NEW.operacion_id FOR UPDATE;
  PERFORM apartar_renglon(NEW.linea_id);
  SELECT * INTO l FROM operacion_linea WHERE id = NEW.linea_id FOR UPDATE;
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

-- ── 2 y 3 · dar y quitar ────────────────────────────────────────────────────

-- Lo que dejó un envío de precio, si ya dejó algo; vacío si ese identificador está libre. Si el
-- identificador ya no sirve —se canceló, o lo ocupa otro envío—, lo rechaza. Mira el envío, no
-- solo su resultado: un envío cancelado no deja resultado, y también está resuelto.
CREATE OR REPLACE FUNCTION precio_ya_enviado(p_envio uuid, p_contenido jsonb, p_usuario bigint) RETURNS precio_especial
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  ev precio_especial;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM envio WHERE id = p_envio) THEN
    RETURN NULL;
  END IF;
  PERFORM reservar_envio(p_envio, 'precio', p_contenido, p_usuario);   -- rechaza si se canceló, o si es otro
  SELECT pe.* INTO ev
  FROM envio_resultado r JOIN precio_especial pe ON pe.id = r.precio_especial_id
  WHERE r.envio_id = p_envio;
  RETURN ev;
END $$;

-- Toma la cuenta y su renglón, en ese orden, y comprueba lo que de ellos se puede comprobar sin
-- más: que la cuenta siga abierta, que el renglón sea suyo y que su precio siga como se vio. La
-- jornada ya no se mira aquí: va después de la clave.
CREATE OR REPLACE FUNCTION renglon_para_precio(p_cuenta uuid, p_linea uuid, p_visto bigint) RETURNS operacion_linea
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  op operacion;
  l  operacion_linea;
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
  IF l.precio_evento IS DISTINCT FROM p_visto THEN
    RAISE EXCEPTION 'El precio de ese material cambió desde que se vio: hay que volver a verlo' USING ERRCODE = 'RC011';
  END IF;
  RETURN l;
END $$;

-- Toma la jornada de hoy en modo compartido, con la cuenta ya en la mano. Qué día es hoy se mira
-- aquí, al final y con el reloj de verdad: una petición que esperó hasta pasada la medianoche se
-- rechaza. Cerrar el día toma la jornada en exclusiva y no toma cuentas, así que no hay forma de
-- cruzarse: o el cierre espera, o el precio encuentra el día cerrado.
CREATE FUNCTION jornada_para_precio(p_cuenta uuid) RETURNS void
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  v_sucursal smallint;
  j          jornada;
BEGIN
  SELECT sucursal_id INTO v_sucursal FROM operacion WHERE id = p_cuenta;
  SELECT * INTO j FROM jornada WHERE sucursal_id = v_sucursal AND cerrada_en IS NULL FOR SHARE;
  IF NOT FOUND OR j.fecha <> hoy_en(v_sucursal) THEN
    RAISE EXCEPTION 'Para dar o quitar un precio especial hace falta la jornada de hoy abierta' USING ERRCODE = 'RC006';
  END IF;
END $$;

-- Da un precio especial a un material de una cuenta abierta. Devuelve el evento; vacío si la clave
-- de quien autoriza no pasó (sin lanzar error, para que el intento fallido quede contado).
-- El cliente es uno que ya existe (`p_cliente`) o uno nuevo, por su nombre (`p_cliente_nuevo`).
CREATE OR REPLACE FUNCTION dar_precio_especial(
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

  -- La cuenta primero, exista o no todavía. Quien repite un envío que aún va en camino espera
  -- aquí a que el primero termine, y al pasar ya ve lo que dejó.
  PERFORM 1 FROM operacion WHERE id = p_cuenta FOR UPDATE;
  -- El mismo envío, otra vez: se devuelve lo que hizo entonces, sin pedir la clave ni exigir que
  -- quien autorizó siga activo ni que el material o la cuenta existan todavía. Y si ese
  -- identificador ya no sirve, se dice aquí.
  ev := precio_ya_enviado(p_envio, v_contenido, p_usuario);
  IF ev.id IS NOT NULL THEN
    RETURN ev;
  END IF;

  -- Lo que no procede se rechaza antes de mirar la clave: no gasta un intento.
  l := renglon_para_precio(p_cuenta, p_linea, p_visto);
  v_precio := l.precio_lista + p_diferencia;
  IF v_precio <= 0 OR v_precio > 99999.9999 THEN
    RAISE EXCEPTION 'Con esa diferencia el precio quedaría en %: tiene que ser mayor que cero y de hasta 99,999.9999', v_precio
      USING ERRCODE = 'RC004';
  END IF;
  -- El cliente, si ya existe. Uno nuevo se da de alta después de la clave.
  IF p_cliente IS NOT NULL THEN
    SELECT * INTO c FROM cliente WHERE id = p_cliente FOR SHARE;
    IF NOT FOUND OR NOT c.activo THEN
      RAISE EXCEPTION 'Ese cliente no existe o está dado de baja' USING ERRCODE = 'RC005';
    END IF;
  ELSE
    SELECT * INTO c FROM cliente WHERE lower(nombre) = lower(v_nombre) FOR SHARE;
    IF FOUND AND NOT c.activo THEN
      RAISE EXCEPTION '«%» está dado de baja: se reactiva por la consola, no se da de alta otro igual', c.nombre USING ERRCODE = 'RC005';
    END IF;
  END IF;
  -- Una cuenta, un cliente: los demás materiales con precio especial tienen que ser suyos. (De
  -- uno que todavía no existe no puede ser ninguno.)
  SELECT pe.cliente_nombre INTO v_otro
  FROM operacion_linea x JOIN precio_especial pe ON pe.id = x.precio_evento
  WHERE x.operacion_id = p_cuenta AND x.id <> p_linea AND pe.clase = 'dar' AND pe.cliente_id IS DISTINCT FROM c.id
  LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'Esta cuenta ya lleva precio especial para «%»: una cuenta es de un solo cliente', v_otro USING ERRCODE = 'RC005';
  END IF;

  IF NOT autorizo_con_clave(p_huella, p_autoriza, p_clave) THEN
    RETURN NULL;
  END IF;
  -- Si lo cancelaron mientras tanto, aquí se rechaza.
  IF NOT reservar_envio(p_envio, 'precio', v_contenido, p_usuario) THEN
    RETURN precio_ya_enviado(p_envio, v_contenido, p_usuario);
  END IF;
  PERFORM jornada_para_precio(p_cuenta);

  IF c.id IS NULL THEN
    -- Uno nuevo. Si otro lo está dando de alta a la vez, aquí se le espera, y queda uno solo.
    INSERT INTO cliente (nombre, creado_por) VALUES (v_nombre, p_usuario) ON CONFLICT (lower(nombre)) DO NOTHING;
    SELECT * INTO c FROM cliente WHERE lower(nombre) = lower(v_nombre) FOR SHARE;
    IF NOT c.activo THEN
      RAISE EXCEPTION '«%» está dado de baja: se reactiva por la consola, no se da de alta otro igual', c.nombre USING ERRCODE = 'RC005';
    END IF;
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
-- el evento apunta al que deshace. Toma lo suyo en el mismo orden que dar.
CREATE OR REPLACE FUNCTION quitar_precio_especial(p_envio uuid, p_cuenta uuid, p_linea uuid, p_visto bigint, p_usuario bigint) RETURNS precio_especial
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

  PERFORM 1 FROM operacion WHERE id = p_cuenta FOR UPDATE;
  ev := precio_ya_enviado(p_envio, v_contenido, p_usuario);
  IF ev.id IS NOT NULL THEN
    RETURN ev;
  END IF;

  l := renglon_para_precio(p_cuenta, p_linea, p_visto);
  SELECT * INTO ant FROM precio_especial WHERE id = l.precio_evento;
  IF NOT FOUND OR ant.clase <> 'dar' THEN
    RAISE EXCEPTION 'Ese material no tiene precio especial que quitar' USING ERRCODE = 'RC005';
  END IF;
  IF NOT reservar_envio(p_envio, 'precio', v_contenido, p_usuario) THEN
    RETURN precio_ya_enviado(p_envio, v_contenido, p_usuario);
  END IF;
  PERFORM jornada_para_precio(p_cuenta);

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
