-- La operación se cierra y se abre en la base.
--
-- «En mantenimiento» es un estado durable: una sola fila que cada ruta de la aplicación consulta
-- en cada petición. Cerrada, ninguna ruta de negocio atiende. Sobrevive a reiniciar el motor y a
-- recrear contenedores, y viaja en el respaldo: uno tomado con la operación cerrada restaura
-- cerrado, y abrir es un paso expreso.
--
-- Lo cambia solo la administración: la aplicación lee el estado y nada más.
--
-- Cerrar y abrir pertenecen a una publicación, que se nombra. Abrir va en dos pasos:
--   · decidir abrir: de aquí en adelante no hay vuelta; queda escrito, con su publicación;
--   · abrir: comprueba que la publicación es la que cerró, que ya se decidió, y que la base es la
--     que se comprobó (su marca), y deja escrito que abrió.
-- Así, quien retome una publicación que murió a la mitad sabe, leyendo la base, hasta dónde llegó.
-- Repetir un paso con la misma publicación no cambia nada: se perdió la respuesta, y se manda otra vez.

CREATE TABLE mantenimiento (
  unica       boolean PRIMARY KEY DEFAULT true CHECK (unica),
  abierta     boolean NOT NULL,
  -- Por qué está cerrada.
  motivo      text,
  -- La publicación que la cerró; abierta, la última que la abrió. Vacía solo antes de la primera.
  publicacion text,
  -- Cuándo esa publicación decidió abrir, y cuándo abrió.
  decidida_en timestamptz,
  abrio_en    timestamptz,
  cambio_en   timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT cerrada_con_motivo CHECK (abierta = (motivo IS NULL)),
  CONSTRAINT cerrada_por_una_publicacion CHECK (abierta OR publicacion IS NOT NULL),
  CONSTRAINT abre_despues_de_decidir CHECK (abrio_en IS NULL OR decidida_en IS NOT NULL),
  CONSTRAINT abrio_y_esta_abierta CHECK (abrio_en IS NULL OR abierta)
);
INSERT INTO mantenimiento (abierta) VALUES (true);

CREATE TRIGGER mantenimiento_no_se_borra BEFORE DELETE ON mantenimiento
  FOR EACH ROW EXECUTE FUNCTION rechazar_cambio();
CREATE TRIGGER mantenimiento_sin_vaciar BEFORE TRUNCATE ON mantenimiento
  FOR EACH STATEMENT EXECUTE FUNCTION rechazar_cambio();

-- Cierra la operación para esa publicación.
CREATE FUNCTION cerrar_operacion(p_motivo text, p_publicacion text) RETURNS mantenimiento
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  m        mantenimiento;
  v_motivo text := nullif(btrim(p_motivo), '');
  v_pub    text := nullif(btrim(p_publicacion), '');
BEGIN
  IF v_motivo IS NULL OR v_pub IS NULL THEN
    RAISE EXCEPTION 'Para cerrar la operación hay que decir por qué y de cuál publicación' USING ERRCODE = 'RC005';
  END IF;
  SELECT * INTO m FROM mantenimiento FOR UPDATE;
  IF NOT m.abierta THEN
    IF m.publicacion = v_pub THEN
      RETURN m;          -- ya la había cerrado esta misma publicación
    END IF;
    RAISE EXCEPTION 'La operación ya está cerrada por otra publicación (%)', m.publicacion USING ERRCODE = 'RC005';
  END IF;
  IF m.publicacion = v_pub THEN
    RAISE EXCEPTION 'La publicación % ya terminó: abrió la operación. Una publicación nueva lleva otro identificador', v_pub USING ERRCODE = 'RC005';
  END IF;
  UPDATE mantenimiento
  SET abierta = false, motivo = v_motivo, publicacion = v_pub, decidida_en = NULL, abrio_en = NULL, cambio_en = clock_timestamp()
  RETURNING * INTO m;
  PERFORM anotar(NULL, 'mantenimiento', 'publicacion', v_pub, jsonb_build_object('paso', 'cerrar', 'publicacion', v_pub, 'motivo', v_motivo));
  RETURN m;
END $$;

-- Deja escrito que esa publicación decidió abrir. De aquí en adelante no hay vuelta.
CREATE FUNCTION decidir_abrir(p_publicacion text) RETURNS mantenimiento
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  m     mantenimiento;
  v_pub text := nullif(btrim(p_publicacion), '');
BEGIN
  SELECT * INTO m FROM mantenimiento FOR UPDATE;
  IF m.abierta OR m.publicacion IS DISTINCT FROM v_pub THEN
    RAISE EXCEPTION 'La operación no está cerrada por esa publicación: no hay apertura que decidir' USING ERRCODE = 'RC005';
  END IF;
  IF m.decidida_en IS NOT NULL THEN
    RETURN m;            -- ya estaba decidido
  END IF;
  UPDATE mantenimiento SET decidida_en = clock_timestamp(), cambio_en = clock_timestamp() RETURNING * INTO m;
  PERFORM anotar(NULL, 'mantenimiento', 'publicacion', v_pub, jsonb_build_object('paso', 'decidir', 'publicacion', v_pub));
  RETURN m;
END $$;

-- Abre la operación. Comprueba que la publicación es la que la cerró, que ya se decidió abrir, y
-- que esta base es la que se comprobó: `p_marca` es su marca de vida. Deja escrito que abrió.
CREATE FUNCTION abrir_operacion(p_publicacion text, p_marca uuid) RETURNS mantenimiento
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  m     mantenimiento;
  v_pub text := nullif(btrim(p_publicacion), '');
BEGIN
  IF v_pub IS NULL OR p_marca IS NULL THEN
    RAISE EXCEPTION 'Para abrir la operación hay que decir de cuál publicación y sobre cuál base' USING ERRCODE = 'RC005';
  END IF;
  SELECT * INTO m FROM mantenimiento FOR UPDATE;
  IF m.publicacion IS DISTINCT FROM v_pub THEN
    RAISE EXCEPTION 'La operación no la cerró esa publicación: no le toca abrirla' USING ERRCODE = 'RC005';
  END IF;
  IF p_marca IS DISTINCT FROM (SELECT id FROM vida) THEN
    RAISE EXCEPTION 'Esta no es la base que se comprobó: su marca es otra' USING ERRCODE = 'RC005';
  END IF;
  IF m.abierta THEN
    RETURN m;            -- ya la había abierto esta misma publicación
  END IF;
  IF m.decidida_en IS NULL THEN
    RAISE EXCEPTION 'Todavía no se ha decidido abrir: primero se anota la decisión' USING ERRCODE = 'RC005';
  END IF;
  UPDATE mantenimiento SET abierta = true, motivo = NULL, abrio_en = clock_timestamp(), cambio_en = clock_timestamp() RETURNING * INTO m;
  PERFORM anotar(NULL, 'mantenimiento', 'publicacion', v_pub, jsonb_build_object('paso', 'abrir', 'publicacion', v_pub, 'marca', p_marca));
  RETURN m;
END $$;

-- La aplicación lee el estado; cerrar y abrir son de la administración.
GRANT SELECT ON mantenimiento TO feruga_app;
