// La puerta de cada ruta. Antes de que corra lo que la ruta hace, aquí se comprueba, en este
// orden: que una petición que escribe venga de esta misma aplicación y traiga un objeto JSON; que
// el equipo esté dado de alta; que haya una persona adentro; que su rol sea de los que la ruta
// nombra; y que la pestaña sepa quién atiende. Y a la salida, cada error toma su forma.
//
// La persona que recibe la ruta sale siempre de la sesión. Lo que venga en el cuerpo de la
// petición diciendo quién es no se usa para eso.
import { bd } from "./bd.ts";
import type { Bd } from "./bd.ts";
import { faltasDelEntorno } from "./entorno.ts";
import { ErrorDeNegocio } from "./errores.ts";
import { baseApta, operacionAbierta } from "./esquema.ts";
import { ErrorDeForma } from "./numeros.ts";
import { acreditar } from "./sesion.ts";
import type { Equipo, PersonaActiva, Rol } from "./sesion.ts";

export interface Contexto<P> {
  peticion: Request;
  bd: Bd;
  /** El cuerpo de la petición; vacío en las lecturas. */
  cuerpo: Record<string, unknown>;
  /** Lo que la dirección trae entre corchetes: /api/cuentas/[cuenta]. */
  parametros: Record<string, string>;
  equipo: P extends null ? Equipo | null : Equipo;
  sesion: string | null;
  persona: P;
}

type Resultado = Response | Record<string, unknown>;
type Manejador = (peticion: Request, extra?: { params?: Promise<Record<string, string>> }) => Promise<Response>;

/** El error que la ruta devuelve tal cual, con su estado. */
export class Rechazo extends Error {
  readonly estado: number;
  readonly codigo: string;

  constructor(estado: number, codigo: string, mensaje: string) {
    super(mensaje);
    this.name = "Rechazo";
    this.estado = estado;
    this.codigo = codigo;
  }
}

const fallo = (estado: number, codigo: string, mensaje: string, encabezados?: HeadersInit): Response =>
  Response.json({ error: { codigo, mensaje } }, { status: estado, headers: encabezados });

/** Una respuesta que además deja una cookie. */
export const conCookie = (datos: Record<string, unknown>, cookie: string): Response =>
  Response.json(datos, { headers: { "set-cookie": cookie } });

/** ¿La petición viene de una página de esta misma aplicación? */
function delMismoOrigen(peticion: Request): boolean {
  const origen = peticion.headers.get("origin");
  if (!origen) return false;
  const admitidos = (process.env.ORIGEN ?? "").split(",").map((o) => o.trim()).filter(Boolean);
  if (admitidos.length > 0) return admitidos.includes(origen);
  const propia = new URL(peticion.url);
  const anfitrion = peticion.headers.get("host") ?? propia.host;
  return origen === `${propia.protocol}//${anfitrion}`;
}

async function leerCuerpo(peticion: Request): Promise<Record<string, unknown>> {
  if (!(peticion.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) {
    throw new ErrorDeForma("La petición no trae lo que se esperaba");
  }
  let cuerpo: unknown;
  try {
    cuerpo = JSON.parse(await peticion.text());
  } catch {
    throw new ErrorDeForma("La petición no trae lo que se esperaba");
  }
  if (cuerpo === null || typeof cuerpo !== "object" || Array.isArray(cuerpo)) {
    throw new ErrorDeForma("La petición no trae lo que se esperaba");
  }
  return cuerpo as Record<string, unknown>;
}

/**
 * Una ruta que no toca la base ni pide equipo ni persona: una preferencia de la pantalla, que tiene
 * que servir también con la base caída o con el sistema en mantenimiento. Conserva lo demás de la
 * puerta: que la petición venga de esta misma aplicación y traiga un objeto JSON.
 */
export function rutaSinBase(hacer: (c: { peticion: Request; cuerpo: Record<string, unknown> }) => Promise<Resultado>): Manejador {
  return async (peticion) => {
    try {
      if (!delMismoOrigen(peticion)) return fallo(403, "ORIGEN", "La petición no viene de esta aplicación");
      const resultado = await hacer({ peticion, cuerpo: await leerCuerpo(peticion) });
      return resultado instanceof Response ? resultado : Response.json(resultado);
    } catch (e) {
      if (e instanceof Rechazo) return fallo(e.estado, e.codigo, e.message);
      if (e instanceof ErrorDeForma) return fallo(400, "FORMA", e.message);
      console.error(e);
      return fallo(500, "INTERNO", "Algo falló de nuestro lado. Intenta de nuevo.");
    }
  };
}

/** Una ruta abierta, o que solo pide equipo: puede no haber persona. */
export function ruta(
  opciones: { acceso: "publico" | "equipo" },
  hacer: (c: Contexto<PersonaActiva | null>) => Promise<Resultado>,
): Manejador;
/** Una ruta de trabajo: hay persona, y si se nombran roles, es de uno de ellos. */
export function ruta(opciones: { roles?: readonly Rol[] }, hacer: (c: Contexto<PersonaActiva>) => Promise<Resultado>): Manejador;
export function ruta(
  opciones: { acceso?: "publico" | "equipo"; roles?: readonly Rol[] },
  hacer: (c: Contexto<any>) => Promise<Resultado>,
): Manejador {
  const acceso = opciones.acceso ?? "persona";
  return async (peticion, extra) => {
    try {
      // Con un entorno que no sirve para operar no se atiende nada, y no se dice qué le falta.
      if (faltasDelEntorno(process.env, ["conexion", "aplicacion"]).length > 0) {
        return fallo(503, "INTERNO", "El sistema no está disponible");
      }
      // Tampoco sobre una base que no es la que esta aplicación espera: otra versión del esquema, o
      // una que volvió de un respaldo sin registrar. Antes que nada, y en cada petición.
      const base = bd();
      // Si la base no contesta, tampoco está disponible: se dice lo mismo que dice la salud, no un error interno.
      const apta = await baseApta(base).catch((e: unknown) => {
        console.error("No se pudo preguntar si la base es apta:", (e as Error).message);
        return false;
      });
      if (!apta) return fallo(503, "INTERNO", "El sistema no está disponible");
      // En mantenimiento no se atiende nada del negocio. Se pregunta en cada petición: abrir y
      // cerrar no dependen de reiniciar nada. Si no se pudo preguntar, se trata como cerrada.
      const abierta = await operacionAbierta(base).catch((e: unknown) => {
        console.error("No se pudo preguntar si la operación está abierta:", (e as Error).message);
        return false;
      });
      if (!abierta) return fallo(503, "MANTENIMIENTO", "El sistema está en mantenimiento. Vuelve a intentar en unos minutos.");

      const escribe = peticion.method !== "GET" && peticion.method !== "HEAD";
      if (escribe && !delMismoOrigen(peticion)) {
        return fallo(403, "ORIGEN", "La petición no viene de esta aplicación");
      }
      const cuerpo = escribe ? await leerCuerpo(peticion) : {};

      const { equipo, sesion, persona } = await acreditar(peticion, base);
      if (acceso !== "publico" && !equipo) {
        return fallo(401, "EQUIPO", "Este equipo no está dado de alta");
      }
      if (acceso === "persona") {
        if (!persona) return fallo(401, "SESION", "Hace falta entrar con tu clave");
        if (opciones.roles && !opciones.roles.includes(persona.rol)) {
          return fallo(403, "ROL", "Esto no le toca a tu rol");
        }
        // Dos pestañas comparten la cookie: si en la otra entró alguien más, esta no debe seguir
        // escribiendo a nombre de quien ya no atiende.
        if (escribe && peticion.headers.get("x-persona") !== persona.id) {
          return fallo(409, "PERSONA", "En este equipo ahora atiende otra persona");
        }
      }

      const resultado = await hacer({
        peticion, bd: base, cuerpo, parametros: (await extra?.params) ?? {}, equipo, sesion, persona,
      });
      return resultado instanceof Response ? resultado : Response.json(resultado);
    } catch (e) {
      if (e instanceof Rechazo) return fallo(e.estado, e.codigo, e.message);
      if (e instanceof ErrorDeForma) return fallo(400, "FORMA", e.message);
      if (e instanceof ErrorDeNegocio) return fallo(e.codigo === "RC008" ? 403 : 409, e.codigo, e.message);
      // Lo inesperado se anota aquí y afuera no sale más que el aviso.
      console.error(e);
      return fallo(500, "INTERNO", "Algo falló de nuestro lado. Intenta de nuevo.");
    }
  };
}
