// Anular un gasto: queda el registro con quién, cuándo y por qué, y deja de sumar.
import { anularGasto } from "../../../../../servidor/dominio/gastos.ts";
import { fila, textoConAlgo } from "../../../../../servidor/forma.ts";
import { ruta } from "../../../../../servidor/ruta.ts";

export const POST = ruta({ roles: ["responsable"] }, async ({ bd, cuerpo, parametros, persona }) => {
  await anularGasto(bd, persona.id, fila(parametros.gasto, "el gasto"), textoConAlgo(cuerpo.motivo, "por qué se anula", 200));
  return { hecho: true };
});
