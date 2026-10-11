// Quien atiende sale. El equipo sigue dado de alta, listo para que entre la siguiente persona.
import { salir } from "../../../../servidor/dominio/identidad.ts";
import { Rechazo, conCookie, ruta } from "../../../../servidor/ruta.ts";
import { cookieCon } from "../../../../servidor/sesion.ts";

export const POST = ruta({ acceso: "equipo" }, async ({ bd, equipo, sesion, persona, peticion }) => {
  // «Salir» desde una pestaña que se quedó atrás no debe sacar a quien atiende ahora.
  if (persona && peticion.headers.get("x-persona") !== persona.id) {
    throw new Rechazo(409, "PERSONA", "En este equipo ahora atiende otra persona");
  }
  if (sesion) await salir(bd, equipo!.huella, sesion);
  return conCookie({ bien: true }, await cookieCon(equipo!.secreto, null));
});
