// Publica la lista de hoy. Desde ese momento no cambia y el mostrador puede atender.
import { estadoDelDia } from "../../../../servidor/dominio/dia.ts";
import { publicarLista } from "../../../../servidor/dominio/precios.ts";
import { ruta } from "../../../../servidor/ruta.ts";

export const POST = ruta({ roles: ["responsable"] }, async ({ bd, persona }) => {
  await publicarLista(bd, persona.id);
  return { dia: await estadoDelDia(bd) };
});
