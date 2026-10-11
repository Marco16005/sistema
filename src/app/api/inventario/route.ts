// Lo que hay en el patio, por familia. Lo ve cualquiera que haya entrado.
import { existencias } from "../../../servidor/dominio/inventario.ts";
import { ruta } from "../../../servidor/ruta.ts";

export const dynamic = "force-dynamic";

export const GET = ruta({}, async ({ bd }) => ({ ...(await existencias(bd)) }));
