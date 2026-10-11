-- Volver de un respaldo.
--
-- Un respaldo trae los folios que había cuando se tomó. Los que se emitieron después se perdieron
-- con el servidor, pero están impresos y en manos de clientes: si al restaurar la numeración
-- siguiera donde iba el respaldo, se repetirían. No hay forma de saber desde aquí cuántos fueron.
-- Por eso cada restauración abre un bloque nuevo de folios, lejos del alcance de lo que se pudo
-- emitir entre un respaldo y otro.
--
-- Y para que no se pueda volver a atender sin ese paso, cada base lleva una marca en dos lugares:
-- una tabla, que viaja en el volcado, y una propiedad de la base en el servidor, que no viaja. Una
-- base restaurada trae la primera sin la segunda. Solo registrar la restauración las empareja.

-- La marca que viaja en el volcado. Una sola fila.
CREATE TABLE vida (
  unica boolean PRIMARY KEY DEFAULT true CHECK (unica),
  id    uuid NOT NULL,
  desde timestamptz NOT NULL DEFAULT clock_timestamp()
);

-- Cada vez que el sistema volvió de un respaldo.
CREATE TABLE restauracion (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  hecha_en      timestamptz NOT NULL DEFAULT clock_timestamp(),
  -- El momento de la instantánea que se restauró: lo posterior a él se perdió.
  respaldo_de   timestamptz NOT NULL,
  -- El último folio que traía el respaldo, y desde dónde sigue la numeración.
  folio_antes   bigint NOT NULL,
  folio_despues bigint NOT NULL CHECK (folio_despues > folio_antes),
  nota          text
);
CREATE TRIGGER restauracion_inmutable BEFORE UPDATE OR DELETE ON restauracion
  FOR EACH ROW EXECUTE FUNCTION rechazar_cambio();
CREATE TRIGGER restauracion_sin_vaciar BEFORE TRUNCATE ON restauracion
  FOR EACH STATEMENT EXECUTE FUNCTION rechazar_cambio();

-- Empareja la base consigo misma: marca nueva en la tabla y en la propiedad de la base. La
-- propiedad la leen las conexiones nuevas; a la que está corriendo esto se le pone también.
CREATE FUNCTION estrenar_vida() RETURNS uuid
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  v uuid := gen_random_uuid();
BEGIN
  INSERT INTO vida (id) VALUES (v)
  ON CONFLICT (unica) DO UPDATE SET id = EXCLUDED.id, desde = clock_timestamp();
  EXECUTE format('ALTER DATABASE %I SET feruga.vida = %L', current_database(), v::text);
  PERFORM set_config('feruga.vida', v::text, false);
  RETURN v;
END $$;

-- ¿La base es la que este servidor conoce? Falso en una base que se restauró y no se registró.
CREATE FUNCTION vida_vigente() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT coalesce((SELECT id::text FROM vida) = nullif(current_setting('feruga.vida', true), ''), false);
$$;

-- Registra que la base volvió de un respaldo: abre un bloque nuevo de folios, cierra las sesiones
-- que venían abiertas en él, empareja la base y deja constancia. La corre quien restaura, con
-- credenciales de administración; la aplicación no puede.
CREATE FUNCTION registrar_restauracion(p_respaldo_de timestamptz, p_nota text DEFAULT NULL) RETURNS restauracion
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  -- Mucho más de lo que el patio puede emitir entre un respaldo y otro.
  c_bloque CONSTANT bigint := 100000;
  v_ultimo bigint;
  v_nuevo  bigint;
  r        restauracion;
BEGIN
  IF p_respaldo_de IS NULL THEN
    RAISE EXCEPTION 'Falta decir de cuándo es el respaldo que se restauró' USING ERRCODE = 'RC005';
  END IF;
  IF p_respaldo_de > clock_timestamp() THEN
    RAISE EXCEPTION 'El respaldo no puede ser de un momento que todavía no llega' USING ERRCODE = 'RC005';
  END IF;

  -- El último folio que la base conoce: el mayor asentado, o lo que diga la secuencia si va más adelante.
  SELECT greatest(coalesce((SELECT max(folio) FROM operacion), 0), CASE WHEN s.is_called THEN s.last_value ELSE 0 END)
  INTO v_ultimo FROM folio_operacion s;
  v_nuevo := ((v_ultimo / c_bloque) + 1) * c_bloque;
  PERFORM setval('folio_operacion', v_nuevo, true);

  UPDATE sesion SET cerrada_en = clock_timestamp(), motivo_cierre = 'restauracion' WHERE cerrada_en IS NULL;
  PERFORM estrenar_vida();

  INSERT INTO restauracion (respaldo_de, folio_antes, folio_despues, nota)
  VALUES (p_respaldo_de, v_ultimo, v_nuevo, nullif(btrim(p_nota), ''))
  RETURNING * INTO r;
  PERFORM anotar(NULL, 'registrar_restauracion', 'restauracion', r.id::text,
                 jsonb_build_object('respaldo_de', p_respaldo_de, 'folio_antes', v_ultimo, 'folio_despues', v_nuevo));
  RETURN r;
END $$;

GRANT SELECT ON vida, restauracion TO feruga_app;
GRANT EXECUTE ON FUNCTION vida_vigente() TO feruga_app;

-- Una instalación nueva, o una que ya operaba cuando llegó esta migración, nace emparejada.
SELECT estrenar_vida();
