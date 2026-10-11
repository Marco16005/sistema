-- Cancelar un envío del que no se supo.
--
-- La pantalla manda cada acción con un identificador, y si no le llega respuesta manda ese mismo
-- otra vez. Eso basta mientras el reintento pasa. Cuando el reintento recibe una regla —ya no
-- alcanza, ya se cerró la jornada, la clave no pasó—, esa respuesta habla del reintento y no del
-- primer intento, que puede seguir en camino y asentarse después. Si la pantalla suelta entonces el
-- identificador y la persona captura de nuevo, quedan dos.
--
-- Preguntar «¿ya entró?» no lo resuelve: un «todavía no» no impide que entre al rato. Lo que lo
-- resuelve es dejar dicho, en el mismo registro de envíos, que ese identificador ya no vale. Pasa
-- por la misma fila única que reserva cualquier envío, así que quien llegue primero decide, y el
-- otro espera a saberlo: o el envío ya había entrado y se dice, o queda cancelado y ya no entra.

ALTER TABLE envio DROP CONSTRAINT envio_clase_check;
ALTER TABLE envio ADD CONSTRAINT envio_clase_check
  CHECK (clase IN ('cuenta', 'material', 'conteo', 'merma', 'separacion', 'correccion', 'cancelado'));

-- Registra el envío. Dice si es nuevo; si ya estaba con el mismo contenido, dice que no; si ya
-- estaba con otro, o se canceló, lo rechaza. Dos envíos a la vez con el mismo identificador pasan
-- de uno en uno: el segundo espera aquí al primero, sean de la cuenta que sean.
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
    RAISE EXCEPTION 'Ese envío se canceló porque no se supo si había llegado: ya no se asienta' USING ERRCODE = 'RC005';
  END IF;
  IF e.clase <> p_clase OR e.contenido <> p_contenido THEN
    RAISE EXCEPTION 'Ese envío ya se había recibido con otros datos' USING ERRCODE = 'RC005';
  END IF;
  RETURN false;
END $$;

-- Cancela un envío. Devuelve si quedó cancelado: cierto cuando no había entrado (y ya no entrará),
-- falso cuando ya había entrado, que entonces se queda como está. Cancelar dos veces es lo mismo.
-- Si el envío va en camino en otra transacción, espera a que termine antes de contestar.
CREATE FUNCTION cancelar_envio(p_envio uuid, p_usuario bigint) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM exigir_rol(p_usuario, 'mostrador', 'responsable', 'patio');
  IF p_envio IS NULL THEN
    RAISE EXCEPTION 'Falta decir cuál envío se cancela' USING ERRCODE = 'RC005';
  END IF;
  INSERT INTO envio (id, clase, contenido, recibido_de) VALUES (p_envio, 'cancelado', '{}'::jsonb, p_usuario)
  ON CONFLICT (id) DO NOTHING;
  IF FOUND THEN
    PERFORM anotar(p_usuario, 'cancelar_envio', 'envio', p_envio::text);
    RETURN true;
  END IF;
  RETURN (SELECT clase = 'cancelado' FROM envio WHERE id = p_envio);
END $$;

GRANT EXECUTE ON FUNCTION cancelar_envio(uuid, bigint) TO feruga_app;
