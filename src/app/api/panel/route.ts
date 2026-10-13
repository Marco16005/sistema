// El panel del negocio: lo de los últimos días, o de tal día a tal día, para quien dirige y para
// quien consulta. Quien atiende el mostrador o el patio no lo ve: es dinero de todos los días, no
// de su cuenta.
import { PERIODOS, panel } from "../../../servidor/dominio/panel.ts";
import type { Periodo } from "../../../servidor/dominio/panel.ts";
import { dia, unoDe } from "../../../servidor/forma.ts";
import { ErrorDeForma } from "../../../servidor/numeros.ts";
import { ruta } from "../../../servidor/ruta.ts";

export const dynamic = "force-dynamic";

export const GET = ruta({ roles: ["responsable", "consulta"] }, async ({ bd, peticion }) => {
  const consulta = new URL(peticion.url).searchParams;
  const [pedido, desde, hasta] = [consulta.get("dias"), consulta.get("desde"), consulta.get("hasta")];
  if (desde !== null || hasta !== null) {
    if (pedido !== null) throw new ErrorDeForma("El periodo se pide por días o de tal día a tal día, no de las dos maneras");
    return { panel: await panel(bd, { desde: dia(desde, "el primer día"), hasta: dia(hasta, "el último día") }) };
  }
  const dias = pedido === null ? 7 : (Number(unoDe(pedido, "el periodo", PERIODOS.map(String))) as Periodo);
  return { panel: await panel(bd, { dias }) };
});
