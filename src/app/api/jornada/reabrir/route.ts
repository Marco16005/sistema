// Reabre el día de hoy, que se cerró por error. Dice cuál cierre vio la pantalla, y lleva la clave
// de quien autoriza. Solo la jornada de hoy; queda registro.
import { reabrirJornada } from "../../../../servidor/dominio/cierre.ts";
import { estadoDelDia } from "../../../../servidor/dominio/dia.ts";
import { entero, fila, texto, uuid } from "../../../../servidor/forma.ts";
import { Rechazo, ruta } from "../../../../servidor/ruta.ts";

export const POST = ruta({ roles: ["mostrador", "responsable"] }, async ({ bd, cuerpo, persona, equipo }) => {
  const reapertura = await reabrirJornada(bd, persona.id, equipo.huella, {
    id: uuid(cuerpo.id, "la reapertura"),
    jornada: fila(cuerpo.jornada, "la jornada"),
    cierre: entero(cuerpo.cierre, "el cierre"),
    autoriza: fila(cuerpo.autoriza, "quien autoriza"),
    clave: texto(cuerpo.clave, "la clave", 16),
  });
  if (!reapertura) throw new Rechazo(401, "CLAVE", "La clave no pasó. Después de varios intentos se bloquea unos minutos.");
  return { reapertura, dia: await estadoDelDia(bd) };
});
