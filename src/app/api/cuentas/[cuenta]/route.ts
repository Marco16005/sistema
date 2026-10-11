// Una cuenta con sus materiales, su resumen y la revisión que se mandará al confirmar.
import { verCuenta } from "../../../../servidor/dominio/cuentas.ts";
import { uuid } from "../../../../servidor/forma.ts";
import { Rechazo, ruta } from "../../../../servidor/ruta.ts";

export const dynamic = "force-dynamic";

export const GET = ruta({ roles: ["mostrador", "responsable", "patio"] }, async ({ bd, parametros }) => {
  const cuenta = await verCuenta(bd, uuid(parametros.cuenta, "la cuenta"));
  if (!cuenta) throw new Rechazo(404, "NO_ESTA", "Esa cuenta ya no está: se terminó o se descartó");
  return { cuenta };
});
