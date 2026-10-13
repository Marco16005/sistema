-- Cambiarle el nombre a un cliente desde la pantalla.
--
-- Era lo único de los clientes que seguía siendo solo de la consola (renombrar_cliente, de la
-- 0025). El dueño lo pidió para la pantalla el 13 de octubre de 2026. Lo hace cualquier
-- responsable, en los ajustes, igual que dar de alta, dar de baja y reactivar (0033), y queda en
-- la bitácora a su nombre, con cómo se llamaba y cómo se llama.
--
-- Lo que el nombre nuevo no toca: cada cuenta cobrada y cada precio especial guardan el nombre que
-- el cliente tenía ese día (0025), así que los comprobantes ya entregados no cambian. Una cuenta
-- abierta que ya lleva su precio se cobra con el nombre de ahora.
--
-- El nombre pasa por la misma regla que en el alta (nombre_de_cliente, de la 0034), y no puede ser
-- el de otro cliente, esté activo o dado de baja.

CREATE FUNCTION cambiar_nombre_de_cliente(p_cliente bigint, p_nombre text, p_usuario bigint) RETURNS cliente
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  c          cliente;
  v_otro     cliente;
  v_nombre   text;
  v_anterior text;
BEGIN
  PERFORM exigir_rol(p_usuario, 'responsable');
  v_nombre := nombre_de_cliente(p_nombre);
  IF v_nombre IS NULL THEN
    RAISE EXCEPTION 'Falta el nombre del cliente' USING ERRCODE = 'RC005';
  END IF;
  -- Con el cliente tomado: quien le está dando un precio especial termina primero, o espera.
  SELECT * INTO c FROM cliente WHERE id = p_cliente FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ese cliente no existe' USING ERRCODE = 'RC005';
  END IF;
  IF c.nombre = v_nombre THEN
    RETURN c;
  END IF;
  SELECT * INTO v_otro FROM cliente WHERE lower(nombre) = lower(v_nombre) AND id <> c.id;
  IF FOUND AND v_otro.activo THEN
    RAISE EXCEPTION 'Ya hay un cliente que se llama «%»', v_otro.nombre USING ERRCODE = 'RC005';
  ELSIF FOUND THEN
    RAISE EXCEPTION '«%» ya es el nombre de un cliente dado de baja', v_otro.nombre USING ERRCODE = 'RC005';
  END IF;
  v_anterior := c.nombre;
  BEGIN
    UPDATE cliente SET nombre = v_nombre WHERE id = c.id RETURNING * INTO c;
  EXCEPTION WHEN unique_violation THEN
    -- Otro tomó ese nombre mientras tanto: se dice como si se hubiera visto antes.
    SELECT * INTO v_otro FROM cliente WHERE lower(nombre) = lower(v_nombre);
    RAISE EXCEPTION 'Ya hay un cliente que se llama «%»', coalesce(v_otro.nombre, v_nombre) USING ERRCODE = 'RC005';
  END;
  PERFORM anotar(p_usuario, 'renombrar', 'cliente', c.id::text, jsonb_build_object('anterior', v_anterior, 'nombre', c.nombre));
  RETURN c;
END $$;

GRANT EXECUTE ON FUNCTION cambiar_nombre_de_cliente(bigint, text, bigint) TO feruga_app;
