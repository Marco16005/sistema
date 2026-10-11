-- La marca que dice si una base es la que este servidor conoce vivía en una propiedad de la base
-- (ALTER DATABASE … SET). Se creía que no viajaba en el volcado, y no viaja en una restauración
-- normal; pero «pg_restore --create» sí la restaura. Una base restaurada así, a mano, quedaba
-- emparejada sin haber registrado su restauración: con los folios donde iba el respaldo.
--
-- Ahora la marca es algo que ningún volcado puede traer: la identidad del servidor (se fija al
-- crearlo) y el identificador que ESTE servidor le dio a ESTA base. Lo que la tabla guarda solo
-- coincide con la realidad en la base donde se registró. Restaurada en otro servidor, o en otra
-- base del mismo, deja de coincidir. Renombrar la base no cambia su identificador.
--
-- Lo que esto no ve: una copia física del servidor entero (sus archivos, una imagen del disco).
-- Ahí todo coincide. Los respaldos de este sistema son volcados, no copias físicas; quien
-- restaure una copia física debe registrar la restauración a mano. Y después de actualizar
-- PostgreSQL de versión mayor el servidor cambia de identidad: hay que volver a emparejar
-- (SELECT estrenar_vida()), que no mueve los folios.
ALTER TABLE vida ADD COLUMN sistema bigint, ADD COLUMN base oid;

-- Solo una instalación recién creada —que todavía no ha emitido ningún folio— nace emparejada.
-- Una que ya operaba NO se empareja sola al llegar aquí: la marca anterior no sirve para distinguirla
-- de un respaldo suyo restaurado en otro lado (esa marca viajaba con «pg_restore --create»), y dar
-- por buena a una restaurada sería justo lo que esto vino a impedir. Se empareja expresamente:
--   · si es la instalación de siempre, que solo se puso al día:  SELECT estrenar_vida();
--   · si volvió de un respaldo:                                  registrar_restauracion(...).
UPDATE vida SET
  sistema = (SELECT system_identifier FROM pg_control_system()),
  base = (SELECT oid FROM pg_database WHERE datname = current_database())
WHERE vida_vigente()
  AND NOT (SELECT is_called FROM folio_operacion)
  AND NOT EXISTS (SELECT 1 FROM operacion);

CREATE OR REPLACE FUNCTION estrenar_vida() RETURNS uuid
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  v uuid := gen_random_uuid();
BEGIN
  INSERT INTO vida (id, sistema, base)
  VALUES (v, (SELECT system_identifier FROM pg_control_system()), (SELECT oid FROM pg_database WHERE datname = current_database()))
  ON CONFLICT (unica) DO UPDATE SET id = EXCLUDED.id, sistema = EXCLUDED.sistema, base = EXCLUDED.base, desde = clock_timestamp();
  RETURN v;
END $$;

CREATE OR REPLACE FUNCTION vida_vigente() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM vida v
    WHERE v.sistema = (SELECT system_identifier FROM pg_control_system())
      AND v.base = (SELECT oid FROM pg_database WHERE datname = current_database())
  );
$$;

-- La propiedad de antes ya no se usa: se retira, para que no viaje a ningún lado.
DO $$ BEGIN
  EXECUTE format('ALTER DATABASE %I RESET feruga.vida', current_database());
END $$;
