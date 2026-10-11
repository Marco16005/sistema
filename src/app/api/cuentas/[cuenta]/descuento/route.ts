// Kilos que se pesaron pero no se pagan. Lo decide quien cobra.
import { ponerDescuento } from "../../../../../servidor/dominio/cuentas.ts";
import { uuid } from "../../../../../servidor/forma.ts";
import { ErrorDeForma } from "../../../../../servidor/numeros.ts";
import { ruta } from "../../../../../servidor/ruta.ts";

export const POST = ruta({ roles: ["mostrador", "responsable"] }, async ({ bd, cuerpo, parametros, persona, equipo }) => {
  const cuenta = uuid(parametros.cuenta, "la cuenta");
  // Cero vale: es quitar el descuento.
  if (typeof cuerpo.kg !== "string" || !/^\d{1,6}(\.\d{1,3})?$/.test(cuerpo.kg)) {
    throw new ErrorDeForma("El descuento se escribe en kilos, con punto y hasta tres decimales");
  }
  return { cuenta: await ponerDescuento(bd, persona.id, cuenta, uuid(cuerpo.linea, "el material"), cuerpo.kg) };
});
