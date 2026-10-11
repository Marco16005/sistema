// Corrige un movimiento ya asentado diciendo cómo debió quedar. Arregla el inventario; el
// comprobante y lo pagado no cambian. Lleva la clave de quien autoriza.
import { corregir } from "../../../../servidor/dominio/inventario.ts";
import { entero, fila, material, texto, textoConAlgo, uuid } from "../../../../servidor/forma.ts";
import { kilos } from "../../../../servidor/numeros.ts";
import { Rechazo, ruta } from "../../../../servidor/ruta.ts";

export const POST = ruta({ roles: ["mostrador", "responsable"] }, async ({ bd, cuerpo, persona, equipo }) => {
  const correccion = await corregir(bd, persona.id, equipo.huella, {
    id: uuid(cuerpo.id, "la corrección"),
    movimiento: fila(cuerpo.movimiento, "el movimiento"),
    material: material(cuerpo.material),
    kg: kilos(cuerpo.kg),
    vistas: entero(cuerpo.vistas, "lo que se revisó"),
    motivo: textoConAlgo(cuerpo.motivo, "el motivo", 300),
    autoriza: fila(cuerpo.autoriza, "quien autoriza"),
    clave: texto(cuerpo.clave, "la clave", 16),
  });
  if (!correccion) throw new Rechazo(401, "CLAVE", "La clave no pasó. Después de varios intentos se bloquea unos minutos.");
  return { correccion };
});
