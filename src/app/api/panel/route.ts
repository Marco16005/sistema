// El panel del negocio: lo de los últimos días, para quien dirige y para quien consulta. Quien
// atiende el mostrador o el patio no lo ve: es dinero de todos los días, no de su cuenta.
import { PERIODOS, panel } from "../../../servidor/dominio/panel.ts";
import type { Periodo } from "../../../servidor/dominio/panel.ts";
import { unoDe } from "../../../servidor/forma.ts";
import { ruta } from "../../../servidor/ruta.ts";

export const dynamic = "force-dynamic";

export const GET = ruta({ roles: ["responsable", "consulta"] }, async ({ bd, peticion }) => {
  const pedido = new URL(peticion.url).searchParams.get("dias");
  const dias = pedido === null ? 7 : (Number(unoDe(pedido, "el periodo", PERIODOS.map(String))) as Periodo);
  return { panel: await panel(bd, { dias }) };
});
