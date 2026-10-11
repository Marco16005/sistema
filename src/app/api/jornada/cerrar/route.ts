// Cierra la jornada que la pantalla tiene a la vista: dice cuál y cuántos cierres le vio, para que
// una orden atrasada no cierre un día que alguien reabrió después. Con cuentas por terminar no
// cierra; con vehículos por volver, sí.
import { cerrarJornada } from "../../../../servidor/dominio/cierre.ts";
import { estadoDelDia } from "../../../../servidor/dominio/dia.ts";
import { entero, fila, uuid } from "../../../../servidor/forma.ts";
import { ruta } from "../../../../servidor/ruta.ts";

export const POST = ruta({ roles: ["mostrador", "responsable"] }, async ({ bd, cuerpo, persona }) => {
  const cierre = await cerrarJornada(bd, persona.id, {
    id: uuid(cuerpo.id, "el cierre"),
    jornada: fila(cuerpo.jornada, "la jornada"),
    cierres: entero(cuerpo.cierres, "los cierres que llevaba"),
  });
  return { cierre, dia: await estadoDelDia(bd) };
});
