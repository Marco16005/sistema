// La versión del esquema que esta aplicación espera: la última migración con la que se construyó.
// Si la base trae otra —de menos o de más—, la aplicación no atiende: una versión nueva contra un
// esquema viejo, o al revés, falla de formas que no se ven hasta que alguien pierde algo.
//
// La imagen de la aplicación no lleva las migraciones, así que va escrita aquí. Una prueba la
// compara con la carpeta: agregar una migración sin cambiar esta línea no pasa.
export const ESQUEMA_ESPERADO = "0034_nombres_de_cliente_sin_resquicios.sql";

const DE_LA_APLICACION = "c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p', 'S')";
/** Cada tabla y secuencia que la marca conoció sigue existiendo, la misma. */
const NADA_FALTA = `NOT EXISTS (
        SELECT 1 FROM jsonb_each_text(v.tablas) t
        WHERE NOT EXISTS (SELECT 1 FROM pg_class c WHERE c.oid = t.value::oid AND ${DE_LA_APLICACION})
      )`;
/** Y no hay ninguna que la marca no conozca. */
const NADA_SOBRA = `NOT EXISTS (
        SELECT 1 FROM pg_class c
        WHERE ${DE_LA_APLICACION} AND NOT EXISTS (SELECT 1 FROM jsonb_each_text(v.tablas) t WHERE t.value::oid = c.oid)
      )`;
const marca = (...condiciones: string[]): string => `
  SELECT EXISTS (
    SELECT 1 FROM vida v
    WHERE v.sistema = (SELECT system_identifier FROM pg_control_system())
      AND v.base = (SELECT oid FROM pg_database WHERE datname = current_database())
      AND v.tablas IS NOT NULL
      AND ${condiciones.join("\n      AND ")}
  ) AS vigente`;

/**
 * ¿La base es la que este servidor conoce, tal como estaba cuando se emparejó? Es el mismo
 * servidor, la misma base, y sus tablas y secuencias son EXACTAMENTE las que la marca conoció: ni
 * falta una ni hay otra. Se mira el identificador que el servidor le dio a cada una, no su nombre.
 * Una restauración las vuelve a crear, y una tabla creada de nuevo es otra aunque se llame igual;
 * que la vieja se conserve con otro nombre no cambia nada, porque la nueva sobra.
 *
 * La comprobación va escrita aquí, y no se le pregunta a una función de la base: un volcado viejo
 * restaurado encima repone las funciones de antes, y con ellas una comprobación más floja. Lo que
 * decide si se atiende no puede venir en el respaldo.
 */
export const SQL_DE_VIDA = marca(NADA_FALTA, NADA_SOBRA);

/**
 * Para el migrador, después de aplicar una migración a una base que estaba emparejada: nada de lo
 * que la marca conocía falta. Lo que haya de más lo creó esa migración, porque antes no sobraba nada.
 */
export const SQL_NADA_FALTA = marca(NADA_FALTA);

/** Las tablas y secuencias de la aplicación, con el identificador que el servidor les dio. Es lo que la marca guarda. */
export const SQL_DE_TABLAS = `
  SELECT coalesce(jsonb_object_agg(c.relname, c.oid::bigint), '{}'::jsonb)
  FROM pg_class c
  WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p', 'S')`;

/**
 * ¿La base es la que esta aplicación puede atender? Está en la versión del esquema que espera y,
 * fuera de desarrollo, no es una base que volvió de un respaldo sin que se registrara su
 * restauración (sin eso los folios seguirían donde iba el respaldo). En desarrollo las bases se
 * clonan de una plantilla y nunca están emparejadas, así que ahí lo segundo no se exige.
 *
 * Lo pregunta cada ruta en cada petición, no solo la salud: el proxy no consulta la salud antes
 * de pasar una petición, y un servicio que ya corría no se detiene porque la base cambie debajo.
 */
export async function baseApta(base: { leer: (sql: string) => Promise<Record<string, any>[]> }): Promise<boolean> {
  const [ultima] = await base.leer("SELECT archivo FROM migracion ORDER BY archivo DESC LIMIT 1");
  if (ultima?.archivo !== ESQUEMA_ESPERADO) return false;
  if (process.env.MODO === "desarrollo") return true;
  const [vida] = await base.leer(SQL_DE_VIDA);
  return vida?.vigente === true;
}

/**
 * ¿La operación está abierta? Se cierra y se abre en la base (migración 0026), y solo la
 * administración lo cambia: mientras está en mantenimiento, ninguna ruta de negocio atiende.
 */
export async function operacionAbierta(base: { leer: (sql: string) => Promise<Record<string, any>[]> }): Promise<boolean> {
  const [m] = await base.leer("SELECT abierta FROM mantenimiento");
  return m?.abierta === true;
}
