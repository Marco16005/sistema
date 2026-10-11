// El comprobante de una cuenta terminada. Leerlo no cuenta como imprimirlo.
import { comprobante, negocio } from "../../../../servidor/dominio/comprobante.ts";
import { uuid } from "../../../../servidor/forma.ts";
import { Rechazo, ruta } from "../../../../servidor/ruta.ts";

export const dynamic = "force-dynamic";

export const GET = ruta({ roles: ["mostrador", "responsable", "consulta"] }, async ({ bd, parametros }) => {
  const c = await comprobante(bd, uuid(parametros.operacion, "la cuenta"));
  if (!c) throw new Rechazo(404, "NO_ESTA", "Esa cuenta no tiene comprobante: no se ha terminado");
  return { comprobante: c, negocio: negocio() };
});
