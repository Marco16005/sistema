// Las hojas del negocio, como archivo para Excel, para quien dirige y quien consulta.
import { HOJAS, comoCsv, tablaPara } from "../../../servidor/dominio/exportar.ts";
import { unoDe } from "../../../servidor/forma.ts";
import { ruta } from "../../../servidor/ruta.ts";

export const dynamic = "force-dynamic";

export const GET = ruta({ roles: ["responsable", "consulta"] }, async ({ bd, peticion }) => {
  const consulta = new URL(peticion.url).searchParams;
  const hoja = unoDe(consulta.get("hoja"), "la hoja", HOJAS);
  const desde = consulta.get("desde") ?? "";
  const hasta = consulta.get("hasta") ?? "";
  const tabla = await tablaPara(bd, { hoja, desde, hasta });
  return new Response(comoCsv(tabla), { headers: {
    "content-type": "text/csv; charset=utf-8",
    "content-disposition": `attachment; filename="${hoja}-${desde}-a-${hasta}.csv"`,
    "cache-control": "no-store",
  } });
});
