// Busca un comprobante por su folio.
import { buscarPorFolio, negocio } from "../../../servidor/dominio/comprobante.ts";
import { fila } from "../../../servidor/forma.ts";
import { Rechazo, ruta } from "../../../servidor/ruta.ts";

export const dynamic = "force-dynamic";

export const GET = ruta({ roles: ["mostrador", "responsable", "consulta"] }, async ({ bd, peticion }) => {
  const comprobante = await buscarPorFolio(bd, fila(new URL(peticion.url).searchParams.get("folio"), "el folio"));
  if (!comprobante) throw new Rechazo(404, "NO_ESTA", "No hay ningún comprobante con ese folio");
  return { comprobante, negocio: negocio() };
});
