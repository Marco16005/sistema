// Sacar o meter dinero del cajón: cuánto, para qué, y la clave de un responsable en ese momento.
import { claveQueNoPaso, claveTecleada } from "../../../../servidor/clave.ts";
import { moverCaja } from "../../../../servidor/dominio/caja.ts";
import { fila, textoConAlgo, unoDe, uuid } from "../../../../servidor/forma.ts";
import { pesos } from "../../../../servidor/numeros.ts";
import { ruta } from "../../../../servidor/ruta.ts";

export const POST = ruta({ roles: ["mostrador", "responsable"] }, async ({ bd, cuerpo, persona, equipo }) => {
  const cajon = await moverCaja(bd, persona.id, equipo.huella, {
    id: uuid(cuerpo.id, "el movimiento"),
    jornada: fila(cuerpo.jornada, "la jornada"),
    tipo: unoDe(cuerpo.tipo, "si se saca o se mete", ["sacar", "meter"] as const),
    importe: pesos(cuerpo.importe, "Cuánto"),
    motivo: textoConAlgo(cuerpo.motivo, "para qué", 200),
    autoriza: fila(cuerpo.autoriza, "quien autoriza"),
    clave: claveTecleada(cuerpo.clave),
  });
  if (!cajon) throw claveQueNoPaso();
  return { cajon };
});
