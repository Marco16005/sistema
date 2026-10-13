// El respaldo diario, que se guarda un año.
//
// Los respaldos de cada hora viven 30 días en su depósito. De cada día se guarda además uno en
// otro depósito, que los conserva 365: el candado de retención lo da el depósito a cada objeto que
// recibe, así que cada plazo tiene el suyo. Dentro, los nombres y los manifiestos son los mismos:
// el programa que lista, baja y comprueba sirve para los dos.
//
// Cuál es «el diario» de un día: el primer respaldo de cada hora que salió bien ese día, contando
// el día en la hora del patio y a partir de su instantánea (las carpetas de los nombres van en
// hora universal: no sirven para esto). «Salió bien» se comprueba antes de elegirlo: su manifiesto
// es válido y el archivo, bajado, coincide con su huella. Uno dañado se salta, y se prueba el que sigue.
//
// Se elige una vez y no cambia. La elección se decide en la base —que es donde está el turno de los
// respaldos—: ahí se escribe una sola vez, y quien llega segundo recibe la del primero. Todo lo que
// después se escribe en el depósito diario sale de esa elección; por eso una escritura que llega
// tarde —la de una corrida que ya perdió el turno— escribe lo mismo que escribiría cualquiera, y
// no puede cambiar cuál es el diario. La elección se deja escrita también en el propio depósito
// diario, antes de subir nada: si la base se pierde y vuelve de un respaldo de antes, se toma de
// ahí. Un reintento sube ese mismo, no el más nuevo; y si el elegido deja de servir, se avisa del
// hueco en vez de poner otro en su lugar sin decirlo.
//
// «Ese día ya tiene su diario» quiere decir un par comprobado, no un nombre en la lista: su
// manifiesto es válido y el archivo, bajado, coincide con su huella. Bajar cada diario en cada
// corrida sería demasiado: lo comprobado se recuerda mientras el servicio corre, y se vuelve a
// comprobar cada semana —cuatro veces antes de que venza su original, que es con lo que se podría
// reponer—. Los diarios que ya no tienen original también se repasan, uno por corrida y por
// turnos: si alguno ya no coincide con su huella, no hay con qué reponerlo, y se avisa; y uno que
// no se deja leer no les quita su turno a los demás.
//
// Un día sin ningún respaldo que sirva no se puede reconstruir: se avisa del hueco. El aviso se da
// por dado cuando el vigilante lo recibió —y entonces se anota, para no repetirlo cada hora—; que
// esté anotado no cierra el día: mientras sus respaldos de cada hora existan, cada corrida vuelve
// a mirar, y si aparece con qué, el día recibe su diario.
//
// Los días se recorren de corrido, desde el primero del que se sabe algo —un respaldo, una
// elección, un diario— hasta hoy: uno de en medio sin nada también es un hueco. El que ya tiene su
// diario y ya no tiene original no se vuelve a resolver: de ese se ocupa el repaso.
//
// Cada día se resuelve por separado: uno que no se puede resolver —su elección no se lee, el
// depósito tropieza con él— no detiene a los demás. Y cada corrida tiene un tiempo, que vale
// también dentro de un día: cada subida, bajada y listado recibe lo que queda, y con el tiempo
// vencido no se empieza nada más. Lo que no alcance queda para la siguiente —que sigue desde lo
// que ya quedó escrito—, sin retrasar el respaldo de la hora; y si a un mismo día se le acaba el
// tiempo en dos corridas seguidas, se dice: «pendiente» no puede ser para siempre.
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ManifiestoInvalido, huellaDe, leerManifiesto, nombreDeManifiesto, respaldosEntre, selloDelDestino } from "./destino.ts";
import type { Destino, Manifiesto, Respaldado } from "./destino.ts";

const formatos = new Map<string, Intl.DateTimeFormat>();

/** El día del calendario del patio en que cae ese instante, como AAAA-MM-DD. */
export function diaDelPatio(momento: Date, zona: string): string {
  let formato = formatos.get(zona);
  if (!formato) {
    formato = new Intl.DateTimeFormat("en-CA", { timeZone: zona, year: "numeric", month: "2-digit", day: "2-digit" });
    formatos.set(zona, formato);
  }
  return formato.format(momento);
}

/** Los días del calendario de uno a otro, los dos incluidos. */
function diasEntre(desde: string, hasta: string): string[] {
  const dias: string[] = [];
  for (let d = new Date(`${desde}T00:00:00Z`); d.toISOString().slice(0, 10) <= hasta; d = new Date(d.getTime() + 24 * 3_600_000)) {
    dias.push(d.toISOString().slice(0, 10));
  }
  return dias;
}

/** Cada cuánto se vuelve a bajar y comparar un diario que todavía tiene su original, en milisegundos. */
export const REVALIDAR_CADA = 7 * 24 * 3_600_000;
/** Cada cuánto se repasa un diario que ya no lo tiene. */
export const REPASAR_CADA = 30 * 24 * 3_600_000;
/** Cuánto puede tardar una corrida, si no se dice otra cosa. */
const PRESUPUESTO = 20 * 60_000;
/** El plazo de subir o bajar algo chico —una elección, un manifiesto, una anotación—: si no pasa en esto, el depósito no está contestando. */
const NOTA = 60_000;

/** Un diario que este proceso ya bajó y comprobó: mientras la lista lo muestre igual, y no haya pasado una semana, no se vuelve a bajar. */
export interface Comprobado {
  objeto: string;
  bytes: number;
  bytesDelManifiesto: number;
  /** Cuándo se comprobó. */
  cuando: number;
}

/** Lo que este proceso recuerda del depósito diario. El servicio lo conserva de una corrida a otra; al reiniciar empieza vacío. */
export interface Comprobados {
  /** Por día: el diario comprobado. */
  dias: Map<string, Comprobado>;
  /** Por objeto: cuándo se repasó —se bajó y se comparó— un diario que ya no tiene original. */
  repasados: Map<string, number>;
  /** Por objeto: cuándo se intentó repasarlo, saliera o no. Con esto se turnan: el que no se deja leer no acapara. */
  intentados: Map<string, number>;
  /** Por objeto: el repaso que no se pudo hacer, y por qué. Se sigue diciendo hasta que salga. */
  tropiezos: Map<string, string>;
  /** Por día: el diario sin original que ya no coincide con su huella. Se avisa hasta que el vigilante se entere. */
  danados: Map<string, { objeto: string; motivo: string }>;
  /** Los días de cuyo hueco ya se sabe que el vigilante se enteró. */
  avisados: Set<string>;
  /** Por día: en cuántas corridas seguidas —de las de siempre, no la corta del arranque— se le acabó el tiempo a la mitad. */
  sinAlcanzar: Map<string, number>;
}

export const sinComprobar = (): Comprobados => ({
  dias: new Map(), repasados: new Map(), intentados: new Map(), tropiezos: new Map(), danados: new Map(), avisados: new Set(), sinAlcanzar: new Map(),
});

export interface AlDia {
  /** Los diarios que esta corrida subió. */
  subidos: Array<{ dia: string; objeto: string }>;
  /** Los días sin diario de los que el vigilante todavía no se ha enterado. Avisado, se anota con `anotarAvisados`. */
  huecos: Array<{ dia: string; motivo: string }>;
  /** Los días que esta corrida no pudo resolver, y por qué. Se reintentan en la siguiente. */
  fallas: Array<{ dia: string; motivo: string }>;
  /** Cuántos días quedaron para la corrida siguiente porque a esta se le acabó el tiempo. */
  pendientes: number;
}

/** Cuál respaldo de cada hora es el diario de ese día. */
export interface Eleccion {
  formato: 1;
  dia: string;
  objeto: string;
  bytes: number;
  sha256: string;
}

/**
 * Donde queda decidida la elección de cada día: la base. Se escribe una sola vez y no se cambia; lo
 * que hay en el depósito diario sale de aquí, no al revés.
 */
export interface Elecciones {
  /** La elección de ese día, si ya la hay. */
  de(dia: string): Promise<Eleccion | null>;
  /** Deja esa elección si el día todavía no tiene, y devuelve la que quedó: esa, o la que llegó antes. */
  fijar(eleccion: Eleccion): Promise<Eleccion>;
}

const copia = (e: Eleccion): Eleccion => ({ formato: 1, dia: e.dia, objeto: e.objeto, bytes: e.bytes, sha256: e.sha256 });
const laMisma = (a: Eleccion, b: Eleccion): boolean => a.dia === b.dia && a.objeto === b.objeto && a.bytes === b.bytes && a.sha256 === b.sha256;

/** Las elecciones, en la memoria de un proceso: para las pruebas de la decisión, que no llevan base. */
export function eleccionesEnMemoria(): Elecciones {
  const fijadas = new Map<string, Eleccion>();
  return {
    de: async (dia) => {
      const e = fijadas.get(dia);
      return e ? copia(e) : null;
    },
    fijar: async (eleccion) => {
      if (!fijadas.has(eleccion.dia)) fijadas.set(eleccion.dia, copia(eleccion));
      return copia(fijadas.get(eleccion.dia)!);
    },
  };
}

/** Lo escrito en el depósito diario como elección de ese día, si se lee y es de ese día. Si no, nada. */
function leerEleccion(texto: string, dia: string): Eleccion | null {
  let e: Partial<Eleccion> | null;
  try {
    e = JSON.parse(texto) as Partial<Eleccion>;
  } catch {
    return null;
  }
  if (!e || e.formato !== 1 || e.dia !== dia || typeof e.objeto !== "string" || typeof e.bytes !== "number" || !Number.isSafeInteger(e.bytes) ||
      typeof e.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(e.sha256)) return null;
  return copia(e as Eleccion);
}

const eleccionDe = (dia: string): string => `elecciones/${dia}.json`;
const huecoDe = (dia: string): string => `elecciones/${dia}.hueco.json`;
const ELECCION = /^elecciones\/(\d{4}-\d{2}-\d{2})\.json$/;

/** El elegido ya no está en el depósito de cada hora, o ya no es el que se eligió. No es lo mismo que no haber podido leerlo. */
class YaNoSirve extends Error {}
/** A la corrida se le acabó el tiempo: no se empieza nada más. No es una falla: sigue la corrida siguiente. */
class SinTiempo extends Error {}

export interface Pendiente {
  /** El depósito de los respaldos de cada hora. */
  origen: Destino;
  /** El depósito de los diarios. */
  diario: Destino;
  /** La zona horaria del patio: en ella se cuenta el día. */
  zona: string;
  ahora: Date;
  /** Lo que este proceso ya comprobó. Vacío al arrancar. */
  comprobados: Comprobados;
  /** Donde queda decidida la elección de cada día: la base. */
  elecciones: Elecciones;
  /**
   * Comprueba que quien corre esto sigue teniendo el turno de los respaldos, y falla si lo perdió.
   * Se llama antes de escribir cualquier cosa en el depósito diario: con el turno perdido no tiene
   * caso seguir. No es lo que impide dos diarios —eso lo impide que la elección sea una, en la
   * base—: una escritura que ya salió no se detiene preguntando.
   */
  turno?: () => Promise<void>;
  /** Cuánto puede tardar esta corrida, en milisegundos. Lo que no alcance queda para la siguiente. */
  presupuesto?: number;
  /** El reloj con que se mide ese tiempo. */
  reloj?: () => number;
  decir?: (linea: string) => void;
}

/**
 * Pone al día el depósito diario: a cada día que todavía tiene respaldos de cada hora y no tiene su
 * diario, se lo sube. Un diario que falló el lunes se recupera el martes, o cuando vuelva el
 * depósito. Se llama con el turno de los respaldos tomado: dos corridas a la vez no ven las dos el
 * día vacío.
 *
 * Si un depósito no deja ni listarlo, falla sin haber marcado nada: se reintenta en la corrida siguiente.
 */
export async function ponerAlDia(p: Pendiente): Promise<AlDia> {
  const decir = p.decir ?? (() => {});
  const reloj = p.reloj ?? Date.now;
  const empezo = reloj();
  const total = p.presupuesto ?? PRESUPUESTO;
  const queda = (): number => total - (reloj() - empezo);
  /** El plazo de subir, bajar o listar algo grande: lo que quede de la corrida, y al menos un minuto. */
  const plazo = (): number => Math.max(NOTA, queda());
  /** Con el tiempo vencido no se empieza nada más. */
  const aTiempo = (): void => {
    if (queda() <= 0) throw new SinTiempo("se acabó el tiempo de la corrida");
  };
  const turno = p.turno ?? (async () => {});
  const hoy = diaDelPatio(p.ahora, p.zona);
  const ahora = p.ahora.getTime();
  const deCadaHora = respaldosEntre(await p.origen.listar(plazo()));
  const enDiario = await p.diario.listar(plazo());
  const tamano = new Map(enDiario.map((e) => [e.nombre, e.bytes]));
  const pares = respaldosEntre(enDiario);
  const diarios = new Map(pares.map((r) => [r.objeto, r]));

  // Los de cada hora, por día del patio y en orden.
  const porDia = new Map<string, Respaldado[]>();
  for (const r of deCadaHora) {
    const dia = diaDelPatio(r.momento, p.zona);
    if (!porDia.has(dia)) porDia.set(dia, []);
    porDia.get(dia)!.push(r);
  }
  const diasConPar = new Set(pares.map((r) => diaDelPatio(r.momento, p.zona)));
  // Los días por mirar: de corrido, desde el primero del que se sabe algo —tiene un respaldo de cada
  // hora, una elección escrita o un diario— hasta hoy, sin saltarse ninguno: un día de en medio sin
  // nada también cuenta. (Hasta hoy: un respaldo «del futuro» —un reloj adelantado— no es de ningún
  // día todavía.) El que ya tiene su diario y ya no tiene original no se resuelve aquí: no hay con
  // qué, y de que siga entero se ocupa el repaso.
  const sabidos = [...porDia.keys(), ...diasConPar];
  for (const e of enDiario) {
    const dia = ELECCION.exec(e.nombre)?.[1];
    if (dia !== undefined) sabidos.push(dia);
  }
  const primero = sabidos.filter((dia) => dia <= hoy).sort()[0];
  const dias = primero === undefined ? [] : diasEntre(primero, hoy).filter((dia) => porDia.has(dia) || !diasConPar.has(dia));
  const hecho: AlDia = { subidos: [], huecos: [], fallas: [], pendientes: 0 };
  if (dias.length === 0 && pares.length === 0) return hecho;

  const carpeta = await mkdtemp(join(tmpdir(), "feruga-respaldo-"));
  const escribir = async (nombre: string, contenido: unknown): Promise<void> => {
    await turno();
    const texto = JSON.stringify(contenido, null, 2) + "\n";
    const [archivo, devuelto] = [join(carpeta, "nota.json"), join(carpeta, "nota.devuelta.json")];
    await writeFile(archivo, texto);
    await p.diario.subir(archivo, nombre, NOTA);
    await p.diario.bajar(nombre, devuelto, NOTA);
    if ((await readFile(devuelto, "utf8")) !== texto) throw new Error(`lo que quedó en el depósito diario bajo ${nombre} no es lo que se subió`);
  };
  /** ¿El vigilante ya se enteró del hueco de ese día? Lo dice su anotación, si se lee y es la suya. */
  const yaAvisado = async (dia: string): Promise<boolean> => {
    if (p.comprobados.avisados.has(dia)) return true;
    if (!tamano.has(huecoDe(dia))) return false;
    const archivo = join(carpeta, "hueco.json");
    await p.diario.bajar(huecoDe(dia), archivo, NOTA);
    let nota: { formato?: unknown; dia?: unknown; avisado?: unknown } | null = null;
    try {
      nota = JSON.parse(await readFile(archivo, "utf8"));
    } catch {
      nota = null;
    }
    // Una anotación que no se lee no acredita que alguien se haya enterado: se avisa otra vez.
    if (!nota || nota.formato !== 1 || nota.dia !== dia || typeof nota.avisado !== "string") return false;
    p.comprobados.avisados.add(dia);
    return true;
  };
  const sinDiario = async (dia: string, motivo: string): Promise<void> => {
    if (await yaAvisado(dia)) return;
    decir(`Sin respaldo diario del ${dia}: ${motivo}. Mientras no aparezca con qué, ese día no se puede reconstruir.`);
    hecho.huecos.push({ dia, motivo });
  };
  /** Baja el manifiesto de ese respaldo a un archivo y lo valida. Devuelve lo que dice, y el archivo tal como bajó. */
  const manifiestoDe = async (destino: Destino, de: Respaldado, archivo: string): Promise<Manifiesto> => {
    await destino.bajar(nombreDeManifiesto(de.objeto), archivo, NOTA);
    return leerManifiesto(await readFile(archivo, "utf8"), de, selloDelDestino(destino));
  };
  const coincide = async (archivo: string, con: { bytes: number; sha256: string }): Promise<boolean> => {
    const h = await huellaDe(archivo);
    return h.bytes === con.bytes && h.sha256 === con.sha256;
  };
  const elegido = join(carpeta, "elegido.age");
  const suManifiesto = join(carpeta, "elegido.manifiesto.json");
  /**
   * Trae del depósito de cada hora el manifiesto de ese respaldo, validado; si ya hay una elección,
   * tiene que decir lo mismo que ella. Si no, `YaNoSirve`. Si el depósito no contesta, falla con
   * otra cosa: no poder leer no es estar dañado.
   */
  const traerSuManifiesto = async (de: Respaldado, eleccion?: Eleccion): Promise<Manifiesto> => {
    let m: Manifiesto;
    try {
      m = await manifiestoDe(p.origen, de, suManifiesto);
    } catch (e) {
      if (e instanceof ManifiestoInvalido) throw new YaNoSirve();
      throw e;
    }
    if (eleccion && (m.sha256 !== eleccion.sha256 || m.bytes !== eleccion.bytes)) throw new YaNoSirve();
    return m;
  };
  /** Trae ese respaldo entero, comprobado: su manifiesto, y el archivo, que coincide con su huella. Si no, `YaNoSirve`. */
  const traer = async (de: Respaldado, eleccion?: Eleccion): Promise<Manifiesto> => {
    const m = await traerSuManifiesto(de, eleccion);
    await p.origen.bajar(de.objeto, elegido, plazo());
    if (!(await coincide(elegido, m))) throw new YaNoSirve();
    return m;
  };
  /**
   * Los respaldos de ese día, del primero al último según su instantánea. Los nombres de ahora
   * llevan el milisegundo y ya vienen en orden; entre los de antes —al segundo— que caen en el
   * mismo segundo, el orden lo dice el manifiesto de cada uno.
   */
  const enSuOrden = async (delDia: Respaldado[]): Promise<Respaldado[]> => {
    const orden: Respaldado[] = [];
    for (let k = 0; k < delDia.length;) {
      const segundo = Math.floor(delDia[k]!.momento.getTime() / 1000);
      const grupo: Respaldado[] = [];
      while (k < delDia.length && Math.floor(delDia[k]!.momento.getTime() / 1000) === segundo) grupo.push(delDia[k++]!);
      if (grupo.length === 1 || grupo.every((r) => r.preciso)) {
        orden.push(...grupo);
        continue;
      }
      const conMomento: Array<{ r: Respaldado; t: number }> = [];
      for (const r of grupo) {
        try {
          conMomento.push({ r, t: Date.parse((await manifiestoDe(p.origen, r, join(carpeta, "orden.json"))).instantanea) });
        } catch (e) {
          if (!(e instanceof ManifiestoInvalido)) throw e;      // uno sin manifiesto válido no es candidato
        }
      }
      conMomento.sort((x, y) => x.t - y.t || (x.r.objeto < y.r.objeto ? -1 : 1));
      orden.push(...conMomento.map((c) => c.r));
    }
    return orden;
  };

  const resolver = async (dia: string): Promise<void> => {
    const ya = p.comprobados.dias.get(dia);
    if (ya && tamano.get(ya.objeto) === ya.bytes && tamano.get(nombreDeManifiesto(ya.objeto)) === ya.bytesDelManifiesto && ahora - ya.cuando < REVALIDAR_CADA) return;
    p.comprobados.dias.delete(dia);

    // La elección: la de la base. Si la base no la tiene y quedó escrita en el depósito diario —la
    // base volvió de un respaldo de antes—, esa. Si no hay ninguna, el primero del día que de verdad
    // sirva; y se fija en la base antes de escribir nada: si otro llegó antes, vale la suya.
    let eleccion = await p.elecciones.de(dia);
    let escrita: Eleccion | null = null;
    if (tamano.has(eleccionDe(dia))) {
      const archivo = join(carpeta, "eleccion.json");
      await p.diario.bajar(eleccionDe(dia), archivo, NOTA);
      escrita = leerEleccion(await readFile(archivo, "utf8"), dia);
      if (!eleccion) {
        if (!escrita) throw new Error(`la elección del diario del ${dia} no se puede leer: no se elige otro respaldo sin que alguien lo vea`);
        eleccion = await p.elecciones.fijar(escrita);
      }
    }
    let traido = false;            // el elegido ya está aquí, bajado y comprobado
    if (!eleccion) {
      let propuesta: Eleccion | null = null;
      for (const candidato of await enSuOrden(porDia.get(dia) ?? [])) {
        aTiempo();
        try {
          const m = await traer(candidato);
          propuesta = { formato: 1, dia, objeto: candidato.objeto, bytes: m.bytes, sha256: m.sha256 };
          break;
        } catch (e) {
          if (!(e instanceof YaNoSirve)) throw e;               // no contestó: no es que esté dañado
        }
      }
      if (!propuesta) {
        // Hoy todavía puede llegar uno. Un día que ya terminó sin ninguno bueno, no —salvo que aparezca—.
        if (dia < hoy) await sinDiario(dia, "no tuvo ningún respaldo que sirva");
        return;
      }
      eleccion = await p.elecciones.fijar(propuesta);
      traido = laMisma(eleccion, propuesta);
    }
    // Lo escrito en el depósito sale de la base. Si falta, o dice otra cosa, o no se lee, se repone.
    if (!escrita || !laMisma(escrita, eleccion)) await escribir(eleccionDe(dia), eleccion);

    // ¿Ya está en el depósito diario, y es el elegido? Un par comprobado: manifiesto válido y archivo que coincide.
    const manifiestoDelDiario = join(carpeta, "del-diario.manifiesto.json");
    const delDiario = diarios.get(eleccion.objeto);
    const bajado = join(carpeta, "del-diario.age");
    let comprobado = false;
    if (delDiario) {
      try {
        const m = await manifiestoDe(p.diario, delDiario, manifiestoDelDiario);
        if (m.sha256 === eleccion.sha256 && m.bytes === eleccion.bytes) {
          aTiempo();
          await p.diario.bajar(eleccion.objeto, bajado, plazo());
          comprobado = await coincide(bajado, eleccion);
          await rm(bajado, { force: true });
        }
      } catch (e) {
        if (!(e instanceof ManifiestoInvalido)) throw e;
      }
    }
    if (comprobado) {
      p.comprobados.dias.set(dia, { objeto: eleccion.objeto, bytes: eleccion.bytes, bytesDelManifiesto: tamano.get(nombreDeManifiesto(eleccion.objeto))!, cuando: ahora });
      return;
    }

    // No está completo. Si de un intento anterior quedó el archivo sin su manifiesto, y es el elegido
    // —se baja y se compara—, no se sube otra vez: solo le falta el manifiesto. Así una corrida a la
    // que no le alcanzó el tiempo no empieza de cero en la siguiente.
    let yaSubido = false;
    if (!delDiario && tamano.get(eleccion.objeto) === eleccion.bytes) {
      aTiempo();
      await p.diario.bajar(eleccion.objeto, bajado, plazo());
      yaSubido = await coincide(bajado, eleccion);
      await rm(bajado, { force: true });
    }
    // Lo que falte se trae del depósito de cada hora, comprobado: el manifiesto, y el archivo si no está ya.
    if (!traido) {
      try {
        const de = deCadaHora.find((r) => r.objeto === eleccion!.objeto);
        if (!de) throw new YaNoSirve();
        aTiempo();
        if (yaSubido) await traerSuManifiesto(de, eleccion);
        else await traer(de, eleccion);
      } catch (e) {
        if (!(e instanceof YaNoSirve)) throw e;
        await sinDiario(dia, `el respaldo elegido para ese día (${eleccion.objeto}) ya no está en el depósito de cada hora, o ya no coincide con su huella`);
        return;
      }
    }
    // Se sube el mismo archivo cifrado con su manifiesto completo —nunca un apuntador al de cada
    // hora, que vence a los 30 días—, y se comprueba igual que un respaldo: bajándolo.
    if (!yaSubido) {
      aTiempo();
      await turno();
      await p.diario.subir(elegido, eleccion.objeto, plazo());
      aTiempo();
      const devuelto = join(carpeta, "devuelto.age");
      await p.diario.bajar(eleccion.objeto, devuelto, plazo());
      if (!(await coincide(devuelto, eleccion))) throw new Error(`lo que quedó en el depósito diario bajo ${eleccion.objeto} no coincide con lo que se subió`);
      await rm(devuelto, { force: true });
    }
    await rm(elegido, { force: true });
    // El manifiesto es chico, y es lo último: se termina aunque el tiempo ya esté justo.
    await turno();
    await p.diario.subir(suManifiesto, nombreDeManifiesto(eleccion.objeto), NOTA);
    await p.diario.bajar(nombreDeManifiesto(eleccion.objeto), manifiestoDelDiario, NOTA);
    const [subido, quedo] = [await readFile(suManifiesto), await readFile(manifiestoDelDiario)];
    if (!subido.equals(quedo)) throw new Error(`el manifiesto que quedó en el depósito diario para ${eleccion.objeto} no es el que se subió`);
    p.comprobados.dias.set(dia, { objeto: eleccion.objeto, bytes: eleccion.bytes, bytesDelManifiesto: subido.length, cuando: ahora });
    hecho.subidos.push({ dia, objeto: eleccion.objeto });
    decir(`Respaldo diario del ${dia}: ${eleccion.objeto}, subido y comprobado.`);
  };

  /**
   * Repasa un diario que ya no tiene original: su manifiesto se lee y el archivo coincide con él. Si
   * ya no, no hay con qué reponerlo: queda anotado como dañado, y se avisa. Van por turnos —primero
   * el que lleve más sin intentarse—: uno que no se deja leer queda dicho, y la corrida siguiente
   * sigue con otro.
   */
  const repasar = async (): Promise<void> => {
    const porRepasar = pares
      .filter((r) => !porDia.has(diaDelPatio(r.momento, p.zona)) && ahora - (p.comprobados.repasados.get(r.objeto) ?? 0) >= REPASAR_CADA)
      .map((r) => ({ r, intento: p.comprobados.intentados.get(r.objeto) ?? 0 }))
      .sort((x, y) => x.intento - y.intento || x.r.momento.getTime() - y.r.momento.getTime());
    const cual = porRepasar[0]?.r;
    if (!cual) return;
    const dia = diaDelPatio(cual.momento, p.zona);
    p.comprobados.intentados.set(cual.objeto, ahora);
    let entero = false;
    try {
      const m = await manifiestoDe(p.diario, cual, join(carpeta, "repaso.manifiesto.json"));
      const bajado = join(carpeta, "repaso.age");
      await p.diario.bajar(cual.objeto, bajado, plazo());
      entero = await coincide(bajado, m);
      await rm(bajado, { force: true });
    } catch (e) {
      if (!(e instanceof ManifiestoInvalido)) {
        p.comprobados.tropiezos.set(cual.objeto, `no se pudo repasar el respaldo diario del ${dia} (${cual.objeto}): ${(e as Error).message}`);
        return;
      }
    }
    p.comprobados.tropiezos.delete(cual.objeto);
    p.comprobados.repasados.set(cual.objeto, ahora);
    if (entero) p.comprobados.danados.delete(dia);
    else {
      p.comprobados.danados.set(dia, {
        objeto: cual.objeto, motivo: `el respaldo diario de ese día (${cual.objeto}) ya no coincide con su huella, y su original ya venció: no hay con qué reponerlo`,
      });
    }
  };

  try {
    for (const dia of dias) {
      if (queda() <= 0) {
        hecho.pendientes += 1;
        continue;
      }
      // Una corrida corta —la del arranque del servicio— no cuenta para decir que a un día no le alcanza el tiempo.
      const deLasDeSiempre = total >= PRESUPUESTO;
      try {
        await resolver(dia);
        p.comprobados.sinAlcanzar.delete(dia);
      } catch (e) {
        if (e instanceof SinTiempo || queda() <= 0) {
          // Se le acabó el tiempo a la mitad. Lo que ya quedó escrito sirve: la corrida siguiente sigue desde ahí.
          const veces = deLasDeSiempre ? (p.comprobados.sinAlcanzar.get(dia) ?? 0) + 1 : 0;
          if (deLasDeSiempre) p.comprobados.sinAlcanzar.set(dia, veces);
          if (veces < 2) hecho.pendientes += 1;
          else {
            const motivo = `en ${veces === 2 ? "dos" : veces} corridas seguidas el tiempo no alcanzó para este día: o el depósito está muy lento, o el respaldo ya no cabe en el tiempo de una corrida`;
            decir(`El respaldo diario del ${dia} no se pudo resolver: ${motivo}.`);
            hecho.fallas.push({ dia, motivo });
          }
          continue;
        }
        // Uno que no se pudo resolver no detiene a los demás: se dice, y se reintenta en la corrida siguiente.
        const motivo = (e as Error).message;
        decir(`El respaldo diario del ${dia} no se pudo resolver en esta corrida: ${motivo}.`);
        hecho.fallas.push({ dia, motivo });
      }
    }
    if (hecho.pendientes > 0) decir(`Se acabó el tiempo de esta corrida: ${hecho.pendientes === 1 ? "queda un día" : `quedan ${hecho.pendientes} días`} por poner al día en la siguiente.`);
    else if (queda() > 0) await repasar();
    // Lo que el repaso dejó dicho, de esta corrida o de las anteriores: los diarios dañados de los
    // que el vigilante todavía no se entera, y los repasos que no salieron. Lo que ya no está en el
    // depósito —venció— deja de decirse.
    for (const [dia, d] of [...p.comprobados.danados]) {
      if (!diarios.has(d.objeto)) p.comprobados.danados.delete(dia);
      else {
        try {
          await sinDiario(dia, d.motivo);
        } catch (e) {
          hecho.fallas.push({ dia, motivo: (e as Error).message });
        }
      }
    }
    for (const [objeto, motivo] of [...p.comprobados.tropiezos]) {
      if (!diarios.has(objeto)) p.comprobados.tropiezos.delete(objeto);
      else hecho.fallas.push({ dia: "el repaso", motivo });
    }
    return hecho;
  } finally {
    await rm(carpeta, { recursive: true, force: true });
  }
}

/**
 * Deja anotado, en el depósito diario, que el vigilante ya se enteró del hueco de esos días: desde
 * ahí ya no se le repite. Se llama cuando el aviso llegó; si no llegó, no se anota, y la corrida
 * siguiente avisa otra vez —mejor dos avisos que ninguno—.
 */
export async function anotarAvisados(p: Pick<Pendiente, "diario" | "ahora" | "comprobados" | "turno">, huecos: AlDia["huecos"]): Promise<void> {
  if (huecos.length === 0) return;
  const carpeta = await mkdtemp(join(tmpdir(), "feruga-respaldo-"));
  try {
    for (const { dia, motivo } of huecos) {
      if (p.turno) await p.turno();
      const archivo = join(carpeta, "hueco.json");
      await writeFile(archivo, JSON.stringify({ formato: 1, dia, motivo, avisado: p.ahora.toISOString() }, null, 2) + "\n");
      await p.diario.subir(archivo, huecoDe(dia), NOTA);
      p.comprobados.avisados.add(dia);
    }
  } finally {
    await rm(carpeta, { recursive: true, force: true });
  }
}
