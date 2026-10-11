// Abre la jornada de hoy. Trae, sin publicar, los últimos precios publicados.
import { abrirJornada, estadoDelDia } from "../../../../servidor/dominio/dia.ts";
import { ruta } from "../../../../servidor/ruta.ts";

export const POST = ruta({ roles: ["mostrador", "responsable"] }, async ({ bd, persona }) => {
  await abrirJornada(bd, persona.id);
  return { dia: await estadoDelDia(bd) };
});
