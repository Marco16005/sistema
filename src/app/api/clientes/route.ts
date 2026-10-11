// Los clientes a los que se les puede dar precio especial, para elegirlos en la pantalla.
import { clientes } from "../../../servidor/dominio/precio-especial.ts";
import { ruta } from "../../../servidor/ruta.ts";

export const dynamic = "force-dynamic";

export const GET = ruta({ roles: ["mostrador", "responsable"] }, async ({ bd }) => ({ clientes: await clientes(bd) }));
