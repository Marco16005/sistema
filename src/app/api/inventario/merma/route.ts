// Material que se descarta: sale del patio, con su motivo.
import { darMerma } from "../../../../servidor/dominio/inventario.ts";
import { material, textoConAlgo, uuid } from "../../../../servidor/forma.ts";
import { kilos } from "../../../../servidor/numeros.ts";
import { ruta } from "../../../../servidor/ruta.ts";

export const POST = ruta({ roles: ["mostrador", "responsable"] }, async ({ bd, cuerpo, persona }) => ({
  merma: await darMerma(bd, persona.id, {
    id: uuid(cuerpo.id, "la merma"),
    material: material(cuerpo.material),
    kg: kilos(cuerpo.kg),
    motivo: textoConAlgo(cuerpo.motivo, "el motivo", 300),
  }),
}));
