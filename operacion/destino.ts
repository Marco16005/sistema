// El destino de los respaldos: el almacenamiento fuera de la máquina, y lo que hay en él.
//
// Al almacenamiento se llega con rclone, que se configura con variables de entorno
// (RCLONE_CONFIG_<REMOTO>_…): la credencial viaja en el entorno del programa, nunca en sus argumentos.
//
// Un respaldo existe cuando tiene manifiesto. El manifiesto se sube al final, cuando lo subido ya se
// bajó y se comprobó; un objeto sin manifiesto es una corrida que no terminó, y aquí no cuenta.
//
// Que rclone termine bien no prueba nada por sí solo —leer un objeto que no existe puede terminar
// «bien», con nada—: lo que se baja se compara siempre, byte por byte, contra su huella.
//
// Y que la huella coincida tampoco dice quién tomó el respaldo: la huella viaja junto al archivo,
// y quien pudiera escribir en el almacenamiento rehace las dos cosas (cifrar solo pide la llave
// pública, que el manifiesto dice). Por eso cada manifiesto lleva un sello: un HMAC de lo que dice,
// con una clave que no está en el almacenamiento. Esa clave se deriva de la llave privada del
// dueño: el servidor guarda solo la derivada (RESPALDO_SELLO) y con ella sella; quien restaura la
// deriva de la llave que de todos modos necesita para descifrar, y comprueba el sello ANTES de
// bajar, descifrar o restaurar nada. Un manifiesto sin sello, o con el de otra llave, no acredita
// ningún respaldo. Quien se haga del servidor entero sí puede sellar: contra eso no hay sello.
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { identidadDe } from "./llave.ts";
import { correr } from "./programas.ts";

export interface Entrada {
  /** El camino del objeto dentro del destino. */
  nombre: string;
  bytes: number;
}

export interface Destino {
  /** Sube ese archivo con ese nombre. Con un plazo propio, si quien sube tiene el tiempo contado. */
  subir(archivo: string, nombre: string, plazo?: number): Promise<void>;
  /** Baja a ese archivo lo que hay bajo ese nombre. Con un plazo propio, si lo que se baja es chico. */
  bajar(nombre: string, archivo: string, plazo?: number): Promise<void>;
  /** Todo lo que hay en el destino. */
  listar(plazo?: number): Promise<Entrada[]>;
  /**
   * La clave con que se sellan los manifiestos que se suben y se comprueban los que se leen. Sin
   * ella (nada) el destino sirve para ver qué hay, pero no acredita ningún respaldo.
   */
  sello: string | null;
  /** Los sellos de llaves que ya se cambiaron: solo comprueban lo que se tomó antes del cambio. Nunca sellan. */
  anteriores?: readonly SelloAnterior[];
}

/**
 * El sello de una llave que ya se cambió. Cuando se cambia la llave, el servidor sella con la nueva;
 * lo de antes sigue sellado con la vieja, y para seguir acreditándolo —y no avisarlo como perdido—
 * guarda su sello, nunca su llave privada. Solo vale para lo que se tomó antes de `hasta`: un
 * respaldo nuevo con un sello viejo no se cree. (Lo encontró Codex el 21 de octubre.)
 */
export interface SelloAnterior {
  clave: string;
  hasta: Date;
}

/**
 * Los sellos anteriores como van en el entorno (RESPALDO_SELLOS_ANTERIORES): «sello@momento», separados
 * por comas; el momento, el del cambio de llave, con su zona (2026-12-01T06:00:00Z). Vacío: ninguno.
 */
export function leerSellosAnteriores(texto: string | undefined): SelloAnterior[] {
  if (!texto || texto.trim() === "") return [];
  return texto.split(",").map((parte) => {
    const [clave, momento] = parte.trim().split("@");
    const hasta = new Date(momento ?? "");
    if (!clave || !SELLO.test(clave) || !momento || !/(Z|[+-]\d{2}:\d{2})$/.test(momento) || Number.isNaN(hasta.getTime())) {
      throw new Error("RESPALDO_SELLOS_ANTERIORES no tiene su forma: «sello@momento», separados por comas; el sello de 64 letras hexadecimales y el momento del cambio con su zona, como lo da operacion/sello.ts --hasta");
    }
    return { clave, hasta };
  });
}

/** Las claves que acreditan algo tomado en ese momento: la vigente, y las anteriores que todavía valían entonces. */
export function clavesPara(clave: string, anteriores: readonly SelloAnterior[], momento: Date): string[] {
  return [clave, ...anteriores.filter((a) => momento.getTime() < a.hasta.getTime()).map((a) => a.clave)];
}

export interface OpcionesDeDestino {
  /**
   * La clave del sello (ver `claveDeSello`), o nada si solo se va a mirar qué hay. Se dice siempre,
   * también cuando es nada: que un destino no compruebe sellos no puede pasar por descuido.
   */
  sello: string | null;
  /** Los sellos de llaves que ya se cambiaron, solo para comprobar lo de antes (ver `SelloAnterior`). */
  anteriores?: readonly SelloAnterior[];
  /** Cuánto puede tardar cada subida, bajada o listado, en milisegundos. */
  plazo?: number;
  /**
   * Ver el almacenamiento como estaba en ese momento. Sirve para volver de un respaldo que alguien
   * pisó después: con versiones, lo anterior sigue ahí. Pide una credencial que pueda leer versiones.
   */
  comoEstaba?: Date;
}

const REMOTO_Y_CAMINO = /^[A-Za-z0-9_]+:[^:]+$/;

/** El destino al que se llega con rclone: «remoto:cubo/carpeta». El remoto se configura en el entorno. */
export function destinoRclone(camino: string, entorno: Record<string, string>, o: OpcionesDeDestino): Destino {
  if (!REMOTO_Y_CAMINO.test(camino)) throw new Error("El destino del respaldo va como remoto:cubo/carpeta");
  if (o.sello !== null && !SELLO.test(o.sello)) throw new Error("El sello de los respaldos no tiene su forma: 64 letras hexadecimales. Se saca de la llave privada con operacion/sello.ts");
  if ((o.anteriores ?? []).some((a) => !SELLO.test(a.clave))) throw new Error("Un sello anterior no tiene su forma: 64 letras hexadecimales");
  const raiz = camino.replace(/\/+$/, "");
  const plazo = o.plazo ?? 30 * 60_000;
  // Sin archivo de configuración: solo cuenta lo que diga el entorno. Pocos reintentos y con plazo:
  // si no hay red, que falle pronto y lo reintente el servicio.
  const comunes = ["--config", "/dev/null", "--retries", "2", "--low-level-retries", "3", "--contimeout", "15s", "--timeout", "60s"];
  const deEntonces = o.comoEstaba ? ["--s3-version-at", o.comoEstaba.toISOString()] : [];
  const rclone = (args: string[], cuanto = plazo): Promise<string> => correr("rclone", [...comunes, ...args], { entorno, plazo: cuanto });
  return {
    sello: o.sello,
    anteriores: o.anteriores ?? [],
    // Sin mirar antes ni después: la credencial del servidor no tiene por qué poder leer para subir,
    // y la comprobación de lo subido la hace quien respalda, bajándolo.
    subir: async (archivo, nombre, cuanto) => {
      await rclone(["copyto", archivo, `${raiz}/${nombre}`, "--no-check-dest", "--s3-no-head", "--s3-no-check-bucket"], cuanto);
    },
    bajar: async (nombre, archivo, cuanto) => {
      await rm(archivo, { force: true });
      await rclone(["copyto", `${raiz}/${nombre}`, archivo, "--no-check-dest", ...deEntonces], cuanto);
      if (!(await stat(archivo).catch(() => null))) throw new Error(`No está en el destino: ${nombre}`);
    },
    listar: async (cuanto) => {
      // Con la diagonal al final rclone sabe que es una carpeta y no pregunta si es un objeto: esa
      // pregunta la credencial restringida no la puede hacer, y se quedaría sin listar.
      const salida = await rclone(["lsjson", "--recursive", "--files-only", "--no-modtime", "--no-mimetype", `${raiz}/`, ...deEntonces], cuanto);
      return (JSON.parse(salida) as { Path: string; Size: number }[]).map((e) => ({ nombre: e.Path, bytes: e.Size }));
    },
  };
}

// ── el sello ───────────────────────────────────────────────────────────────

/** La forma de la clave del sello y del sello mismo: un SHA-256 en hexadecimal. */
export const SELLO = /^[0-9a-f]{64}$/;
/** Separa esta clave de cualquier otra cosa que algún día se derive de la misma llave. */
const ETIQUETA_DE_LA_CLAVE = "feruga: sello de los respaldos, v1";
const ETIQUETA_DEL_MANIFIESTO = "feruga: manifiesto de respaldo, v1";

/**
 * La clave del sello, derivada de la llave privada de age tal como la guarda el dueño (el archivo
 * de age-keygen, con sus comentarios, o el renglón solo). La llave se lee como la lee age
 * (operacion/llave.ts): una sola identidad, sin contar comentarios, y bien escrita; así el sello
 * es el de la llave con que se va a descifrar, y no el de un texto parecido. Es un HMAC-SHA256
 * con la etiqueta como clave y el renglón de la llave como mensaje: de la derivada no se vuelve a
 * la llave. Lo mismo, sin este programa (no comprueba que la llave esté bien escrita):
 *   grep -v '^#' llave-privada.txt | grep -o 'AGE-SECRET-KEY-1[0-9A-Z]*' | head -1 | tr -d '\n' | openssl dgst -sha256 -hmac 'feruga: sello de los respaldos, v1' -r | cut -d' ' -f1
 */
export function claveDeSello(llavePrivada: string): string {
  return createHmac("sha256", ETIQUETA_DE_LA_CLAVE).update(identidadDe(llavePrivada).secreta).digest("hex");
}

/** El sello de lo que dice ese manifiesto, con esa clave. Todo lo que el manifiesto dice entra, en un orden fijo. */
export function selloDe(m: Omit<Manifiesto, "sello">, clave: string): string {
  if (!SELLO.test(clave)) throw new Error("La clave del sello no tiene su forma");
  const dicho = JSON.stringify([m.formato, m.corrida, m.instantanea, m.objeto, m.bytes, m.sha256, m.pgDump, m.llavePublica, m.esquema, m.publicacion ?? null]);
  return createHmac("sha256", Buffer.from(clave, "hex")).update(`${ETIQUETA_DEL_MANIFIESTO}\n${dicho}`).digest("hex");
}

/**
 * El sello de una anotación chica que el servidor deja en un depósito y que no es un manifiesto: la
 * elección del diario de un día, el aviso de un día sin diario. Lleva dicho qué es: el sello de una
 * cosa no vale para otra, aunque sus datos se parezcan.
 */
export function selloDeNota(que: string, datos: ReadonlyArray<string | number | null>, clave: string): string {
  if (!SELLO.test(clave)) throw new Error("La clave del sello no tiene su forma");
  return createHmac("sha256", Buffer.from(clave, "hex")).update(`feruga: ${que}, v1\n${JSON.stringify(datos)}`).digest("hex");
}

/** ¿Lo que viene es ese sello? Se compara entero, sin que el tiempo que tarde diga en qué letra difiere. */
export const esElSello = (viene: unknown, debido: string): boolean =>
  typeof viene === "string" && SELLO.test(viene) && timingSafeEqual(Buffer.from(viene, "hex"), Buffer.from(debido, "hex"));

// ── lo que hay respaldado ──────────────────────────────────────────────────

/** Lo que se sabe de un respaldo. Se sube al final, y con él el respaldo existe. */
export interface Manifiesto {
  formato: 1;
  /** El identificador de la corrida que lo tomó. */
  corrida: string;
  /**
   * De cuándo es. Todo lo que quedó asentado antes de este momento está en el respaldo; de lo
   * posterior no se sabe, y es lo que hay que conciliar si se vuelve de él.
   */
  instantanea: string;
  /** El objeto cifrado, dentro del destino. */
  objeto: string;
  bytes: number;
  sha256: string;
  pgDump: string;
  /** La llave pública con que se cifró: dice cuál privada lo abre. */
  llavePublica: string;
  /** La última migración que traía la base. */
  esquema: string;
  /**
   * La publicación que corría cuando se tomó: dice con qué imágenes se restaura. No la traen los
   * respaldos de antes de que se publicara así, ni los de desarrollo.
   */
  publicacion?: string;
  /** El sello de todo lo anterior (`selloDe`): dice que lo tomó quien tiene la clave, y que nadie lo cambió. */
  sello: string;
}

/** El identificador de una publicación (operacion/publicacion.ts): la hora, el commit y algo al azar. */
export const PUBLICACION = /^[0-9]{8}T[0-9]{6}Z-[0-9a-f]{12}-[0-9a-f]{6}$/;

export interface Respaldado {
  objeto: string;
  bytes: number;
  /** El momento que lleva en su nombre: el de su instantánea. */
  momento: Date;
  /** Si el nombre lo trae al milisegundo. Los de la primera versión lo traen solo al segundo. */
  preciso: boolean;
}

// El nombre de hoy lleva el momento al milisegundo. El de la primera versión lo llevaba al segundo:
// esos respaldos siguen ahí —no se pueden renombrar, para eso es el candado— y se siguen leyendo.
const OBJETO = /^\d{4}\/\d{2}\/\d{2}\/(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(\d{3})?Z-([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})\.dump\.age$/;

/**
 * El nombre con que se guarda el respaldo de esa corrida: por fecha, con su momento al milisegundo,
 * y único. El identificador de la corrida va al final y solo desempata dos del mismo milisegundo,
 * que no se dan: los respaldos van de uno en uno.
 */
export function nombreDeObjeto(instantanea: Date, corrida: string): string {
  const iso = instantanea.toISOString();               // 2026-10-04T15:00:00.123Z
  const momento = iso.slice(0, 23).replace(/[-:.]/g, "") + "Z";
  return `${iso.slice(0, 4)}/${iso.slice(5, 7)}/${iso.slice(8, 10)}/${momento}-${corrida}.dump.age`;
}

export const nombreDeManifiesto = (objeto: string): string => objeto.replace(/\.dump\.age$/, ".manifiesto.json");

/**
 * Los respaldos que hay en el destino —los que tienen manifiesto—, del más viejo al más nuevo,
 * según el momento de su nombre. Va por nombres: no lee los manifiestos. Que uno se pueda usar lo
 * dice `ultimoUtilizable` o `traer`.
 */
export async function respaldos(destino: Destino): Promise<Respaldado[]> {
  return respaldosEntre(await destino.listar());
}

/** Lo mismo, sobre una lista del destino que ya se tiene. */
export function respaldosEntre(entradas: Entrada[]): Respaldado[] {
  const nombres = new Set(entradas.map((e) => e.nombre));
  const hay: Respaldado[] = [];
  for (const e of entradas) {
    const m = OBJETO.exec(e.nombre);
    if (!m || !nombres.has(nombreDeManifiesto(e.nombre))) continue;
    const [, a, me, d, h, mi, s, ms, corrida] = m;
    const momento = new Date(`${a}-${me}-${d}T${h}:${mi}:${s}.${ms ?? "000"}Z`);
    // Solo cuenta un nombre que sea el de una fecha de verdad, en su carpeta: el que el propio
    // programa habría puesto. Una fecha imposible, o en la carpeta de otro día, no es un respaldo.
    if (Number.isNaN(momento.getTime())) continue;
    const canonico = nombreDeObjeto(momento, corrida!);
    if (e.nombre !== (ms !== undefined ? canonico : canonico.replace(/(T\d{6})000Z-/, "$1Z-"))) continue;
    hay.push({ objeto: e.nombre, bytes: e.bytes, momento, preciso: ms !== undefined });
  }
  return hay.sort((x, y) => x.momento.getTime() - y.momento.getTime() || (x.objeto < y.objeto ? -1 : x.objeto > y.objeto ? 1 : 0));
}

/** El tamaño y la huella SHA-256 de un archivo. */
export async function huellaDe(archivo: string): Promise<{ bytes: number; sha256: string }> {
  const huella = createHash("sha256");
  let bytes = 0;
  for await (const trozo of createReadStream(archivo)) {
    huella.update(trozo as Buffer);
    bytes += (trozo as Buffer).length;
  }
  return { bytes, sha256: huella.digest("hex") };
}

/** El manifiesto se pudo leer, y lo que dice no puede ser de ese respaldo. No es lo mismo que no haber podido leerlo. */
export class ManifiestoInvalido extends Error {}

/**
 * ¿Esa instantánea es la que lleva el nombre del respaldo? Al milisegundo; o dentro de su segundo,
 * si el nombre es de los de antes. Un manifiesto que diga otro momento se haría pasar por un
 * respaldo de otra hora.
 */
function delMismoMomento(instantanea: number, de: Respaldado): boolean {
  if (Number.isNaN(instantanea)) return false;
  return de.preciso ? instantanea === de.momento.getTime() : Math.floor(instantanea / 1000) === Math.floor(de.momento.getTime() / 1000);
}

/**
 * Lo que un manifiesto debe decir para acreditar ese respaldo: completo, con forma, con su momento,
 * con el tamaño del objeto que hay, y con el sello de esa clave. Si no, falla con `ManifiestoInvalido`.
 */
export function leerManifiesto(texto: string, de: Respaldado, clave: string, anteriores: readonly SelloAnterior[] = []): Manifiesto {
  let m: Partial<Manifiesto>;
  try {
    m = JSON.parse(texto) as Partial<Manifiesto>;
  } catch {
    throw new ManifiestoInvalido(`El manifiesto de ${de.objeto} no se puede leer`);
  }
  const corrida = OBJETO.exec(de.objeto)![8];
  const texto_ = (v: unknown): v is string => typeof v === "string" && v.length > 0;
  const bien = m !== null && typeof m === "object" && m.formato === 1 && m.objeto === de.objeto && m.corrida === corrida &&
    texto_(m.sha256) && /^[0-9a-f]{64}$/.test(m.sha256) &&
    Number.isSafeInteger(m.bytes) && m.bytes! > 0 && m.bytes === de.bytes &&
    texto_(m.instantanea) && delMismoMomento(Date.parse(m.instantanea), de) &&
    texto_(m.pgDump) && texto_(m.llavePublica) && /^age1[0-9a-z]{58}$/.test(m.llavePublica) &&
    texto_(m.esquema) && /^\d{4}_[a-z0-9_]+\.sql$/.test(m.esquema) &&
    (m.publicacion === undefined || (typeof m.publicacion === "string" && PUBLICACION.test(m.publicacion)));
  if (!bien) throw new ManifiestoInvalido(`El manifiesto de ${de.objeto} no es de ese respaldo, o dice algo que no puede ser`);
  // Solo lo que se conoce, y con su sello: lo que alguien le hubiera agregado no pasa de aquí.
  const limpio: Omit<Manifiesto, "sello"> = {
    formato: 1, corrida: m.corrida!, instantanea: m.instantanea!, objeto: m.objeto!, bytes: m.bytes!, sha256: m.sha256!,
    pgDump: m.pgDump!, llavePublica: m.llavePublica!, esquema: m.esquema!, ...(m.publicacion !== undefined ? { publicacion: m.publicacion } : {}),
  };
  // Con la clave vigente, o con la de una llave anterior si se tomó antes de que se cambiara.
  if (!clavesPara(clave, anteriores, new Date(limpio.instantanea)).some((k) => esElSello(m.sello, selloDe(limpio, k)))) {
    throw new ManifiestoInvalido(
      `El manifiesto de ${de.objeto} no lleva el sello de este negocio: no lo tomó este sistema con esta llave, o alguien lo cambió después. No acredita ningún respaldo`,
    );
  }
  return { ...limpio, sello: m.sello as string };
}

/** La clave con que ese destino comprueba sellos. Sin ella no se acredita nada: se dice, y no se sigue. */
export function selloDelDestino(destino: Destino): string {
  if (destino.sello === null) {
    throw new Error("Sin el sello de los respaldos no se puede saber cuál sirve: hace falta RESPALDO_SELLO, o la llave privada, de la que se saca");
  }
  return destino.sello;
}

/** Los manifiestos son chicos: si uno no baja en este plazo, el destino no está contestando. */
const PLAZO_DE_MANIFIESTO = 60_000;

/**
 * Baja y lee el manifiesto de ese respaldo. Falla con `ManifiestoInvalido` si se leyó y no sirve;
 * con cualquier otro error, si no se pudo leer (el destino no contesta, o niega la lectura).
 */
export async function manifiestoDe(destino: Destino, de: Respaldado, carpeta: string): Promise<Manifiesto> {
  const clave = selloDelDestino(destino);
  const archivo = join(carpeta, "manifiesto.json");
  try {
    await destino.bajar(nombreDeManifiesto(de.objeto), archivo, PLAZO_DE_MANIFIESTO);
    return leerManifiesto(await readFile(archivo, "utf8"), de, clave, destino.anteriores ?? []);
  } finally {
    await rm(archivo, { force: true });
  }
}

/** Cuántos manifiestos se leen, a lo más, para decidir cuál es el último: dañados o no. */
const LECTURAS = 10;

export interface Utilizable {
  manifiesto: Manifiesto;
  /** Los más nuevos que se saltaron porque su manifiesto no los acredita. */
  saltados: string[];
}

/**
 * El respaldo más nuevo con su manifiesto validado: se lee, es el suyo, y lo que dice es posible.
 * (Que el respaldo mismo esté entero lo comprueba `traer`, al bajarlo.) Con esto se decide si ya
 * se respaldó a la hora debida.
 *
 * La búsqueda tiene un tope de lecturas, cuenten como cuenten. Un manifiesto dañado se salta y se
 * sigue con el anterior, pero no para siempre: agotado el tope se contesta que no hay entre los más
 * nuevos. Si para saber cuál es el último habría que leer más de lo que el tope deja (muchos con el
 * nombre de antes en el mismo segundo), falla diciendo que no se pudo determinar: no se da por
 * último a uno cualquiera. Y si el destino no contesta, tampoco se sigue probando: falla enseguida
 * diciendo que no se pudo comprobar. No poder leer no es lo mismo que estar dañado.
 */
export async function ultimoUtilizable(destino: Destino): Promise<Utilizable | null> {
  selloDelDestino(destino);
  const hay = await respaldos(destino);
  const carpeta = await mkdtemp(join(tmpdir(), "feruga-respaldo-"));
  const saltados: string[] = [];
  let lecturas = 0;
  const leer = async (de: Respaldado): Promise<Manifiesto | null> => {
    lecturas += 1;
    try {
      return await manifiestoDe(destino, de, carpeta);
    } catch (e) {
      if (!(e instanceof ManifiestoInvalido)) throw new Error(`No se pudo comprobar el manifiesto de ${de.objeto}: ${(e as Error).message}`);
      saltados.push(de.objeto);
      return null;
    }
  };
  try {
    while (hay.length > 0 && lecturas < LECTURAS) {
      // Los del último segundo. Si alguno trae su momento solo al segundo (un nombre de antes), el
      // orden entre ellos no se sabe por el nombre: lo dice el manifiesto de cada uno.
      const segundo = Math.floor(hay.at(-1)!.momento.getTime() / 1000);
      const grupo: Respaldado[] = [hay.pop()!];          // siempre sale al menos uno: el bucle avanza
      while (hay.length > 0 && Math.floor(hay.at(-1)!.momento.getTime() / 1000) === segundo) grupo.push(hay.pop()!);
      const enOrden = grupo.every((r) => r.preciso);
      const leidos: Manifiesto[] = [];
      for (const de of grupo) {
        if (lecturas >= LECTURAS) {
          if (enOrden) return null;
          throw new Error(
            `No se pudo determinar cuál es el último respaldo: hay ${grupo.length} del mismo segundo con el nombre de antes, ` +
              "y saber cuál es el más nuevo pediría leerlos todos",
          );
        }
        const manifiesto = await leer(de);
        if (!manifiesto) continue;
        // Con nombres al milisegundo ya vienen en orden: el primero que sirva es el más nuevo.
        if (enOrden) return { manifiesto, saltados };
        leidos.push(manifiesto);
      }
      leidos.sort((x, y) => Date.parse(y.instantanea) - Date.parse(x.instantanea));
      if (leidos[0]) return { manifiesto: leidos[0], saltados };
    }
    return null;
  } finally {
    await rm(carpeta, { recursive: true, force: true });
  }
}

/**
 * Baja un respaldo a esa carpeta —el último, o el que se pida por su nombre— y comprueba que es el
 * que dice su manifiesto. Si no coincide, no lo entrega. Si el más nuevo no sirve no baja en
 * silencio a uno más viejo: lo dice, y dice cuál es el último con su manifiesto en orden, para
 * pedirlo por su nombre. Y si no se pudo comprobar (el destino no contesta), dice eso y nada más.
 */
export async function traer(destino: Destino, carpeta: string, cual?: string): Promise<{ archivo: string; manifiesto: Manifiesto }> {
  selloDelDestino(destino);
  let manifiesto: Manifiesto;
  if (cual === undefined) {
    let util: Utilizable | null;
    try {
      util = await ultimoUtilizable(destino);
    } catch (e) {
      throw new Error(`${(e as Error).message}. No se restaura a ciegas: pide el respaldo por su nombre (se ven con «lista»), o vuelve a intentarlo si fue el destino el que no contestó.`);
    }
    if (!util) {
      if ((await respaldos(destino)).length === 0) throw new Error("No hay ningún respaldo en el destino");
      throw new Error(
        `Los respaldos más nuevos tienen el manifiesto dañado o sin el sello de este negocio (se revisaron hasta ${LECTURAS}): no se restaura a ciegas. ` +
          "Puede haber anteriores en orden: se ven con «lista» y se piden por su nombre.",
      );
    }
    if (util.saltados.length > 0) {
      throw new Error(
        `Hay respaldos más nuevos, o del mismo segundo, con el manifiesto dañado o sin el sello de este negocio (${util.saltados[0]}): no se restaura uno más viejo sin que se pida. ` +
          `El último con su manifiesto en orden es ${util.manifiesto.objeto} (del ${util.manifiesto.instantanea}); pídelo por su nombre.`,
      );
    }
    manifiesto = util.manifiesto;
  } else {
    const de = (await respaldos(destino)).find((r) => r.objeto === cual);
    if (!de) throw new Error(`No hay un respaldo con ese nombre en el destino: ${cual}`);
    const propia = await mkdtemp(join(tmpdir(), "feruga-respaldo-"));
    try {
      manifiesto = await manifiestoDe(destino, de, propia);
    } finally {
      await rm(propia, { recursive: true, force: true });
    }
  }

  const archivo = join(carpeta, "respaldo.dump.age");
  await destino.bajar(manifiesto.objeto, archivo);
  const bajado = await huellaDe(archivo);
  if (bajado.bytes !== manifiesto.bytes || bajado.sha256 !== manifiesto.sha256) {
    await rm(archivo, { force: true });
    throw new Error(
      `Lo que hay en el destino bajo ${manifiesto.objeto} no coincide con su manifiesto: alguien lo cambió después de respaldarlo, o se dañó. ` +
        "No se restaura. Si el almacenamiento guarda versiones, se puede ver como estaba antes del cambio.",
    );
  }
  return { archivo, manifiesto };
}
