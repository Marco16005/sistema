// La ganancia para quien dirige: lo vendido, lo que costó, lo perdido y el patio a costo. Se pide
// por cuántos días terminando hoy (7, 30, 91 o 365) o de tal día a tal día, hasta un año; y en
// tramos de un día, una semana o un mes. Sin decir el tramo, el que se lee mejor según el largo.
import { AGRUPAR, ganancia } from "../../../../servidor/dominio/ganancia.ts";
import type { Agrupar } from "../../../../servidor/dominio/ganancia.ts";
import { TOPE_DE_DIAS } from "../../../../servidor/dominio/panel.ts";
import { estadoDelDia } from "../../../../servidor/dominio/dia.ts";
import { dia, unoDe } from "../../../../servidor/forma.ts";
import { ErrorDeForma } from "../../../../servidor/numeros.ts";
import { ruta } from "../../../../servidor/ruta.ts";

export const dynamic = "force-dynamic";

const PERIODOS = ["7", "30", "91", "365"] as const;
const restar = (fecha: string, dias: number): string => new Date(Date.parse(`${fecha}T00:00:00Z`) - dias * 86_400_000).toISOString().slice(0, 10);
const largo = (desde: string, hasta: string): number => Math.round((Date.parse(`${hasta}T00:00:00Z`) - Date.parse(`${desde}T00:00:00Z`)) / 86_400_000) + 1;

export const GET = ruta({ roles: ["responsable", "consulta"] }, async ({ bd, peticion }) => {
  const consulta = new URL(peticion.url).searchParams;
  const [pedido, d, h, a] = [consulta.get("dias"), consulta.get("desde"), consulta.get("hasta"), consulta.get("agrupar")];
  let desde: string;
  let hasta: string;
  if (d !== null || h !== null) {
    if (pedido !== null) throw new ErrorDeForma("El periodo se pide por días o de tal día a tal día, no de las dos maneras");
    desde = dia(d, "el primer día");
    hasta = dia(h, "el último día");
    if (desde > hasta) throw new ErrorDeForma("El primer día del periodo no puede ser posterior al último");
    if (largo(desde, hasta) > TOPE_DE_DIAS) throw new ErrorDeForma("En la ganancia cabe hasta un año: pide un periodo más corto");
  } else {
    const dias = pedido === null ? 30 : Number(unoDe(pedido, "el periodo", PERIODOS));
    hasta = (await estadoDelDia(bd)).hoy;
    desde = restar(hasta, dias - 1);
  }
  const dias = largo(desde, hasta);
  const agrupar: Agrupar = a === null ? (dias <= 31 ? "dia" : dias <= 183 ? "semana" : "mes") : unoDe(a, "cómo se agrupa", AGRUPAR);
  return { ganancia: await ganancia(bd, { desde, hasta, agrupar }) };
});
