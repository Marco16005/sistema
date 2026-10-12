// La historia de precios, para quien dirige y quien consulta.
import { historiaDePrecios, PERIODOS_DE_PRECIOS } from "../../../../servidor/dominio/historia-de-precios.ts";
import type { PeriodoDePrecios } from "../../../../servidor/dominio/historia-de-precios.ts";
import { unoDe } from "../../../../servidor/forma.ts";
import { ruta } from "../../../../servidor/ruta.ts";

export const dynamic = "force-dynamic";

export const GET = ruta({ roles: ["responsable", "consulta"] }, async ({ bd, peticion }) => {
  const pedido = new URL(peticion.url).searchParams.get("dias");
  const dias = pedido === null ? 30 : (Number(unoDe(pedido, "el periodo", PERIODOS_DE_PRECIOS.map(String))) as PeriodoDePrecios);
  return { historia: await historiaDePrecios(bd, { dias }) };
});
