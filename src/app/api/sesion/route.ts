// Quién atiende en este equipo ahora, si hay alguien.
import { ruta } from "../../../servidor/ruta.ts";

export const dynamic = "force-dynamic";

export const GET = ruta({ acceso: "equipo" }, async ({ persona }) => ({ persona }));
