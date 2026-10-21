-- Los gastos del negocio.
--
-- El dueño lo pidió así (respuesta 7 del cuestionario, 14 de octubre de 2026): «capturarlos más
-- adelante, a mano, porque quizá algún gasto lo pueden tomar de otro lado; solo anotarlos y llevar
-- el registro y decidir si se ven o no». Hay dos cifras: lo que dejó el material (el panel de
-- Ganancia, con el costo de 0039) y lo que queda después de los gastos que el dueño quiera restar.
--
--   · Cada gasto es de un TIPO; cada tipo dice si CUENTA para la utilidad. Los da de alta y los
--     marca un responsable. La migración deja los de siempre, y todos cuentan.
--   · Un gasto «de otro lado» se captura con su fecha, aunque sea de días atrás, y no toca el cajón.
--   · Un gasto «del cajón» es dinero que sale HOY del cajón: se registra también como un «sacar»
--     (caja_movimiento), y así baja lo que debería haber una sola vez. Lo registra un responsable
--     con su sesión: él es quien autoriza ese «sacar». Y un «sacar» que ya se había registrado en
--     el cajón (la tienda, la gasolina) se puede CLASIFICAR como gasto: queda ligado a él y no
--     vuelve a mover el cajón.
--   · Un gasto no se borra: se ANULA, con motivo; deja de sumar y queda quién y cuándo. Anular uno
--     del cajón no devuelve dinero al cajón —su «sacar» se queda: si el dinero regresó, eso es un
--     «meter»—, y solo se puede mientras su día siga abierto, porque el corte de un día cerrado ya
--     se hizo con él.
--
-- Errores: RC004 cantidad o fecha que no valen · RC005 forma, tipo o gasto que no procede ·
-- RC006 sin jornada abierta o sin el cajón contado · RC008 no es de un responsable · RC012 envío.

ALTER TABLE envio DROP CONSTRAINT envio_clase_check;
ALTER TABLE envio ADD CONSTRAINT envio_clase_check CHECK (clase IN (
  'cuenta', 'material', 'conteo', 'merma', 'separacion', 'correccion', 'cancelado', 'cierre', 'reapertura', 'precio',
  'caja_apertura', 'caja_movimiento', 'caja_corte', 'correccion_cuenta', 'abono', 'gasto'
));

-- Un texto de captura, como el motivo del cajón: sin espacios de más.
CREATE FUNCTION texto_de_gasto(p text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $$
  SELECT nullif(btrim(regexp_replace(p, '[[:space:]]+', ' ', 'g')), '');
$$;

CREATE TABLE tipo_de_gasto (
  id        bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  nombre    text NOT NULL CHECK (nombre = texto_de_gasto(nombre) AND char_length(nombre) <= 40),
  cuenta    boolean NOT NULL DEFAULT true,
  activo    boolean NOT NULL DEFAULT true,
  creado_en timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX tipo_de_gasto_nombre_unico ON tipo_de_gasto (lower(nombre));
INSERT INTO tipo_de_gasto (nombre) VALUES ('Sueldos'), ('Renta'), ('Luz y agua'), ('Fletes'), ('Gasolina'), ('Mantenimiento'), ('Otro');

CREATE TABLE gasto (
  id                 bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  fecha              date NOT NULL,
  tipo_id            bigint NOT NULL REFERENCES tipo_de_gasto,
  concepto           text NOT NULL CHECK (concepto = texto_de_gasto(concepto) AND char_length(concepto) <= 200),
  importe            numeric(14,2) NOT NULL CHECK (importe > 0 AND importe <= 99999999.99),
  de_donde           text NOT NULL CHECK (de_donde IN ('cajon', 'otro')),
  caja_movimiento_id bigint REFERENCES caja_movimiento,
  anulado_en         timestamptz,
  anulado_por        bigint REFERENCES usuario,
  motivo_anulacion   text CHECK (motivo_anulacion = texto_de_gasto(motivo_anulacion) AND char_length(motivo_anulacion) <= 200),
  registrado_por     bigint NOT NULL REFERENCES usuario,
  creado_en          timestamptz NOT NULL DEFAULT clock_timestamp(),
  envio_id           uuid NOT NULL UNIQUE REFERENCES envio,
  CONSTRAINT del_cajon_con_su_movimiento CHECK ((de_donde = 'cajon') = (caja_movimiento_id IS NOT NULL)),
  CONSTRAINT anulado_completo CHECK ((anulado_en IS NULL) = (anulado_por IS NULL) AND (anulado_en IS NULL) = (motivo_anulacion IS NULL))
);
CREATE INDEX gasto_por_fecha ON gasto (fecha);
-- Un «sacar» es a lo más un gasto vivo. Si ese se anula (el tipo estaba mal), se clasifica otra vez.
CREATE UNIQUE INDEX gasto_vivo_por_movimiento ON gasto (caja_movimiento_id) WHERE anulado_en IS NULL;

-- El guardián: de un gasto solo cambia su anulación, una vez y completa. No se borra.
CREATE FUNCTION gasto_cambia() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Un gasto no se borra: se anula' USING ERRCODE = 'RC001';
  END IF;
  IF OLD.anulado_en IS NOT NULL
     OR ROW(NEW.id, NEW.fecha, NEW.tipo_id, NEW.concepto, NEW.importe, NEW.de_donde, NEW.caja_movimiento_id, NEW.registrado_por, NEW.creado_en, NEW.envio_id)
        IS DISTINCT FROM ROW(OLD.id, OLD.fecha, OLD.tipo_id, OLD.concepto, OLD.importe, OLD.de_donde, OLD.caja_movimiento_id, OLD.registrado_por, OLD.creado_en, OLD.envio_id) THEN
    RAISE EXCEPTION 'De un gasto solo se registra su anulación, una vez' USING ERRCODE = 'RC001';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER gasto_cambia BEFORE UPDATE OR DELETE ON gasto FOR EACH ROW EXECUTE FUNCTION gasto_cambia();
CREATE TRIGGER gasto_sin_vaciar BEFORE TRUNCATE ON gasto FOR EACH STATEMENT EXECUTE FUNCTION rechazar_cambio();

-- ── los tipos ────────────────────────────────────────────────────────────────

CREATE FUNCTION alta_tipo_de_gasto(p_nombre text, p_usuario bigint) RETURNS tipo_de_gasto
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  t        tipo_de_gasto;
  v_nombre text := texto_de_gasto(p_nombre);
BEGIN
  PERFORM exigir_rol(p_usuario, 'responsable');
  IF v_nombre IS NULL OR char_length(v_nombre) > 40 THEN
    RAISE EXCEPTION 'El tipo de gasto lleva un nombre de hasta 40 letras' USING ERRCODE = 'RC005';
  END IF;
  BEGIN
    INSERT INTO tipo_de_gasto (nombre) VALUES (v_nombre) RETURNING * INTO t;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'Ya hay un tipo de gasto que se llama «%»', v_nombre USING ERRCODE = 'RC005';
  END;
  PERFORM anotar(p_usuario, 'alta', 'tipo_de_gasto', t.id::text, jsonb_build_object('nombre', t.nombre));
  RETURN t;
END $$;

CREATE FUNCTION cambiar_tipo_de_gasto(p_tipo bigint, p_cuenta boolean, p_activo boolean, p_usuario bigint) RETURNS tipo_de_gasto
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  t tipo_de_gasto;
BEGIN
  PERFORM exigir_rol(p_usuario, 'responsable');
  IF p_cuenta IS NULL OR p_activo IS NULL THEN
    RAISE EXCEPTION 'Falta decir si cuenta y si sigue activo' USING ERRCODE = 'RC005';
  END IF;
  SELECT * INTO t FROM tipo_de_gasto WHERE id = p_tipo FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ese tipo de gasto no existe' USING ERRCODE = 'RC005';
  END IF;
  IF t.cuenta = p_cuenta AND t.activo = p_activo THEN
    RETURN t;
  END IF;
  UPDATE tipo_de_gasto SET cuenta = p_cuenta, activo = p_activo WHERE id = p_tipo RETURNING * INTO t;
  PERFORM anotar(p_usuario, 'cambiar', 'tipo_de_gasto', t.id::text, jsonb_build_object('nombre', t.nombre, 'cuenta', p_cuenta, 'activo', p_activo));
  RETURN t;
END $$;

-- ── registrar y anular ───────────────────────────────────────────────────────

CREATE FUNCTION registrar_gasto(p_envio uuid, p_fecha date, p_tipo bigint, p_concepto text, p_importe numeric,
                                p_de_donde text, p_movimiento bigint, p_usuario bigint) RETURNS gasto
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  u          usuario;
  g          gasto;
  t          tipo_de_gasto;
  j          jornada;
  m          caja_movimiento;
  v_concepto text := texto_de_gasto(p_concepto);
  v_contenido jsonb;
  v_mov      bigint;
  v_envio_mov uuid;
BEGIN
  u := exigir_rol(p_usuario, 'responsable');
  PERFORM exigir_dinero(p_importe);
  IF p_importe = 0 THEN
    RAISE EXCEPTION 'Un gasto es de una cantidad mayor que cero' USING ERRCODE = 'RC004';
  END IF;
  IF v_concepto IS NULL OR char_length(v_concepto) > 200 THEN
    RAISE EXCEPTION 'El concepto del gasto lleva de una a 200 letras' USING ERRCODE = 'RC005';
  END IF;
  IF p_de_donde IS NULL OR p_de_donde NOT IN ('cajon', 'otro') THEN
    RAISE EXCEPTION 'Un gasto sale del cajón o de otro lado' USING ERRCODE = 'RC005';
  END IF;
  IF p_fecha IS NULL OR p_fecha > hoy_en(u.sucursal_id) THEN
    RAISE EXCEPTION 'La fecha del gasto no puede ser posterior a hoy' USING ERRCODE = 'RC004';
  END IF;
  IF p_de_donde = 'otro' AND p_movimiento IS NOT NULL THEN
    RAISE EXCEPTION 'Un gasto de otro lado no viene de un movimiento del cajón' USING ERRCODE = 'RC005';
  END IF;
  v_contenido := jsonb_build_object('fecha', p_fecha, 'tipo', p_tipo, 'concepto', v_concepto, 'importe', p_importe,
                                   'de_donde', p_de_donde, 'movimiento', p_movimiento);
  IF envio_del_cajon(p_envio, 'gasto', v_contenido, p_usuario) THEN
    SELECT * INTO g FROM gasto WHERE envio_id = p_envio;
    RETURN g;
  END IF;

  SELECT * INTO t FROM tipo_de_gasto WHERE id = p_tipo;
  IF NOT FOUND OR NOT t.activo THEN
    RAISE EXCEPTION 'Ese tipo de gasto no existe o está dado de baja' USING ERRCODE = 'RC005';
  END IF;

  IF p_de_donde = 'cajon' AND p_movimiento IS NULL THEN
    -- Sale hoy del cajón: de la jornada abierta, con el cajón contado, y es un «sacar».
    SELECT * INTO j FROM jornada WHERE sucursal_id = u.sucursal_id AND cerrada_en IS NULL FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'No hay jornada abierta: un gasto del cajón sale hoy' USING ERRCODE = 'RC006';
    END IF;
    IF p_fecha <> j.fecha THEN
      RAISE EXCEPTION 'Un gasto que sale del cajón es de hoy: con otra fecha, es de otro lado' USING ERRCODE = 'RC005';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM caja_apertura WHERE jornada_id = j.id) THEN
      RAISE EXCEPTION 'Primero se cuenta el cajón al abrir' USING ERRCODE = 'RC006';
    END IF;
    PERFORM reservar_envio(p_envio, 'gasto', v_contenido, p_usuario);
    -- El «sacar» lleva su propio envío, ligado al del gasto.
    v_envio_mov := gen_random_uuid();
    PERFORM reservar_envio(v_envio_mov, 'caja_movimiento', jsonb_build_object('gasto', p_envio), p_usuario);
    INSERT INTO caja_movimiento (jornada_id, tipo, importe, motivo, registrado_por, autorizado_por, envio_id)
    VALUES (j.id, 'sacar', p_importe, v_concepto, p_usuario, p_usuario, v_envio_mov) RETURNING id INTO v_mov;
    PERFORM anotar(p_usuario, 'sacar', 'caja', v_mov::text,
                   jsonb_build_object('importe', p_importe, 'motivo', v_concepto, 'autoriza', p_usuario));
  ELSIF p_de_donde = 'cajon' THEN
    -- Un «sacar» que ya estaba: se clasifica, sin mover el cajón otra vez. El candado del
    -- movimiento hace que dos clasificaciones a la vez pasen de una en una.
    SELECT * INTO m FROM caja_movimiento WHERE id = p_movimiento FOR UPDATE;
    IF NOT FOUND OR m.tipo <> 'sacar' THEN
      RAISE EXCEPTION 'Solo un «sacar» del cajón se clasifica como gasto' USING ERRCODE = 'RC005';
    END IF;
    IF EXISTS (SELECT 1 FROM gasto WHERE caja_movimiento_id = m.id AND anulado_en IS NULL) THEN
      RAISE EXCEPTION 'Ese movimiento del cajón ya se clasificó como gasto' USING ERRCODE = 'RC005';
    END IF;
    IF m.importe <> p_importe THEN
      RAISE EXCEPTION 'El gasto tiene que ser por lo mismo que se sacó (% pesos)', m.importe USING ERRCODE = 'RC004';
    END IF;
    IF p_fecha <> (SELECT fecha FROM jornada WHERE id = m.jornada_id) THEN
      RAISE EXCEPTION 'El gasto es del día en que se sacó el dinero' USING ERRCODE = 'RC005';
    END IF;
    PERFORM reservar_envio(p_envio, 'gasto', v_contenido, p_usuario);
    v_mov := m.id;
  ELSE
    PERFORM reservar_envio(p_envio, 'gasto', v_contenido, p_usuario);
  END IF;

  INSERT INTO gasto (fecha, tipo_id, concepto, importe, de_donde, caja_movimiento_id, registrado_por, envio_id)
  VALUES (p_fecha, t.id, v_concepto, p_importe, p_de_donde, v_mov, p_usuario, p_envio) RETURNING * INTO g;
  PERFORM anotar(p_usuario, 'gastar', 'gasto', g.id::text,
                 jsonb_build_object('nombre', t.nombre, 'motivo', v_concepto, 'total', p_importe, 'de_donde', p_de_donde));
  RETURN g;
END $$;

CREATE FUNCTION anular_gasto(p_gasto bigint, p_motivo text, p_usuario bigint) RETURNS gasto
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  g        gasto;
  v_motivo text := texto_de_gasto(p_motivo);
  v_cerrada timestamptz;
BEGIN
  PERFORM exigir_rol(p_usuario, 'responsable');
  IF v_motivo IS NULL OR char_length(v_motivo) > 200 THEN
    RAISE EXCEPTION 'Para anular un gasto se dice por qué, en hasta 200 letras' USING ERRCODE = 'RC005';
  END IF;
  SELECT * INTO g FROM gasto WHERE id = p_gasto FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ese gasto no existe' USING ERRCODE = 'RC005';
  END IF;
  IF g.anulado_en IS NOT NULL THEN
    RAISE EXCEPTION 'Ese gasto ya estaba anulado' USING ERRCODE = 'RC005';
  END IF;
  IF g.de_donde = 'cajon' THEN
    -- Con su jornada tomada: un cierre a la vez espera, o ya cerró y se rechaza.
    SELECT j.cerrada_en INTO v_cerrada FROM caja_movimiento m JOIN jornada j ON j.id = m.jornada_id
    WHERE m.id = g.caja_movimiento_id FOR SHARE OF j;
    IF v_cerrada IS NOT NULL THEN
      RAISE EXCEPTION 'El día de ese gasto ya se cerró, con su corte: ya no se anula' USING ERRCODE = 'RC006';
    END IF;
  END IF;
  UPDATE gasto SET anulado_en = clock_timestamp(), anulado_por = p_usuario, motivo_anulacion = v_motivo
  WHERE id = p_gasto RETURNING * INTO g;
  PERFORM anotar(p_usuario, 'anular', 'gasto', g.id::text, jsonb_build_object('motivo', v_motivo, 'total', g.importe));
  RETURN g;
END $$;

-- ── lo que suman ─────────────────────────────────────────────────────────────

-- Los gastos de un periodo por tipo, sin los anulados. Solo los tipos con algún gasto.
CREATE FUNCTION gastos_del_periodo(p_desde date, p_hasta date)
RETURNS TABLE (tipo_id bigint, tipo text, cuenta boolean, total numeric, cuantos int)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT t.id, t.nombre, t.cuenta, sum(g.importe)::numeric(16,2), count(*)::int
  FROM gasto g JOIN tipo_de_gasto t ON t.id = g.tipo_id
  WHERE g.anulado_en IS NULL AND g.fecha BETWEEN p_desde AND p_hasta
  GROUP BY t.id, t.nombre, t.cuenta;
$$;

GRANT SELECT ON tipo_de_gasto, gasto TO feruga_app;
GRANT EXECUTE ON FUNCTION
  alta_tipo_de_gasto(text, bigint),
  cambiar_tipo_de_gasto(bigint, boolean, boolean, bigint),
  registrar_gasto(uuid, date, bigint, text, numeric, text, bigint, bigint),
  anular_gasto(bigint, text, bigint),
  gastos_del_periodo(date, date)
TO feruga_app;
