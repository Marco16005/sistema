// Los movimientos de un material, del más reciente al más viejo.
import { movimientosDe } from "../../../../../servidor/dominio/inventario.ts";
import { material } from "../../../../../servidor/forma.ts";
import { Rechazo, ruta } from "../../../../../servidor/ruta.ts";

export const dynamic = "force-dynamic";

export const GET = ruta({}, async ({ bd, parametros }) => {
  const m = await movimientosDe(bd, material(parametros.material));
  if (!m) throw new Rechazo(404, "NO_ESTA", "Ese material no existe");
  return { ...m };
});
