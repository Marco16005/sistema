// Los días del patio, del más reciente al más viejo.
import { diasDelHistorial } from "../../../servidor/dominio/historial.ts";
import { ruta } from "../../../servidor/ruta.ts";

export const dynamic = "force-dynamic";

export const GET = ruta({ roles: ["responsable", "consulta"] }, async ({ bd, peticion }) =>
  diasDelHistorial(bd, { antes: new URL(peticion.url).searchParams.get("antes") }));
