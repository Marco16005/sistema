-- La marca que dice si una base es la que este servidor conoce se leía de un valor que cada
-- conexión recibe AL ABRIRSE. Una conexión que ya estaba abierta cuando se registró una
-- restauración seguía viendo el valor viejo: la aplicación, con su pozo de conexiones, se quedaba
-- cerrada hasta que alguien la reiniciara (la salud la sondea cada pocos segundos y no las deja vencer).
--
-- Ahora se lee de donde el servidor la guarda —la propiedad de la base—, que es igual para todas
-- las conexiones en cuanto se confirma. Sigue sin viajar en el volcado: es del servidor, no de los datos.
CREATE OR REPLACE FUNCTION vida_vigente() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1
    FROM vida v
    JOIN pg_database d ON d.datname = current_database()
    JOIN pg_db_role_setting s ON s.setdatabase = d.oid AND s.setrole = 0
    WHERE ('feruga.vida=' || v.id::text) = ANY (s.setconfig)
  );
$$;
