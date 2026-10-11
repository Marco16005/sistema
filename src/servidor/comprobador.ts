// El comprobador: el programa de la operación que, por HTTPS y a través del proxy, verifica qué
// versión contesta y sobre qué base antes de abrir (operacion/comprobar.ts).
//
// La salud es pública y dice lo mínimo. El detalle —la versión, el esquema, la marca de la base—
// se le da solo a quien demuestra tener el entorno de esta instalación: una credencial derivada de
// la clave con que se sellan las cookies. No es la clave, y de ella no se puede sacar la clave.
import { createHmac, timingSafeEqual } from "node:crypto";

const ENCABEZADO = "x-comprobador";

/** La credencial con que el comprobador se presenta, derivada de la clave de sesión de la instalación. */
export function credencialDelComprobador(claveDeSesion: string): string {
  return createHmac("sha256", claveDeSesion).update("feruga · comprobador de la operación · v1").digest("hex");
}

/** ¿Esa petición viene del comprobador de esta instalación? */
export function esElComprobador(peticion: Request): boolean {
  const clave = process.env.SESION_CLAVE;
  const presentada = peticion.headers.get(ENCABEZADO);
  if (!clave || !presentada) return false;
  const [esperada, dada] = [Buffer.from(credencialDelComprobador(clave)), Buffer.from(presentada)];
  return esperada.length === dada.length && timingSafeEqual(esperada, dada);
}

/** El encabezado con que el comprobador se acredita. */
export const encabezadoDelComprobador = (claveDeSesion: string): Record<string, string> => ({ [ENCABEZADO]: credencialDelComprobador(claveDeSesion) });
