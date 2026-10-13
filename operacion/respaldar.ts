// Respaldar la base fuera de la máquina.
//
//   node operacion/respaldar.ts ahora             toma un respaldo y termina
//   node operacion/respaldar.ts lista [--diario]  los respaldos que existen en el destino (o en el de los diarios)
//   node operacion/respaldar.ts servicio          toma cada respaldo a su hora, para siempre
//
// Cada respaldo es una corrida con identificador propio y pasos explícitos, y el fallo de
// cualquiera la detiene:
//   1. Tomar el turno: un respaldo a la vez; el programado y el manual se esperan.
//   2. Avisar al vigilante de que empezó.
//   3. Volcar la base (pg_dump, formato propio): una instantánea coherente, con el patio trabajando.
//   4. Cifrar con la llave PÚBLICA. La privada no está en esta máquina: el servidor no puede leer
//      sus propios respaldos.
//   5. Subir, con un nombre que no se repite.
//   6. Bajar lo subido y comparar su huella con la de lo que se cifró.
//   7. Subir el manifiesto, y volver a leerlo. Con él, el respaldo existe; sin él, no.
//   8. Avisar al vigilante de que terminó bien.
// El aviso de «terminó bien» va al final y solo al final: que el vigilante no lo reciba a su hora
// es lo que dispara la alerta. Si el vigilante no contesta, el respaldo se toma igual: dejar de
// respaldar porque no hay a quién avisar sería peor, y su silencio ya es la alerta.
//
// Después, con el turno todavía tomado, se pone al día el respaldo diario —el que se guarda un año,
// en otro depósito— (operacion/diario.ts). Si eso falla, el respaldo de la hora sigue valiendo y ya
// avisó su éxito: el diario avisa por su propia señal, y se reintenta en la corrida siguiente.
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import pg from "pg";
import { exigirEntorno } from "../src/servidor/entorno.ts";
import { PUBLICACION, SELLO, destinoRclone, huellaDe, nombreDeManifiesto, nombreDeObjeto, respaldos, selloDe, selloDelDestino, ultimoUtilizable } from "./destino.ts";
import type { Destino, Manifiesto } from "./destino.ts";
import { anotarAvisados, ponerAlDia, sinComprobar } from "./diario.ts";
import type { AlDia, Comprobados, Eleccion, Elecciones } from "./diario.ts";
import { leerHorario, siguiente, toca } from "./horario.ts";
import type { Hora } from "./horario.ts";
import { correr, entornoDePg } from "./programas.ts";

// ── el vigilante ───────────────────────────────────────────────────────────

/** A quien se le avisa de cada corrida. Está fuera de la máquina: si deja de recibir avisos a su hora, alerta. */
export interface Vigia {
  inicio(corrida: string): Promise<void>;
  bien(corrida: string): Promise<void>;
  fallo(corrida: string, que: string): Promise<void>;
}

/**
 * Un vigilante al que se le avisa por HTTP, con el protocolo de Healthchecks: la dirección sola es
 * «terminó bien»; con /start, «empezó»; con /fail, «falló». El identificador de la corrida va en «rid».
 */
export function vigiaHttp(direccion: string, plazo = 10_000): Vigia {
  // La dirección no lleva usuario ni contraseña —la señal va en su ruta—: una que los llevara
  // acabaría impresa, entera, en el registro, la primera vez que fallara un aviso. Y por lo mismo,
  // de un aviso que falla se dice que falló, no con qué dirección.
  let conClave = true;
  try {
    const u = new URL(direccion);
    conClave = u.username !== "" || u.password !== "";
  } catch {
    throw new Error("La dirección del vigilante no es una dirección completa");
  }
  if (conClave) throw new Error("La dirección del vigilante no lleva usuario ni contraseña: la señal va en su ruta");
  const base = direccion.replace(/\/+$/, "");
  const avisar = async (sufijo: string, corrida: string, cuerpo = ""): Promise<void> => {
    let r: Response;
    try {
      r = await fetch(`${base}${sufijo}?rid=${encodeURIComponent(corrida)}`, { method: "POST", body: cuerpo, signal: AbortSignal.timeout(plazo) });
    } catch (e) {
      const causa = (e as { cause?: { code?: string } }).cause?.code ?? (e as Error).name;
      throw new Error(`no se pudo llegar al vigilante (${causa})`);
    }
    if (!r.ok) throw new Error(`el vigilante contestó ${r.status}`);
  };
  return {
    inicio: (corrida) => avisar("/start", corrida),
    bien: (corrida) => avisar("", corrida),
    fallo: (corrida, que) => avisar("/fail", corrida, que.slice(0, 1000)),
  };
}

// ── la corrida ─────────────────────────────────────────────────────────────

/** Cuánto puede tardar cada paso, en milisegundos. Uno que se queda detenido se termina y la corrida falla. */
export interface Plazos {
  /** Esperando a que termine otro respaldo. */
  turno: number;
  volcado: number;
  cifrado: number;
}

const PLAZOS: Plazos = { turno: 30 * 60_000, volcado: 30 * 60_000, cifrado: 10 * 60_000 };

/** El candado que comparten todos los respaldos de una base: lo toma una conexión y lo suelta al cerrarse, termine como termine. */
const CANDADO = 7152;

/** El respaldo diario, que se guarda un año: a dónde va, y a quién le avisa. */
export interface Diario {
  /** El depósito de los diarios: otro que el de cada hora, con su candado de un año. */
  destino: Destino;
  /** La zona horaria del patio: en ella se cuenta el día. */
  zona: string;
  /** Su propio vigilante: que falle el diario no es que falle el respaldo de la hora. */
  vigia?: Vigia;
  /** Lo que este proceso ya comprobó del depósito diario. El servicio lo conserva de una corrida a otra. */
  comprobados: Comprobados;
  /** Cuánto puede tardar el diario en cada corrida, en milisegundos: lo que no alcance queda para la siguiente. */
  presupuesto?: number;
  reloj?: () => Date;
}

/** Al arrancar el servicio el diario se pone al día antes del primer respaldo: con poco tiempo, para no retrasarlo. */
const PRESUPUESTO_AL_ARRANCAR = 5 * 60_000;

/** Lo que pasó con el diario en una corrida. `fallo`: por qué no se pudo, si no se pudo. */
export interface DelDiario extends AlDia {
  fallo: string | null;
}

export interface Respaldo {
  /** La dirección de administración de la base que se respalda. */
  base: string;
  /** La llave pública de age con que se cifra. */
  llavePublica: string;
  destino: Destino;
  vigia?: Vigia;
  /** Si hay depósito diario: después de cada respaldo se pone al día. */
  diario?: Diario;
  /** La publicación que corre: queda dicha en el manifiesto del respaldo. */
  publicacion?: string;
  plazos?: Partial<Plazos>;
  /** Por dónde avisa lo que va haciendo. Nunca recibe una clave. */
  decir?: (linea: string) => void;
}

export interface Hecho {
  manifiesto: Manifiesto;
  /** Si el vigilante recibió el aviso de que terminó bien. */
  avisado: boolean;
  /** Lo que pasó con el respaldo diario, si hay depósito diario. */
  diario?: DelDiario;
}

/**
 * Las elecciones del respaldo diario, en la base (tabla respaldo_diario): una fila por día, que se
 * escribe una sola vez. Quien llega segundo no la cambia: recibe la que ya estaba.
 */
export function eleccionesEnLaBase(sesion: pg.Client): Elecciones {
  const de = async (dia: string): Promise<Eleccion | null> => {
    const fila = (await sesion.query("SELECT to_char(dia, 'YYYY-MM-DD') AS dia, objeto, bytes, sha256 FROM respaldo_diario WHERE dia = $1::date", [dia])).rows[0] as
      { dia: string; objeto: string; bytes: string; sha256: string } | undefined;
    return fila ? { formato: 1, dia: fila.dia, objeto: fila.objeto, bytes: Number(fila.bytes), sha256: fila.sha256 } : null;
  };
  return {
    de,
    fijar: async (e) => {
      await sesion.query("INSERT INTO respaldo_diario (dia, objeto, bytes, sha256) VALUES ($1::date, $2, $3, $4) ON CONFLICT (dia) DO NOTHING", [e.dia, e.objeto, e.bytes, e.sha256]);
      const quedo = await de(e.dia);
      if (!quedo) throw new Error(`no se pudo dejar en la base la elección del diario del ${e.dia}`);
      return quedo;
    },
  };
}

/**
 * Pone al día el depósito diario y avisa a su vigilante. No falla: si no se pudo, lo dice, avisa del
 * fallo —solo de que falló: el detalle se queda en el registro de esta máquina— y devuelve por qué.
 * Se llama con el turno de los respaldos tomado.
 */
async function pasoDiario(r: Respaldo, d: Diario, corrida: string, decir: (linea: string) => void, sesion: pg.Client, presupuesto = d.presupuesto): Promise<DelDiario> {
  const avisar = async (aviso: (v: Vigia) => Promise<void>): Promise<boolean> => {
    if (!d.vigia) return false;
    try {
      await aviso(d.vigia);
      return true;
    } catch (e) {
      decir(`No se pudo avisar al vigilante del respaldo diario: ${(e as Error).message}`);
      return false;
    }
  };
  // El turno es de la sesión con la base: si se cortó, otra corrida puede estar decidiendo lo mismo.
  const turno = async (): Promise<void> => {
    let mio = false;
    try {
      mio = (await sesion.query(
        "SELECT 1 FROM pg_locks WHERE locktype = 'advisory' AND classid = 0 AND objid = $1 AND objsubid = 1 AND pid = pg_backend_pid() AND granted",
        [CANDADO],
      )).rows.length === 1;
    } catch {
      mio = false;
    }
    if (!mio) throw new Error("se perdió el turno de los respaldos —la sesión con la base se cortó—: no se escribe nada más en el depósito diario");
  };
  // La elección de cada día se decide en la base, por la misma sesión que tiene el turno. Si la
  // sesión se cortó, lo que hay que decir es eso.
  const conLaSesion = async <T>(consulta: () => Promise<T>): Promise<T> => {
    try {
      return await consulta();
    } catch (e) {
      await turno();
      throw e;
    }
  };
  const enLaBase = eleccionesEnLaBase(sesion);
  const elecciones: Elecciones = { de: (dia) => conLaSesion(() => enLaBase.de(dia)), fijar: (e) => conLaSesion(() => enLaBase.fijar(e)) };
  const ahora = (d.reloj ?? (() => new Date()))();
  try {
    const hecho = await ponerAlDia({ origen: r.destino, diario: d.destino, zona: d.zona, ahora, comprobados: d.comprobados, elecciones, turno, presupuesto, decir });
    if (hecho.huecos.length > 0) {
      // Un día que se quedó sin diario es una alerta. Se da por dada cuando el vigilante la recibió:
      // solo entonces se anota, y deja de repetirse. Si no llegó, la corrida siguiente avisa otra vez.
      const llego = await avisar((v) => v.fallo(corrida, `Sin respaldo diario del ${hecho.huecos.map((h) => h.dia).join(", ")}`));
      if (llego) {
        try {
          await anotarAvisados({ diario: d.destino, ahora, comprobados: d.comprobados, turno }, hecho.huecos);
        } catch (e) {
          decir(`El vigilante ya se enteró, pero no se pudo dejar anotado (${(e as Error).message}): se le avisará otra vez.`);
        }
      }
    } else if (hecho.fallas.length > 0) await avisar((v) => v.fallo(corrida, "El respaldo diario falló"));
    else await avisar((v) => v.bien(corrida));
    if (hecho.fallas.length === 0) return { ...hecho, fallo: null };
    decir("El respaldo de cada hora no se ve afectado; lo que el diario no pudo resolver se reintenta en la corrida siguiente.");
    return { ...hecho, fallo: hecho.fallas.map((f) => `${f.dia}: ${f.motivo}`).join("; ") };
  } catch (e) {
    const fallo = (e as Error).message;
    decir(`El respaldo diario falló: ${fallo}. El respaldo de cada hora no se ve afectado; el diario se reintenta en la corrida siguiente.`);
    await avisar((v) => v.fallo(corrida, "El respaldo diario falló"));
    return { subidos: [], huecos: [], fallas: [], pendientes: 0, fallo };
  }
}

/** Termina la sesión que ese volcado dejó en la base, y comprueba que ya no está. Si no puede, lo dice. */
async function terminarSesion(base: string, sesion: string, decir: (linea: string) => void): Promise<void> {
  const otra = new pg.Client({ connectionString: base, connectionTimeoutMillis: 10_000 });
  otra.on("error", () => {});
  try {
    await otra.connect();
    await otra.query("SELECT pg_terminate_backend(pid, 5000) FROM pg_stat_activity WHERE application_name = $1 AND pid <> pg_backend_pid()", [sesion]);
    const quedan = (await otra.query("SELECT count(*)::int AS n FROM pg_stat_activity WHERE application_name = $1 AND pid <> pg_backend_pid()", [sesion])).rows[0].n as number;
    if (quedan > 0) decir("No se pudo confirmar que la sesión del volcado terminó: sigue viva en la base, con sus candados. Desistirá sola al vencer su plazo de espera.");
  } catch (e) {
    decir(`No se pudo confirmar que la sesión del volcado terminó (${(e as Error).message}). Si sigue viva, desistirá sola al vencer su plazo de espera.`);
  } finally {
    await otra.end().catch(() => {});
  }
}

export async function respaldar(r: Respaldo): Promise<Hecho> {
  // Sin la clave del sello no se toma un respaldo que después nadie podría acreditar.
  const clave = selloDelDestino(r.destino);
  const decir = r.decir ?? (() => {});
  const plazos = { ...PLAZOS, ...r.plazos };
  const corrida = randomUUID();
  const avisar = async (aviso: (v: Vigia) => Promise<void>): Promise<boolean> => {
    if (!r.vigia) return false;
    try {
      await aviso(r.vigia);
      return true;
    } catch (e) {
      decir(`No se pudo avisar al vigilante: ${(e as Error).message}`);
      return false;
    }
  };

  let paso = "conectar con la base";
  const turno = new pg.Client({ connectionString: r.base, connectionTimeoutMillis: 10_000 });
  turno.on("error", () => {});          // si la base se va a media corrida, el fallo lo cuenta el paso que esté corriendo
  let carpeta: string | null = null;
  try {
    await turno.connect();

    paso = "tomar el turno";
    await turno.query(`SET lock_timeout = ${Math.floor(plazos.turno)}`);
    try {
      await turno.query("SELECT pg_advisory_lock($1)", [CANDADO]);
    } catch (e) {
      if ((e as { code?: string }).code === "55P03") throw new Error("otro respaldo sigue corriendo y no terminó a tiempo");
      throw e;
    }
    await avisar((v) => v.inicio(corrida));

    paso = "volcar la base";
    carpeta = await mkdtemp(join(tmpdir(), "feruga-respaldo-"));
    const claro = join(carpeta, "respaldo.dump");
    const cifrado = `${claro}.age`;
    const pgDump = (await correr("pg_dump", ["--version"], { plazo: 10_000 })).trim();
    // El momento se toma ANTES de la instantánea: todo lo asentado antes de este momento está en el
    // respaldo. (Algo de lo inmediatamente posterior también puede estar: es un límite, no la hora exacta.)
    const instantanea = (await turno.query("SELECT clock_timestamp() AS t")).rows[0].t as Date;
    // Lo que el manifiesto diga del respaldo se lee de LA MISMA instantánea que se vuelca: esta
    // conexión la fija y se la presta a pg_dump. Si entra una migración un instante después, ni el
    // volcado la trae ni el manifiesto la nombra.
    await turno.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const foto = (await turno.query("SELECT pg_export_snapshot() AS foto")).rows[0].foto as string;
    const esquema = (await turno.query("SELECT archivo FROM migracion ORDER BY archivo DESC LIMIT 1")).rows[0]?.archivo as string | undefined;
    if (!esquema) throw new Error("la base no tiene migraciones aplicadas: no hay nada que respaldar");
    decir(`Respaldo ${corrida}: volcando la base…`);
    // La conexión va en el entorno de pg_dump: en sus argumentos la clave quedaría a la vista.
    const sesion = `pg_dump respaldo ${corrida}`;
    try {
      // Además del plazo de aquí, uno del lado de la base: si el volcado se queda esperando un
      // candado y nadie alcanza a terminarlo, él mismo desiste.
      await correr("pg_dump", ["--format=custom", `--snapshot=${foto}`, `--lock-wait-timeout=${Math.ceil(plazos.volcado) + 5000}`, "--file", claro], {
        entorno: { ...entornoDePg(r.base), PGAPPNAME: sesion }, plazo: plazos.volcado,
      });
      await turno.query("COMMIT");
    } catch (e) {
      // Detener a pg_dump no detiene su sesión en la base: si estaba esperando un candado, ahí se
      // queda, con los suyos tomados y estorbando a una migración. Se termina desde una conexión
      // propia —la del turno pudo haber muerto, y por eso falló el volcado— y se comprueba.
      await terminarSesion(r.base, sesion, decir);
      throw e;
    }

    paso = "cifrar el volcado";
    await correr("age", ["--recipient", r.llavePublica, "--output", cifrado, claro], { plazo: plazos.cifrado });
    await rm(claro);
    const local = await huellaDe(cifrado);

    paso = "subir el respaldo";
    const objeto = nombreDeObjeto(instantanea, corrida);
    decir(`Subiendo ${objeto} (${local.bytes} bytes)…`);
    await r.destino.subir(cifrado, objeto);

    paso = "comprobar lo subido";
    const devuelto = join(carpeta, "devuelto.age");
    await r.destino.bajar(objeto, devuelto);
    const remoto = await huellaDe(devuelto);
    await rm(devuelto);
    if (remoto.bytes !== local.bytes || remoto.sha256 !== local.sha256) {
      throw new Error("lo que quedó en el destino no coincide con lo que se subió");
    }
    await rm(cifrado);

    paso = "subir el manifiesto";
    const dicho: Omit<Manifiesto, "sello"> = {
      formato: 1, corrida, instantanea: instantanea.toISOString(), objeto, bytes: local.bytes, sha256: local.sha256,
      pgDump, llavePublica: r.llavePublica, esquema, ...(r.publicacion !== undefined ? { publicacion: r.publicacion } : {}),
    };
    // El sello va al final y cubre todo lo anterior: sin él, quien restaura no toma este respaldo por bueno.
    const manifiesto: Manifiesto = { ...dicho, sello: selloDe(dicho, clave) };
    const texto = JSON.stringify(manifiesto, null, 2) + "\n";
    const delManifiesto = join(carpeta, "manifiesto.json");
    await writeFile(delManifiesto, texto);
    await r.destino.subir(delManifiesto, nombreDeManifiesto(objeto));
    const devueltoM = join(carpeta, "manifiesto.devuelto.json");
    await r.destino.bajar(nombreDeManifiesto(objeto), devueltoM, 60_000);
    if ((await readFile(devueltoM, "utf8")) !== texto) throw new Error("el manifiesto que quedó en el destino no es el que se subió");

    decir(`Respaldo ${corrida}: hecho y comprobado.`);
    const avisado = await avisar((v) => v.bien(corrida));
    // El diario, con el turno todavía tomado: una corrida a mano y la programada no ven las dos el día vacío.
    return { manifiesto, avisado, ...(r.diario ? { diario: await pasoDiario(r, r.diario, corrida, decir, turno) } : {}) };
  } catch (e) {
    // Al vigilante, que es un servicio ajeno, solo el paso: el detalle (nombres de máquinas, de
    // cubos, lo que dijo cada programa) se queda en el registro de esta máquina.
    await avisar((v) => v.fallo(corrida, `El respaldo falló al ${paso}`));
    throw new Error(`El respaldo falló al ${paso}: ${(e as Error).message}`);
  } finally {
    await turno.end().catch(() => {});
    if (carpeta) await rm(carpeta, { recursive: true, force: true });
  }
}

/**
 * Pone al día el respaldo diario sin tomar otro respaldo: lo que no se pudo subir mientras el
 * servicio estuvo caído, o mientras el depósito diario no contestaba. Toma el turno de los
 * respaldos, como una corrida. Sin depósito diario no hace nada.
 */
export async function diarioAlArrancar(r: Respaldo): Promise<DelDiario | null> {
  if (!r.diario) return null;
  const plazos = { ...PLAZOS, ...r.plazos };
  const turno = new pg.Client({ connectionString: r.base, connectionTimeoutMillis: 10_000 });
  turno.on("error", () => {});
  try {
    await turno.connect();
    await turno.query(`SET lock_timeout = ${Math.floor(plazos.turno)}`);
    try {
      await turno.query("SELECT pg_advisory_lock($1)", [CANDADO]);
    } catch (e) {
      if ((e as { code?: string }).code === "55P03") throw new Error("otro respaldo sigue corriendo y no terminó a tiempo");
      throw e;
    }
    return await pasoDiario(r, r.diario, randomUUID(), r.decir ?? (() => {}), turno, PRESUPUESTO_AL_ARRANCAR);
  } finally {
    await turno.end().catch(() => {});
  }
}

// ── el servicio: cada respaldo a su hora ───────────────────────────────────

export interface Servicio {
  horario: readonly Hora[];
  /** La zona horaria en que está escrito el horario. */
  zona: string;
  /** Cuánto esperar para reintentar un respaldo que falló, en milisegundos. Nunca más allá de la hora siguiente. */
  reintento: number;
  reloj: () => Date;
  dormir: (ms: number) => Promise<void>;
  /** El momento del último respaldo que existe en el destino, o null si no hay ninguno. */
  ultimo: () => Promise<Date | null>;
  /** Toma un respaldo. Si no puede, falla. */
  corrida: () => Promise<unknown>;
  /** Lo que se hace una vez al arrancar, antes del primer respaldo: poner al día el diario. Si falla, se dice y se sigue. */
  alArrancar?: () => Promise<unknown>;
  decir?: (linea: string) => void;
  /** Para detenerlo. Por omisión corre para siempre. */
  seguir?: () => boolean;
}

/**
 * Toma cada respaldo a su hora. Si al arrancar ya se debía uno —el servicio estuvo caído—, lo toma
 * enseguida: uno, no uno por cada hora perdida. Si uno falla, lo reintenta pronto. Y si no puede
 * saber cuál fue el último, toma uno: de más no estorba.
 */
export async function servicio(s: Servicio): Promise<void> {
  const decir = s.decir ?? (() => {});
  const seguir = s.seguir ?? (() => true);
  if (s.alArrancar) {
    try {
      await s.alArrancar();
    } catch (e) {
      decir(`No se pudo poner al día el respaldo diario al arrancar: ${(e as Error).message}`);
    }
  }
  let ultimo: Date | null;
  try {
    ultimo = await s.ultimo();
  } catch (e) {
    decir(`No se pudo saber cuál fue el último respaldo (${(e as Error).message}): se toma uno ahora.`);
    ultimo = null;
  }
  while (seguir()) {
    const ahora = s.reloj();
    if (toca(s.horario, s.zona, ahora, ultimo)) {
      try {
        await s.corrida();
        // Con esta corrida queda saldada la hora que se debía. Se anota con el reloj de esta
        // máquina, que es con el que se decide: el de la base puede ir adelantado o atrasado.
        ultimo = ahora;
        continue;          // si tardó más que el intervalo, puede que ya se deba otro
      } catch (e) {
        decir(`El respaldo falló: ${(e as Error).message}`);
        const despues = s.reloj();
        await s.dormir(Math.min(s.reintento, siguiente(s.horario, s.zona, despues).getTime() - despues.getTime()));
        continue;
      }
    }
    await s.dormir(siguiente(s.horario, s.zona, ahora).getTime() - ahora.getTime());
  }
}

// ── la consola ─────────────────────────────────────────────────────────────

/** Lo que pide cada orden, además de lo que exige el entorno de operación. En desarrollo es lo único que se comprueba. */
function pedir(env: NodeJS.ProcessEnv, nombres: string[]): void {
  const falta = nombres.filter((n) => !env[n]);
  if (falta.length > 0) throw new Error(`Falta ${falta.join(", ")}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const orden = process.argv[2];
  const env = process.env;
  try {
    if (orden === "lista") {
      // Sirve también en otra máquina, con la credencial de recuperación: solo necesita llegar al destino.
      // Con --diario, los que se guardan un año: uno por día.
      const cual = process.argv.includes("--diario") ? "RESPALDO_DESTINO_DIARIO" : "RESPALDO_DESTINO";
      pedir(env, [cual]);
      // Ver qué hay no pide el sello; saber cuál sirve, sí.
      if (env.RESPALDO_SELLO && !SELLO.test(env.RESPALDO_SELLO)) throw new Error("RESPALDO_SELLO no tiene su forma: 64 letras hexadecimales");
      const destino = destinoRclone(env[cual]!, {}, { sello: env.RESPALDO_SELLO || null });
      const hay = await respaldos(destino);
      for (const r of hay) console.log(`${r.momento.toLocaleString("es-MX")}  ${String(r.bytes).padStart(12)} bytes  ${r.objeto}`);
      console.log(hay.length === 0 ? "No hay ningún respaldo en el destino." : hay.length === 1 ? "1 respaldo." : `${hay.length} respaldos. El último es el de abajo.`);
      // Que aparezca en la lista no dice que sirva: eso lo dice su manifiesto, con su sello.
      if (hay.length > 0 && destino.sello === null) {
        console.log("Cuál sirve no se comprobó: hace falta el sello de los respaldos (RESPALDO_SELLO), que se saca de la llave privada con operacion/sello.ts.");
      } else if (hay.length > 0) {
        const util = await ultimoUtilizable(destino);
        console.log(util ? `El último con su manifiesto en orden: ${util.manifiesto.objeto}` : "Ninguno de los más nuevos tiene su manifiesto en orden.");
      }
    } else if (orden === "ahora" || orden === "servicio") {
      exigirEntorno(env, ["administracion", "respaldo"]);
      pedir(env, ["DATABASE_URL", "RESPALDO_LLAVE_PUBLICA", "RESPALDO_DESTINO", "RESPALDO_SELLO", ...(orden === "servicio" ? ["RESPALDO_HORARIO"] : [])]);
      const sello = env.RESPALDO_SELLO!;
      const zona = env.TZ ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
      const respaldo: Respaldo = {
        base: env.DATABASE_URL!, llavePublica: env.RESPALDO_LLAVE_PUBLICA!, destino: destinoRclone(env.RESPALDO_DESTINO!, {}, { sello }),
        ...(env.RESPALDO_VIGIA_URL ? { vigia: vigiaHttp(env.RESPALDO_VIGIA_URL) } : {}),
        // En operación, la publicación que corre (la pone el Compose). Lo que no sea una, no se anota.
        ...(env.VERSION && PUBLICACION.test(env.VERSION) ? { publicacion: env.VERSION } : {}),
        // El diario, si hay depósito para él (en operación lo hay siempre: lo exige el entorno).
        ...(env.RESPALDO_DESTINO_DIARIO ? {
          diario: {
            destino: destinoRclone(env.RESPALDO_DESTINO_DIARIO, {}, { sello }), zona, comprobados: sinComprobar(),
            ...(env.RESPALDO_VIGIA_DIARIO_URL ? { vigia: vigiaHttp(env.RESPALDO_VIGIA_DIARIO_URL) } : {}),
          },
        } : {}),
        decir: (linea) => console.log(linea),
      };
      if (orden === "ahora") {
        const { manifiesto, avisado, diario } = await respaldar(respaldo);
        if (respaldo.vigia && !avisado) console.error("El respaldo quedó hecho, pero el vigilante no recibió el aviso: va a alertar.");
        if (diario?.fallo) console.error("El respaldo quedó hecho, pero el diario —el que se guarda un año— no se pudo poner al día. Se reintenta en la corrida siguiente.");
        // Su nombre, en una línea aparte: quien lo tomó antes de publicar una versión lo guarda para volver a ese, no «al último».
        console.log(`respaldo: ${manifiesto.objeto}`);
        // Y si el vigilante se enteró, también aparte: quien publica lo anota, y el respaldo vale igual.
        console.log(`vigia: ${respaldo.vigia ? (avisado ? "avisado" : "sin avisar") : "no hay"}`);
      } else {
        console.log(`Respaldos a las ${env.RESPALDO_HORARIO} (${zona}).`);
        // Cuando se le pide que se detenga —al publicar una versión, al apagar el servidor— no corta
        // el respaldo que tenga a medias: lo termina, y entonces sale. Si está esperando su hora, sale enseguida.
        let detener = false;
        let despertar = (): void => {};
        for (const senal of ["SIGTERM", "SIGINT"] as const) {
          process.on(senal, () => {
            if (!detener) console.error("Se pidió detener el servicio: termina lo que tenga a medias, y sale.");
            detener = true;
            despertar();
          });
        }
        await servicio({
          horario: leerHorario(env.RESPALDO_HORARIO!), zona, reintento: 5 * 60_000,
          reloj: () => new Date(),
          dormir: (ms) => new Promise((sigue) => {
            if (detener) return sigue();
            const reloj = setTimeout(sigue, Math.min(ms, 2 ** 31 - 1));
            despertar = () => {
              clearTimeout(reloj);
              sigue();
            };
          }),
          seguir: () => !detener,
          ultimo: async () => {
            const util = await ultimoUtilizable(respaldo.destino);
            return util ? new Date(util.manifiesto.instantanea) : null;
          },
          corrida: () => respaldar(respaldo),
          alArrancar: () => diarioAlArrancar(respaldo),
          decir: (linea) => console.error(linea),
        });
      }
    } else {
      console.error("Uso: node operacion/respaldar.ts ahora | lista [--diario] | servicio");
      process.exit(2);
    }
  } catch (e) {
    console.error((e as Error).message);
    process.exit(1);
  }
}
