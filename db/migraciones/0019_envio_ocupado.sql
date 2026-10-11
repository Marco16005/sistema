-- Un identificador de envío que ya no sirve tiene su propio código.
--
-- Hasta aquí, mandar un envío con un identificador que ya ocupaba otro (con otros datos), o con uno
-- cancelado, contestaba RC005, igual que cualquier dato que no admite el cambio. Pero no son lo
-- mismo. RC005 es una regla sobre lo que se quiso hacer; esto dice que el identificador está
-- resuelto en el servidor y que nada más va a entrar con él. La pantalla necesita distinguirlo:
-- con un identificador resuelto no hay nada que cancelar ni que esperar, y lo que ocupa ese
-- identificador no es la captura que se tiene enfrente.
--
--   RC012 · ese identificador de envío ya no sirve: se canceló, o lo ocupa otro envío.

CREATE OR REPLACE FUNCTION reservar_envio(p_id uuid, p_clase text, p_contenido jsonb, p_usuario bigint) RETURNS boolean
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  e envio;
BEGIN
  INSERT INTO envio (id, clase, contenido, recibido_de) VALUES (p_id, p_clase, p_contenido, p_usuario)
  ON CONFLICT (id) DO NOTHING;
  IF FOUND THEN
    RETURN true;
  END IF;
  SELECT * INTO e FROM envio WHERE id = p_id;
  IF e.clase = 'cancelado' THEN
    RAISE EXCEPTION 'Ese envío se canceló porque no se supo si había llegado: ya no se asienta' USING ERRCODE = 'RC012';
  END IF;
  IF e.clase <> p_clase OR e.contenido <> p_contenido THEN
    RAISE EXCEPTION 'Ese envío ya se había recibido con otros datos' USING ERRCODE = 'RC012';
  END IF;
  RETURN false;
END $$;
