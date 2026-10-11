// Cuenta un material. Lleva lo que la vista previa mostró y la clave de quien autoriza.
import { contar } from "../../../../servidor/dominio/inventario.ts";
import { fila, kilosVistos, material, momento, texto, textoOpcional, uuid } from "../../../../servidor/forma.ts";
import { kilos } from "../../../../servidor/numeros.ts";
import { Rechazo, ruta } from "../../../../servidor/ruta.ts";

export const POST = ruta({ roles: ["mostrador", "responsable"] }, async ({ bd, cuerpo, persona, equipo }) => {
  // Quien autoriza sí viene en el cuerpo: es quien dice autorizar, y su clave —que comprueba la base— lo demuestra.
  const conteo = await contar(bd, persona.id, equipo.huella, {
    id: uuid(cuerpo.id, "el conteo"),
    material: material(cuerpo.material),
    contado: kilos(cuerpo.contado),
    contadoEn: momento(cuerpo.contadoEn, "el momento del conteo"),
    registrado: kilosVistos(cuerpo.registrado, "lo que decía el libro"),
    nota: textoOpcional(cuerpo.nota, "la nota", 300),
    autoriza: fila(cuerpo.autoriza, "quien autoriza"),
    clave: texto(cuerpo.clave, "la clave", 16),
  });
  if (!conteo) throw new Rechazo(401, "CLAVE", "La clave no pasó. Después de varios intentos se bloquea unos minutos.");
  return { conteo };
});
