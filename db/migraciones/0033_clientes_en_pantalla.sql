-- Los clientes, desde la pantalla. Lo pidió el dueño el 13 de octubre de 2026: hasta hoy un cliente
-- solo nacía en el mostrador, al darle su primer precio especial, y darlo de baja o reactivarlo era
-- de la consola (0025). Ahora un responsable lo da de alta, lo da de baja y lo reactiva desde los
-- ajustes. Cambiarle el nombre sigue siendo de la consola.
--
-- Tener a un cliente en la lista no le da nada: cada precio especial sigue pidiendo la clave de
-- quien autoriza (dar_precio_especial). Por eso estas dos entradas no piden clave otra vez, como
-- tampoco la piden las del catálogo de materiales (0030): las hace un responsable que ya está
-- adentro, y quedan anotadas a su nombre.
--
-- La baja no toca lo que ya se dio: una cuenta abierta que ya lleva precio especial para ese
-- cliente —autorizado cuando estaba activo— se cobra como está. Lo que la baja impide es darle
-- otro (lo cuidan dar_precio_especial y precio_especial_nace, que releen al cliente bloqueado).
--
-- Las funciones de la consola (renombrar_cliente, baja_de_cliente, reactivar_cliente) se quedan
-- como están, y la aplicación sigue sin poder llamarlas ni escribir la tabla.

-- ── 0. un nombre, una sola manera de escribirlo ─────────────────────────────
--
-- La regla de la 0025 recortaba espacios comunes y nada más. Con dos puertas para dar de alta a un
-- cliente, la revisión de Codex del 13 de octubre encontró lo que eso dejaba pasar: un nombre de
-- puros caracteres que no se ven daba un cliente invisible; «Ana Paz» con un espacio duro, o «José»
-- con el acento escrito aparte, daban un segundo cliente igual a la vista; y en el mostrador un
-- blanco raro al principio guardaba un nombre en blanco (la restricción comparaba contra «nada», y
-- eso no la violaba) o salía como error crudo de la base.
--
-- Ahora la regla es una sola, para los ajustes, el mostrador y la consola: la misma letra escrita
-- de dos maneras queda de una (NFC); lo que no se ve —ancho cero, marcas de dirección, guion
-- opcional, selectores— se quita; todo blanco, sea el que sea, es un espacio, y no hay dos seguidos
-- ni a las orillas; y lo que queda vacío no es un nombre. Las mayúsculas y los acentos siguen
-- distinguiendo como antes: «Jose» y «José» son dos, y eso se arregla renombrando.
CREATE OR REPLACE FUNCTION nombre_de_cliente(p_nombre text) RETURNS text
LANGUAGE plpgsql IMMUTABLE SET search_path = public, pg_temp AS $$
DECLARE
  v text := normalize(coalesce(p_nombre, ''), NFC);
BEGIN
  v := regexp_replace(v, '[\u00AD\u034F\u061C\u115F\u1160\u17B4\u17B5\u180B-\u180E\u200B-\u200F\u202A-\u202E\u2060-\u206F\u3164\uFE00-\uFE0F\uFEFF\uFFA0]', '', 'g');
  v := regexp_replace(v, '[\s\u0085\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000]+', ' ', 'g');
  v := nullif(btrim(v, ' '), '');
  IF char_length(v) > 80 THEN
    RAISE EXCEPTION 'El nombre del cliente lleva hasta 80 letras' USING ERRCODE = 'RC005';
  END IF;
  RETURN v;
END $$;

-- Los clientes que ya existían pasan por la regla nueva. Casi siempre no cambia nada. Al que
-- quedaría sin nombre, o igual a otro, se le pone uno que dice cuál es —su número—: no se pierde
-- ni se junta con nadie, y se corrige después renombrándolo por la consola. Los comprobantes y el
-- registro de precios guardan el nombre como estaba; eso no se toca.
DO $$
DECLARE
  r record;
  v text;
BEGIN
  FOR r IN SELECT id, nombre FROM cliente ORDER BY id LOOP
    v := nombre_de_cliente(left(r.nombre, 80));
    IF v IS NULL THEN
      v := 'Cliente sin nombre (' || r.id || ')';
    ELSIF v <> r.nombre AND EXISTS (SELECT 1 FROM cliente WHERE lower(nombre) = lower(v) AND id <> r.id) THEN
      v := left(v, 58) || ' (' || r.id || ')';
    END IF;
    IF v <> r.nombre THEN
      UPDATE cliente SET nombre = v WHERE id = r.id;
    END IF;
  END LOOP;
END $$;

-- Y la tabla lo exige diciéndolo completo: un nombre que la regla deja en nada ya no pasa.
ALTER TABLE cliente DROP CONSTRAINT cliente_nombre_check;
ALTER TABLE cliente ADD CONSTRAINT cliente_nombre_check CHECK (nombre IS NOT DISTINCT FROM nombre_de_cliente(nombre));

-- ── 1. dar de alta ──────────────────────────────────────────────────────────

-- El nombre se guarda como lo deja nombre_de_cliente (arriba) y es único sin distinguir
-- mayúsculas, también contra los dados de baja: a ese se le reactiva.
CREATE FUNCTION alta_cliente(p_nombre text, p_usuario bigint) RETURNS cliente
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  c        cliente;
  v_nombre text;
BEGIN
  PERFORM exigir_rol(p_usuario, 'responsable');
  v_nombre := nombre_de_cliente(p_nombre);
  IF v_nombre IS NULL THEN
    RAISE EXCEPTION 'Falta el nombre del cliente' USING ERRCODE = 'RC005';
  END IF;

  INSERT INTO cliente (nombre, creado_por) VALUES (v_nombre, p_usuario)
  ON CONFLICT (lower(nombre)) DO NOTHING RETURNING * INTO c;
  IF FOUND THEN
    PERFORM anotar(p_usuario, 'alta', 'cliente', c.id::text, jsonb_build_object('nombre', c.nombre));
    RETURN c;
  END IF;

  -- Ya había uno con ese nombre. Si otro lo estaba dando de alta a la vez —aquí, o en el mostrador
  -- con su primer precio—, el INSERT lo esperó, y esta consulta ya lo ve.
  SELECT * INTO c FROM cliente WHERE lower(nombre) = lower(v_nombre);
  IF c.activo THEN
    RAISE EXCEPTION 'Ya hay un cliente que se llama «%»', c.nombre USING ERRCODE = 'RC005';
  END IF;
  RAISE EXCEPTION '«%» está dado de baja: reactívalo en vez de dar de alta otro igual', c.nombre USING ERRCODE = 'RC005';
END $$;

-- ── 2. dar de baja y reactivar ──────────────────────────────────────────────

-- Repetir lo que ya está hecho no cambia nada ni se anota otra vez.
CREATE FUNCTION cambiar_cliente(p_cliente bigint, p_activo boolean, p_usuario bigint) RETURNS cliente
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  c cliente;
BEGIN
  PERFORM exigir_rol(p_usuario, 'responsable');
  IF p_activo IS NULL THEN
    RAISE EXCEPTION 'Falta decir si el cliente queda activo o dado de baja' USING ERRCODE = 'RC005';
  END IF;
  -- Bloqueado: quien le esté dando un precio en este instante termina antes, o espera y lo relee.
  SELECT * INTO c FROM cliente WHERE id = p_cliente FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ese cliente no existe' USING ERRCODE = 'RC005';
  END IF;
  IF c.activo = p_activo THEN
    RETURN c;
  END IF;

  UPDATE cliente SET activo = p_activo WHERE id = c.id RETURNING * INTO c;
  IF p_activo THEN
    PERFORM anotar(p_usuario, 'reactivar', 'cliente', c.id::text, jsonb_build_object('nombre', c.nombre));
  ELSE
    PERFORM anotar(p_usuario, 'baja', 'cliente', c.id::text, jsonb_build_object('nombre', c.nombre));
  END IF;
  RETURN c;
END $$;

GRANT EXECUTE ON FUNCTION
  alta_cliente(text, bigint),
  cambiar_cliente(bigint, boolean, bigint)
TO feruga_app;

-- ── 3. el mostrador dice dónde se reactiva ──────────────────────────────────

-- dar_precio_especial es la de 0027, letra por letra, salvo un mensaje: a quien escribe como nuevo
-- el nombre de un cliente dado de baja se le decía «se reactiva por la consola». Ya no es ahí.
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
      RAISE EXCEPTION '«%» está dado de baja: lo reactiva un responsable en Ajustes, no se da de alta otro igual', c.nombre USING ERRCODE = 'RC005';
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
      RAISE EXCEPTION '«%» está dado de baja: lo reactiva un responsable en Ajustes, no se da de alta otro igual', c.nombre USING ERRCODE = 'RC005';
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
