// El manifiesto de una publicación, y con él qué corre en la instalación.
//
// Publicar una versión es una secuencia lineal (operacion/publicar.sh). Antes de cada paso que
// cambia algo queda escrito aquí que se va a dar, de modo que sobreviva a un apagón: quien retome
// una publicación que murió a la mitad lee esto y lo que dice la base, y no supone nada.
//
//   publicaciones/                  privada: lo que guarda lleva claves
//     instalacion                   el nombre de esta instalación; se le da una vez
//     <publicación>/manifiesto.json
//     <publicación>/conjunto.json   la configuración resuelta con que corre ese conjunto
//
// El manifiesto dice la publicación (con identificador propio), la instalación, la base y su marca
// —para no confundir historias—, el conjunto que corría y el candidato por el identificador
// inmutable de cada imagen, el nombre exacto del respaldo previo, y cuatro marcas que solo avanzan:
//
//   empezó la migración   de aquí en adelante la base pudo cambiar: ya no se vuelve solo
//   no se publica         se desistió antes de migrar: lo que se vuelve a abrir es el conjunto anterior
//   se decidió abrir      de aquí en adelante no hay vuelta
//   abierta
//
// «Empezó la migración» y «no se publica» se excluyen. De la apertura manda la base; de la
// migración, el manifiesto. Un manifiesto cerrado no cambia nunca.
//
// Qué conjunto está vigente no se anota aparte: lo dice el último manifiesto cerrado. Así, cerrar
// —una sola escritura— es lo que cambia la respuesta, y no hay dos archivos que puedan discrepar.
//
// Por la línea de órdenes, como lo usan los guiones (que no traen con qué leer JSON):
//
//   node operacion/publicacion.ts <carpeta> identificador <commit>
//   … crear <publicación> <commit> <estado> [--de-fuera=<servicio>,…]
//                                         la configuración resuelta del candidato, por la entrada estándar
//   … marcar <publicación> empezoLaMigracion | noSePublica | seDecidioAbrir | abierta
//   … respaldo <publicación> <nombre>     · vigia <publicación> si|no     · base <publicación> <marca>
//   … cerrar <publicación> <cómo> [<marca de la base restaurada>]
//   … pendiente                           su identificador; nada, si no hay
//   … vigente [publicacion | commit | marca | configuracion]
//   … dato <publicación> <campo>          commit, base.marca, respaldo.nombre, anterior.configuracion…
//   … variables <publicación> candidato|anterior   · variables vigente
//                                         IMAGEN_…=… y VERSION=…: con qué se resuelve o se levanta ese conjunto
//   … conjunto <publicación> [--de-fuera=…]   vuelve a guardar su configuración resuelta (entrada estándar): mismas imágenes
//   … decidir <publicación> <estado>      «1 candidato», «1 anterior», «2» o «3»; si hay que detenerse, sale con 3
//   … corre <publicación> candidato|anterior [--nada-mas] [--de-fuera=…] <servicio=huella>…
//                                         `docker inspect` por la entrada estándar. Con --nada-mas, el de TODOS los
//                                         contenedores de la instalación: cualquiera que corra sin esperarse es una falta
//   … vuelta <publicación>                en qué va la vuelta al respaldo previo: «paso empezado|hecho [detalle]» por renglón
//   … vuelta <publicación> detener|apartar|restaurar|levantar antes|despues [<detalle>]
//
// <estado> es lo que imprime `operacion.ts estado`, o «no-contesta».
// --de-fuera es solo para los ensayos: lo que en el servidor está fuera —el almacenamiento, el
// vigilante— ahí corre junto, y se dice cuál es. En operación no se pasa, y no hay nada de más.
import { randomBytes } from "node:crypto";
import * as fs from "node:fs/promises";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { ESQUEMA_ESPERADO } from "../src/servidor/esquema.ts";
import { PUBLICACION, nombreDeManifiesto, respaldosEntre } from "./destino.ts";

export const FORMATO = 1;

/** Qué corre: cada servicio por el identificador inmutable de su imagen, y la configuración resuelta con que se levanta. */
export interface Conjunto {
  imagenes: Record<string, string>;
  /** Dónde está su configuración resuelta, dentro de la carpeta de publicaciones. Lleva claves. */
  configuracion: string;
}

export type Marca = "empezoLaMigracion" | "noSePublica" | "seDecidioAbrir" | "abierta";
const MARCAS: readonly Marca[] = ["empezoLaMigracion", "noSePublica", "seDecidioAbrir", "abierta"];

// No hay relevo a una versión corregida: de una publicación que empezó a migrar y no abrió se vuelve
// al respaldo previo —el negocio estuvo cerrado desde antes de tomarlo: no se pierde nada— y la
// corregida se publica después, como cualquier otra (docs/planes/2026-10-03-despliegue.md, tarea 5).
export type ComoCierra = "publicada" | "publicada, con el respaldo sin arrancar" | "no publicada" | "restaurada";
const CIERRES: readonly ComoCierra[] = ["publicada", "publicada, con el respaldo sin arrancar", "no publicada", "restaurada"];

export interface Manifiesto {
  formato: typeof FORMATO;
  publicacion: string;
  /** El orden en que se escribieron, en esta instalación. No depende del reloj. */
  numero: number;
  instalacion: string;
  creada: string;
  commit: string;
  base: {
    /** La marca de la base sobre la que se publica. Nula solo en la primera publicación, mientras no hay base. */
    marca: string | null;
    /** La publicación que, según la base, la había cerrado o abierto por última vez cuando se escribió esto. */
    publicacion: string | null;
  };
  /** Lo que corría, y con qué publicación llegó. Nulo en la primera. */
  anterior: (Conjunto & { publicacion: string }) | null;
  candidato: Conjunto & { esquema: string };
  /** El respaldo tomado con la operación cerrada, por su nombre exacto; y si el vigilante se enteró. */
  respaldo: { nombre: string; vigia: boolean | null } | null;
  marcas: Record<Marca, string | null>;
  cierre: { como: ComoCierra; en: string; marca?: string } | null;
}

/** Lo que hay que decir para escribir el manifiesto de una publicación nueva. Lo demás lo pone `crear`. */
export interface Nueva {
  publicacion: string;
  commit: string;
  base: { marca: string | null; publicacion: string | null };
  candidato: Conjunto & { esquema: string };
  /** La configuración resuelta del candidato, para guardarla junto al manifiesto. Lleva claves. */
  configuracion?: string;
}

/** Lo que corre hoy, según el último manifiesto cerrado. */
export interface Vigente {
  publicacion: string;
  commit: string;
  conjunto: Conjunto;
  base: { marca: string };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const INSTALACION = /^[0-9a-f]{12}$/;
const FECHA = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/**
 * El identificador de una publicación: la hora, el commit y algo al azar. Es suyo —dos del mismo
 * commit no se llaman igual— y sirve de nombre de carpeta y de etiqueta de imagen.
 */
export function identificador(ahora: Date, commit: string, azar: string = randomBytes(3).toString("hex")): string {
  if (!/^[0-9a-f]{12,40}$/.test(commit)) throw new Error("El commit de una publicación va completo, o al menos con sus doce primeras letras");
  const hora = ahora.toISOString().slice(0, 19).replace(/[-:]/g, "") + "Z";
  return `${hora}-${commit.slice(0, 12)}-${azar}`;
}

// ── escribir de modo que sobreviva a un apagón ─────────────────────────────

interface Abierto {
  writeFile(texto: string): Promise<unknown>;
  sync(): Promise<void>;
  close(): Promise<void>;
}
/** Lo que se usa del sistema de archivos al escribir. Las pruebas ponen el suyo para ver el orden. */
export interface Disco {
  open(ruta: string, modo: string, permisos?: number): Promise<Abierto>;
  rename(de: string, a: string): Promise<void>;
  rm(ruta: string, o: { force: boolean }): Promise<void>;
}

/**
 * Deja ese texto en ese archivo, entero o nada, también si se va la luz: se escribe a un archivo
 * aparte, se sincroniza a disco, se renombra encima del bueno, y se sincroniza la carpeta —sin eso
 * el renombre puede no haber llegado al disco—. Si algo falla, falla: quien llama no avanza.
 */
export async function escribirDurable(ruta: string, texto: string, disco: Disco = fs): Promise<void> {
  const aparte = `${ruta}.${process.pid}-${randomBytes(4).toString("hex")}.nuevo`;
  try {
    const archivo = await disco.open(aparte, "wx", 0o600);
    try {
      await archivo.writeFile(texto);
      await archivo.sync();
    } finally {
      await archivo.close();
    }
    await disco.rename(aparte, ruta);
  } catch (e) {
    await disco.rm(aparte, { force: true }).catch(() => {});
    throw e;
  }
  const carpeta = await disco.open(dirname(ruta), "r");
  try {
    await carpeta.sync();
  } finally {
    await carpeta.close();
  }
}

/** Manda a disco lo que haya pendiente de ese archivo o de esa carpeta. */
async function sincronizar(ruta: string): Promise<void> {
  const abierto = await fs.open(ruta, "r");
  try {
    await abierto.sync();
  } finally {
    await abierto.close();
  }
}

/**
 * Lo que se acaba de leer, asegurado en disco: el archivo, la carpeta que lo nombra y —si es de
 * una publicación— la carpeta de publicaciones, que nombra a la suya. Una escritura puede haber
 * fallado justo al asegurar una de esas carpetas —lo nuevo ya se ve, y un apagón todavía se lo
 * puede llevar—; quien la repite, o quien llega después y la lee, no debe darla por hecha. Así, de
 * un manifiesto que podría no sobrevivir a un apagón no se decide nada: o queda asegurado aquí, o
 * la lectura falla.
 */
async function asegurar(ruta: string, que: string, raiz?: string): Promise<void> {
  try {
    await sincronizar(ruta);
    await sincronizar(dirname(ruta));
    if (raiz !== undefined && raiz !== dirname(ruta)) await sincronizar(raiz);
  } catch (e) {
    throw new Error(`No se pudo asegurar en disco ${que} (${(e as Error).message}): podría no sobrevivir a un apagón. No se sigue.`);
  }
}

// ── leer ───────────────────────────────────────────────────────────────────

const esTexto = (v: unknown): v is string => typeof v === "string" && v.length > 0;
const esFecha = (v: unknown): v is string => typeof v === "string" && FECHA.test(v);

function esConjunto(v: unknown): boolean {
  if (typeof v !== "object" || v === null) return false;
  const c = v as Record<string, unknown>;
  const imagenes = c.imagenes;
  if (typeof imagenes !== "object" || imagenes === null || Object.keys(imagenes).length === 0) return false;
  return Object.values(imagenes).every(esTexto) && esTexto(c.configuracion);
}

/**
 * Por qué esa publicación no puede cerrarse así; nulo si puede. Son las mismas reglas para
 * escribir un cierre y para creer uno que ya está escrito: un manifiesto que dice «publicada» sin
 * haber abierto no es de fiar, lo haya dejado quien lo haya dejado.
 */
function porQueNoCierra(m: Pick<Manifiesto, "marcas" | "base" | "anterior">, como: ComoCierra, marca: unknown): string | null {
  const { empezoLaMigracion, noSePublica, seDecidioAbrir, abierta: abrio } = m.marcas;
  if (como === "publicada" || como === "publicada, con el respaldo sin arrancar") {
    if (noSePublica) return "se dijo que no se publica";
    if (!empezoLaMigracion || !abrio || m.base.marca === null) return "no abrió con la versión nueva";
  } else if (como === "no publicada") {
    if (empezoLaMigracion) return abrio ? "abrió con la versión nueva" : "empezó la migración";
    if (!noSePublica) return "no se había dicho que no se publica";
    // Con un conjunto anterior, se cierra cuando ese volvió a abrir. La primera vez no hay a qué volver.
    if (m.anterior !== null && !abrio) return "el conjunto anterior no volvió a abrir";
  } else if (como === "restaurada") {
    if (!empezoLaMigracion) return "no empezó la migración, y la base no se tocó";
    if (seDecidioAbrir) return "ya se decidió abrir, y desde ahí no se vuelve al respaldo";
    if (m.anterior === null) return "no hay un conjunto anterior al que volver";
    if (typeof marca !== "string" || !UUID.test(marca)) return "falta la marca de la base restaurada";
    if (marca === m.base.marca) return "una base restaurada no tiene la misma marca que la de antes";
  } else {
    return "no es una forma de cerrar una publicación";
  }
  if (como !== "restaurada" && marca !== undefined) return "solo una restaurada dice la marca de la base que quedó";
  return null;
}

/** Lo leído es un manifiesto de este formato, completo. Si no, no se usa: ni un poco. */
function entender(texto: string, deCual: string): Manifiesto {
  const noSeEntiende = (porQue: string): Error => new Error(`El manifiesto de la publicación ${deCual} no se entiende (${porQue}). No se sigue hasta saber qué pasó con ella.`);
  let m: Record<string, any>;
  try {
    m = JSON.parse(texto);
  } catch {
    throw noSeEntiende("no es JSON");
  }
  if (typeof m !== "object" || m === null) throw noSeEntiende("no es un manifiesto");
  if (m.formato !== FORMATO) throw noSeEntiende(`es de otro formato: ${JSON.stringify(m.formato)}`);
  if (m.publicacion !== deCual) throw new Error(`El manifiesto que está en la carpeta de la publicación ${deCual} no es el de su carpeta: dice ser de ${JSON.stringify(m.publicacion)}. No se sigue.`);
  const bien =
    Number.isInteger(m.numero) && m.numero >= 1 &&
    typeof m.instalacion === "string" && INSTALACION.test(m.instalacion) &&
    esFecha(m.creada) && esTexto(m.commit) &&
    typeof m.base === "object" && m.base !== null &&
    (m.base.marca === null || (typeof m.base.marca === "string" && UUID.test(m.base.marca))) &&
    (m.base.publicacion === null || esTexto(m.base.publicacion)) &&
    (m.anterior === null || (esConjunto(m.anterior) && esTexto(m.anterior.publicacion))) &&
    esConjunto(m.candidato) && esTexto(m.candidato.esquema) &&
    (m.respaldo === null || (typeof m.respaldo === "object" && esTexto(m.respaldo.nombre) && (m.respaldo.vigia === null || typeof m.respaldo.vigia === "boolean"))) &&
    typeof m.marcas === "object" && m.marcas !== null &&
    Object.keys(m.marcas).length === MARCAS.length && MARCAS.every((k) => m.marcas[k] === null || esFecha(m.marcas[k])) &&
    (m.cierre === null || (typeof m.cierre === "object" && CIERRES.includes(m.cierre.como) && esFecha(m.cierre.en)));
  if (!bien) throw noSeEntiende("le falta algo, o trae algo que no va");
  // Las marcas solo avanzan, y en su orden: unas que no pudieron darse así no son de fiar.
  const { empezoLaMigracion, noSePublica, seDecidioAbrir, abierta } = (m as Manifiesto).marcas;
  if (
    (empezoLaMigracion && noSePublica) || (seDecidioAbrir && !empezoLaMigracion && !noSePublica) || (abierta && !seDecidioAbrir) ||
    // Desistir es volver a abrir el conjunto anterior: la primera publicación no tiene ninguno.
    (seDecidioAbrir && noSePublica && m.anterior === null)
  ) {
    throw noSeEntiende("sus marcas se contradicen");
  }
  // Y el cierre, con las reglas con que se escribe.
  if (m.cierre !== null) {
    const deMas = Object.keys(m.cierre).filter((k) => !["como", "en", "marca"].includes(k));
    const porQue = deMas.length > 0 ? `trae algo que ningún cierre lleva (${deMas.join(", ")})` : porQueNoCierra(m as Manifiesto, m.cierre.como, m.cierre.marca);
    if (porQue !== null) throw noSeEntiende(`su cierre no pudo darse así: dice «${m.cierre.como}», y ${porQue}`);
  }
  return m as Manifiesto;
}

const rutaDe = (carpeta: string, publicacion: string): string => join(carpeta, publicacion, "manifiesto.json");

export async function leer(carpeta: string, publicacion: string): Promise<Manifiesto> {
  let texto: string;
  try {
    texto = await fs.readFile(rutaDe(carpeta, publicacion), "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(`La carpeta de la publicación ${publicacion} no tiene manifiesto. No significa que no haya nada pendiente: no se sigue hasta saber qué pasó con ella.`);
    }
    throw new Error(`No se pudo leer el manifiesto de la publicación ${publicacion}: ${(e as Error).message}. No se sigue.`);
  }
  const m = entender(texto, publicacion);
  await asegurar(rutaDe(carpeta, publicacion), `el manifiesto de la publicación ${publicacion}`, carpeta);
  return m;
}

/** Todas las publicaciones de la instalación, en el orden en que se escribieron. Si alguna no se lee, falla. */
export async function todas(carpeta: string): Promise<Manifiesto[]> {
  let nombres: string[];
  try {
    // Las carpetas que empiezan con punto son publicaciones a medio escribir: no llegaron a existir.
    nombres = (await fs.readdir(carpeta, { withFileTypes: true })).filter((e) => e.isDirectory() && !e.name.startsWith(".")).map((e) => e.name);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw e;
  }
  const leidas: Manifiesto[] = [];
  for (const nombre of nombres) leidas.push(await leer(carpeta, nombre));
  leidas.sort((a, b) => a.numero - b.numero);
  for (let k = 1; k < leidas.length; k++) {
    if (leidas[k]!.numero === leidas[k - 1]!.numero) {
      throw new Error(`Dos publicaciones dicen tener el mismo número (${leidas[k - 1]!.publicacion} y ${leidas[k]!.publicacion}). No se sigue.`);
    }
  }
  return leidas;
}

/** La publicación sin cerrar, si hay una. Más de una no puede haber: si las hay, se detiene. */
export async function pendiente(carpeta: string): Promise<Manifiesto | null> {
  const abiertas = (await todas(carpeta)).filter((m) => m.cierre === null);
  if (abiertas.length > 1) throw new Error(`Hay más de una publicación sin cerrar (${abiertas.map((m) => m.publicacion).join(", ")}). No se sigue.`);
  return abiertas[0] ?? null;
}

/** Lo que corre hoy, según el último manifiesto cerrado. Nulo: todavía no se ha publicado nada. */
export async function vigente(carpeta: string): Promise<Vigente | null> {
  return vigenteEntre(await todas(carpeta));
}

function vigenteEntre(publicaciones: Manifiesto[]): Vigente | null {
  for (const m of publicaciones.filter((p) => p.cierre !== null).reverse()) {
    const como = m.cierre!.como;
    if (como === "publicada" || como === "publicada, con el respaldo sin arrancar") {
      const { imagenes, configuracion } = m.candidato;
      return { publicacion: m.publicacion, commit: m.commit, conjunto: { imagenes, configuracion }, base: { marca: m.base.marca! } };
    }
    if (como === "restaurada") {
      // Se volvió al respaldo previo: corre el conjunto anterior, sobre la base restaurada, que es otra.
      const { publicacion, imagenes, configuracion } = m.anterior!;
      const deAntes = publicaciones.find((p) => p.publicacion === publicacion);
      if (!deAntes) throw new Error(`La publicación ${m.publicacion} volvió al conjunto de ${publicacion}, y su manifiesto no está. No se sigue.`);
      return { publicacion, commit: deAntes.commit, conjunto: { imagenes, configuracion }, base: { marca: m.cierre!.marca! } };
    }
    // «No publicada» no cambió lo que corre: manda la de antes.
  }
  return null;
}

/** El nombre de esta instalación. Se le da una vez, al escribir su primera publicación. */
export async function instalacion(carpeta: string): Promise<string> {
  const ruta = join(carpeta, "instalacion");
  let nombre: string;
  let estaba = true;
  try {
    nombre = (await fs.readFile(ruta, "utf8")).trim();
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    if ((await todas(carpeta)).length > 0) throw new Error("La instalación tiene publicaciones y no tiene nombre: falta el archivo «instalacion». No se sigue.");
    nombre = randomBytes(6).toString("hex");
    await escribirDurable(ruta, `${nombre}\n`);
    estaba = false;
  }
  if (!INSTALACION.test(nombre)) throw new Error("El nombre de la instalación no se entiende. No se sigue.");
  if (estaba) await asegurar(ruta, "el nombre de la instalación");
  return nombre;
}

// ── escribir ───────────────────────────────────────────────────────────────

const guardar = async (carpeta: string, m: Manifiesto): Promise<Manifiesto> => {
  await escribirDurable(rutaDe(carpeta, m.publicacion), `${JSON.stringify(m, null, 2)}\n`);
  return m;
};

/** Escribe el manifiesto de una publicación nueva. Antes de tocar nada. */
export async function crear(carpeta: string, nueva: Nueva, ahora: Date = new Date()): Promise<Manifiesto> {
  if (!PUBLICACION.test(nueva.publicacion)) throw new Error(`«${nueva.publicacion}» no es el identificador de una publicación`);
  // El nombre de la carpeta de publicaciones también tiene que llegar a disco: sin eso, un apagón
  // puede llevársela entera, con todo y lo que se aseguró dentro. Se asegura siempre, no solo al
  // crearla: que ya exista no dice que se haya alcanzado a asegurar la vez que se creó.
  const creada = await fs.mkdir(carpeta, { recursive: true, mode: 0o700 });
  try {
    await sincronizar(dirname(carpeta));
    for (let hecha = creada === undefined || creada === carpeta ? null : dirname(carpeta); hecha !== null; hecha = hecha === creada ? null : dirname(hecha)) await sincronizar(dirname(hecha));
  } catch (e) {
    throw new Error(`No se pudo asegurar en disco la carpeta de publicaciones (${(e as Error).message}): podría no sobrevivir a un apagón. No se escribió nada.`);
  }
  const hechas = await todas(carpeta);
  const sinCerrar = hechas.filter((m) => m.cierre === null);
  if (sinCerrar.length > 0) {
    throw new Error(`Hay una publicación sin cerrar (${sinCerrar.map((m) => m.publicacion).join(", ")}): primero se recupera esa. No se escribió nada.`);
  }
  const corre = vigenteEntre(hechas);
  if ((corre?.base.marca ?? null) !== nueva.base.marca) {
    throw new Error(
      corre
        ? "Lo que se quiere publicar habla de otra base que la que dejó la última publicación: su marca no es la misma. No se escribió nada."
        : "Todavía no se ha publicado nada en esta instalación, y ya hay una base: es otra base que la que conoce esta carpeta. No se escribió nada.",
    );
  }
  const m: Manifiesto = {
    formato: FORMATO,
    publicacion: nueva.publicacion,
    numero: (hechas.at(-1)?.numero ?? 0) + 1,
    instalacion: await instalacion(carpeta),
    creada: ahora.toISOString(),
    commit: nueva.commit,
    base: { marca: nueva.base.marca, publicacion: nueva.base.publicacion },
    anterior: corre ? { publicacion: corre.publicacion, ...corre.conjunto } : null,
    candidato: nueva.candidato,
    respaldo: null,
    marcas: { empezoLaMigracion: null, noSePublica: null, seDecidioAbrir: null, abierta: null },
    cierre: null,
  };
  entender(JSON.stringify(m), m.publicacion);
  const yaExiste = new Error(`La publicación ${m.publicacion} ya existe. No se escribió nada.`);
  if (await fs.stat(join(carpeta, m.publicacion)).then(() => true, () => false)) throw yaExiste;
  // Su carpeta se arma aparte, completa, y aparece de un solo movimiento: una publicación existe
  // entera —con su manifiesto y su configuración— o no existe.
  const aparte = join(carpeta, `.nueva-${m.publicacion}`);
  await fs.rm(aparte, { recursive: true, force: true });
  await fs.mkdir(aparte, { mode: 0o700 });
  try {
    if (nueva.configuracion !== undefined) await escribirDurable(join(aparte, "conjunto.json"), nueva.configuracion);
    await escribirDurable(join(aparte, "manifiesto.json"), `${JSON.stringify(m, null, 2)}\n`);
    await fs.rename(aparte, join(carpeta, m.publicacion)).catch((e: NodeJS.ErrnoException) => {
      throw e.code === "ENOTEMPTY" || e.code === "EEXIST" ? yaExiste : e;
    });
  } catch (e) {
    await fs.rm(aparte, { recursive: true, force: true });
    throw e;
  }
  await sincronizar(carpeta);
  return m;
}

/** La publicación, para anotarle algo: tiene que estar sin cerrar. */
async function abierta(carpeta: string, publicacion: string): Promise<Manifiesto> {
  const m = await leer(carpeta, publicacion);
  if (m.cierre !== null) throw new Error(`La publicación ${publicacion} ya está cerrada («${m.cierre.como}»): un manifiesto cerrado no cambia.`);
  return m;
}

/** Pone una marca. Solo avanzan: repetir una no la cambia, y cada una pide las que van antes. */
export async function marcar(carpeta: string, publicacion: string, marca: Marca, ahora: Date = new Date()): Promise<Manifiesto> {
  const m = await abierta(carpeta, publicacion);
  if (m.marcas[marca] !== null) return m;
  const { empezoLaMigracion, noSePublica, seDecidioAbrir } = m.marcas;
  const no = (porQue: string): Error => new Error(`La publicación ${publicacion} no puede anotar «${marca}»: ${porQue}.`);
  if (marca === "empezoLaMigracion") {
    if (noSePublica) throw no("ya se dijo que no se publica");
    // Hay una base que cuidar, y no hay a qué volver: sin el respaldo anotado no se migra.
    if (m.base.marca !== null && m.respaldo === null) throw no("sin el respaldo anotado no se migra");
  } else if (marca === "noSePublica") {
    if (empezoLaMigracion) throw no("ya empezó la migración, y la base pudo cambiar");
  } else if (marca === "seDecidioAbrir") {
    if (!empezoLaMigracion && !noSePublica) throw no("ni empezó la migración ni se desistió de publicar");
    if (noSePublica && m.anterior === null) throw no("se desistió de publicar, y no hay un conjunto anterior que abrir: es la primera");
  } else if (!seDecidioAbrir) {
    throw no("no se abre sin haberse decidido");
  }
  return guardar(carpeta, { ...m, marcas: { ...m.marcas, [marca]: ahora.toISOString() } });
}

/** Anota el respaldo tomado con la operación cerrada, por su nombre exacto. Una vez, y antes de migrar. */
export async function anotarRespaldo(carpeta: string, publicacion: string, nombre: string): Promise<Manifiesto> {
  if (respaldosEntre([{ nombre, bytes: 0 }, { nombre: nombreDeManifiesto(nombre), bytes: 0 }]).length !== 1) {
    throw new Error(`«${nombre}» no es el nombre de un respaldo`);
  }
  const m = await abierta(carpeta, publicacion);
  if (m.respaldo !== null) {
    if (m.respaldo.nombre === nombre) return m;
    throw new Error(`La publicación ${publicacion} ya tiene anotado su respaldo (${m.respaldo.nombre}): no se cambia por otro, aunque sea más nuevo.`);
  }
  if (m.marcas.empezoLaMigracion) throw new Error(`La publicación ${publicacion} ya empezó a migrar: su respaldo previo ya no puede ser otro.`);
  return guardar(carpeta, { ...m, respaldo: { nombre, vigia: null } });
}

/** Anota, aparte, si el vigilante se enteró del respaldo. Si no llegó el aviso, el respaldo vale igual. */
export async function anotarVigia(carpeta: string, publicacion: string, avisado: boolean): Promise<Manifiesto> {
  const m = await abierta(carpeta, publicacion);
  if (m.respaldo === null) throw new Error(`La publicación ${publicacion} todavía no tiene anotado su respaldo.`);
  return guardar(carpeta, { ...m, respaldo: { ...m.respaldo, vigia: avisado } });
}

/** En la primera publicación, la base nace al migrar: aquí se anota cuál es. En las demás ya está dicha, y no se cambia. */
export async function fijarBase(carpeta: string, publicacion: string, marca: string): Promise<Manifiesto> {
  if (!UUID.test(marca)) throw new Error(`«${marca}» no es la marca de una base`);
  const m = await abierta(carpeta, publicacion);
  if (m.base.marca === marca) return m;
  if (m.base.marca !== null) throw new Error(`La publicación ${publicacion} se escribió para otra base: su marca no es esa.`);
  return guardar(carpeta, { ...m, base: { ...m.base, marca } });
}

/** Cierra el manifiesto. Una vez: repetir el mismo cierre no cambia nada, y otro se rechaza. */
export async function cerrar(
  carpeta: string, publicacion: string, como: ComoCierra, o: { marca?: string } = {}, ahora: Date = new Date(),
): Promise<Manifiesto> {
  const m = await leer(carpeta, publicacion);
  if (m.cierre !== null) {
    if (m.cierre.como === como && (m.cierre.marca ?? null) === (o.marca ?? null)) return m;
    throw new Error(`La publicación ${publicacion} ya está cerrada («${m.cierre.como}»): un manifiesto cerrado no cambia.`);
  }
  const porQue = porQueNoCierra(m, como, como === "restaurada" ? o.marca : undefined);
  if (porQue !== null) throw new Error(`La publicación ${publicacion} no se puede cerrar como «${como}»: ${porQue}.`);
  const cierre: NonNullable<Manifiesto["cierre"]> = { como, en: ahora.toISOString(), ...(como === "restaurada" ? { marca: o.marca! } : {}) };
  return guardar(carpeta, { ...m, cierre });
}

// ── volver al respaldo previo: su registro ─────────────────────────────────

/** Los pasos de volver al respaldo previo (operacion/volver.sh), en su orden. */
export type PasoDeVuelta = "detener" | "apartar" | "restaurar" | "levantar";
const PASOS_DE_VUELTA: readonly PasoDeVuelta[] = ["detener", "apartar", "restaurar", "levantar"];

/**
 * El registro de una vuelta al respaldo previo: cada paso con su «antes» y su «después», para que
 * una muerte a la mitad se retome hacia adelante sabiendo qué se alcanzó a intentar. El detalle
 * dice a qué nombre se apartó la base que falló, y qué marca tiene la restaurada.
 */
export interface Vuelta {
  formato: typeof FORMATO;
  publicacion: string;
  pasos: Partial<Record<PasoDeVuelta, { antes: string; despues: string | null; detalle: string | null }>>;
}

const rutaDeVuelta = (carpeta: string, publicacion: string): string => join(carpeta, publicacion, "vuelta.json");

/** El registro de la vuelta al respaldo de esa publicación. Nulo: no se ha empezado. Si no se entiende, falla. */
export async function vuelta(carpeta: string, publicacion: string): Promise<Vuelta | null> {
  let texto: string;
  try {
    texto = await fs.readFile(rutaDeVuelta(carpeta, publicacion), "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw e;
  }
  const noSeEntiende = new Error(`El registro de la vuelta al respaldo de la publicación ${publicacion} no se entiende. No se sigue hasta saber qué pasó.`);
  let v: Vuelta;
  try {
    v = JSON.parse(texto);
  } catch {
    throw noSeEntiende;
  }
  const bien =
    typeof v === "object" && v !== null && v.formato === FORMATO && v.publicacion === publicacion && typeof v.pasos === "object" && v.pasos !== null &&
    Object.entries(v.pasos).every(([paso, p]) =>
      PASOS_DE_VUELTA.includes(paso as PasoDeVuelta) && typeof p === "object" && p !== null && esFecha(p.antes) &&
      (p.despues === null || esFecha(p.despues)) && (p.detalle === null || esTexto(p.detalle)));
  if (!bien) throw noSeEntiende;
  await asegurar(rutaDeVuelta(carpeta, publicacion), `el registro de la vuelta al respaldo de la publicación ${publicacion}`, carpeta);
  return v;
}

/** Anota el «antes» o el «después» de un paso de la vuelta. En orden; repetir una anotación no la cambia. */
export async function anotarPaso(
  carpeta: string, publicacion: string, paso: PasoDeVuelta, cuando: "antes" | "despues", detalle?: string, ahora: Date = new Date(),
): Promise<Vuelta> {
  const m = await abierta(carpeta, publicacion);
  const no = (porQue: string): Error => new Error(`De la publicación ${publicacion} no se vuelve al respaldo: ${porQue}.`);
  if (m.marcas.seDecidioAbrir) throw no("ya se decidió abrir, y pudo cobrarse algo que el respaldo no trae");
  if (!m.marcas.empezoLaMigracion) throw no("no empezó la migración: la base no se tocó, y lo que toca es recuperar");
  const v: Vuelta = (await vuelta(carpeta, publicacion)) ?? { formato: FORMATO, publicacion, pasos: {} };
  const k = PASOS_DE_VUELTA.indexOf(paso);
  const previo = PASOS_DE_VUELTA[k - 1];
  if (previo !== undefined && !v.pasos[previo]?.despues) throw new Error(`No se puede anotar «${paso}»: falta terminar «${previo}».`);
  const suyo = v.pasos[paso];
  if (cuando === "despues" && !suyo) throw new Error(`No se puede anotar que «${paso}» terminó sin haber anotado que empezaba.`);
  if (suyo && detalle !== undefined && suyo.detalle !== null && suyo.detalle !== detalle) {
    throw new Error(`El paso «${paso}» ya tiene anotado otro detalle (${suyo.detalle}): no se cambia.`);
  }
  const nuevo = {
    antes: suyo?.antes ?? ahora.toISOString(),
    despues: suyo?.despues ?? (cuando === "despues" ? ahora.toISOString() : null),
    detalle: suyo?.detalle ?? detalle ?? null,
  };
  if (suyo && suyo.antes === nuevo.antes && suyo.despues === nuevo.despues && suyo.detalle === nuevo.detalle) return v;
  const anotado: Vuelta = { ...v, pasos: { ...v.pasos, [paso]: nuevo } };
  await escribirDurable(rutaDeVuelta(carpeta, publicacion), `${JSON.stringify(anotado, null, 2)}\n`);
  return anotado;
}

// ── recuperar ──────────────────────────────────────────────────────────────

/** Lo que dice la base: su marca, y el estado de la operación con la publicación que lo puso. */
export interface DeLaBase {
  marca: string;
  abierta: boolean;
  /** La publicación que la cerró o la abrió por última vez. Nula: nunca se ha cerrado. */
  publicacion: string | null;
  /** Se anotó en la base que se decidió abrir. */
  decidida: boolean;
  /** Se anotó en la base que abrió. */
  abrio: boolean;
}

export interface Evidencia {
  /** «no hay»: el servidor contesta y esa base no existe. «no contesta»: no se pudo saber. */
  base: DeLaBase | "no hay" | "no contesta";
}

export type Decision =
  /** Se decidió abrir o ya abrió: se termina hacia adelante, con ese conjunto. Nunca se ofrece el respaldo previo. */
  | { caso: 1; conjunto: "candidato" | "anterior" }
  /**
   * Empezó la migración y no hay señal de apertura: se queda cerrado. Ni se repite ni se vuelve solo.
   * (Salvo en la primera publicación, que no tiene a qué volver ni datos que cuidar: esa repite la
   * migración y sigue. Lo decide el guion, que sabe que es la primera porque no hay conjunto anterior.)
   */
  | { caso: 2 }
  /** Ni lo uno ni lo otro: se restablece el conjunto anterior. La base no se tocó. */
  | { caso: 3 }
  | { detenerse: string };

/**
 * Qué hacer con una publicación que quedó sin cerrar. La tabla se lee en este orden y se queda en
 * la primera que se cumple; por eso manda la apertura: una publicación normal que llegó a abrir
 * tiene también «empezó la migración». Las señales son las de ESTA publicación, en el manifiesto o
 * en la base. Si la identidad no coincide o falta evidencia, no se elige el caso más cómodo.
 */
export function decidir(m: Manifiesto, e: Evidencia): Decision {
  if (m.cierre !== null) return { detenerse: `La publicación ${m.publicacion} ya está cerrada («${m.cierre.como}»): no hay nada que recuperar.` };
  if (e.base === "no contesta") return { detenerse: "La base no contesta: sin lo que ella dice no se puede saber en qué quedó la publicación." };
  if (e.base === "no hay") {
    // Solo la primera publicación puede no tener base, y solo mientras no supo cuál era: o no llegó
    // a migrar —no creó nada—, o murió con la migración recién anotada y antes de que naciera.
    if (m.base.marca === null && !m.marcas.seDecidioAbrir) return m.marcas.empezoLaMigracion ? { caso: 2 } : { caso: 3 };
    return { detenerse: "No hay base, y esta publicación ya la conocía o la daba por existente. No se sigue." };
  }
  if (m.base.marca !== null && e.base.marca !== m.base.marca) {
    return { detenerse: "La base que contesta es otra base que la de esta publicación: su marca no es la misma. No se sigue." };
  }
  if (e.base.publicacion !== m.publicacion && e.base.publicacion !== m.base.publicacion) {
    return {
      detenerse:
        `La base dice que la cerró o la abrió ${e.base.publicacion === null ? "nadie todavía" : `la publicación ${e.base.publicacion}`}: ` +
        "es otra publicación que esta y que la que había cuando esta empezó. No se sigue.",
    };
  }
  const laBaseLoDice = e.base.publicacion === m.publicacion && (e.base.decidida || e.base.abrio);
  if (m.marcas.seDecidioAbrir || laBaseLoDice) {
    if (m.marcas.noSePublica && m.anterior === null) {
      return { detenerse: "La base dice que esta publicación decidió abrir, pero desistió de publicar y no hay un conjunto anterior que abrir: es la primera. No se sigue." };
    }
    return { caso: 1, conjunto: m.marcas.noSePublica ? "anterior" : "candidato" };
  }
  if (m.marcas.empezoLaMigracion) return { caso: 2 };
  return { caso: 3 };
}

// ── qué corre de verdad ────────────────────────────────────────────────────

/** Qué variable de Compose lleva la imagen de cada servicio del conjunto. */
export const VARIABLES = [["db", "IMAGEN_DB"], ["migracion", "IMAGEN_ADMIN"], ["web", "IMAGEN_WEB"], ["respaldo", "IMAGEN_RESPALDO"], ["proxy", "IMAGEN_PROXY"]] as const;
/** Los servicios que usan la imagen de otro. */
const HERMANOS: Record<string, string> = { consola: "migracion", comprobacion: "respaldo" };
const IMAGEN = /^sha256:[0-9a-f]{64}$/;
const esPropio = (servicio: string): boolean => VARIABLES.some(([propio]) => propio === servicio) || Object.hasOwn(HERMANOS, servicio);
/** Lo que se declara «de fuera» no puede ser un servicio de este sistema: sería sacarlo del inventario. */
function exigirDeFuera(deFuera: readonly string[]): void {
  for (const servicio of deFuera) if (esPropio(servicio)) throw new Error(`${servicio} es de este sistema: no se puede declarar de fuera.`);
}

/**
 * De la configuración resuelta de un conjunto (`docker compose config --format json`), la imagen
 * de cada servicio. Cada una va por su identificador inmutable —un nombre con etiqueta puede
 * apuntar mañana a otra cosa—, ninguna trae cómo construirse, y la aplicación dice qué publicación contesta.
 */
export function imagenesDe(configuracion: string, publicacion: string, deFuera: readonly string[] = []): Record<string, string> {
  const noEs = new Error("Lo que llegó no es la configuración resuelta de Compose (docker compose config --format json).");
  let servicios: Record<string, { image?: unknown; build?: unknown; environment?: Record<string, unknown> }>;
  try {
    servicios = JSON.parse(configuracion)?.services;
  } catch {
    throw noEs;
  }
  if (typeof servicios !== "object" || servicios === null) throw noEs;
  // El conjunto es el que es. Un servicio de más no entraría al inventario de imágenes: nadie lo
  // guardaría fuera ni lo miraría al comprobar qué corre, y podría ir por etiqueta. Solo en un
  // ensayo corre junto lo que en el servidor está fuera, y entonces se dice cuál es.
  exigirDeFuera(deFuera);
  for (const servicio of Object.keys(servicios)) {
    if (!esPropio(servicio) && !deFuera.includes(servicio)) {
      throw new Error(`En la configuración, ${servicio} no es un servicio de este sistema: lo que corre en operación es el conjunto, y nada más.`);
    }
  }
  const imagenes: Record<string, string> = {};
  for (const [servicio] of VARIABLES) {
    const imagen = servicios[servicio]?.image;
    if (typeof imagen !== "string" || !IMAGEN.test(imagen)) {
      throw new Error(`En la configuración, ${servicio} no va por el identificador de su imagen (sha256:…): un nombre con etiqueta puede apuntar mañana a otra cosa.`);
    }
    imagenes[servicio] = imagen;
  }
  for (const [servicio, s] of Object.entries(servicios)) {
    const hermano = Object.hasOwn(HERMANOS, servicio) ? HERMANOS[servicio] : undefined;
    if (hermano !== undefined && s.image !== imagenes[hermano]) throw new Error(`En la configuración, ${servicio} no usa la misma imagen que ${hermano}.`);
    if ((hermano !== undefined || Object.hasOwn(imagenes, servicio)) && s.build !== undefined) {
      throw new Error(`En la configuración, ${servicio} trae cómo construirse: en operación se levanta lo ya construido, y nada más.`);
    }
  }
  const version = servicios.web!.environment?.VERSION;
  if (version !== publicacion) throw new Error(`La configuración no dice que contesta esta publicación: VERSION es ${JSON.stringify(version ?? null)}.`);
  return imagenes;
}

/** Lo que aquí se mira de un contenedor, como lo describe `docker inspect`. */
interface Contenedor {
  Image?: string;
  State?: { Running?: boolean; Health?: { Status?: string } };
  Config?: { Labels?: Record<string, string> };
}

/**
 * Lo que no coincide entre lo que corre y un conjunto. De cada servicio que se pide mirar: que
 * haya un contenedor y solo uno, andando y sano, con la imagen del manifiesto y con la
 * configuración que se guardó (su huella, la que Compose le pone al crearlo).
 *
 * Así comprueba un paso intermedio: mira lo que se le pide. Con `nadaMas` comprueba el conjunto
 * completo: `contenedores` son entonces todos los de la instalación, y cualquiera que corra sin
 * que se le esperara es una falta. No cuentan los de un «run», ni —en un ensayo— lo que se
 * declaró de fuera.
 */
export function faltasDeLoQueCorre(
  imagenes: Record<string, string>, esperado: Record<string, string>, contenedores: Contenedor[], o: { nadaMas?: boolean; deFuera?: readonly string[] } = {},
): string[] {
  const faltas: string[] = [];
  for (const [servicio, huella] of Object.entries(esperado)) {
    const imagen = Object.hasOwn(imagenes, servicio) ? imagenes[servicio] : undefined;
    if (imagen === undefined) {
      faltas.push(`${servicio} no es parte de este conjunto`);
      continue;
    }
    const suyos = contenedores.filter((c) => c.Config?.Labels?.["com.docker.compose.service"] === servicio && c.Config.Labels["com.docker.compose.oneoff"] !== "True");
    if (suyos.length === 0) faltas.push(`${servicio} no está corriendo: no hay contenedor`);
    else if (suyos.length > 1) faltas.push(`hay ${suyos.length} contenedores de ${servicio}`);
    else {
      const c = suyos[0]!;
      if (c.State?.Running !== true) faltas.push(`${servicio} no está corriendo: su contenedor está detenido`);
      else if (c.State.Health?.Status !== undefined && c.State.Health.Status !== "healthy") faltas.push(`${servicio} no está sano (${c.State.Health.Status})`);
      if (c.Image !== imagen) faltas.push(`${servicio} corre con otra imagen que la del manifiesto`);
      if (c.Config?.Labels?.["com.docker.compose.config-hash"] !== huella) faltas.push(`${servicio} corre con otra configuración que la que se guardó`);
    }
  }
  if (o.nadaMas) {
    const deMas = new Set<string>();
    for (const c of contenedores) {
      const servicio = c.Config?.Labels?.["com.docker.compose.service"] ?? "un contenedor sin servicio";
      if (c.State?.Running === true && c.Config?.Labels?.["com.docker.compose.oneoff"] !== "True" && !Object.hasOwn(esperado, servicio) && !(o.deFuera ?? []).includes(servicio)) {
        deMas.add(servicio);
      }
    }
    for (const servicio of deMas) faltas.push(`corre ${servicio}, que aquí no se esperaba`);
  }
  return faltas;
}

// ── la consola ─────────────────────────────────────────────────────────────

async function entradaEstandar(): Promise<string> {
  let texto = "";
  for await (const trozo of process.stdin) texto += trozo;
  return texto;
}

/** Lo que dice la base, como lo imprime `operacion.ts estado`; o que no contesta. */
function evidenciaDe(estado: string): Evidencia["base"] | "sin mantenimiento" {
  if (estado === "no-contesta") return "no contesta";
  let e: { base?: unknown };
  try {
    e = JSON.parse(estado);
  } catch {
    throw new Error("El estado de la base no se entiende: se esperaba lo que imprime «operacion.ts estado».");
  }
  if (e?.base === "no hay" || e?.base === "sin mantenimiento") return e.base;
  const b = e?.base as Partial<DeLaBase> | undefined;
  if (
    typeof b !== "object" || b === null || typeof b.marca !== "string" || !UUID.test(b.marca) || typeof b.abierta !== "boolean" ||
    (b.publicacion !== null && typeof b.publicacion !== "string") || typeof b.decidida !== "boolean" || typeof b.abrio !== "boolean"
  ) {
    throw new Error("El estado de la base no se entiende: se esperaba lo que imprime «operacion.ts estado».");
  }
  return { marca: b.marca, abierta: b.abierta, publicacion: b.publicacion, decidida: b.decidida, abrio: b.abrio };
}

const DE_ANTES = "La base es de antes del mantenimiento: todavía no tiene dónde cerrarse. Instalarlo es un procedimiento aparte (ver la guía).";

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [carpeta, orden, ...resto] = process.argv.slice(2);
  const args = resto.filter((x) => !x.startsWith("--"));
  const opciones = resto.filter((x) => x.startsWith("--"));
  const uso = (): never => {
    console.error(
      "Uso: node operacion/publicacion.ts <carpeta> identificador <commit> | crear <publicación> <commit> <estado> [--de-fuera=…] | marcar <publicación> <marca> | " +
        "respaldo <publicación> <nombre> | vigia <publicación> si|no | base <publicación> <marca> | cerrar <publicación> <cómo> [<marca>] | pendiente | " +
        "vigente [publicacion|commit|marca|configuracion] | dato <publicación> <campo> | variables <publicación> candidato|anterior | variables vigente | " +
        "conjunto <publicación> [--de-fuera=…] | decidir <publicación> <estado> | corre <publicación> candidato|anterior [--nada-mas] [--de-fuera=…] <servicio=huella>… | " +
        "vuelta <publicación> [detener|apartar|restaurar|levantar antes|despues [<detalle>]]",
    );
    process.exit(2);
  };
  // Las opciones que admite cada orden. Una que no es de esa orden no se pasa por alto: no hace nada, y dice cómo se usa.
  const DE_FUERA = /^--de-fuera=([a-z0-9_-]+(?:,[a-z0-9_-]+)*)$/;
  const admite = (opcion: string): boolean =>
    (DE_FUERA.test(opcion) && ["crear", "conjunto", "corre"].includes(orden!)) || (opcion === "--nada-mas" && orden === "corre");
  if (!opciones.every(admite) || new Set(opciones.map((o) => o.split("=")[0])).size !== opciones.length) uso();
  const deFuera = opciones.flatMap((o) => DE_FUERA.exec(o)?.[1]?.split(",") ?? []);
  const cuantos: Record<string, (n: number) => boolean> = {
    identificador: (n) => n === 1, crear: (n) => n === 3, marcar: (n) => n === 2, respaldo: (n) => n === 2, vigia: (n) => n === 2, base: (n) => n === 2,
    cerrar: (n) => n === 2 || n === 3, pendiente: (n) => n === 0, vigente: (n) => n <= 1, dato: (n) => n === 2, variables: (n) => n === 1 || n === 2,
    conjunto: (n) => n === 1, decidir: (n) => n === 2, corre: (n) => n >= 3, vuelta: (n) => n === 1 || n === 3 || n === 4,
  };
  if (!carpeta || !orden || !cuantos[orden]?.(args.length)) uso();
  const [a, b, c] = args as [string, string, string];
  if (orden === "marcar" && !MARCAS.includes(b as Marca)) uso();
  if (orden === "vigia" && b !== "si" && b !== "no") uso();
  if (orden === "cerrar" && !CIERRES.includes(b as ComoCierra)) uso();
  if (orden === "vigente" && a !== undefined && !["publicacion", "commit", "marca", "configuracion"].includes(a)) uso();
  if (orden === "variables" && !(args.length === 1 ? a === "vigente" : b === "candidato" || b === "anterior")) uso();
  if (orden === "corre" && ((b !== "candidato" && b !== "anterior") || args.slice(2).some((par) => !/^[a-z_]+=[0-9a-f]+$/.test(par)))) uso();
  if (orden === "vuelta" && args.length > 1 && (!PASOS_DE_VUELTA.includes(b as PasoDeVuelta) || (c !== "antes" && c !== "despues"))) uso();

  /** Lo que corre con ese conjunto, o con el vigente: sus variables. */
  const variables = (imagenes: Record<string, string>, version: string): string =>
    [...VARIABLES.filter(([servicio]) => imagenes[servicio] !== undefined).map(([servicio, variable]) => `${variable}=${imagenes[servicio]}`), `VERSION=${version}`].join("\n");
  /** El conjunto de esa publicación que se pide, con la publicación que contesta en él. */
  const conjuntoDe = (m: Manifiesto, cual: string): { imagenes: Record<string, string>; version: string } => {
    if (cual === "candidato") return { imagenes: m.candidato.imagenes, version: m.publicacion };
    if (m.anterior === null) throw new Error(`La publicación ${m.publicacion} no tiene conjunto anterior: es la primera.`);
    return { imagenes: m.anterior.imagenes, version: m.anterior.publicacion };
  };

  try {
    const conPublicacion = !["identificador", "pendiente", "vigente"].includes(orden!) && !(orden === "variables" && args.length === 1);
    if (conPublicacion && !PUBLICACION.test(a)) throw new Error(`«${a}» no es el identificador de una publicación`);
    exigirDeFuera(deFuera);
    if (orden === "identificador") console.log(identificador(new Date(), a));
    else if (orden === "crear") {
      const base = evidenciaDe(c);
      if (base === "no contesta") throw new Error("La base no contesta: no se escribe una publicación sin saber sobre qué base.");
      if (base === "sin mantenimiento") throw new Error(DE_ANTES);
      if (base !== "no hay" && !base.abierta) {
        throw new Error(`La operación está cerrada (por la publicación ${base.publicacion}) y no hay ninguna publicación sin cerrar: no se publica hasta saber por qué.`);
      }
      const configuracion = await entradaEstandar();
      await crear(carpeta!, {
        publicacion: a, commit: b, configuracion,
        base: base === "no hay" ? { marca: null, publicacion: null } : { marca: base.marca, publicacion: base.publicacion },
        candidato: { imagenes: imagenesDe(configuracion, a, deFuera), configuracion: `${a}/conjunto.json`, esquema: ESQUEMA_ESPERADO },
      });
    } else if (orden === "marcar") await marcar(carpeta!, a, b as Marca);
    else if (orden === "respaldo") await anotarRespaldo(carpeta!, a, b);
    else if (orden === "vigia") await anotarVigia(carpeta!, a, b === "si");
    else if (orden === "base") await fijarBase(carpeta!, a, b);
    else if (orden === "cerrar") await cerrar(carpeta!, a, b as ComoCierra, c === undefined ? {} : { marca: c });
    else if (orden === "pendiente") {
      const m = await pendiente(carpeta!);
      if (m) console.log(m.publicacion);
    } else if (orden === "vigente") {
      const v = await vigente(carpeta!);
      if (v) console.log({ publicacion: v.publicacion, commit: v.commit, marca: v.base.marca, configuracion: v.conjunto.configuracion }[a ?? "publicacion"]);
    } else if (orden === "dato") {
      let dato: unknown = await leer(carpeta!, a);
      for (const parte of b.split(".")) dato = dato === null || typeof dato !== "object" ? undefined : (dato as Record<string, unknown>)[parte];
      if (typeof dato === "object" && dato !== null) throw new Error(`«${b}» no es un dato suelto del manifiesto`);
      if (dato !== null && dato !== undefined) console.log(String(dato));
    } else if (orden === "variables") {
      if (args.length === 1) {
        const v = await vigente(carpeta!);
        if (!v) throw new Error("Todavía no se ha publicado nada en esta instalación.");
        console.log(variables(v.conjunto.imagenes, v.publicacion));
      } else {
        const { imagenes, version } = conjuntoDe(await leer(carpeta!, a), b);
        console.log(variables(imagenes, version));
      }
    } else if (orden === "conjunto") {
      const m = await leer(carpeta!, a);
      const configuracion = await entradaEstandar();
      const imagenes = imagenesDe(configuracion, a, deFuera);
      if (JSON.stringify(Object.entries(imagenes).sort()) !== JSON.stringify(Object.entries(m.candidato.imagenes).sort())) {
        throw new Error(`Las imágenes de esa configuración no son las imágenes de esa publicación (${a}). No se guardó.`);
      }
      await escribirDurable(join(carpeta!, m.candidato.configuracion), configuracion);
    } else if (orden === "vuelta") {
      if (args.length === 1) {
        const v = await vuelta(carpeta!, a);
        for (const paso of PASOS_DE_VUELTA) {
          const p = v?.pasos[paso];
          if (p) console.log([paso, p.despues ? "hecho" : "empezado", ...(p.detalle ? [p.detalle] : [])].join(" "));
        }
      } else await anotarPaso(carpeta!, a, b as PasoDeVuelta, c as "antes" | "despues", args[3]);
    } else if (orden === "decidir") {
      const base = evidenciaDe(b);
      const d: Decision = base === "sin mantenimiento" ? { detenerse: DE_ANTES } : decidir(await leer(carpeta!, a), { base });
      if ("detenerse" in d) {
        console.error(d.detenerse);
        process.exit(3);
      }
      console.log(d.caso === 1 ? `1 ${d.conjunto}` : String(d.caso));
    } else {
      const { imagenes } = conjuntoDe(await leer(carpeta!, a), b);
      let contenedores: Contenedor[];
      try {
        contenedores = JSON.parse(await entradaEstandar());
        if (!Array.isArray(contenedores)) throw new Error("no es una lista");
      } catch {
        throw new Error("Lo que llegó por la entrada estándar no es lo que imprime docker inspect.");
      }
      const esperado = Object.fromEntries(args.slice(2).map((par) => par.split("=") as [string, string]));
      const faltas = faltasDeLoQueCorre(imagenes, esperado, contenedores, { nadaMas: opciones.includes("--nada-mas"), deFuera });
      if (faltas.length > 0) throw new Error(`Lo que corre no es ese conjunto:\n  · ${faltas.join("\n  · ")}`);
    }
  } catch (e) {
    console.error((e as Error).message);
    process.exit(1);
  }
}
