-- Dos carreras en lo que los ajustes escriben (0030 y 0031). Las encontraron, el 12 de octubre de
-- 2026, la revisión de seguridad del guardado del catálogo y la revisión de Codex de personas y
-- equipos. En las dos, cada lado comprobaba su regla contra lo que veía antes de que el otro
-- terminara, y las dos reglas pasaban.

-- ── 1. Dar de baja un material mientras alguien lo agrega a una cuenta ───────
--
-- cambiar_material (0030) niega la baja si el material está en una cuenta abierta, y bloquea el
-- material mientras decide. Pero quien agregaba ese material en ese mismo instante ya había leído
-- que seguía activo (linea_nace lo mira sin bloquearlo): esperaba a que la baja terminara y entraba
-- después. Quedaba una cuenta abierta con un material dado de baja.
--
-- Aquí el renglón que nace relee el material ya bloqueado: si se le está dando de baja, espera, y
-- al releerlo lo encuentra dado de baja. Es la misma idea con que un renglón bloquea su jornada
-- contra el cierre. Va en un disparador aparte, que corre después de linea_nace (por su nombre),
-- para no volver a escribir esa función entera. El orden de los candados no cambia: la cuenta, la
-- jornada, y al final el material; cambiar_material solo toma el del material.
CREATE FUNCTION linea_con_material_vigente() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT coalesce((SELECT activo FROM material WHERE id = NEW.material_id FOR SHARE), false) THEN
    RAISE EXCEPTION 'Ese material está dado de baja' USING ERRCODE = 'RC005';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER linea_nace_con_material_vigente BEFORE INSERT ON operacion_linea
  FOR EACH ROW EXECUTE FUNCTION linea_con_material_vigente();

-- Lo que NO se cierra, a propósito: que un conteo o una corrección le ponga existencia a un material
-- en el instante en que se le da de baja. Los movimientos de inventario sobre un material dado de
-- baja tienen que seguir pudiéndose —es como se corrige lo que quedó de él—, así que no se pueden
-- negar. Si pasa, queda un material dado de baja con existencia: se ve en el inventario, y se
-- reactiva desde los ajustes.

-- ── 2. Dos responsables que se dan de baja el equipo uno al otro, a la vez ───
--
-- baja_de_equipo (0031) no deja dar de baja el equipo desde el que se pide. Con dos equipos, A y B:
-- desde A se da de baja B y, a la vez, desde B se da de baja A. Cada una veía vigente su propio
-- equipo, las dos pasaban, y el negocio se quedaba sin ningún equipo: nadie podía volver a entrar
-- sin la consola.
--
-- Ahora las bajas de equipo de una sucursal van en fila (un candado propio, el 7154: los de la
-- sucursal son el 7151 y el 7153). La segunda espera a la primera; al pasar, la comprobación de la
-- clave vuelve a mirar si el equipo desde el que se pide sigue vigente, ya no lo está, y contesta
-- que no. Siempre queda al menos el equipo de quien hizo la última baja.
CREATE OR REPLACE FUNCTION baja_de_equipo(p_huella text, p_usuario bigint, p_clave text, p_equipo uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  e equipo;
BEGIN
  PERFORM exigir_quien_administra(p_usuario);
  -- Una baja de equipo a la vez. Antes de mirar nada: lo que se mire después ya es definitivo.
  PERFORM pg_advisory_xact_lock(7154, 1);
  SELECT * INTO e FROM equipo WHERE id = p_equipo AND sucursal_id = 1;
  IF NOT FOUND OR e.baja_en IS NOT NULL THEN
    RAISE EXCEPTION 'Ese equipo no existe o ya estaba dado de baja' USING ERRCODE = 'RC005';
  END IF;
  IF e.huella = p_huella THEN
    RAISE EXCEPTION 'Este es el equipo desde el que lo pides: se da de baja desde otro' USING ERRCODE = 'RC005';
  END IF;

  -- La clave, desde un equipo vigente: si a este equipo lo acaban de dar de baja, aquí ya no pasa.
  IF NOT autorizo_con_clave(p_huella, p_usuario, p_clave) THEN
    RETURN false;
  END IF;
  PERFORM baja_equipo(p_equipo, p_usuario);
  RETURN true;
END $$;
