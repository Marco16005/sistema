// Termina la cuenta tal como se vio: asienta el inventario, fija el total y le da folio.
import { FORMAS_DE_PAGO, confirmar } from "../../../../../servidor/dominio/cuentas.ts";
import { entero, unoDe, uuid } from "../../../../../servidor/forma.ts";
import { ruta } from "../../../../../servidor/ruta.ts";

export const POST = ruta({ roles: ["mostrador", "responsable"] }, async ({ bd, cuerpo, parametros, persona, equipo }) => {
  const cuenta = uuid(parametros.cuenta, "la cuenta");
  // La revisión es la que venía con lo que la pantalla mostró. Si la cuenta cambió, no se confirma.
  // Sin decir cómo se pagó, es en efectivo: lo de todos los días.
  const forma = cuerpo.forma === undefined ? "efectivo" : unoDe(cuerpo.forma, "cómo se pagó", FORMAS_DE_PAGO);
  return { cuenta: await confirmar(bd, persona.id, cuenta, entero(cuerpo.revision, "la revisión"), forma) };
});
