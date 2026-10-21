// Un tipo de gasto: si se resta en la utilidad, y si sigue en uso.
import { cambiarTipoDeGasto } from "../../../../../servidor/dominio/gastos.ts";
import { fila } from "../../../../../servidor/forma.ts";
import { ErrorDeForma } from "../../../../../servidor/numeros.ts";
import { ruta } from "../../../../../servidor/ruta.ts";

export const POST = ruta({ roles: ["responsable"] }, async ({ bd, cuerpo, parametros, persona }) => {
  if (typeof cuerpo.cuenta !== "boolean" || typeof cuerpo.activo !== "boolean") throw new ErrorDeForma("Falta decir si cuenta y si sigue en uso");
  await cambiarTipoDeGasto(bd, persona.id, fila(parametros.tipo, "el tipo de gasto"), { cuenta: cuerpo.cuenta, activo: cuerpo.activo });
  return { hecho: true };
});
