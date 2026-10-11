// En qué va el día: lo primero que pregunta la pantalla, y lo que vuelve a preguntar tras cada acción.
import { estadoDelDia } from "../../../servidor/dominio/dia.ts";
import { ruta } from "../../../servidor/ruta.ts";

export const dynamic = "force-dynamic";

export const GET = ruta({}, async ({ bd }) => ({ dia: await estadoDelDia(bd) }));
