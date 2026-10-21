// Un responsable ya vio el aviso: deja de salir. Queda quién lo vio y cuándo.
import { avisosSinVer, verAviso } from "../../../../../servidor/dominio/caja.ts";
import { fila } from "../../../../../servidor/forma.ts";
import { ruta } from "../../../../../servidor/ruta.ts";

export const POST = ruta({ roles: ["responsable"] }, async ({ bd, parametros, persona }) => {
  await verAviso(bd, persona.id, fila(parametros.aviso, "el aviso"));
  return { avisos: await avisosSinVer(bd) };
});
