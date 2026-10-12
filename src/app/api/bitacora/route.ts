// Lo que quedó anotado, con filtros para buscar y seguir leyendo.
import { bitacora } from "../../../servidor/dominio/bitacora.ts";
import { ruta } from "../../../servidor/ruta.ts";

export const dynamic = "force-dynamic";

export const GET = ruta({ roles: ["responsable", "consulta"] }, async ({ bd, peticion }) => {
  const parametros = new URL(peticion.url).searchParams;
  return bitacora(bd, {
    antes: parametros.get("antes"), persona: parametros.get("persona"), dia: parametros.get("dia"),
  });
});
