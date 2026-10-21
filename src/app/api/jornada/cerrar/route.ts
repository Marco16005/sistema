// Cierra la jornada que la pantalla tiene a la vista, con su corte: lo que se contó en el cajón, lo
// que se deja para mañana, y quién lo firma con su clave —un responsable, o alguien de mostrador
// con permiso de corte—. Dice cuál jornada y cuántos cierres le vio, para que una orden atrasada
// no cierre un día que alguien reabrió después. Con cuentas por terminar no cierra; con vehículos
// por volver, sí.
import { claveQueNoPaso, claveTecleada } from "../../../../servidor/clave.ts";
import { cerrarJornada } from "../../../../servidor/dominio/cierre.ts";
import { estadoDelDia } from "../../../../servidor/dominio/dia.ts";
import { entero, fila, uuid } from "../../../../servidor/forma.ts";
import { pesos } from "../../../../servidor/numeros.ts";
import { ruta } from "../../../../servidor/ruta.ts";

export const POST = ruta({ roles: ["mostrador", "responsable"] }, async ({ bd, cuerpo, persona, equipo }) => {
  const cierre = await cerrarJornada(bd, persona.id, equipo.huella, {
    id: uuid(cuerpo.id, "el cierre"),
    jornada: fila(cuerpo.jornada, "la jornada"),
    cierres: entero(cuerpo.cierres, "los cierres que llevaba"),
    contado: pesos(cuerpo.contado, "Lo que hay en el cajón"),
    seQueda: pesos(cuerpo.seQueda, "Lo que se queda en el cajón"),
    hace: fila(cuerpo.hace, "quien hace el corte"),
    clave: claveTecleada(cuerpo.clave),
  });
  if (!cierre) throw claveQueNoPaso();
  return { cierre, dia: await estadoDelDia(bd) };
});
