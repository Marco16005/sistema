// Quita el precio especial de un material: vuelve a su precio de lista. No pide clave. Dice qué
// cambio de precio le vio la pantalla a ese material.
import { quitarPrecioEspecial } from "../../../../../../servidor/dominio/precio-especial.ts";
import { fila, uuid } from "../../../../../../servidor/forma.ts";
import { ruta } from "../../../../../../servidor/ruta.ts";

export const POST = ruta({ roles: ["mostrador", "responsable"] }, async ({ bd, cuerpo, parametros, persona }) => {
  return {
    cuenta: await quitarPrecioEspecial(bd, persona.id, {
      id: uuid(cuerpo.id, "el envío"),
      cuenta: uuid(parametros.cuenta, "la cuenta"),
      linea: uuid(cuerpo.linea, "el material"),
      // «No se vio ninguno» se dice, con un nulo: no decir nada no tiene la forma esperada.
      visto: cuerpo.visto === null ? null : fila(cuerpo.visto, "lo que se vio"),
    }),
  };
});
