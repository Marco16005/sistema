// La segunda pesada de un vehículo: vacío en una compra, cargado en una venta.
import { segundaPesada } from "../../../../../servidor/dominio/cuentas.ts";
import { uuid } from "../../../../../servidor/forma.ts";
import { kilos } from "../../../../../servidor/numeros.ts";
import { ruta } from "../../../../../servidor/ruta.ts";

export const POST = ruta({ roles: ["mostrador", "responsable", "patio"] }, async ({ bd, cuerpo, parametros, persona, equipo }) => {
  const cuenta = uuid(parametros.cuenta, "la cuenta");
  return {
    cuenta: await segundaPesada(bd, persona.id, cuenta, uuid(cuerpo.linea, "el material"), {
      captura: uuid(cuerpo.captura, "la pesada"), kg: kilos(cuerpo.kg),
    }),
  };
});
