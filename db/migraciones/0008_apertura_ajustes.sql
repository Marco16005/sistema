-- Saldo inicial, conteos, correcciones y merma. Todo entra al libro mayor por estas funciones.
--
-- El patio arranca como inventario nuevo: el saldo inicial es opcional y declara si fue contado
-- o estimado. Cerrado el corte de arranque ya no se carga más; cualquier diferencia posterior se
-- asienta como conteo o como ajuste, que sí dejan explicación.

CREATE FUNCTION corte_no_se_reabre() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF OLD.corte_cerrado_en IS NOT NULL
     AND ROW(NEW.corte_cerrado_en, NEW.corte_cerrado_por) IS DISTINCT FROM ROW(OLD.corte_cerrado_en, OLD.corte_cerrado_por) THEN
    RAISE EXCEPTION 'El corte de arranque ya está cerrado y no se reabre' USING ERRCODE = 'RC001';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER corte_no_se_reabre BEFORE UPDATE ON sucursal
  FOR EACH ROW EXECUTE FUNCTION corte_no_se_reabre();

-- Un ajuste puede revertir por completo el movimiento al que se refiere. Eso ocurre una sola
-- vez por movimiento: la doble reversa queda impedida por la base, no por la aplicación.
ALTER TABLE movimiento_inventario
  ADD COLUMN revierte boolean NOT NULL DEFAULT false,
  ADD CONSTRAINT revierte_con_referencia CHECK (NOT revierte OR (tipo = 'ajuste' AND referencia_id IS NOT NULL));
CREATE UNIQUE INDEX movimiento_una_reversa ON movimiento_inventario (referencia_id) WHERE revierte;

CREATE FUNCTION registrar_apertura(p_material int, p_kg numeric, p_origen text, p_usuario bigint)
RETURNS movimiento_inventario
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  m movimiento_inventario;
BEGIN
  PERFORM exigir_rol(p_usuario, 'responsable');
  INSERT INTO movimiento_inventario (sucursal_id, material_id, tipo, cantidad_kg, origen_saldo, creado_por)
  SELECT sucursal_id, id, 'apertura', round(p_kg, 3), p_origen, p_usuario FROM material WHERE id = p_material
  RETURNING * INTO m;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'El material % no existe', p_material USING ERRCODE = 'RC005';
  END IF;
  PERFORM anotar(p_usuario, 'apertura', 'material', p_material::text,
                 jsonb_build_object('kg', m.cantidad_kg, 'origen', p_origen));
  RETURN m;
END $$;

CREATE FUNCTION cerrar_corte(p_sucursal smallint, p_usuario bigint) RETURNS sucursal
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  s sucursal;
BEGIN
  PERFORM exigir_rol(p_usuario, 'responsable');
  UPDATE sucursal SET corte_cerrado_en = now(), corte_cerrado_por = p_usuario
  WHERE id = p_sucursal AND corte_cerrado_en IS NULL
  RETURNING * INTO s;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'El corte de arranque ya estaba cerrado' USING ERRCODE = 'RC003';
  END IF;
  PERFORM anotar(p_usuario, 'cerrar_corte', 'sucursal', p_sucursal::text);
  RETURN s;
END $$;

-- Un conteo es un saldo observado en un momento, no una diferencia. La diferencia la calcula la
-- base contra lo que el libro decía en ese momento, de modo que lo comprado o vendido entre el
-- conteo y su captura no se pierde.
--
-- "Lo que el libro decía en ese momento" se reconstruye con el momento efectivo de cada movimiento:
-- las correcciones valen desde lo que corrigen y los ajustes de conteos anteriores, desde que se
-- contó. Por eso capturar dos veces el mismo conteo, o contar otra vez antes de capturar el
-- primero, corrige una sola vez. Cada conteo queda además como registro propio: es la medición.
CREATE TABLE conteo (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  sucursal_id    smallint NOT NULL REFERENCES sucursal,
  material_id    int NOT NULL REFERENCES material,
  jornada_id     bigint NOT NULL REFERENCES jornada,
  contado_kg     numeric(12,3) NOT NULL CHECK (contado_kg >= 0 AND contado_kg <> 'NaN'),
  contado_en     timestamptz NOT NULL,
  registrado_kg  numeric(14,3) NOT NULL,                       -- lo que el libro decía en ese momento
  diferencia_kg  numeric(12,3) NOT NULL,
  movimiento_id  bigint REFERENCES movimiento_inventario,      -- el ajuste, si hubo diferencia
  nota           text,
  autorizado_por bigint NOT NULL REFERENCES usuario,
  creado_por     bigint NOT NULL REFERENCES usuario,
  creado_en      timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT diferencia_cuadra CHECK (diferencia_kg = contado_kg - registrado_kg),
  CONSTRAINT ajuste_si_hubo_diferencia CHECK ((diferencia_kg <> 0) = (movimiento_id IS NOT NULL))
);
CREATE INDEX conteo_por_material ON conteo (material_id, contado_en);
CREATE TRIGGER conteo_inmutable BEFORE UPDATE OR DELETE ON conteo
  FOR EACH ROW EXECUTE FUNCTION rechazar_cambio();
CREATE TRIGGER conteo_sin_vaciar BEFORE TRUNCATE ON conteo
  FOR EACH STATEMENT EXECUTE FUNCTION rechazar_cambio();

CREATE FUNCTION registrar_conteo(
  p_material int, p_contado numeric, p_autoriza bigint, p_usuario bigint,
  p_nota text DEFAULT NULL, p_contado_en timestamptz DEFAULT clock_timestamp()
) RETURNS numeric
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_sucursal smallint;
  v_jornada  bigint;
  v_abierta  timestamptz;
  v_contado  numeric(12,3) := round(p_contado, 3);
  v_entonces numeric(14,3);
  v_dif      numeric(12,3);
  v_mov      bigint;
BEGIN
  PERFORM exigir_rol(p_usuario, 'mostrador', 'responsable');
  IF NOT EXISTS (SELECT 1 FROM usuario WHERE id = p_autoriza AND puede_autorizar AND activo) THEN
    RAISE EXCEPTION 'Un conteo lo autoriza una de las personas facultadas' USING ERRCODE = 'RC008';
  END IF;
  IF v_contado IS NULL OR v_contado = 'NaN' OR v_contado < 0 THEN
    RAISE EXCEPTION 'Lo contado tiene que ser un número de kilos, cero o más' USING ERRCODE = 'RC005';
  END IF;
  IF p_contado_en IS NULL THEN
    RAISE EXCEPTION 'Falta el momento en que se contó' USING ERRCODE = 'RC005';
  END IF;
  IF p_contado_en > clock_timestamp() THEN
    RAISE EXCEPTION 'El momento del conteo no puede estar en el futuro' USING ERRCODE = 'RC005';
  END IF;
  SELECT sucursal_id INTO v_sucursal FROM material WHERE id = p_material;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'El material % no existe', p_material USING ERRCODE = 'RC005';
  END IF;
  v_jornada := jornada_abierta(v_sucursal);
  SELECT abierta_en INTO v_abierta FROM jornada WHERE id = v_jornada;
  IF p_contado_en < v_abierta THEN
    RAISE EXCEPTION 'El conteo tiene que haberse hecho en la jornada abierta, no antes' USING ERRCODE = 'RC005';
  END IF;
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'El libro de inventario solo se escribe en READ COMMITTED' USING ERRCODE = 'RC010';
  END IF;
  PERFORM pg_advisory_xact_lock(7151, v_sucursal);

  IF EXISTS (SELECT 1 FROM conteo WHERE material_id = p_material AND contado_en > p_contado_en) THEN
    RAISE EXCEPTION 'Ya hay un conteo más reciente de este material: este, más viejo, ya no aplica'
      USING ERRCODE = 'RC005';
  END IF;

  SELECT coalesce(sum(cantidad_kg), 0) INTO v_entonces
  FROM movimiento_inventario WHERE material_id = p_material AND efectivo_en <= p_contado_en;
  v_dif := v_contado - v_entonces;

  IF v_dif <> 0 THEN
    INSERT INTO movimiento_inventario
      (sucursal_id, material_id, tipo, cantidad_kg, jornada_id, motivo, autorizado_por, creado_por, efectivo_en)
    VALUES (v_sucursal, p_material, 'ajuste', v_dif, v_jornada,
            format('Conteo físico: el libro decía %s kg y se contaron %s kg', v_entonces, v_contado)
              || coalesce('. ' || nullif(btrim(p_nota), ''), ''),
            p_autoriza, p_usuario, p_contado_en)
    RETURNING id INTO v_mov;
  END IF;
  INSERT INTO conteo (sucursal_id, material_id, jornada_id, contado_kg, contado_en, registrado_kg, diferencia_kg,
                      movimiento_id, nota, autorizado_por, creado_por)
  VALUES (v_sucursal, p_material, v_jornada, v_contado, p_contado_en, v_entonces, v_dif,
          v_mov, nullif(btrim(p_nota), ''), p_autoriza, p_usuario);

  PERFORM anotar(p_usuario, 'conteo', 'material', p_material::text,
                 jsonb_build_object('contado', v_contado, 'registrado', v_entonces, 'diferencia', v_dif,
                                    'contado_en', p_contado_en, 'autoriza', p_autoriza));
  RETURN v_dif;
END $$;

-- Ajuste por una cantidad: para corregir un error de captura, con referencia al movimiento
-- original si lo hay. El original no se toca.
CREATE FUNCTION registrar_ajuste(
  p_material int, p_kg numeric, p_motivo text, p_autoriza bigint, p_usuario bigint, p_referencia bigint DEFAULT NULL
) RETURNS movimiento_inventario
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  m movimiento_inventario;
  v_sucursal smallint;
BEGIN
  PERFORM exigir_rol(p_usuario, 'mostrador', 'responsable');
  SELECT sucursal_id INTO v_sucursal FROM material WHERE id = p_material;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'El material % no existe', p_material USING ERRCODE = 'RC005';
  END IF;
  INSERT INTO movimiento_inventario (sucursal_id, material_id, tipo, cantidad_kg, jornada_id, referencia_id, motivo, autorizado_por, creado_por)
  VALUES (v_sucursal, p_material, 'ajuste', round(p_kg, 3), jornada_abierta(v_sucursal), p_referencia, p_motivo, p_autoriza, p_usuario)
  RETURNING * INTO m;
  PERFORM anotar(p_usuario, 'ajuste', 'material', p_material::text,
                 jsonb_build_object('kg', m.cantidad_kg, 'motivo', p_motivo, 'autoriza', p_autoriza, 'referencia', p_referencia));
  RETURN m;
END $$;

-- Material equivocado: lo que se asentó en uno pasa al otro, en una sola transacción y con
-- referencia al movimiento original. Si del equivocado ya no hay suficiente, no se hace nada.
CREATE FUNCTION corregir_material(p_movimiento bigint, p_material int, p_motivo text, p_autoriza bigint, p_usuario bigint)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  o movimiento_inventario;
  v_jornada bigint;
BEGIN
  PERFORM exigir_rol(p_usuario, 'mostrador', 'responsable');
  SELECT * INTO o FROM movimiento_inventario WHERE id = p_movimiento;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'El movimiento % no existe', p_movimiento USING ERRCODE = 'RC005';
  END IF;
  IF o.tipo NOT IN ('apertura', 'compra', 'venta') THEN
    RAISE EXCEPTION 'Solo se corrige el material de una apertura, una compra o una venta' USING ERRCODE = 'RC005';
  END IF;
  IF o.material_id = p_material THEN
    RAISE EXCEPTION 'El movimiento ya es de ese material' USING ERRCODE = 'RC005';
  END IF;
  v_jornada := jornada_abierta(o.sucursal_id);

  INSERT INTO movimiento_inventario (sucursal_id, material_id, tipo, cantidad_kg, jornada_id, referencia_id, revierte, motivo, autorizado_por, creado_por)
  VALUES (o.sucursal_id, o.material_id, 'ajuste', -o.cantidad_kg, v_jornada, o.id, true, p_motivo, p_autoriza, p_usuario);
  INSERT INTO movimiento_inventario (sucursal_id, material_id, tipo, cantidad_kg, jornada_id, referencia_id, motivo, autorizado_por, creado_por)
  VALUES (o.sucursal_id, p_material, 'ajuste', o.cantidad_kg, v_jornada, o.id, p_motivo, p_autoriza, p_usuario);

  PERFORM anotar(p_usuario, 'corregir_material', 'movimiento_inventario', o.id::text,
                 jsonb_build_object('de', o.material_id, 'a', p_material, 'kg', o.cantidad_kg, 'motivo', p_motivo, 'autoriza', p_autoriza));
END $$;

-- Merma física: material que se descarta. No es un descuento de precio: es una salida del patio.
CREATE FUNCTION registrar_merma(p_material int, p_kg numeric, p_motivo text, p_usuario bigint)
RETURNS movimiento_inventario
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  m movimiento_inventario;
  v_sucursal smallint;
BEGIN
  PERFORM exigir_rol(p_usuario, 'mostrador', 'responsable');
  SELECT sucursal_id INTO v_sucursal FROM material WHERE id = p_material;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'El material % no existe', p_material USING ERRCODE = 'RC005';
  END IF;
  INSERT INTO movimiento_inventario (sucursal_id, material_id, tipo, cantidad_kg, jornada_id, motivo, creado_por)
  VALUES (v_sucursal, p_material, 'merma', -round(p_kg, 3), jornada_abierta(v_sucursal), p_motivo, p_usuario)
  RETURNING * INTO m;
  PERFORM anotar(p_usuario, 'merma', 'material', p_material::text, jsonb_build_object('kg', -m.cantidad_kg, 'motivo', p_motivo));
  RETURN m;
END $$;
