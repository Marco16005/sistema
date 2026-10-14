// Agrega un material con su peso. En la báscula grande es la primera pesada del vehículo. En la
// chica puede llevar lo que pesa vacío el recipiente en que viene.
import { agregarMaterial } from "../../../../../servidor/dominio/cuentas.ts";
import { bascula, material, uuid } from "../../../../../servidor/forma.ts";
import { kilos, recipiente } from "../../../../../servidor/numeros.ts";
import { ruta } from "../../../../../servidor/ruta.ts";

export const POST = ruta({ roles: ["mostrador", "responsable", "patio"] }, async ({ bd, cuerpo, parametros, persona, equipo }) => {
  const cuenta = uuid(parametros.cuenta, "la cuenta");
  return {
    cuenta: await agregarMaterial(bd, persona.id, cuenta, {
      linea: uuid(cuerpo.linea, "el material"),
      captura: uuid(cuerpo.captura, "la pesada"),
      material: material(cuerpo.material),
      bascula: bascula(cuerpo.bascula),
      kg: kilos(cuerpo.kg),
      ...(cuerpo.recipiente === undefined ? {} : { recipiente: recipiente(cuerpo.recipiente) }),
    }),
  };
});
