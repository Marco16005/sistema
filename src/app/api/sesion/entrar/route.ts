// Una persona entra con su clave. Quien estaba atendiendo en este equipo deja de estarlo.
import { entrar } from "../../../../servidor/dominio/identidad.ts";
import { fila, texto } from "../../../../servidor/forma.ts";
import { Rechazo, conCookie, ruta } from "../../../../servidor/ruta.ts";
import { cookieCon } from "../../../../servidor/sesion.ts";

export const POST = ruta({ acceso: "equipo" }, async ({ bd, cuerpo, equipo }) => {
  // Aquí la persona sí viene en el cuerpo: es quien dice ser, y la clave es la que lo demuestra.
  const adentro = await entrar(bd, equipo!.huella, fila(cuerpo.persona, "la persona"), texto(cuerpo.clave, "la clave", 16));
  if (!adentro) {
    // La misma respuesta sea cual sea la razón.
    throw new Rechazo(401, "CLAVE", "No se pudo entrar. Revisa la clave; después de varios intentos se bloquea unos minutos.");
  }
  return conCookie({ persona: adentro.persona }, await cookieCon(equipo!.secreto, adentro.sesion));
});
