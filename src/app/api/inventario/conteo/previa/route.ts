// Lo que se ve antes de autorizar un conteo: la hora, ya fija, lo que el libro decía y la diferencia.
// No escribe nada.
import { previaDeConteo } from "../../../../../servidor/dominio/inventario.ts";
import { hora, material } from "../../../../../servidor/forma.ts";
import { kilos } from "../../../../../servidor/numeros.ts";
import { ruta } from "../../../../../servidor/ruta.ts";

export const POST = ruta({ roles: ["mostrador", "responsable"] }, async ({ bd, cuerpo }) => ({
  previa: await previaDeConteo(
    bd, material(cuerpo.material), kilos(cuerpo.contado),
    cuerpo.hora === undefined || cuerpo.hora === null ? null : hora(cuerpo.hora, "la hora"),
  ),
}));
