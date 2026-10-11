// Cómo habla la pantalla con el servidor. Toda petición que escribe dice como quién cree estar
// actuando: si en otra pestaña entró alguien más, el servidor la rechaza en vez de dejarla
// escribir a nombre de quien ya no atiende.

export class ErrorDeApi extends Error {
  readonly estado: number;
  readonly codigo: string;

  constructor(estado: number, codigo: string, mensaje: string) {
    super(mensaje);
    this.name = "ErrorDeApi";
    this.estado = estado;
    this.codigo = codigo;
  }
}

let actuaComo: string | null = null;
let alPerderSesion: (codigo: string) => void = () => {};
let alCambiarElMantenimiento: (cerrado: boolean) => void = () => {};
let enMantenimiento = false;

export function actuarComo(persona: string | null): void {
  actuaComo = persona;
}

/** Qué hacer cuando el servidor dice que la sesión venció, que el equipo no vale o que atiende otra persona. */
export function avisarSiSePierdeLaSesion(aviso: (codigo: string) => void): void {
  alPerderSesion = aviso;
}

/**
 * Qué hacer cuando el servidor empieza a decir que está en mantenimiento, y cuando vuelve a atender.
 * Se avisa solo al cambiar, no en cada petición.
 */
export function avisarDelMantenimiento(aviso: (cerrado: boolean) => void): void {
  alCambiarElMantenimiento = aviso;
}

function mantenimiento(cerrado: boolean): void {
  if (cerrado === enMantenimiento) return;
  enMantenimiento = cerrado;
  alCambiarElMantenimiento(cerrado);
}

export async function pedir<T = any>(metodo: "GET" | "POST", camino: string, cuerpo?: unknown): Promise<T> {
  let respuesta: Response;
  try {
    respuesta = await fetch(camino, {
      method: metodo,
      cache: "no-store",
      credentials: "same-origin",
      headers: metodo === "POST" ? { "content-type": "application/json", ...(actuaComo ? { "x-persona": actuaComo } : {}) } : undefined,
      body: metodo === "POST" ? JSON.stringify(cuerpo ?? {}) : undefined,
    });
  } catch {
    throw new ErrorDeApi(0, "RED", "No se pudo hablar con el servidor. Revisa la conexión y vuelve a intentar.");
  }
  let datos: any = null;
  try {
    datos = await respuesta.json();
  } catch {
    // Una respuesta sin cuerpo legible se trata como falla del servidor.
  }
  if (respuesta.ok) {
    mantenimiento(false);
    return datos as T;
  }
  const error = new ErrorDeApi(
    respuesta.status,
    datos?.error?.codigo ?? "INTERNO",
    datos?.error?.mensaje ?? "Algo falló de nuestro lado. Intenta de nuevo.",
  );
  if (error.codigo === "SESION" || error.codigo === "EQUIPO" || error.codigo === "PERSONA") alPerderSesion(error.codigo);
  // Una respuesta del negocio —aunque sea un rechazo— dice que ya atiende; «en mantenimiento», que no.
  if (error.codigo === "MANTENIMIENTO") mantenimiento(true);
  else if (respuesta.status < 500) mantenimiento(false);
  throw error;
}

/**
 * ¿El servidor contestó con una regla? Entonces ESA petición —la que recibió la respuesta— no entró.
 * Sin respuesta, con una falla del servidor o de lo que hay en medio, o con la sesión perdida, no
 * se sabe: pudo haber entrado, y lo único seguro es mandar ese mismo envío otra vez.
 *
 * Una regla no dice que no haya otra petición con el mismo identificador en camino: un intento
 * anterior del que no se supo, o el mismo envío mandado desde otra pestaña. Por eso ninguna
 * captura se suelta con una regla sola: antes se resuelve su envío con `cancelarEnvio`.
 */
export const rechazoConRegla = (e: unknown): boolean => e instanceof ErrorDeApi && /^(RC\d{3}|CLAVE|FORMA)$/.test(e.codigo);

/**
 * Resuelve de una vez un envío: le pide al servidor que lo cancele. Si ya había entrado, lo dice
 * y se queda como está. Si no, queda cancelado y ya no entra aunque llegue después. Cualquier
 * respuesta que no diga con claridad una de las dos cosas cuenta como no saber.
 */
export async function cancelarEnvio(id: string): Promise<"entro" | "cancelado"> {
  const r: unknown = await pedir("POST", `/api/envios/${id}/cancelar`);
  const entro = typeof r === "object" && r !== null ? (r as { entro?: unknown }).entro : undefined;
  if (typeof entro !== "boolean") throw new ErrorDeApi(502, "INTERNO", "El servidor no dijo si ese envío quedó cancelado. Vuelve a intentar.");
  return entro ? "entro" : "cancelado";
}

/** Un identificador nuevo para una cuenta, un material, una pesada o una impresión. */
export function identificador(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  // Fuera de un contexto seguro el navegador no ofrece randomUUID, pero sí números al azar.
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
