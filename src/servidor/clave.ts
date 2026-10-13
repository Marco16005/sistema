// La clave que alguien teclea para demostrar que es quien dice, y lo que se contesta con lo que
// solo debe verse una vez.
import { ErrorDeForma } from "./numeros.ts";
import { Rechazo } from "./ruta.ts";

/**
 * La clave de quien pide algo que la exige: de cuatro a ocho dígitos, como texto. Lo que no tiene
 * esa forma no se le pregunta a la base —no es un intento—: se dice aquí.
 */
export function claveTecleada(valor: unknown): string {
  if (typeof valor !== "string" || !/^[0-9]{4,8}$/.test(valor)) throw new ErrorDeForma("Falta la clave de quien lo pide, o no tiene la forma esperada");
  return valor;
}

/** La clave no pasó: se dice igual en todas partes, y no se dice por qué. */
export const claveQueNoPaso = (): Rechazo => new Rechazo(401, "CLAVE", "La clave no pasó. Después de varios intentos se bloquea unos minutos.");

/** Una respuesta con algo que se ve una sola vez —una clave, un código—: que nadie la guarde. */
export const unaSolaVez = (datos: Record<string, unknown>): Response => Response.json(datos, { headers: { "cache-control": "no-store" } });
