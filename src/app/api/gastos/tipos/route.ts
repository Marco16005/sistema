// Dar de alta un tipo de gasto (además de los de siempre).
import { altaTipoDeGasto } from "../../../../servidor/dominio/gastos.ts";
import { textoConAlgo } from "../../../../servidor/forma.ts";
import { ruta } from "../../../../servidor/ruta.ts";

export const POST = ruta({ roles: ["responsable"] }, async ({ bd, cuerpo, persona }) => {
  await altaTipoDeGasto(bd, persona.id, textoConAlgo(cuerpo.nombre, "el nombre del tipo", 40));
  return { hecho: true };
});
