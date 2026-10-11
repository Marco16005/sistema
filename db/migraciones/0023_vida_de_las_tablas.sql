-- La identidad del servidor y de la base dice DÓNDE están los datos, no de qué historia son. Un
-- volcado restaurado ENCIMA de la misma base («pg_restore --clean», a mano) deja el mismo servidor y
-- la misma base, con datos de antes: pasaba por buena y repetía folios.
--
-- Se agrega lo que esa restauración sí cambia: reemplaza las tablas, y una tabla recreada recibe
-- otro identificador. La marca guarda el de CADA tabla y secuencia que había al emparejar, y la
-- base es la de siempre mientras sus tablas y secuencias sean EXACTAMENTE esas: ni falta una ni
-- hay otra. Se mira el identificador, no el nombre: cambiarle el nombre a una tabla no la hace
-- otra; que una desaparezca no se deja pasar; y guardar la vieja con otro nombre para restaurar
-- otra con el de siempre tampoco, porque la restaurada es una que la marca no conoce.
--
-- QUIÉN LO COMPRUEBA. La aplicación y el migrador, con su propio código (src/servidor/esquema.ts).
-- No le preguntan a una función de esta base: un volcado viejo restaurado encima repone las
-- funciones de antes. vida_vigente() queda para quien mira desde SQL, y dice lo mismo mientras
-- nadie la haya repuesto.
--
-- LAS MIGRACIONES. Lo que una migración crea entra a la marca al aplicarla —lo hace el migrador—,
-- y solo si la base estaba emparejada antes y después no falta nada de lo conocido: migrar nunca
-- empareja. Una migración que tenga que QUITAR o VOLVER A CREAR una tabla o secuencia ya cubierta
-- lo dice antes de hacerlo, una llamada por cada cosa:  SELECT vida_retirar('la_tabla');  (las
-- secuencias de sus columnas se van con ella). Si no, la base queda sin emparejar.
--
-- FUERA DE UNA MIGRACIÓN no se crean ni se quitan tablas en el esquema de la aplicación: una de
-- más o una de menos deja la base sin emparejar.
--
-- LO QUE NO SE VE, dicho:
--   · una copia física del servidor entero (sus archivos, una imagen del disco);
--   · vaciar las tablas y cargarles solo los datos de un volcado, sin recrearlas;
--   · lo que no es tabla ni secuencia: funciones, vistas, disparadores repuestos de un volcado;
--   · quien administra la base y la empareja a mano (SELECT estrenar_vida()).
-- Protege de una restauración olvidada, no de una maniobra deliberada. La forma admitida de
-- restaurar es el programa, que restaura en una base nueva y registra.
ALTER TABLE vida ADD COLUMN tablas jsonb;

-- Las tablas y secuencias de la aplicación, con el identificador que tienen ahora.
-- (OR REPLACE, aquí y abajo: un volcado anterior a esta migración, restaurado encima de una base
-- que ya la tenía, no se lleva estas funciones —no las conoce—, y al ponerse al día las encuentra.)
CREATE OR REPLACE FUNCTION vida_tablas() RETURNS jsonb
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  SELECT coalesce(jsonb_object_agg(c.relname, c.oid::bigint), '{}'::jsonb)
  FROM pg_class c
  WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p', 'S');
$$;

-- Como en la 0022: solo una instalación recién creada nace emparejada. Una que ya operaba con la
-- marca anterior NO se empareja sola al llegar aquí: esa marca no distingue a la instalación de
-- siempre de un respaldo suyo restaurado encima (SELECT estrenar_vida(), o registrar la restauración).
UPDATE vida SET tablas = vida_tablas()
WHERE vida_vigente()
  AND NOT (SELECT is_called FROM folio_operacion)
  AND NOT EXISTS (SELECT 1 FROM operacion);

CREATE OR REPLACE FUNCTION estrenar_vida() RETURNS uuid
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  v uuid := gen_random_uuid();
BEGIN
  INSERT INTO vida (id, sistema, base, tablas)
  VALUES (v, (SELECT system_identifier FROM pg_control_system()),
          (SELECT oid FROM pg_database WHERE datname = current_database()), vida_tablas())
  ON CONFLICT (unica) DO UPDATE
    SET id = EXCLUDED.id, sistema = EXCLUDED.sistema, base = EXCLUDED.base, tablas = EXCLUDED.tablas, desde = clock_timestamp();
  RETURN v;
END $$;

-- La comprobación, para quien mira desde SQL. Con nombre nuevo a propósito: un volcado anterior a
-- esta migración no la trae, así que no la puede reponer.
-- `p_salvo`: tablas o secuencias que pueden estar «de más» sin que cuente. Solo lo usa vida_retirar,
-- para lo que una migración ya retiró y todavía no quita; fuera de eso va vacío.
CREATE OR REPLACE FUNCTION vida_coincide_salvo(p_salvo bigint[]) RETURNS boolean
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM vida v
    WHERE v.sistema = (SELECT system_identifier FROM pg_control_system())
      AND v.base = (SELECT oid FROM pg_database WHERE datname = current_database())
      AND v.tablas IS NOT NULL
      -- nada de lo conocido falta
      AND NOT EXISTS (
        SELECT 1 FROM jsonb_each_text(v.tablas) t
        WHERE NOT EXISTS (
          SELECT 1 FROM pg_class c
          WHERE c.oid = t.value::oid AND c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p', 'S')
        )
      )
      -- y no hay nada que la marca no conozca
      AND NOT EXISTS (
        SELECT 1 FROM pg_class c
        WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p', 'S')
          AND c.oid::bigint <> ALL (p_salvo)
          AND NOT EXISTS (SELECT 1 FROM jsonb_each_text(v.tablas) t WHERE t.value::oid = c.oid)
      )
  );
$$;

CREATE OR REPLACE FUNCTION vida_coincide() RETURNS boolean
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  SELECT vida_coincide_salvo('{}'::bigint[]);
$$;

CREATE OR REPLACE FUNCTION vida_vigente() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT vida_coincide();
$$;

-- Para la migración que tiene que quitar o volver a crear una tabla o secuencia ya cubierta: la
-- saca de la marca ANTES de quitarla, junto con las secuencias que sean suyas (las de sus columnas).
-- Solo en una base emparejada; en otra no hace nada, que retirar no es una forma de emparejar.
--
-- Lo retirado queda un momento «de más» —existe y ya no está en la marca— hasta que la migración
-- lo quita. Para que en ese rato se pueda retirar lo siguiente, lo que esta misma transacción ya
-- retiró no cuenta como de más. Solo dentro de la transacción: retirar algo y dejarlo ahí deja la
-- base sin emparejar, como cualquier tabla que sobra.
CREATE OR REPLACE FUNCTION vida_retirar(p_nombre text) RETURNS boolean
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  v_oid   oid := to_regclass('public.' || quote_ident(p_nombre))::oid;
  v_antes bigint[] := coalesce(string_to_array(nullif(current_setting('feruga.retiradas', true), ''), ',')::bigint[], '{}');
  v_idas  bigint[];
BEGIN
  IF NOT vida_coincide_salvo(v_antes) THEN
    RETURN false;
  END IF;
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'No existe %: se retira de la marca antes de quitarla, no después', p_nombre;
  END IF;
  SELECT array_agg(x.o) INTO v_idas FROM (
    SELECT v_oid::bigint AS o
    UNION
    SELECT d.objid::bigint
    FROM pg_depend d JOIN pg_class s ON s.oid = d.objid AND s.relkind = 'S'
    WHERE d.classid = 'pg_class'::regclass AND d.refclassid = 'pg_class'::regclass
      AND d.refobjid = v_oid AND d.deptype IN ('a', 'i')
  ) x;
  UPDATE vida SET tablas = (
    SELECT coalesce(jsonb_object_agg(t.key, t.value), '{}'::jsonb)
    FROM jsonb_each(tablas) t WHERE NOT ((t.value #>> '{}')::bigint = ANY (v_idas))
  );
  PERFORM set_config('feruga.retiradas', array_to_string(v_antes || v_idas, ','), true);
  RETURN true;
END $$;
