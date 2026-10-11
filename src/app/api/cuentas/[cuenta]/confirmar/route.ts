// Termina la cuenta tal como se vio: asienta el inventario, fija el total y le da folio.
import { confirmar } from "../../../../../servidor/dominio/cuentas.ts";
import { entero, uuid } from "../../../../../servidor/forma.ts";
import { ruta } from "../../../../../servidor/ruta.ts";

export const POST = ruta({ roles: ["mostrador", "responsable"] }, async ({ bd, cuerpo, parametros, persona, equipo }) => {
  const cuenta = uuid(parametros.cuenta, "la cuenta");
  // La revisión es la que venía con lo que la pantalla mostró. Si la cuenta cambió, no se confirma.
  return { cuenta: await confirmar(bd, persona.id, cuenta, entero(cuerpo.revision, "la revisión")) };
});
