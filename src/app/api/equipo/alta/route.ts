// Da de alta este equipo con un código de un solo uso generado desde la consola.
// Es, con la de salud, la única ruta que responde a un equipo que todavía no está dado de alta.
import { darDeAltaEquipo } from "../../../../servidor/dominio/identidad.ts";
import { texto } from "../../../../servidor/forma.ts";
import { Rechazo, conCookie, ruta } from "../../../../servidor/ruta.ts";
import { cookieCon, secretoNuevo } from "../../../../servidor/sesion.ts";

export const POST = ruta({ acceso: "publico" }, async ({ bd, cuerpo }) => {
  const codigo = texto(cuerpo.codigo, "el código", 40);
  // La cookie se prepara antes de canjear: si no se puede sellar, falla aquí y el código no se gasta.
  const secreto = secretoNuevo();
  const cookie = await cookieCon(secreto, null);
  if (!(await darDeAltaEquipo(bd, codigo, secreto))) {
    throw new Rechazo(409, "CODIGO", "Ese código no sirve o ya venció. Pide uno nuevo.");
  }
  return conCookie({ bien: true }, cookie);
});
