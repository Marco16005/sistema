// Lo que pesa vacío el recipiente de un material ya pesado en la báscula chica: el costal o la
// carretilla que se olvidó al pesar, o que se tecleó mal. Lo pone quien pesa.
import { ponerRecipiente } from "../../../../../servidor/dominio/cuentas.ts";
import { uuid } from "../../../../../servidor/forma.ts";
import { recipiente } from "../../../../../servidor/numeros.ts";
import { ruta } from "../../../../../servidor/ruta.ts";

export const POST = ruta({ roles: ["mostrador", "responsable", "patio"] }, async ({ bd, cuerpo, parametros, persona }) => {
  const cuenta = uuid(parametros.cuenta, "la cuenta");
  // Cero vale: es quitarlo.
  return { cuenta: await ponerRecipiente(bd, persona.id, cuenta, uuid(cuerpo.linea, "el material"), recipiente(cuerpo.kg)) };
});
