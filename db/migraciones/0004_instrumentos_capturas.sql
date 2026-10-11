-- Básculas y pesadas. Una pesada es lo que marcó una báscula en un momento: es evidencia y no
-- se modifica. En el núcleo el peso se teclea; cuando una báscula se conecte bastará cambiar
-- su modo de lectura, y teclear en ella pasará a ser una excepción que exige motivo.

CREATE TABLE instrumento (
  id           smallint PRIMARY KEY,
  sucursal_id  smallint NOT NULL REFERENCES sucursal,
  nombre       text NOT NULL,
  capacidad_kg numeric(12,3) NOT NULL CHECK (capacidad_kg > 0),
  division_kg  numeric(12,3) NOT NULL CHECK (division_kg > 0),
  -- La báscula grande pesa vehículos: el peso sale de la diferencia entre dos pesadas.
  doble_pesaje boolean NOT NULL DEFAULT false,
  lectura      text NOT NULL DEFAULT 'manual' CHECK (lectura IN ('manual', 'serie', 'camara'))
);

-- PROVISIONAL: capacidad y división reales salen de la placa de cada báscula (pendiente E6).
-- Se dejan holgadas para no rechazar pesos legítimos mientras llega ese dato.
INSERT INTO instrumento (id, sucursal_id, nombre, capacidad_kg, division_kg, doble_pesaje) VALUES
  (1, 1, 'Báscula 1', 100000, 1,     true),
  (2, 1, 'Báscula 2',   1000, 0.001, false),
  (3, 1, 'Báscula 3',   1000, 0.001, false);

CREATE TABLE captura_peso (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  instrumento_id smallint NOT NULL REFERENCES instrumento,
  valor_kg       numeric(12,3) NOT NULL CHECK (valor_kg >= 0),
  origen         text NOT NULL CHECK (origen IN ('tecleada', 'serie', 'camara')),
  motivo         text,
  tomada_en      timestamptz NOT NULL DEFAULT now(),
  tomada_por     bigint NOT NULL REFERENCES usuario,
  -- Una pesada sirve unos minutos: pasado ese tiempo hay que volver a pesar.
  vence_en       timestamptz NOT NULL DEFAULT now() + interval '5 minutes',
  CONSTRAINT vence_despues CHECK (vence_en > tomada_en)
);

CREATE FUNCTION captura_valida() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  i instrumento;
BEGIN
  SELECT * INTO i FROM instrumento WHERE id = NEW.instrumento_id;
  IF NEW.valor_kg = 'NaN' THEN
    RAISE EXCEPTION 'El peso tiene que ser un número' USING ERRCODE = 'RC004';
  END IF;
  IF NEW.valor_kg > i.capacidad_kg THEN
    RAISE EXCEPTION '% kg rebasa la capacidad de la % (% kg)', NEW.valor_kg, i.nombre, i.capacidad_kg
      USING ERRCODE = 'RC004';
  END IF;
  IF mod(NEW.valor_kg, i.division_kg) <> 0 THEN
    RAISE EXCEPTION 'La % avanza de % en % kg y no puede marcar %', i.nombre, i.division_kg, i.division_kg, NEW.valor_kg
      USING ERRCODE = 'RC004';
  END IF;
  IF NEW.origen = 'tecleada' THEN
    IF i.lectura <> 'manual' AND coalesce(btrim(NEW.motivo), '') = '' THEN
      RAISE EXCEPTION 'La % se lee sola: teclear su peso es una excepción y exige motivo', i.nombre
        USING ERRCODE = 'RC004';
    END IF;
  ELSIF NEW.origen <> i.lectura THEN
    RAISE EXCEPTION 'La % no se lee por %', i.nombre, NEW.origen USING ERRCODE = 'RC004';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER captura_valida BEFORE INSERT ON captura_peso
  FOR EACH ROW EXECUTE FUNCTION captura_valida();

CREATE TRIGGER captura_inmutable BEFORE UPDATE OR DELETE ON captura_peso
  FOR EACH ROW EXECUTE FUNCTION rechazar_cambio();
CREATE TRIGGER captura_sin_vaciar BEFORE TRUNCATE ON captura_peso
  FOR EACH STATEMENT EXECUTE FUNCTION rechazar_cambio();

-- Una pesada se consume una sola vez y para siempre: aunque el renglón que la usó se quite,
-- no vuelve a servir. Así no hay forma de pesar una vez y registrar dos.
CREATE TABLE captura_usada (
  captura_id uuid PRIMARY KEY REFERENCES captura_peso,
  linea_id   uuid NOT NULL,
  usada_en   timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER captura_usada_inmutable BEFORE UPDATE OR DELETE ON captura_usada
  FOR EACH ROW EXECUTE FUNCTION rechazar_cambio();
CREATE TRIGGER captura_usada_sin_vaciar BEFORE TRUNCATE ON captura_usada
  FOR EACH STATEMENT EXECUTE FUNCTION rechazar_cambio();
