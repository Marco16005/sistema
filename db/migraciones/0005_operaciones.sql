-- Cuentas (operaciones), sus renglones y las pesadas de cada renglón.
--
-- Una cuenta abierta es una operación en borrador: se le agregan y quitan renglones, y se
-- descarta sin dejar huella. Al confirmarse queda fija. El estado de pago va aparte del estado
-- de registro, porque en pedidos grandes se vende a crédito.
--
-- Ni el precio ni el peso de un renglón los escribe quien captura: el precio sale de la lista
-- publicada y el peso sale de la pesada.

CREATE SEQUENCE folio_operacion;

CREATE TABLE operacion (
  id              uuid PRIMARY KEY,     -- lo genera la estación: reintentar un envío no duplica
  sucursal_id     smallint NOT NULL REFERENCES sucursal,
  jornada_id      bigint NOT NULL REFERENCES jornada,
  lista_id        bigint NOT NULL REFERENCES lista_precios,
  tipo            text NOT NULL CHECK (tipo IN ('compra', 'venta')),
  etiqueta        text,
  estado          text NOT NULL DEFAULT 'borrador' CHECK (estado IN ('borrador', 'confirmada')),
  estado_pago     text NOT NULL DEFAULT 'pendiente' CHECK (estado_pago IN ('pendiente', 'liquidada')),
  -- Sube con cada cambio a la cuenta. Quien confirma manda la revisión que tenía a la vista:
  -- si ya no coincide, la cuenta cambió y no se confirma.
  revision        int NOT NULL DEFAULT 0,
  creada_en       timestamptz NOT NULL DEFAULT now(),
  creada_por      bigint NOT NULL REFERENCES usuario,
  folio           bigint UNIQUE,
  suma            numeric(14,2),        -- suma de importes, con centavos
  ajuste_redondeo numeric(14,2),        -- lo que cambia al pagar en pesos cerrados
  total           numeric(14,0),        -- lo que se paga o se cobra
  confirmada_en   timestamptz,
  confirmada_por  bigint REFERENCES usuario,
  -- Casi siempre es su propia jornada. Difiere cuando un vehículo se pesó vacío un día después:
  -- la cuenta conserva la jornada y los precios en que llegó, pero se asienta el día en que se terminó.
  confirmada_en_jornada bigint REFERENCES jornada,
  CONSTRAINT confirmacion_completa CHECK (
    (estado = 'confirmada') = (folio IS NOT NULL AND suma IS NOT NULL AND ajuste_redondeo IS NOT NULL
                               AND total IS NOT NULL AND confirmada_en IS NOT NULL AND confirmada_por IS NOT NULL
                               AND confirmada_en_jornada IS NOT NULL)),
  CONSTRAINT redondeo_explicado CHECK (total IS NULL OR (total = round(suma) AND ajuste_redondeo = total - suma))
);
CREATE INDEX operacion_abiertas ON operacion (jornada_id) WHERE estado = 'borrador';

-- Abrir una cuenta bloquea la jornada contra su cierre: si la jornada se está cerrando, espera,
-- y al releerla la encuentra cerrada.
CREATE FUNCTION operacion_nace() RETURNS trigger
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
  RETURN NEW;
END $$;
CREATE TRIGGER operacion_nace BEFORE INSERT ON operacion
  FOR EACH ROW EXECUTE FUNCTION operacion_nace();

CREATE FUNCTION operacion_cambia() RETURNS trigger
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
           NEW.confirmada_en_jornada, NEW.revision)
       IS DISTINCT FROM
       ROW(OLD.id, OLD.sucursal_id, OLD.jornada_id, OLD.lista_id, OLD.tipo, OLD.etiqueta, OLD.estado, OLD.creada_en,
           OLD.creada_por, OLD.folio, OLD.suma, OLD.ajuste_redondeo, OLD.total, OLD.confirmada_en, OLD.confirmada_por,
           OLD.confirmada_en_jornada, OLD.revision)
    THEN
      RAISE EXCEPTION 'La operación con folio % está confirmada y no se modifica', OLD.folio USING ERRCODE = 'RC001';
    END IF;
  ELSIF ROW(NEW.id, NEW.sucursal_id, NEW.jornada_id, NEW.lista_id, NEW.tipo)
        IS DISTINCT FROM ROW(OLD.id, OLD.sucursal_id, OLD.jornada_id, OLD.lista_id, OLD.tipo) THEN
    RAISE EXCEPTION 'A una cuenta abierta no se le cambia el sentido, la jornada ni la lista: se descarta y se abre otra'
      USING ERRCODE = 'RC005';
  END IF;
  -- La etiqueta también es contenido de la cuenta: cambiarla sube la revisión.
  IF OLD.estado = 'borrador' AND NEW.estado = 'borrador' AND NEW.etiqueta IS DISTINCT FROM OLD.etiqueta THEN
    NEW.revision := OLD.revision + 1;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER operacion_cambia BEFORE UPDATE OR DELETE ON operacion
  FOR EACH ROW EXECUTE FUNCTION operacion_cambia();

CREATE TABLE operacion_linea (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operacion_id    uuid NOT NULL REFERENCES operacion ON DELETE CASCADE,
  material_id     int NOT NULL REFERENCES material,         -- todo renglón es de un material del catálogo
  instrumento_id  smallint NOT NULL REFERENCES instrumento,
  precio_unitario numeric(14,4) NOT NULL,
  peso_bruto      numeric(12,3),                            -- vacío hasta que se asienta la pesada
  tara            numeric(12,3) NOT NULL DEFAULT 0 CHECK (tara >= 0),
  descuento_kg    numeric(12,3) NOT NULL DEFAULT 0 CHECK (descuento_kg >= 0),
  -- Lo que entra o sale del patio.
  peso_recibido   numeric(12,3) GENERATED ALWAYS AS (peso_bruto - tara) STORED,
  -- Lo que se paga o se cobra.
  peso_liquidable numeric(12,3) GENERATED ALWAYS AS (peso_bruto - tara - descuento_kg) STORED,
  importe         numeric(14,2) GENERATED ALWAYS AS (round((peso_bruto - tara - descuento_kg) * precio_unitario, 2)) STORED,
  creada_en       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT peso_positivo CHECK (peso_bruto IS NULL OR peso_bruto > tara),
  CONSTRAINT descuento_cabe CHECK (peso_bruto IS NULL OR descuento_kg <= peso_bruto - tara)
);
CREATE INDEX operacion_linea_de ON operacion_linea (operacion_id);

-- Toda edición de una cuenta bloquea la cuenta: no se puede agregar, cambiar ni quitar un renglón
-- mientras otra sesión la confirma, y al terminar la espera se relee su estado.
CREATE FUNCTION linea_nace() RETURNS trigger
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
  -- El precio queda congelado aquí; el peso llegará de la pesada.
  NEW.precio_unitario := v_precio;
  NEW.peso_bruto := NULL;
  NEW.tara := 0;
  RETURN NEW;
END $$;
CREATE TRIGGER linea_nace BEFORE INSERT ON operacion_linea
  FOR EACH ROW EXECUTE FUNCTION linea_nace();

CREATE FUNCTION linea_cambia() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_estado text;
  v_folio  bigint;
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
  IF ROW(NEW.id, NEW.operacion_id, NEW.material_id, NEW.instrumento_id, NEW.precio_unitario)
     IS DISTINCT FROM ROW(OLD.id, OLD.operacion_id, OLD.material_id, OLD.instrumento_id, OLD.precio_unitario) THEN
    RAISE EXCEPTION 'A un renglón no se le cambia el material, la báscula ni el precio: se quita y se agrega otro'
      USING ERRCODE = 'RC005';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER linea_cambia BEFORE UPDATE OR DELETE ON operacion_linea
  FOR EACH ROW EXECUTE FUNCTION linea_cambia();

-- Las pesadas de un renglón: una en báscula chica; dos, en orden, en la báscula grande.
CREATE TABLE linea_pesada (
  linea_id   uuid NOT NULL REFERENCES operacion_linea ON DELETE CASCADE,
  orden      smallint NOT NULL CHECK (orden IN (1, 2)),
  captura_id uuid NOT NULL UNIQUE REFERENCES captura_peso,    -- una pesada se usa una sola vez
  PRIMARY KEY (linea_id, orden)
);

-- Asentar una pesada es lo único que le pone peso a un renglón.
CREATE FUNCTION asentar_pesada() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  l  operacion_linea;
  op operacion;
  c  captura_peso;
  c1 captura_peso;
  i  instrumento;
BEGIN
  SELECT * INTO op FROM operacion
  WHERE id = (SELECT operacion_id FROM operacion_linea WHERE id = NEW.linea_id) FOR UPDATE;
  SELECT * INTO l FROM operacion_linea WHERE id = NEW.linea_id FOR UPDATE;
  IF op.estado <> 'borrador' THEN
    RAISE EXCEPTION 'La operación con folio % está confirmada: no admite más pesadas', op.folio USING ERRCODE = 'RC001';
  END IF;
  -- La pesada queda consumida para siempre; si ya se había usado, aquí falla.
  INSERT INTO captura_usada (captura_id, linea_id) VALUES (NEW.captura_id, NEW.linea_id);
  SELECT * INTO c FROM captura_peso WHERE id = NEW.captura_id;
  SELECT * INTO i FROM instrumento WHERE id = l.instrumento_id;
  IF c.instrumento_id <> l.instrumento_id THEN
    RAISE EXCEPTION 'Esa pesada es de otra báscula, no de la %', i.nombre USING ERRCODE = 'RC004';
  END IF;
  IF clock_timestamp() > c.vence_en THEN
    RAISE EXCEPTION 'Esa pesada ya venció: hay que volver a pesar' USING ERRCODE = 'RC004';
  END IF;

  IF NOT i.doble_pesaje THEN
    IF NEW.orden <> 1 THEN
      RAISE EXCEPTION 'La % pesa una sola vez', i.nombre USING ERRCODE = 'RC004';
    END IF;
    UPDATE operacion_linea SET peso_bruto = c.valor_kg, tara = 0 WHERE id = l.id;
  ELSIF NEW.orden = 2 THEN
    SELECT cp.* INTO c1
    FROM linea_pesada lp JOIN captura_peso cp ON cp.id = lp.captura_id
    WHERE lp.linea_id = l.id AND lp.orden = 1;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Falta la primera pesada de este renglón' USING ERRCODE = 'RC004';
    END IF;
    -- La diferencia debe tener el sentido de la operación.
    IF op.tipo = 'compra' AND c.valor_kg >= c1.valor_kg THEN
      RAISE EXCEPTION 'En una compra el vehículo vacío (% kg) debe pesar menos que cargado (% kg)', c.valor_kg, c1.valor_kg
        USING ERRCODE = 'RC004';
    END IF;
    IF op.tipo = 'venta' AND c.valor_kg <= c1.valor_kg THEN
      RAISE EXCEPTION 'En una venta el vehículo cargado (% kg) debe pesar más que vacío (% kg)', c.valor_kg, c1.valor_kg
        USING ERRCODE = 'RC004';
    END IF;
    UPDATE operacion_linea
    SET peso_bruto = greatest(c.valor_kg, c1.valor_kg), tara = least(c.valor_kg, c1.valor_kg)
    WHERE id = l.id;
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER asentar_pesada AFTER INSERT ON linea_pesada
  FOR EACH ROW EXECUTE FUNCTION asentar_pesada();

CREATE TRIGGER linea_pesada_no_cambia BEFORE UPDATE ON linea_pesada
  FOR EACH ROW EXECUTE FUNCTION rechazar_cambio();

-- Todo lo que cambia el contenido de una cuenta abierta —agregar, cambiar o quitar un renglón,
-- asentar una pesada— sube su revisión. Contar renglones y sumar importes no basta para saber si
-- la cuenta es la misma: se puede cambiar un material por otro que cueste igual.
CREATE FUNCTION cuenta_cambio() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_operacion uuid;
BEGIN
  IF TG_TABLE_NAME = 'linea_pesada' THEN
    SELECT operacion_id INTO v_operacion FROM operacion_linea WHERE id = NEW.linea_id;
  ELSIF TG_OP = 'DELETE' THEN
    v_operacion := OLD.operacion_id;
  ELSE
    v_operacion := NEW.operacion_id;
  END IF;
  UPDATE operacion SET revision = revision + 1 WHERE id = v_operacion AND estado = 'borrador';
  RETURN NULL;
END $$;
CREATE TRIGGER linea_sube_revision AFTER INSERT OR UPDATE OR DELETE ON operacion_linea
  FOR EACH ROW EXECUTE FUNCTION cuenta_cambio();
CREATE TRIGGER pesada_sube_revision AFTER INSERT ON linea_pesada
  FOR EACH ROW EXECUTE FUNCTION cuenta_cambio();

-- Cambiar o quitar un renglón se hace por estas funciones, que toman primero la cuenta y después
-- el renglón. Todas las rutas siguen ese mismo orden —abrir renglón, asentar pesada, confirmar,
-- descartar—, de modo que dos de ellas no pueden quedar esperándose una a la otra. Un UPDATE o
-- DELETE directo tomaría primero el renglón, al revés; por eso la aplicación no tiene ese permiso.
CREATE FUNCTION quitar_renglon(p_linea uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM 1 FROM operacion
  WHERE id = (SELECT operacion_id FROM operacion_linea WHERE id = p_linea) FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ese renglón no existe' USING ERRCODE = 'RC005';
  END IF;
  DELETE FROM operacion_linea WHERE id = p_linea;
END $$;

CREATE FUNCTION fijar_descuento(p_linea uuid, p_kg numeric) RETURNS operacion_linea
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  l operacion_linea;
BEGIN
  PERFORM 1 FROM operacion
  WHERE id = (SELECT operacion_id FROM operacion_linea WHERE id = p_linea) FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ese renglón no existe' USING ERRCODE = 'RC005';
  END IF;
  UPDATE operacion_linea SET descuento_kg = round(p_kg, 3) WHERE id = p_linea RETURNING * INTO l;
  RETURN l;
END $$;

-- Una pesada no se quita suelta: se va con su renglón.
CREATE FUNCTION pesada_se_va_con_su_renglon() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM operacion_linea WHERE id = OLD.linea_id) THEN
    RAISE EXCEPTION 'Una pesada no se quita suelta: se quita el renglón y se vuelve a pesar' USING ERRCODE = 'RC005';
  END IF;
  RETURN OLD;
END $$;
CREATE TRIGGER pesada_se_va_con_su_renglon BEFORE DELETE ON linea_pesada
  FOR EACH ROW EXECUTE FUNCTION pesada_se_va_con_su_renglon();

CREATE TRIGGER operacion_sin_vaciar BEFORE TRUNCATE ON operacion
  FOR EACH STATEMENT EXECUTE FUNCTION rechazar_cambio();
CREATE TRIGGER linea_sin_vaciar BEFORE TRUNCATE ON operacion_linea
  FOR EACH STATEMENT EXECUTE FUNCTION rechazar_cambio();
CREATE TRIGGER linea_pesada_sin_vaciar BEFORE TRUNCATE ON linea_pesada
  FOR EACH STATEMENT EXECUTE FUNCTION rechazar_cambio();

-- Cuánto dinero expone cada pesada según la báscula en que se hizo. El error máximo de una
-- lectura es media división; multiplicado por el precio da los pesos en juego. Y la división
-- entre el peso dice qué tan gruesa resulta la báscula para esa cantidad. No hay báscula fija por
-- material: se elige por cantidad, así que la alerta se calcula, no se configura.
CREATE VIEW renglon_riesgo AS
SELECT l.id AS linea_id, l.operacion_id, l.material_id, l.instrumento_id,
       round(i.division_kg / 2 * l.precio_unitario, 2)::numeric(14,2) AS valor_en_riesgo,
       (CASE WHEN l.peso_recibido > 0 THEN round(i.division_kg / l.peso_recibido, 4) END)::numeric(10,4) AS error_relativo
FROM operacion_linea l
JOIN instrumento i ON i.id = l.instrumento_id;
