// El cajón de un día: con cuánto se abrió, lo que entró y salió, cuánto debería haber y sus cortes.
// Sin decir cuál, el de la jornada abierta (o la última).
import { estadoDelCajon } from "../../../servidor/dominio/caja.ts";
import { fila } from "../../../servidor/forma.ts";
import { ruta } from "../../../servidor/ruta.ts";

export const dynamic = "force-dynamic";

export const GET = ruta({ roles: ["mostrador", "responsable", "consulta"] }, async ({ bd, peticion }) => {
  const pedida = new URL(peticion.url).searchParams.get("jornada");
  return { cajon: await estadoDelCajon(bd, pedida === null ? null : fila(pedida, "la jornada")) };
});
