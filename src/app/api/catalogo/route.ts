// Los materiales con el precio de hoy, según la cuenta sea de compra o de venta, y las básculas.
import { catalogo } from "../../../servidor/dominio/catalogo.ts";
import { unoDe } from "../../../servidor/forma.ts";
import { ruta } from "../../../servidor/ruta.ts";

export const dynamic = "force-dynamic";

export const GET = ruta({ roles: ["mostrador", "responsable", "patio"] }, async ({ bd, peticion }) => {
  const tipo = unoDe(new URL(peticion.url).searchParams.get("tipo"), "el sentido de la cuenta", ["compra", "venta"]);
  return { ...(await catalogo(bd, tipo)) };
});
