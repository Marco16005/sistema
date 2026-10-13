// Restaura un respaldo cifrado en un servidor de base de datos donde el sistema todavía no existe.
// Es un solo programa, para el ensayo y para la emergencia: lo que aquí se prueba es lo que se usa
// el día que haga falta.
//
// La secuencia, y por qué va en ese orden:
//   1. Descifrar con la llave privada, que entra por la entrada estándar y nunca por un argumento.
//   2. Crear los roles mínimos: el volcado no trae roles, y sus permisos nombran a feruga_app.
//   3. Restaurar en una base APARTE, en una sola transacción: o entra todo o no entra nada.
//   4. Auditar lo restaurado.
//   5. Poner la base al día (migraciones que falten) y registrar la restauración, que abre un
//      bloque nuevo de folios y cierra las sesiones que venían abiertas.
//   6. Dejar listo el usuario de la aplicación, que es quien le abre la puerta de la base.
//   7. Comprobar, entrando como ese usuario, que la base se puede usar: está en la versión que este
//      programa conoce, quedó registrada, y se lee.
//   8. Solo entonces darle a la base su nombre definitivo.
// Si algo falla antes del último paso, la base de trabajo se elimina: nunca queda una base con el
// nombre definitivo a medio restaurar. Y si el nombre definitivo ya existe, no se toca nada.
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import pg from "pg";
import { migrar } from "../db/migrar.ts";
import { asegurarRol } from "../db/rol.ts";
import { exigirEntorno } from "../src/servidor/entorno.ts";
import { ESQUEMA_ESPERADO, SQL_DE_VIDA } from "../src/servidor/esquema.ts";
import { claveDeSello, destinoRclone, traer } from "./destino.ts";
import type { Destino } from "./destino.ts";
import { correr, entornoDePg } from "./programas.ts";

const NOMBRE_DE_BASE = /^[a-z][a-z0-9_]{2,40}$/;

export interface Restauracion {
  /** La dirección de administración del servidor (a su base «postgres»). */
  servidor: string;
  /** El nombre definitivo de la base. Debe estar libre. */
  base: string;
  /** El respaldo cifrado. */
  archivo: string;
  /** La llave privada de age, tal como la guarda el dueño. */
  llave: string;
  usuarioWeb: string;
  claveWeb: string;
  /** El momento de la instantánea, si se sabe (lo trae el manifiesto del respaldo). Si no, lo último que el respaldo trae. */
  respaldoDe?: Date;
  nota?: string;
  /** Por dónde avisa lo que va haciendo. Nunca recibe la llave. */
  decir?: (linea: string) => void;
}

const enLaBase = (servidor: string, base: string): string => {
  const u = new URL(servidor);
  u.pathname = "/" + base;
  return u.toString();
};

/** Lo que una base restaurada debe cumplir antes de darla por buena. */
async function auditar(db: pg.Client): Promise<void> {
  const dice = async (sql: string): Promise<number> => (await db.query(sql)).rows[0].n;
  if ((await db.query("SELECT to_regclass('migracion') AS t")).rows[0].t === null) throw new Error("no trae el registro de migraciones: no parece un respaldo de este sistema");
  if ((await dice("SELECT count(*)::int AS n FROM migracion")) === 0) throw new Error("no trae ninguna migración aplicada");
  if ((await dice("SELECT count(*)::int AS n FROM pg_trigger WHERE NOT tgisinternal AND tgenabled <> 'O'")) > 0) {
    throw new Error("trae disparadores apagados: las reglas del libro no estarían vivas");
  }
  const sueltos = await dice(
    `SELECT count(*)::int AS n
     FROM operacion_linea l JOIN operacion o ON o.id = l.operacion_id
     LEFT JOIN movimiento_inventario mv ON mv.linea_id = l.id
     WHERE o.estado = 'confirmada'
       AND (mv.id IS NULL OR mv.cantidad_kg <> CASE o.tipo WHEN 'compra' THEN l.peso_recibido ELSE -l.peso_recibido END)`,
  );
  if (sueltos > 0) throw new Error(`${sueltos} renglones confirmados no cuadran con su movimiento de inventario`);
  if ((await dice("SELECT count(*)::int AS n FROM existencia WHERE kg < 0")) > 0) throw new Error("trae existencias negativas");
}

/** Cuánto pueden tardar el descifrado y la restauración, en milisegundos. Uno que se queda detenido se termina. */
const PLAZO = 60 * 60_000;

/**
 * El turno de quien restaura una base, en el servidor (un candado de aviso de PostgreSQL, junto
 * con el nombre de la base). Dos restauraciones de la misma base a la vez no caben: trabajan en
 * la misma base aparte, y cada una empieza por borrarla. El turno es de la sesión: si quien
 * restaura muere, se suelta solo.
 */
export const CANDADO_DE_RESTAURACION = 7151;

export async function restaurar(o: Restauracion): Promise<{ respaldoDe: Date; folioDespues: number; comprobado: true }> {
  const decir = o.decir ?? (() => {});
  if (!NOMBRE_DE_BASE.test(o.base)) throw new Error(`El nombre de la base no es válido: ${o.base}`);
  const trabajo = `${o.base}_restaurando`;
  const admin = new pg.Client({ connectionString: o.servidor, connectionTimeoutMillis: 10_000 });
  await admin.connect();
  const carpeta = await mkdtemp(join(tmpdir(), "feruga-restaurar-"));
  const claro = join(carpeta, "respaldo.dump");
  let hayTrabajo = false;
  try {
    if (!(await admin.query("SELECT pg_try_advisory_lock($1, hashtext($2)) AS mio", [CANDADO_DE_RESTAURACION, o.base])).rows[0].mio) {
      throw new Error(`Ya hay otra restauración de la base «${o.base}» en curso en ese servidor. Cuando termine —o cuando ya no exista—, se vuelve a intentar. No se tocó nada.`);
    }
    if ((await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [o.base])).rows.length > 0) {
      throw new Error(`En ese servidor ya existe una base «${o.base}»: no se restaura encima de una base que existe. No se tocó nada.`);
    }

    decir("Descifrando el respaldo…");
    try {
      await correr("age", ["--decrypt", "--identity", "-", "--output", claro, o.archivo], { entrada: o.llave, plazo: PLAZO });
    } catch (e) {
      throw new Error(`No se pudo descifrar el respaldo: la llave no es la suya, o el archivo está dañado. (${(e as Error).message})`);
    }

    await admin.query(`DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'feruga_app') THEN CREATE ROLE feruga_app NOLOGIN; END IF;
    END $$`);
    await admin.query(`DROP DATABASE IF EXISTS ${trabajo} WITH (FORCE)`);
    await admin.query(`CREATE DATABASE ${trabajo}`);
    hayTrabajo = true;

    decir("Restaurando en una base aparte…");
    try {
      // La conexión va en el entorno de pg_restore: en sus argumentos la clave quedaría a la vista de cualquiera en la máquina.
      const conexion = entornoDePg(enLaBase(o.servidor, trabajo));
      await correr("pg_restore", ["--single-transaction", "--exit-on-error", "--no-owner", "--dbname", conexion.PGDATABASE!, claro], { entorno: conexion, plazo: PLAZO });
    } catch (e) {
      throw new Error(`No se pudo restaurar el respaldo: ${(e as Error).message}`);
    }

    const db = new pg.Client({ connectionString: enLaBase(o.servidor, trabajo), connectionTimeoutMillis: 10_000 });
    await db.connect();
    let respaldoDe: Date;
    let folioDespues: number;
    try {
      decir("Auditando lo restaurado…");
      try {
        await auditar(db);
      } catch (e) {
        throw new Error(`El respaldo se restauró pero no pasa la auditoría: ${(e as Error).message}`);
      }
      const pendientes = await migrar(db);
      if (pendientes.length) decir(`Se aplicaron las migraciones que le faltaban: ${pendientes.join(", ")}`);
      // Un respaldo de una versión MÁS NUEVA que este programa trae migraciones que aquí no existen:
      // la aplicación de esta versión no podría atenderlo. No se restaura; se dice con qué versión sí.
      const version = (await db.query("SELECT archivo FROM migracion ORDER BY archivo DESC LIMIT 1")).rows[0].archivo as string;
      if (version !== ESQUEMA_ESPERADO) {
        throw new Error(
          `El respaldo es de otra versión del sistema: su base llega hasta «${version}» y este programa conoce hasta «${ESQUEMA_ESPERADO}». ` +
            "Se restaura con la versión del sistema que lo tomó, o una posterior.",
        );
      }

      const ultimo = (await db.query(
        `SELECT greatest((SELECT max(ocurrido_en) FROM bitacora), (SELECT max(creado_en) FROM movimiento_inventario),
                         (SELECT max(recibido_en) FROM envio)) AS t`,
      )).rows[0].t as Date | null;
      const momento = o.respaldoDe ?? ultimo;
      if (!momento) throw new Error("No se pudo saber de cuándo es el respaldo: dilo expresamente");
      respaldoDe = momento;
      const r = (await db.query("SELECT * FROM registrar_restauracion($1, $2)", [respaldoDe, o.nota ?? null])).rows[0];
      folioDespues = Number(r.folio_despues);
      decir(`Restauración registrada: los folios siguen después del ${folioDespues}.`);
      // La operación vuelve como estaba en el respaldo. Si estaba cerrada, sigue cerrada: restaurar
      // no abre nada, y quien restaura tiene que saber que el negocio no está atendiendo.
      if ((await db.query("SELECT to_regclass('public.mantenimiento') AS t")).rows[0].t !== null) {
        const { rows: [m] } = await db.query("SELECT abierta, publicacion FROM mantenimiento");
        decir(
          m.abierta
            ? "La operación quedó abierta, como estaba en el respaldo."
            : `LA OPERACIÓN QUEDÓ CERRADA (en mantenimiento), como estaba en el respaldo: la cerró la publicación ${m.publicacion}. Abrirla es un paso aparte.`,
        );
      }
      await asegurarRol(db, o.usuarioWeb, o.claveWeb);
    } finally {
      await db.end();
    }

    // Antes de darla por buena: entrar como entra la aplicación y ver que la puede usar.
    decir("Comprobando que la aplicación puede usar la base…");
    const uso = new URL(enLaBase(o.servidor, trabajo));
    uso.username = o.usuarioWeb;
    uso.password = o.claveWeb;
    const app = new pg.Client({ connectionString: uso.toString(), connectionTimeoutMillis: 10_000 });
    try {
      await app.connect();
      // Lo mismo que la aplicación pregunta en cada petición, y que puede leer lo suyo.
      await app.query("SELECT count(*) FROM existencia");
      if ((await app.query(SQL_DE_VIDA)).rows[0].vigente !== true) throw new Error("la base no quedó registrada como restaurada");
    } catch (e) {
      throw new Error(`La base se restauró, pero la aplicación no la puede usar: ${(e as Error).message}`);
    } finally {
      await app.end().catch(() => {});
    }

    await admin.query(`ALTER DATABASE ${trabajo} RENAME TO ${o.base}`);
    hayTrabajo = false;
    decir(`Listo: la base «${o.base}» quedó restaurada.`);
    return { respaldoDe, folioDespues, comprobado: true };
  } finally {
    if (hayTrabajo) await admin.query(`DROP DATABASE IF EXISTS ${trabajo} WITH (FORCE)`).catch(() => {});
    await admin.end();
    await rm(carpeta, { recursive: true, force: true });
  }
}

/** Hace cuánto fue eso, dicho como se dice: minutos, horas o días enteros. */
function haceCuanto(desde: Date, ahora: Date): string {
  const minutos = Math.max(0, Math.floor((ahora.getTime() - desde.getTime()) / 60_000));
  if (minutos < 60) return minutos === 1 ? "de hace 1 minuto" : `de hace ${minutos} minutos`;
  const horas = Math.floor(minutos / 60);
  if (horas < 24) return horas === 1 ? "de hace 1 hora" : `de hace ${horas} horas`;
  const dias = Math.floor(horas / 24);
  return dias === 1 ? "de hace 1 día" : `de hace ${dias} días`;
}

/**
 * Lo mismo, con el respaldo traído del almacenamiento: el último, o el que se pida por su nombre.
 * Se baja, se comprueba contra su manifiesto, y de él sale el momento exacto del respaldo.
 */
export async function restaurarDelDestino(
  o: Omit<Restauracion, "archivo" | "respaldoDe"> & { destino: Destino; cual?: string; /** El reloj con que se dice de hace cuánto es el respaldo. */ reloj?: () => Date },
): Promise<{ respaldoDe: Date; folioDespues: number; comprobado: true; objeto: string }> {
  const decir = o.decir ?? (() => {});
  // El sello se comprueba con la clave que sale de la llave con que se va a descifrar, y con ninguna
  // otra: así un manifiesto solo vale si lo selló quien tiene la derivada de esta misma llave.
  if (o.destino.sello !== claveDeSello(o.llave)) {
    throw new Error("El sello con que se comprobarían los respaldos no es el de esta llave privada: no se baja nada. (El destino se arma con la clave que sale de la llave: claveDeSello.)");
  }
  const carpeta = await mkdtemp(join(tmpdir(), "feruga-restaurar-"));
  try {
    decir("Bajando el respaldo y comprobando su sello y su huella contra su manifiesto…");
    const { archivo, manifiesto } = await traer(o.destino, carpeta, o.cual);
    const [tomado, ahora] = [new Date(manifiesto.instantanea), (o.reloj ?? (() => new Date()))()];
    decir(`Respaldo del ${manifiesto.instantanea} (${haceCuanto(tomado, ahora)}): ${manifiesto.objeto}`);
    // El sello acredita lo que el respaldo trae, no que el depósito los enseñe todos: si faltaran los
    // últimos, «el último» sería uno viejo y auténtico. Eso no se sabe desde aquí; se dice, para que
    // quien restaura lo compare con lo que sabe por fuera.
    if (o.cual === undefined && ahora.getTime() - tomado.getTime() > 24 * 3_600_000) {
      decir(
        "OJO: es el respaldo más nuevo que el depósito enseña, y tiene más de un día. El sello dice que es auténtico, no que sea el último que se tomó: " +
          "si esperabas uno posterior, compáralo con el último «terminó bien» que recibió el vigilante antes de dar esto por bueno.",
      );
    }
    // Si el manifiesto ya dice que es de una versión más nueva, ni se intenta. (Lo que decide, de
    // todos modos, es lo que traiga la base restaurada: eso lo mira `restaurar`.)
    if (manifiesto.esquema > ESQUEMA_ESPERADO) {
      throw new Error(
        `El respaldo es de una versión más nueva del sistema: su base llega hasta «${manifiesto.esquema}» y este programa conoce hasta «${ESQUEMA_ESPERADO}». ` +
          "Se restaura con la versión del sistema que lo tomó, o una posterior.",
      );
    }
    const { destino: _destino, cual: _cual, reloj: _reloj, ...resto } = o;
    const r = await restaurar({
      ...resto, archivo, respaldoDe: new Date(manifiesto.instantanea), nota: o.nota ?? `Respaldo ${manifiesto.objeto}`,
    });
    return { ...r, objeto: manifiesto.objeto };
  } finally {
    await rm(carpeta, { recursive: true, force: true });
  }
}

/** Lee todo lo que llegue por la entrada estándar. */
async function entradaEstandar(): Promise<string> {
  let texto = "";
  for await (const trozo of process.stdin) texto += trozo;
  return texto;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const opcion = (nombre: string): string | undefined => args.find((a) => a.startsWith(`--${nombre}=`))?.slice(nombre.length + 3);
  const archivo = args.find((a) => !a.startsWith("--"));
  const remoto = args.some((a) => a === "--remoto" || a.startsWith("--remoto="));
  const diario = args.some((a) => a === "--diario" || a.startsWith("--diario="));
  const ensayo = args.includes("--ensayo");
  const env = process.env;
  const uso = [
    "Uso: node operacion/restaurar.ts <respaldo.dump.age> [--respaldo-de=AAAA-MM-DDTHH:MM:SS±HH:MM] [--nota=…] < llave-privada.txt",
    "     node operacion/restaurar.ts --remoto[=<objeto>] [--como-estaba=AAAA-MM-DDTHH:MM:SS±HH:MM] [--ensayo] [--nota=…] < llave-privada.txt",
    "     node operacion/restaurar.ts --diario[=<objeto>] [--como-estaba=…] [--ensayo] [--nota=…] < llave-privada.txt",
    "Con --remoto el respaldo se baja del almacenamiento (RESPALDO_DESTINO): el último, o el que se nombre.",
    "Con --diario se baja del depósito de los diarios, que se guardan un año (RESPALDO_DESTINO_DIARIO): el último, o el que se nombre.",
    "Uno u otro: --remoto y --diario no se combinan, ni con un archivo.",
    "Con --como-estaba se ve el almacenamiento como estaba en ese momento, por si alguien pisó un respaldo después.",
    "Con --ensayo, al terminar bien se le avisa al vigilante de los ensayos (ENSAYO_VIGIA_URL).",
    "La llave privada entra por la entrada estándar, desde un archivo. No se teclea ni se pasa como argumento.",
    "Del almacenamiento solo se restaura un respaldo con el sello de esa misma llave: se comprueba antes de bajarlo.",
  ].join("\n");
  const cuando = (nombre: string): Date | undefined => {
    const texto = opcion(nombre);
    if (texto === undefined) return undefined;
    if (Number.isNaN(Date.parse(texto))) throw new Error(`No entiendo esa fecha: ${texto}`);
    return new Date(texto);
  };
  let pedido: { respaldoDe: Date | undefined; comoEstaba: Date | undefined } | null = null;
  try {
    pedido = { respaldoDe: cuando("respaldo-de"), comoEstaba: cuando("como-estaba") };
  } catch (e) {
    console.error((e as Error).message);
  }
  const falta = !env.DATABASE_URL ? "Falta DATABASE_URL" : remoto && !env.RESPALDO_DESTINO ? "Falta RESPALDO_DESTINO"
    : diario && !env.RESPALDO_DESTINO_DIARIO ? "Falta RESPALDO_DESTINO_DIARIO"
    : ensayo && !env.ENSAYO_VIGIA_URL ? "Falta ENSAYO_VIGIA_URL: se pidió avisar del ensayo y no se dijo a quién" : null;
  if (!pedido || [archivo, remoto, diario].filter(Boolean).length !== 1 || process.stdin.isTTY || falta) {
    if (falta) console.error(falta);
    console.error(uso);
    process.exit(2);
  }
  exigirEntorno(env, ["administracion", "conexion"]);
  const url = env.DATABASE_URL!;
  const comunes = {
    servidor: enLaBase(url, "postgres"), base: new URL(url).pathname.replace(/^\//, ""), llave: await entradaEstandar(),
    usuarioWeb: env.WEB_BD_USUARIO ?? "feruga_web", claveWeb: env.WEB_BD_CLAVE ?? "",
    ...(opcion("nota") ? { nota: opcion("nota")! } : {}),
    decir: (linea: string) => console.log(linea),
  };
  try {
    if (remoto || diario) {
      const cual = opcion(remoto ? "remoto" : "diario");
      await restaurarDelDestino({
        ...comunes,
        destino: destinoRclone(env[remoto ? "RESPALDO_DESTINO" : "RESPALDO_DESTINO_DIARIO"]!, {}, {
          sello: claveDeSello(comunes.llave), ...(pedido.comoEstaba ? { comoEstaba: pedido.comoEstaba } : {}),
        }),
        ...(cual ? { cual } : {}),
      });
    } else {
      await restaurar({ ...comunes, archivo: archivo!, ...(pedido.respaldoDe ? { respaldoDe: pedido.respaldoDe } : {}) });
    }
  } catch (e) {
    console.error(`No se restauró: ${(e as Error).message}`);
    process.exit(1);
  }
  if (ensayo) {
    // El ensayo periódico tiene su propio vigilante: alerta si pasa demasiado tiempo sin que alguien restaure de verdad.
    try {
      const r = await fetch(env.ENSAYO_VIGIA_URL!, { method: "POST", signal: AbortSignal.timeout(10_000) });
      if (!r.ok) throw new Error(`contestó ${r.status}`);
      console.log("Se avisó al vigilante de los ensayos.");
    } catch (e) {
      console.error(`La restauración quedó hecha, pero no se pudo avisar al vigilante de los ensayos: ${(e as Error).message}`);
      process.exit(3);
    }
  }
}
