// Quiénes pueden autorizar un conteo o una corrección, para elegirse en la pantalla.
import { quienesAutorizan } from "../../../../servidor/dominio/inventario.ts";
import { ruta } from "../../../../servidor/ruta.ts";

export const dynamic = "force-dynamic";

export const GET = ruta({ roles: ["mostrador", "responsable"] }, async ({ bd }) => ({ personas: await quienesAutorizan(bd) }));
