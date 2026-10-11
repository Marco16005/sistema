// Volver al respaldo previo: lo que se le hace al servidor de la base de datos. Lo usa
// operacion/volver.sh, que es el camino entero.
//
//   node operacion/volver.ts bases             las bases de la instalación, una por renglón: «nombre marca»
//   node operacion/volver.ts apartar <nombre>  le cambia el nombre a la base de la instalación, sin borrarla
//   node operacion/volver.ts quitar-vacia      quita la base de la instalación, solo si está vacía
//
// La base que falló no se borra: se aparta con otro nombre, y así el suyo queda libre para la que
// se restaura (operacion/restaurar.ts nunca restaura encima de una base que existe). Qué bases
// hay, con qué nombre y con qué marca, es la evidencia con que se retoma una vuelta que murió a la
// mitad. La apartada se borra a mano, después, cuando ya no haga falta.
import { pathToFileURL } from "node:url";
import pg from "pg";
import { exigirEntorno } from "../src/servidor/entorno.ts";

const NOMBRE_DE_BASE = /^[a-z][a-z0-9_]{2,60}$/;

export interface Base {
  nombre: string;
  /** Su marca de vida. Nula: existe, pero todavía no es una base de este sistema (está a medio restaurar). */
  marca: string | null;
}

const enLaBase = (servidor: string, base: string): string => {
  const u = new URL(servidor);
  u.pathname = "/" + base;
  return u.toString();
};

async function conAdmin<T>(servidor: string, tarea: (admin: pg.Client) => Promise<T>): Promise<T> {
  const admin = new pg.Client({ connectionString: servidor, connectionTimeoutMillis: 10_000 });
  await admin.connect();
  try {
    return await tarea(admin);
  } finally {
    await admin.end();
  }
}

/** Las bases de la instalación en ese servidor: la suya, y las que llevan su nombre y algo más (apartadas, a medio restaurar). */
export async function bases(servidor: string, base: string): Promise<Base[]> {
  if (!NOMBRE_DE_BASE.test(base)) throw new Error(`El nombre de la base no es válido: ${base}`);
  const nombres = await conAdmin(servidor, async (admin) =>
    (await admin.query("SELECT datname FROM pg_database WHERE datname = $1 OR starts_with(datname, $1 || '_') ORDER BY datname", [base])).rows.map((f) => f.datname as string),
  );
  const hay: Base[] = [];
  for (const nombre of nombres) {
    const marca = await conAdmin(enLaBase(servidor, nombre), async (db) => {
      if ((await db.query("SELECT to_regclass('public.vida') AS t")).rows[0].t === null) return null;
      return ((await db.query("SELECT id FROM vida")).rows[0]?.id as string | undefined) ?? null;
    });
    hay.push({ nombre, marca });
  }
  return hay;
}

/**
 * Aparta la base: le cambia el nombre, sin borrarla. Su nombre queda libre. No se hace con alguien
 * adentro —primero se detiene y se drena—, ni sobre un nombre que ya existe.
 */
export async function apartar(servidor: string, base: string, aparte: string): Promise<void> {
  for (const nombre of [base, aparte]) if (!NOMBRE_DE_BASE.test(nombre)) throw new Error(`El nombre de la base no es válido: ${nombre}`);
  if (!aparte.startsWith(`${base}_`)) throw new Error(`«${aparte}» no es de esta instalación: una base apartada lleva el nombre de la suya («${base}») y algo más.`);
  await conAdmin(servidor, async (admin) => {
    const existe = async (nombre: string): Promise<boolean> => (await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [nombre])).rows.length > 0;
    if (await existe(aparte)) throw new Error(`En ese servidor ya existe una base «${aparte}»: no se aparta encima de otra. No se tocó nada.`);
    if (!(await existe(base))) throw new Error(`La base «${base}» no existe: no hay qué apartar. No se tocó nada.`);
    const adentro = (await admin.query("SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = $1", [base])).rows[0].n as number;
    if (adentro > 0) {
      throw new Error(`La base «${base}» todavía tiene ${adentro === 1 ? "1 sesión" : `${adentro} sesiones`} adentro: primero se detiene lo que la usa. No se tocó nada.`);
    }
    await admin.query(`ALTER DATABASE ${base} RENAME TO ${aparte}`);
  });
}

/**
 * Quita la base, solo si está vacía. En una máquina nueva el servidor nace con la base de la
 * instalación ya creada y sin nada; para instalar desde un respaldo hay que dejar libre su nombre,
 * porque nunca se restaura encima de una base que existe. Una que tiene algo —lo que sea— no se
 * quita: se aparta, o lo decide una persona. Si ya no está, no hay nada que hacer.
 */
export async function quitarVacia(servidor: string, base: string): Promise<void> {
  if (!NOMBRE_DE_BASE.test(base)) throw new Error(`El nombre de la base no es válido: ${base}`);
  const existe = await conAdmin(servidor, async (admin) => (await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [base])).rows.length > 0);
  if (!existe) return;
  // Lo que haya en ella fuera de lo que trae el servidor: tablas, vistas, secuencias, funciones, tipos.
  const suyo = await conAdmin(enLaBase(servidor, base), async (db) =>
    (await db.query(
      `SELECT (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
               WHERE n.nspname NOT IN ('pg_catalog', 'information_schema') AND n.nspname NOT LIKE 'pg_toast%')
            + (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
               WHERE n.nspname NOT IN ('pg_catalog', 'information_schema'))
            + (SELECT count(*) FROM pg_namespace WHERE nspname NOT IN ('pg_catalog', 'information_schema', 'public') AND nspname NOT LIKE 'pg_%') AS n`,
    )).rows[0].n as string,
  );
  if (Number(suyo) > 0) throw new Error(`La base «${base}» no está vacía: no se quita. Instalar desde un respaldo es para una máquina donde todavía no hay nada. No se tocó nada.`);
  await conAdmin(servidor, async (admin) => {
    const adentro = (await admin.query("SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = $1", [base])).rows[0].n as number;
    if (adentro > 0) {
      throw new Error(`La base «${base}» tiene ${adentro === 1 ? "1 sesión" : `${adentro} sesiones`} adentro: primero se detiene lo que la usa. No se tocó nada.`);
    }
    await admin.query(`DROP DATABASE ${base}`);
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [orden, ...args] = process.argv.slice(2);
  if (!(((orden === "bases" || orden === "quitar-vacia") && args.length === 0) || (orden === "apartar" && args.length === 1))) {
    console.error("Uso: node operacion/volver.ts bases | apartar <nombre> | quitar-vacia");
    process.exit(2);
  }
  try {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("Falta DATABASE_URL");
    exigirEntorno(process.env, ["administracion"]);
    const servidor = enLaBase(url, "postgres");
    const base = new URL(url).pathname.replace(/^\//, "");
    if (orden === "bases") for (const b of await bases(servidor, base)) console.log(`${b.nombre} ${b.marca ?? ""}`.trim());
    else if (orden === "quitar-vacia") await quitarVacia(servidor, base);
    else await apartar(servidor, base, args[0]!);
  } catch (e) {
    console.error((e as Error).message);
    process.exit(1);
  }
}
