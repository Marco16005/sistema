// El cierre y las cuentas que quedaron asentadas en ese día.
import { resumenDelCierre } from "../../../../servidor/dominio/cierre.ts";
import { cuentasDelDia } from "../../../../servidor/dominio/historial.ts";
import { Rechazo, ruta } from "../../../../servidor/ruta.ts";

export const dynamic = "force-dynamic";

export const GET = ruta({ roles: ["responsable", "consulta"] }, async ({ bd, parametros }) => {
  const cuentas = await cuentasDelDia(bd, parametros.jornada!);
  if (cuentas === null) throw new Rechazo(404, "NO_EXISTE", "Ese día no está en el historial");
  return { cierre: await resumenDelCierre(bd, parametros.jornada!), cuentas };
});
