// Resuelve un envío del que la pantalla no supo: lo cancela. Contesta si ya había entrado; si no,
// queda cancelado y ya no se asienta aunque llegue después.
import { cancelarEnvio } from "../../../../../servidor/dominio/envios.ts";
import { uuid } from "../../../../../servidor/forma.ts";
import { ruta } from "../../../../../servidor/ruta.ts";

export const POST = ruta({ roles: ["mostrador", "responsable", "patio"] }, async ({ bd, parametros, persona }) => ({
  entro: await cancelarEnvio(bd, persona.id, uuid(parametros.envio, "el envío")),
}));
