// Una pestaña duplicada —o abierta desde otra— nace con una copia de lo que la primera tenía
// guardado, y con eso una copia de lo que estaba a medias: una captura de inventario, un peso
// tecleado en el mostrador. Dos pestañas con lo mismo a medias son dos formularios llenos, y
// registrar en los dos son dos asientos. Aquí cada pestaña averigua, al cargar, si es copia de otra
// que sigue abierta. Si lo es, suelta lo heredado: lo que estaba a medias sigue donde se empezó.
//
// Cada pestaña lleva un identificador propio, guardado junto con lo demás; una copia nace con el
// de su original. Quién se queda con él lo decide un candado del navegador, que es de una sola
// pestaña a la vez y se suelta solo cuando esa pestaña se va: no hay plazo que vencer ni carrera
// que ganar. Recargar no es copiar: el candado queda libre al irse la página anterior.
//
// Si pedir el candado falla, la pestaña no sabe si es la original o una copia. No saberlo no vale
// como «es mía»: queda en duda, sin soltar nada y sin dejar capturar, hasta que se pueda comprobar.
//
// La aplicación no corre dentro de un marco. Un marco del mismo origen comparte lo guardado con su
// página pero es otro documento: se tomaría por copia y le borraría lo suyo a la original. Lo
// prohíbe la respuesta del servidor; y si aun así llegara a cargar, aquí no toca nada.
//
// Los candados piden origen seguro (HTTPS, o esta misma máquina). Donde no los hay, las pestañas se
// avisan entre sí y la copia espera un momento la respuesta: sirve en el caso común y no garantiza
// nada si la respuesta tarda. Y si ni eso hay, la copia hereda; lo que entonces protege es que
// ningún envío se asienta dos veces.
import { useEffect, useState } from "react";
import { identificador } from "./cliente.ts";

const CLAVE = "feruga.pestana";
const INVENTARIO = "feruga.inventario";
const MOSTRADOR = "feruga.mostrador";
const CIERRE = "feruga.cierre";
/** Lo que el cajón deja a medias: el conteo al abrir, sacar o meter dinero, un abono, una corrección y un gasto. */
const CAJA = ["feruga.caja.apertura", "feruga.caja.movimiento", "feruga.caja.abono", "feruga.correccion", "feruga.gasto"];
/** Lo que se espera el candado de la pestaña anterior al recargar. Una original nunca lo suelta: esperar no cambia la respuesta. */
const ESPERA_DEL_CANDADO_MS = 1000;
/** Lo que se espera el aviso de otra pestaña, donde no hay candados. */
const ESPERA_DEL_AVISO_MS = 250;

/** Lo que se sabe de esta pestaña: es dueña de lo suyo; no se pudo saber; o está dentro de un marco. */
export type Pestana = "propia" | "dudosa" | "enmarcada";

let averiguando: Promise<Pestana> | null = null;
let sabido: Pestana | null = null;
const heredado = { inventario: false, mostrador: false, cierre: false };

/** Resuelve cuando ya se sabe si esta pestaña es copia de otra (y entonces lo heredado ya se soltó), o que no se pudo saber. */
export function pestanaLista(): Promise<Pestana> {
  averiguando ??= averiguar().then((r) => {
    sabido = r;
    return r;
  });
  return averiguando;
}

/**
 * Para una pantalla que guarda lo que está a medias: qué se sabe de la pestaña, y cómo volver a
 * comprobarlo cuando quedó en duda. Mientras no sea «propia», la pantalla no lee lo guardado.
 */
export function usePestana(): { estado: Pestana | "esperando"; otraVez: () => void } {
  const [estado, setEstado] = useState<Pestana | "esperando">(sabido ?? "esperando");
  useEffect(() => {
    let vigente = true;
    void pestanaLista().then((r) => { if (vigente) setEstado(r); });
    return () => { vigente = false; };
  }, []);
  const otraVez = (): void => {
    if (sabido !== "dudosa") return;
    averiguando = null;
    sabido = null;
    setEstado("esperando");
    void pestanaLista().then(setEstado);
  };
  return { estado, otraVez };
}

/** ¿Esta pestaña nació con algo a medias de otra, y lo soltó? Lo dice una sola vez por pantalla. */
export function soltoLoHeredado(de: "inventario" | "mostrador" | "cierre"): boolean {
  const si = heredado[de];
  heredado[de] = false;
  return si;
}

function guardado(clave: string): unknown {
  try {
    return JSON.parse(sessionStorage.getItem(clave) ?? "null");
  } catch {
    return null;       // lo que no se puede leer tampoco se puede registrar dos veces
  }
}

function soltarLoHeredado(): void {
  const inventario = guardado(INVENTARIO) as { e?: unknown } | null;
  heredado.inventario = Boolean(inventario && typeof inventario === "object" && "e" in inventario);
  const mostrador = guardado(MOSTRADOR) as { lugares?: Record<string, { peso?: string; pendiente?: unknown; segunda?: unknown } | null> } | null;
  heredado.mostrador = Object.values(mostrador?.lugares ?? {}).some((l) => Boolean(l && (l.peso || l.pendiente || l.segunda)));
  const cierre = guardado(CIERRE) as { cierre?: unknown; reapertura?: unknown } | null;
  heredado.cierre = Boolean(cierre && typeof cierre === "object" && (cierre.cierre || cierre.reapertura)) || CAJA.some((c) => guardado(c) !== null);
  try {
    sessionStorage.removeItem(INVENTARIO);
    sessionStorage.removeItem(MOSTRADOR);
    sessionStorage.removeItem(CIERRE);
    for (const c of CAJA) sessionStorage.removeItem(c);
  } catch {
    // Sin dónde guardar no había nada heredado.
  }
}

function estrenar(): string {
  const id = identificador();
  try {
    sessionStorage.setItem(CLAVE, id);
  } catch {
    // Igual que arriba.
  }
  return id;
}

function enUnMarco(): boolean {
  try {
    return window.self !== window.top;
  } catch {
    return true;      // si ni siquiera se puede preguntar, es que está dentro de otra página
  }
}

async function averiguar(): Promise<Pestana> {
  if (enUnMarco()) return "enmarcada";
  let id: string | null = null;
  try {
    id = sessionStorage.getItem(CLAVE);
  } catch {
    // Sin dónde guardar no hay nada que heredar.
  }
  const candados = typeof navigator !== "undefined" ? navigator.locks : undefined;
  if (candados) return conCandados(candados, id);
  if (typeof BroadcastChannel !== "undefined") await conAvisos(id);
  else if (!id) estrenar();
  return "propia";
}

async function conCandados(candados: LockManager, id: string | null): Promise<Pestana> {
  type Intento = "lo tengo" | "lo tiene otra" | "no se sabe";
  /** Pide el candado de ese identificador, para conservarlo mientras viva la pestaña. */
  const pedir = (cual: string): Promise<Intento> =>
    new Promise((resuelve) => {
      const control = new AbortController();
      let vencio = false;
      const plazo = setTimeout(() => {
        vencio = true;
        control.abort();
      }, ESPERA_DEL_CANDADO_MS);
      // Solo el plazo propio dice que otra pestaña lo tiene. Cualquier otro fallo es no saber.
      const fallo = (): void => {
        clearTimeout(plazo);
        resuelve(vencio ? "lo tiene otra" : "no se sabe");
      };
      try {
        candados
          .request(`${CLAVE}.${cual}`, { signal: control.signal }, () => {
            clearTimeout(plazo);
            resuelve("lo tengo");
            return new Promise<never>(() => {});
          })
          .catch(fallo);
      } catch {
        fallo();
      }
    });
  /** Con un par de reintentos: un tropiezo pasajero no deja la pestaña en duda. */
  const tener = async (cual: string): Promise<Intento> => {
    for (let intento = 1; ; intento += 1) {
      const r = await pedir(cual);
      if (r !== "no se sabe" || intento === 3) return r;
      await new Promise((sigue) => setTimeout(sigue, 150));
    }
  };

  if (id) {
    const r = await tener(id);
    if (r === "lo tengo") return "propia";
    if (r === "no se sabe") return "dudosa";       // ni se suelta nada ni se deja capturar
    soltarLoHeredado();                            // otra pestaña abierta tiene este identificador: esta es su copia
  }
  return (await tener(estrenar())) === "lo tengo" ? "propia" : "dudosa";
}

function conAvisos(heredadoDe: string | null): Promise<void> {
  return new Promise((listo) => {
    let id = heredadoDe;
    let establecida = false;
    let espera: ReturnType<typeof setTimeout> | undefined;
    const quedarConEste = (): void => {
      establecida = true;
      listo();
    };
    const canal = new BroadcastChannel("feruga.pestanas");      // queda abierto mientras viva la pestaña
    canal.onmessage = (mensaje: MessageEvent<{ tipo?: string; id?: string } | null>) => {
      const m = mensaje.data;
      if (!m || m.id !== id) return;
      if (m.tipo === "hay" && establecida) canal.postMessage({ tipo: "viva", id });
      if (m.tipo === "viva" && !establecida) {
        // Otra pestaña abierta ya tiene este identificador: esta es su copia.
        clearTimeout(espera);
        soltarLoHeredado();
        id = estrenar();
        quedarConEste();
      }
    };
    if (!id) {
      id = estrenar();
      return quedarConEste();
    }
    espera = setTimeout(quedarConEste, ESPERA_DEL_AVISO_MS);
    canal.postMessage({ tipo: "hay", id });
  });
}
