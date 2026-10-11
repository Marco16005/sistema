// Agrega un material con su peso. En la báscula grande es la primera pesada del vehículo.
import { agregarMaterial } from "../../../../../servidor/dominio/cuentas.ts";
import { bascula, material, uuid } from "../../../../../servidor/forma.ts";
import { kilos } from "../../../../../servidor/numeros.ts";
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
    }),
  };
});
