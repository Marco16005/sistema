// La operación, vista desde la base: en qué estado está, y cerrarla y abrirla para una publicación.
// Es con lo que publicar una versión (operacion/publicar.sh) le habla a la base.
//
//   node operacion/operacion.ts estado                        lo que dice la base, en una línea de JSON
//   node operacion/operacion.ts estado marca|abierta|publicacion|esquema|sesiones
//                                                              ese dato, suelto; vacío si no hay base
//   node operacion/operacion.ts cerrar <publicación> <motivo>
//   node operacion/operacion.ts drenar [segundos]             espera a que no quede ninguna sesión de la aplicación;
//                                                              pasado el plazo las termina, y comprueba que no quedó ninguna
//   node operacion/operacion.ts migrador [segundos]           espera a que termine un migrador que quedó corriendo;
//                                                              pasado el plazo termina su sesión, y comprueba que soltó
//   node operacion/operacion.ts decidir <publicación>         de aquí en adelante no hay vuelta
//   node operacion/operacion.ts abrir <publicación> <marca>   comprueba la publicación, la decisión y la base
//
// Cerrar, decidir y abrir son las funciones de la base (migración 0026): repetir un paso con la
// misma publicación no cambia nada, y una publicación no pisa a otra.
import { pathToFileURL } from "node:url";
import pg from "pg";
import { exigirEntorno } from "../src/servidor/entorno.ts";
import type { DeLaBase } from "./publicacion.ts";

export type Estado =
  /** Esa base no existe, o existe y nunca se migró. */
  | { base: "no hay" }
  /** Tiene historia, pero es de antes de que la operación se cerrara en la base. */
  | { base: "sin mantenimiento"; esquema: string }
  | { base: DeLaBase; esquema: string; motivo: string | null; /** Las sesiones que la aplicación tiene abiertas. */ sesiones: number };

/** Las sesiones en esta base que no son de administración: las de la aplicación. La misma cuenta que hace el migrador. */
const DE_LA_APLICACION = `
  FROM pg_stat_activity a JOIN pg_roles r ON r.rolname = a.usename
  WHERE a.datname = current_database() AND a.pid <> pg_backend_pid() AND NOT r.rolsuper`;

/**
 * Lo que dice la base. Que la base no exista se contesta —«no hay»—; que el servidor no conteste,
 * o no deje entrar, no es lo mismo: falla, y quien pregunta se queda sin saber.
 */
export async function estadoDeLaBase(url: string, plazo = 10_000): Promise<Estado> {
  const db = new pg.Client({ connectionString: url, connectionTimeoutMillis: plazo });
  try {
    await db.connect();
  } catch (e) {
    await db.end().catch(() => {});
    // 3D000: el servidor contestó, y esa base no existe.
    if ((e as { code?: string }).code === "3D000") return { base: "no hay" };
    throw new Error(`La base no contesta: ${(e as Error).message}`);
  }
  try {
    const { rows: [hay] } = await db.query(
      "SELECT to_regclass('public.migracion') IS NOT NULL AS migrada, to_regclass('public.mantenimiento') IS NOT NULL AS mantenimiento",
    );
    if (!hay.migrada) return { base: "no hay" };
    const esquema = (await db.query("SELECT archivo FROM migracion ORDER BY archivo DESC LIMIT 1")).rows[0]?.archivo as string | undefined;
    if (esquema === undefined) return { base: "no hay" };
    if (!hay.mantenimiento) return { base: "sin mantenimiento", esquema };
    const { rows: [m] } = await db.query(
      `SELECT (SELECT id FROM vida) AS marca, abierta, publicacion, motivo, decidida_en IS NOT NULL AS decidida, abrio_en IS NOT NULL AS abrio,
              (SELECT count(*)::int ${DE_LA_APLICACION}) AS sesiones
       FROM mantenimiento`,
    );
    return {
      base: { marca: m.marca, abierta: m.abierta, publicacion: m.publicacion, decidida: m.decidida, abrio: m.abrio },
      esquema, motivo: m.motivo, sesiones: m.sesiones,
    };
  } finally {
    await db.end();
  }
}

export interface AlDrenar {
  /** Cuánto se les espera a que terminen solas, en milisegundos. */
  plazo: number;
  /** Cada cuánto se vuelve a mirar. */
  pausa?: number;
  /** Cuánto se le da a una sesión terminada para desaparecer, antes de dar el drenado por fallido. */
  gracia?: number;
  decir?: (linea: string) => void;
}

/**
 * Espera a que no quede ninguna sesión de la aplicación en la base. Lo que entró antes de cerrar
 * puede terminar; pasado el plazo, las que queden se terminan, y se comprueba que no quedó ninguna.
 * Solo con la operación cerrada: abierta, esas sesiones son gente trabajando.
 */
export async function drenar(db: Pick<pg.Client, "query">, o: AlDrenar): Promise<{ terminadas: number }> {
  const decir = o.decir ?? ((linea: string) => console.log(linea));
  const pausa = o.pausa ?? 500;
  const esperar = (): Promise<void> => new Promise((sigue) => setTimeout(sigue, pausa));
  const adentro = async (): Promise<number> => (await db.query(`SELECT count(*)::int AS n ${DE_LA_APLICACION}`)).rows[0].n;
  const sesiones = (n: number): string => (n === 1 ? "1 sesión de la aplicación" : `${n} sesiones de la aplicación`);

  if ((await db.query("SELECT abierta FROM mantenimiento")).rows[0].abierta) {
    throw new Error("La operación está abierta: no se drena. Primero se cierra.");
  }
  const limite = Date.now() + o.plazo;
  let n = await adentro();
  if (n > 0) decir(`Queda ${sesiones(n)} en la base: se le espera a que termine.`);
  while (n > 0 && Date.now() < limite) {
    await esperar();
    n = await adentro();
  }
  if (n === 0) return { terminadas: 0 };

  const { rowCount } = await db.query(`SELECT pg_terminate_backend(a.pid) ${DE_LA_APLICACION}`);
  const terminadas = rowCount ?? 0;
  // Terminar una sesión no es instantáneo: se le da un momento, y se comprueba.
  const hasta = Date.now() + (o.gracia ?? 10_000);
  while ((n = await adentro()) > 0 && Date.now() < hasta) await esperar();
  if (n > 0) throw new Error(`Sigue habiendo ${sesiones(n)} en la base después de terminarlas. No se sigue.`);
  decir(`Se terminaron ${terminadas === 1 ? "1 sesión" : `${terminadas} sesiones`} de la aplicación que no acabaron a tiempo.`);
  return { terminadas };
}

/** Las sesiones que tienen, o esperan, el candado del migrador (db/migrar.ts): las de un migrador que corre. */
const DEL_MIGRADOR = `
  FROM pg_locks c
  WHERE c.locktype = 'advisory' AND c.classid = 0 AND c.objid = 7150 AND c.objsubid = 1
    AND c.database = (SELECT oid FROM pg_database WHERE datname = current_database())`;

/**
 * Antes de recuperar una publicación que se interrumpió: que el guion haya muerto no dice nada de
 * la instrucción que dejó corriendo en la base. Se espera a que el migrador termine; pasado el
 * plazo se termina su sesión —lo que tenía a medias no entra: cada migración es una transacción—,
 * y se comprueba que soltó.
 */
export async function esperarAlMigrador(db: Pick<pg.Client, "query">, o: AlDrenar): Promise<{ terminadas: number }> {
  const decir = o.decir ?? ((linea: string) => console.log(linea));
  const pausa = o.pausa ?? 500;
  const esperar = (): Promise<void> => new Promise((sigue) => setTimeout(sigue, pausa));
  const corriendo = async (): Promise<number> => (await db.query(`SELECT count(*)::int AS n ${DEL_MIGRADOR}`)).rows[0].n;

  const limite = Date.now() + o.plazo;
  let n = await corriendo();
  if (n > 0) decir("El migrador de la publicación interrumpida sigue corriendo en la base: se le espera a que termine.");
  while (n > 0 && Date.now() < limite) {
    await esperar();
    n = await corriendo();
  }
  if (n === 0) return { terminadas: 0 };

  const { rowCount } = await db.query(`SELECT pg_terminate_backend(c.pid) ${DEL_MIGRADOR}`);
  const terminadas = rowCount ?? 0;
  const hasta = Date.now() + (o.gracia ?? 10_000);
  while ((n = await corriendo()) > 0 && Date.now() < hasta) await esperar();
  if (n > 0) throw new Error("El migrador sigue en la base después de terminar su sesión. No se sigue.");
  decir(terminadas === 1 ? "Se terminó la sesión del migrador, que no acabó a tiempo." : `Se terminaron ${terminadas} sesiones del migrador, que no acabaron a tiempo.`);
  return { terminadas };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [orden, ...args] = process.argv.slice(2);
  const uso = (): never => {
    console.error(
      "Uso: node operacion/operacion.ts estado [marca|abierta|publicacion|esquema|sesiones] | cerrar <publicación> <motivo> | drenar [segundos] | " +
        "migrador [segundos] | decidir <publicación> | abrir <publicación> <marca>",
    );
    process.exit(2);
  };
  const cuantos = { estado: [0, 1], cerrar: [2], drenar: [0, 1], migrador: [0, 1], decidir: [1], abrir: [2] }[orden ?? ""];
  if (!cuantos || !cuantos.includes(args.length) || args.some((a) => a.trim() === "")) uso();
  if ((orden === "drenar" || orden === "migrador") && args[0] !== undefined && !/^\d{1,4}$/.test(args[0])) uso();
  if (orden === "estado" && args[0] !== undefined && !["marca", "abierta", "publicacion", "esquema", "sesiones"].includes(args[0])) uso();
  try {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("Falta DATABASE_URL");
    exigirEntorno(process.env, ["administracion"]);
    if (orden === "estado") {
      const e = await estadoDeLaBase(url);
      if (args[0] === undefined) console.log(JSON.stringify(e));
      else if (args[0] === "esquema") console.log("esquema" in e ? e.esquema : "");
      else if (args[0] === "sesiones") console.log("sesiones" in e ? e.sesiones : "");
      else console.log(typeof e.base === "object" ? (e.base[args[0] as "marca" | "abierta" | "publicacion"] ?? "") : "");
    } else {
      const db = new pg.Client({ connectionString: url, connectionTimeoutMillis: 10_000 });
      await db.connect();
      try {
        if (orden === "cerrar") await db.query("SELECT cerrar_operacion($2, $1)", args);
        else if (orden === "decidir") await db.query("SELECT decidir_abrir($1)", args);
        else if (orden === "abrir") await db.query("SELECT abrir_operacion($1, $2)", args);
        else if (orden === "migrador") {
          const { terminadas } = await esperarAlMigrador(db, { plazo: Number(args[0] ?? 60) * 1000 });
          console.log(terminadas === 0 ? "No hay ningún migrador corriendo en la base." : "El migrador ya no corre en la base.");
        } else {
          await drenar(db, { plazo: Number(args[0] ?? 60) * 1000 });
          console.log("No queda ninguna sesión de la aplicación en la base.");
        }
      } finally {
        await db.end();
      }
    }
  } catch (e) {
    console.error((e as Error).message);
    process.exit(1);
  }
}
