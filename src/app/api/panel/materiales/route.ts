// Los materiales del patio para quien dirige: cuánto hay de cada uno y qué tanto se mueve.
import { materialesDelPatio } from "../../../../servidor/dominio/materiales-del-panel.ts";
import { ruta } from "../../../../servidor/ruta.ts";

export const dynamic = "force-dynamic";

export const GET = ruta({ roles: ["responsable", "consulta"] }, async ({ bd }) => ({ patio: await materialesDelPatio(bd, {}) }));
