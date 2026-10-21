// Contar el cajón al abrir el día: lo que hay de verdad. Si no es lo que se dejó en el último
// corte, la base deja un aviso para el responsable.
import { abrirCajon } from "../../../../servidor/dominio/caja.ts";
import { estadoDelDia } from "../../../../servidor/dominio/dia.ts";
import { fila, uuid } from "../../../../servidor/forma.ts";
import { pesos } from "../../../../servidor/numeros.ts";
import { ruta } from "../../../../servidor/ruta.ts";

export const POST = ruta({ roles: ["mostrador", "responsable"] }, async ({ bd, cuerpo, persona }) => {
  const cajon = await abrirCajon(bd, persona.id, {
    id: uuid(cuerpo.id, "el conteo"),
    jornada: fila(cuerpo.jornada, "la jornada"),
    contado: pesos(cuerpo.contado, "Lo que hay en el cajón"),
  });
  return { cajon, dia: await estadoDelDia(bd) };
});
