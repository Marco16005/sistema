-- Reabrir el día.
--
-- Una jornada cerrada no se modifica, y abrir la de hoy cuando ya existe se rechaza: un cierre por
-- error a media tarde dejaba al negocio sin atender hasta mañana. Ahora la jornada de HOY se puede
-- reabrir —la misma, con su lista ya publicada y sus cuentas—, con la clave de quien autoriza, y
-- queda registro que no se borra.
--
-- Se reabre un cierre en particular, y se cierra una apertura en particular. La jornada lleva la
-- cuenta de sus cierres; cerrar dice cuántos llevaba cuando la pantalla la vio abierta, y reabrir
-- dice cuál cierre vio. Sin eso, una petición atrasada —de otra pestaña, o un reintento con la
-- respuesta perdida— deshace lo que otra persona hizo después: reabre un cierre que nadie pidió
-- reabrir, o vuelve a cerrar un día que alguien acababa de reabrir con la clave del dueño.
-- «Cerrar la que esté abierta» deja por eso de existir.
--
--   RC011 · lo que se vio ya cambió (ese cierre ya no es el vigente): hay que volver a verlo.

-- ── la cuenta de cierres ────────────────────────────────────────────────────

ALTER TABLE jornada ADD COLUMN cierres int NOT NULL DEFAULT 0 CHECK (cierres >= 0);

-- Las que ya estaban cerradas llevan un cierre. El guardián de las jornadas cerradas no deja
-- tocarlas: se aparta solo para este renglón de la migración.
ALTER TABLE jornada DISABLE TRIGGER jornada_cerrada_no_cambia;
UPDATE jornada SET cierres = 1 WHERE cerrada_en IS NOT NULL;
ALTER TABLE jornada ENABLE TRIGGER jornada_cerrada_no_cambia;

-- ── el registro de reaperturas ──────────────────────────────────────────────

CREATE TABLE reapertura (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  jornada_id     bigint NOT NULL REFERENCES jornada,
  -- Qué cierre de esa jornada se reabrió: el primero, el segundo…
  cierre         int NOT NULL CHECK (cierre >= 1),
  -- Cuándo se había cerrado y quién la cerró.
  cerrada_en     timestamptz NOT NULL,
  cerrada_por    bigint NOT NULL REFERENCES usuario,
  reabierta_en   timestamptz NOT NULL DEFAULT clock_timestamp(),
  pedida_por     bigint NOT NULL REFERENCES usuario,
  autorizada_por bigint NOT NULL REFERENCES usuario,
  -- La transacción en que se escribió: el guardián solo acepta el registro de la suya.
  transaccion    xid8 NOT NULL DEFAULT pg_current_xact_id(),
  -- Una reapertura por cierre: la prueba no se puede usar dos veces.
  UNIQUE (jornada_id, cierre)
);
CREATE TRIGGER reapertura_inmutable BEFORE UPDATE OR DELETE ON reapertura
  FOR EACH ROW EXECUTE FUNCTION rechazar_cambio();
CREATE TRIGGER reapertura_sin_vaciar BEFORE TRUNCATE ON reapertura
  FOR EACH STATEMENT EXECUTE FUNCTION rechazar_cambio();

-- Un registro de reapertura solo nace del cierre vigente de su jornada, tal como está: el mismo
-- número, la misma hora, la misma persona. Toma la jornada, para que nadie la cambie entre tanto.
CREATE FUNCTION reapertura_nace() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  j jornada;
BEGIN
  SELECT * INTO j FROM jornada WHERE id = NEW.jornada_id FOR UPDATE;
  IF j.cerrada_en IS NULL OR j.cierres <> NEW.cierre
     OR j.cerrada_en <> NEW.cerrada_en OR j.cerrada_por <> NEW.cerrada_por THEN
    RAISE EXCEPTION 'Ese registro de reapertura no corresponde al cierre vigente de la jornada' USING ERRCODE = 'RC001';
  END IF;
  NEW.transaccion := pg_current_xact_id();
  NEW.reabierta_en := clock_timestamp();
  RETURN NEW;
END $$;
CREATE TRIGGER reapertura_nace BEFORE INSERT ON reapertura
  FOR EACH ROW EXECUTE FUNCTION reapertura_nace();

-- Y no puede quedar suelto: al terminar la transacción, ese cierre ya no es el vigente (la jornada
-- quedó abierta, o se volvió a cerrar con otro número).
CREATE FUNCTION reapertura_se_cumple() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM jornada j WHERE j.id = NEW.jornada_id AND j.cierres = NEW.cierre AND j.cerrada_en IS NOT NULL) THEN
    RAISE EXCEPTION 'Quedó registrada una reapertura sin que la jornada se reabriera' USING ERRCODE = 'RC001';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER reapertura_se_cumple AFTER INSERT ON reapertura
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION reapertura_se_cumple();

-- ── el guardián de la jornada ───────────────────────────────────────────────
--
-- Una jornada cerrada admite un solo cambio: dejar de estarlo. Con todo lo demás idéntico, y solo
-- si en ESTA transacción quedó escrita la reapertura de ESA jornada y ESE cierre. Borrar nunca
-- entra por la excepción. Y la cuenta de cierres solo sube, de uno en uno, exactamente al cerrar.
CREATE OR REPLACE FUNCTION jornada_cerrada_no_cambia() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.cerrada_en IS NOT NULL OR OLD.cierres > 0 THEN
      RAISE EXCEPTION 'La jornada del % ya se cerró alguna vez y no se borra', OLD.fecha USING ERRCODE = 'RC001';
    END IF;
    RETURN OLD;
  END IF;

  IF OLD.cerrada_en IS NOT NULL THEN
    IF NEW.cerrada_en IS NULL AND NEW.cerrada_por IS NULL
       AND (to_jsonb(NEW) - 'cerrada_en' - 'cerrada_por') = (to_jsonb(OLD) - 'cerrada_en' - 'cerrada_por')
       AND EXISTS (
         SELECT 1 FROM reapertura r
         WHERE r.jornada_id = OLD.id AND r.cierre = OLD.cierres
           AND r.cerrada_en = OLD.cerrada_en AND r.cerrada_por = OLD.cerrada_por
           AND r.transaccion = pg_current_xact_id()
       ) THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'La jornada del % ya está cerrada y no se modifica', OLD.fecha USING ERRCODE = 'RC001';
  END IF;

  IF NEW.cierres <> OLD.cierres + (NEW.cerrada_en IS NOT NULL)::int THEN
    RAISE EXCEPTION 'La cuenta de cierres de una jornada solo sube de uno en uno, al cerrarla' USING ERRCODE = 'RC001';
  END IF;
  RETURN NEW;
END $$;

-- ── cerrar ──────────────────────────────────────────────────────────────────

-- Las reglas del cierre no cambian: qué cuentas lo impiden y qué deja pendiente. Solo cuenta el cierre.
CREATE OR REPLACE FUNCTION cerrar_jornada(p_jornada bigint, p_usuario bigint) RETURNS jornada
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  j jornada;
  v_abiertas   int;
  v_pendientes int;
BEGIN
  PERFORM exigir_rol(p_usuario, 'mostrador', 'responsable');
  -- Cerrar bloquea la jornada: quien esté abriendo una cuenta espera y la encuentra cerrada.
  SELECT * INTO j FROM jornada WHERE id = p_jornada FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'La jornada % no existe', p_jornada USING ERRCODE = 'RC006';
  END IF;
  IF j.cerrada_en IS NOT NULL THEN
    RAISE EXCEPTION 'La jornada del % ya estaba cerrada', j.fecha USING ERRCODE = 'RC006';
  END IF;

  SELECT count(*) FILTER (WHERE NOT espera_vehiculo), count(*) FILTER (WHERE espera_vehiculo)
  INTO v_abiertas, v_pendientes
  FROM cuenta_pendiente WHERE jornada_id = p_jornada;
  IF v_abiertas > 0 THEN
    RAISE EXCEPTION 'Hay % cuentas abiertas: se terminan o se descartan antes de cerrar', v_abiertas
      USING ERRCODE = 'RC006';
  END IF;

  UPDATE jornada SET cerrada_en = now(), cerrada_por = p_usuario, cierres = cierres + 1 WHERE id = p_jornada RETURNING * INTO j;
  PERFORM anotar(p_usuario, 'cerrar', 'jornada', p_jornada::text,
                 jsonb_build_object('fecha', j.fecha, 'vehiculos_pendientes', v_pendientes, 'cierre', j.cierres));
  RETURN j;
END $$;

-- Los envíos de cerrar y de reabrir, y lo que dejaron.
ALTER TABLE envio DROP CONSTRAINT envio_clase_check;
ALTER TABLE envio ADD CONSTRAINT envio_clase_check
  CHECK (clase IN ('cuenta', 'material', 'conteo', 'merma', 'separacion', 'correccion', 'cancelado', 'cierre', 'reapertura'));

ALTER TABLE envio_resultado
  ADD COLUMN jornada_id    bigint REFERENCES jornada,
  ADD COLUMN cierre        int,
  ADD COLUMN reapertura_id bigint REFERENCES reapertura,
  DROP CONSTRAINT un_resultado,
  ADD CONSTRAINT un_resultado CHECK (num_nonnulls(conteo_id, movimiento_id, transformacion_id, jornada_id, reapertura_id) = 1),
  ADD CONSTRAINT cierre_con_su_jornada CHECK ((jornada_id IS NULL) = (cierre IS NULL));

-- Lo que hizo un cierre: qué jornada cerró y cuál cierre fue. Es lo que se devuelve si el envío se
-- repite, aunque después la jornada se haya reabierto.
CREATE TYPE cierre_hecho AS (jornada_id bigint, cierre int);

-- Cierra ESA jornada, si sigue abierta y lleva los cierres que la pantalla le vio.
CREATE FUNCTION cerrar_el_dia(p_envio uuid, p_jornada bigint, p_cierres int, p_usuario bigint) RETURNS cierre_hecho
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  u           usuario;
  j           jornada;
  r           envio_resultado;
  v_contenido jsonb;
BEGIN
  u := exigir_rol(p_usuario, 'mostrador', 'responsable');
  IF p_envio IS NULL THEN
    RAISE EXCEPTION 'El cierre llegó sin identificador' USING ERRCODE = 'RC005';
  END IF;
  IF p_jornada IS NULL OR p_cierres IS NULL OR p_cierres < 0 THEN
    RAISE EXCEPTION 'Falta decir cuál jornada se cierra y cuántos cierres llevaba' USING ERRCODE = 'RC005';
  END IF;
  v_contenido := jsonb_build_object('jornada', p_jornada, 'cierres', p_cierres);

  -- El mismo envío, otra vez: se devuelve lo que hizo entonces, sin volver a cerrar lo que haya ahora.
  SELECT * INTO r FROM envio_resultado WHERE envio_id = p_envio;
  IF FOUND THEN
    PERFORM reservar_envio(p_envio, 'cierre', v_contenido, p_usuario);   -- rechaza si el contenido es otro
    RETURN ROW(r.jornada_id, r.cierre)::cierre_hecho;
  END IF;
  -- Si otro igual va en camino, aquí se le espera; al pasar, ya dejó su resultado.
  IF NOT reservar_envio(p_envio, 'cierre', v_contenido, p_usuario) THEN
    SELECT * INTO r FROM envio_resultado WHERE envio_id = p_envio;
    RETURN ROW(r.jornada_id, r.cierre)::cierre_hecho;
  END IF;

  SELECT * INTO j FROM jornada WHERE id = p_jornada AND sucursal_id = u.sucursal_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'La jornada % no existe', p_jornada USING ERRCODE = 'RC006';
  END IF;
  IF j.cerrada_en IS NOT NULL OR j.cierres <> p_cierres THEN
    RAISE EXCEPTION 'El día del % ya se cerró o se reabrió desde que se vio: hay que volver a verlo', j.fecha USING ERRCODE = 'RC011';
  END IF;

  j := cerrar_jornada(p_jornada, p_usuario);
  INSERT INTO envio_resultado (envio_id, jornada_id, cierre) VALUES (p_envio, j.id, j.cierres);
  RETURN ROW(j.id, j.cierres)::cierre_hecho;
END $$;

-- ── reabrir ─────────────────────────────────────────────────────────────────

-- Reabre ESE cierre de ESA jornada. Devuelve el registro; vacío si la clave de quien autoriza no
-- pasó (sin lanzar error, para que el intento fallido quede contado).
CREATE FUNCTION reabrir_jornada(
  p_envio uuid, p_jornada bigint, p_cierre int, p_autoriza bigint, p_clave text, p_huella text, p_usuario bigint
) RETURNS reapertura
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  u           usuario;
  j           jornada;
  r           envio_resultado;
  ra          reapertura;
  v_contenido jsonb;
BEGIN
  u := exigir_rol(p_usuario, 'mostrador', 'responsable');
  IF p_envio IS NULL THEN
    RAISE EXCEPTION 'La reapertura llegó sin identificador' USING ERRCODE = 'RC005';
  END IF;
  IF p_jornada IS NULL OR p_cierre IS NULL OR p_cierre < 1 THEN
    RAISE EXCEPTION 'Falta decir cuál cierre de cuál jornada se reabre' USING ERRCODE = 'RC005';
  END IF;
  v_contenido := jsonb_build_object('jornada', p_jornada, 'cierre', p_cierre, 'autoriza', p_autoriza);

  -- El mismo envío, otra vez: se devuelve lo que hizo entonces, sin pedir la clave ni reabrir de nuevo.
  SELECT * INTO r FROM envio_resultado WHERE envio_id = p_envio;
  IF FOUND THEN
    PERFORM reservar_envio(p_envio, 'reapertura', v_contenido, p_usuario);   -- rechaza si el contenido es otro
    SELECT * INTO ra FROM reapertura WHERE id = r.reapertura_id;
    RETURN ra;
  END IF;

  IF NOT autorizo_con_clave(p_huella, p_autoriza, p_clave) THEN
    RETURN NULL;
  END IF;
  IF NOT reservar_envio(p_envio, 'reapertura', v_contenido, p_usuario) THEN
    SELECT x.* INTO ra FROM envio_resultado e JOIN reapertura x ON x.id = e.reapertura_id WHERE e.envio_id = p_envio;
    RETURN ra;
  END IF;

  SELECT * INTO j FROM jornada WHERE id = p_jornada AND sucursal_id = u.sucursal_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'La jornada % no existe', p_jornada USING ERRCODE = 'RC006';
  END IF;
  -- Qué día es hoy se mira aquí, ya con la jornada tomada y con el reloj de verdad: una petición
  -- que empezó antes de la medianoche y obtuvo el candado después ya no reabre.
  IF j.fecha <> hoy_en(j.sucursal_id) THEN
    RAISE EXCEPTION 'Solo se reabre el día de hoy: la jornada del % ya no lo es', j.fecha USING ERRCODE = 'RC006';
  END IF;
  IF j.cerrada_en IS NULL OR j.cierres <> p_cierre THEN
    RAISE EXCEPTION 'Ese cierre ya no es el vigente: el día se reabrió o se volvió a cerrar desde que se vio' USING ERRCODE = 'RC011';
  END IF;

  INSERT INTO reapertura (jornada_id, cierre, cerrada_en, cerrada_por, pedida_por, autorizada_por)
  VALUES (j.id, j.cierres, j.cerrada_en, j.cerrada_por, p_usuario, p_autoriza)
  RETURNING * INTO ra;
  UPDATE jornada SET cerrada_en = NULL, cerrada_por = NULL WHERE id = j.id;
  INSERT INTO envio_resultado (envio_id, reapertura_id) VALUES (p_envio, ra.id);
  PERFORM anotar(p_usuario, 'reabrir', 'jornada', j.id::text,
                 jsonb_build_object('fecha', j.fecha, 'cierre', j.cierres, 'cerrada_en', j.cerrada_en,
                                    'cerrada_por', j.cerrada_por, 'autoriza', p_autoriza));
  RETURN ra;
END $$;

-- ── abrir, cuando la de hoy ya se cerró ─────────────────────────────────────

CREATE OR REPLACE FUNCTION abrir_jornada(p_sucursal smallint, p_fecha date, p_usuario bigint) RETURNS jornada
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  j       jornada;
  v_lista bigint;
  v_antes bigint;
BEGIN
  PERFORM exigir_rol(p_usuario, 'responsable', 'mostrador');
  IF EXISTS (SELECT 1 FROM jornada WHERE sucursal_id = p_sucursal AND cerrada_en IS NULL) THEN
    RAISE EXCEPTION 'Ya hay una jornada abierta: hay que cerrarla antes de abrir otra' USING ERRCODE = 'RC006';
  END IF;
  IF EXISTS (SELECT 1 FROM jornada WHERE sucursal_id = p_sucursal AND fecha = p_fecha) THEN
    -- No hay ninguna abierta, así que esa ya se cerró. Si es la de hoy, tiene remedio.
    IF p_fecha = hoy_en(p_sucursal) THEN
      RAISE EXCEPTION 'La jornada de hoy ya se cerró: se puede reabrir con la clave de quien autoriza' USING ERRCODE = 'RC006';
    END IF;
    RAISE EXCEPTION 'La jornada del % ya existe', p_fecha USING ERRCODE = 'RC006';
  END IF;

  SELECT l.id INTO v_antes
  FROM lista_precios l JOIN jornada jj ON jj.id = l.jornada_id
  WHERE jj.sucursal_id = p_sucursal AND l.publicada_en IS NOT NULL
  ORDER BY jj.fecha DESC LIMIT 1;

  INSERT INTO jornada (sucursal_id, fecha, abierta_por) VALUES (p_sucursal, p_fecha, p_usuario) RETURNING * INTO j;
  INSERT INTO lista_precios (jornada_id) VALUES (j.id) RETURNING id INTO v_lista;
  IF v_antes IS NOT NULL THEN
    INSERT INTO precio (lista_id, material_id, compra, venta)
    SELECT v_lista, material_id, compra, venta FROM precio WHERE lista_id = v_antes;
  END IF;
  PERFORM anotar(p_usuario, 'abrir', 'jornada', j.id::text, jsonb_build_object('fecha', p_fecha));
  RETURN j;
END $$;

-- ── permisos ────────────────────────────────────────────────────────────────

-- «Cerrar la que esté abierta» se retira: toda orden de cerrar dice cuál.
DROP FUNCTION cerrar_jornada_abierta(bigint);

GRANT SELECT ON reapertura TO feruga_app;
GRANT EXECUTE ON FUNCTION
  cerrar_el_dia(uuid, bigint, int, bigint),
  reabrir_jornada(uuid, bigint, int, bigint, text, text, bigint)
TO feruga_app;
