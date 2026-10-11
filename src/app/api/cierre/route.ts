// El resumen del día: lo asentado y lo que falta por terminar.
import { resumenDelCierre } from "../../../servidor/dominio/cierre.ts";
import { ruta } from "../../../servidor/ruta.ts";

export const dynamic = "force-dynamic";

export const GET = ruta({}, async ({ bd }) => ({ cierre: await resumenDelCierre(bd) }));
