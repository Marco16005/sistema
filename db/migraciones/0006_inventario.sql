-- Libro mayor de inventario. Solo crece: cada entrada, salida, merma, ajuste o transformación es
-- un renglón que no se modifica ni se borra. La existencia no se guarda en ningún lado: es la
-- suma de este libro. Por eso un saldo no puede "arreglarse" sin dejar el movimiento que lo explica.

CREATE TABLE transformacion (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sucursal_id smallint NOT NULL REFERENCES sucursal,
  jornada_id  bigint REFERENCES jornada,
  merma_kg    numeric(12,3) NOT NULL DEFAULT 0 CHECK (merma_kg >= 0),
  nota        text,
  creada_en   timestamptz NOT NULL DEFAULT now(),
  creada_por  bigint NOT NULL REFERENCES usuario
);

CREATE TABLE movimiento_inventario (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  sucursal_id       smallint NOT NULL REFERENCES sucursal,
  material_id       int NOT NULL REFERENCES material,        -- no existe movimiento sin material
  tipo              text NOT NULL CHECK (tipo IN ('apertura', 'compra', 'venta', 'merma', 'ajuste', 'transformacion')),
  cantidad_kg       numeric(12,3) NOT NULL CHECK (cantidad_kg <> 0 AND cantidad_kg <> 'NaN'),   -- positivo entra, negativo sale
  jornada_id        bigint REFERENCES jornada,
  linea_id          uuid UNIQUE REFERENCES operacion_linea,  -- un renglón confirmado deja un solo movimiento
  transformacion_id uuid REFERENCES transformacion,
  referencia_id     bigint REFERENCES movimiento_inventario, -- el movimiento que un ajuste corrige
  origen_saldo      text CHECK (origen_saldo IN ('contado', 'estimado')),
  motivo            text,
  autorizado_por    bigint REFERENCES usuario,
  creado_en         timestamptz NOT NULL DEFAULT now(),
  -- Desde cuándo vale el movimiento al reconstruir lo que el libro decía en una fecha. Casi siempre
  -- es el momento de su asiento. Una corrección vale desde el movimiento que corrige, y el ajuste de
  -- un conteo, desde el momento en que se contó: así un conteo no vuelve a corregir lo ya corregido.
  efectivo_en       timestamptz NOT NULL,
  creado_por        bigint NOT NULL REFERENCES usuario,
  CONSTRAINT entra_positivo  CHECK (tipo NOT IN ('apertura', 'compra') OR cantidad_kg > 0),
  CONSTRAINT sale_negativo   CHECK (tipo NOT IN ('venta', 'merma') OR cantidad_kg < 0),
  CONSTRAINT viene_de_renglon CHECK ((tipo IN ('compra', 'venta')) = (linea_id IS NOT NULL)),
  CONSTRAINT apertura_declara_origen CHECK ((tipo = 'apertura') = (origen_saldo IS NOT NULL)),
  CONSTRAINT transformacion_ligada CHECK ((tipo = 'transformacion') = (transformacion_id IS NOT NULL)),
  CONSTRAINT con_motivo CHECK (tipo NOT IN ('ajuste', 'merma') OR coalesce(btrim(motivo), '') <> ''),
  CONSTRAINT ajuste_autorizado CHECK (tipo <> 'ajuste' OR autorizado_por IS NOT NULL),
  CONSTRAINT referencia_solo_en_ajuste CHECK (referencia_id IS NULL OR tipo = 'ajuste')
);
CREATE INDEX movimiento_por_material ON movimiento_inventario (material_id);
CREATE INDEX movimiento_por_jornada ON movimiento_inventario (jornada_id);

CREATE VIEW existencia AS
SELECT m.id AS material_id, m.nombre, coalesce(sum(mv.cantidad_kg), 0)::numeric(14,3) AS kg
FROM material m
LEFT JOIN movimiento_inventario mv ON mv.material_id = m.id
GROUP BY m.id, m.nombre;

-- Lo que hay libre para vender: la existencia menos lo ya apartado en ventas todavía abiertas.
-- Es una cortesía para avisar a tiempo en la pantalla; la garantía es la del libro mayor.
CREATE VIEW disponible AS
SELECT e.material_id, e.nombre, e.kg,
       coalesce(a.apartado_kg, 0)::numeric(14,3) AS apartado_kg,
       (e.kg - coalesce(a.apartado_kg, 0))::numeric(14,3) AS disponible_kg
FROM existencia e
LEFT JOIN (
  SELECT l.material_id, sum(l.peso_recibido) AS apartado_kg
  FROM operacion_linea l
  JOIN operacion o ON o.id = l.operacion_id
  WHERE o.estado = 'borrador' AND o.tipo = 'venta' AND l.peso_recibido IS NOT NULL
  GROUP BY l.material_id
) a USING (material_id);

-- Toda entrada al libro pasa por aquí, de una en una: un solo candado del patio. Con una caja el
-- rendimiento no importa, y un candado único no puede interbloquearse consigo mismo.
-- El candado solo protege si la suma se lee después de obtenerlo, y eso exige READ COMMITTED: en
-- un aislamiento más estricto la transacción seguiría viendo el saldo de antes de esperar.
CREATE FUNCTION movimiento_entra() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_hay    numeric(14,3);
  v_nombre text;
BEGIN
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'El libro de inventario solo se escribe en READ COMMITTED, no en %', current_setting('transaction_isolation')
      USING ERRCODE = 'RC010';
  END IF;
  PERFORM pg_advisory_xact_lock(7151, NEW.sucursal_id);

  -- El momento del movimiento es el de su asiento, tomado ya con el candado: así el orden de las
  -- fechas es el orden en que se escribió el libro. La hora de inicio de la transacción no sirve,
  -- porque una transacción que empezó antes puede asentar después.
  NEW.creado_en := clock_timestamp();
  IF NEW.referencia_id IS NOT NULL THEN
    NEW.efectivo_en := coalesce((SELECT efectivo_en FROM movimiento_inventario WHERE id = NEW.referencia_id), NEW.creado_en);
  ELSIF NEW.tipo <> 'ajuste' OR NEW.efectivo_en IS NULL THEN
    NEW.efectivo_en := NEW.creado_en;
  END IF;

  -- Asentar un movimiento bloquea su jornada contra el cierre: si se está cerrando, espera, y al
  -- releerla la encuentra cerrada.
  IF NEW.tipo <> 'apertura' THEN
    IF NEW.jornada_id IS NULL
       OR (SELECT cerrada_en FROM jornada WHERE id = NEW.jornada_id FOR SHARE) IS NOT NULL THEN
      RAISE EXCEPTION 'Un movimiento se asienta en una jornada abierta: una jornada cerrada ya no cambia'
        USING ERRCODE = 'RC006';
    END IF;
  END IF;

  -- Cargar apertura bloquea la sucursal contra el cierre del corte.
  IF NEW.tipo = 'apertura'
     AND (SELECT corte_cerrado_en FROM sucursal WHERE id = NEW.sucursal_id FOR SHARE) IS NOT NULL THEN
    RAISE EXCEPTION 'El corte de arranque ya se cerró: el saldo inicial ya no se carga, se ajusta por conteo'
      USING ERRCODE = 'RC003';
  END IF;

  IF NEW.tipo = 'ajuste'
     AND NOT EXISTS (SELECT 1 FROM usuario WHERE id = NEW.autorizado_por AND puede_autorizar AND activo) THEN
    RAISE EXCEPTION 'Un ajuste lo autoriza una de las personas facultadas' USING ERRCODE = 'RC008';
  END IF;

  IF NEW.cantidad_kg < 0 THEN
    SELECT coalesce(sum(cantidad_kg), 0) INTO v_hay FROM movimiento_inventario WHERE material_id = NEW.material_id;
    IF v_hay + NEW.cantidad_kg < 0 THEN
      SELECT nombre INTO v_nombre FROM material WHERE id = NEW.material_id;
      RAISE EXCEPTION 'No alcanza: hay % kg de % y se quieren sacar % kg', v_hay, v_nombre, -NEW.cantidad_kg
        USING ERRCODE = 'RC002';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER movimiento_entra BEFORE INSERT ON movimiento_inventario
  FOR EACH ROW EXECUTE FUNCTION movimiento_entra();

CREATE TRIGGER movimiento_inmutable BEFORE UPDATE OR DELETE ON movimiento_inventario
  FOR EACH ROW EXECUTE FUNCTION rechazar_cambio();
CREATE TRIGGER movimiento_sin_vaciar BEFORE TRUNCATE ON movimiento_inventario
  FOR EACH STATEMENT EXECUTE FUNCTION rechazar_cambio();
