// La ficha de un material: lo que entró y salió, a cuánto el kilo, cuánto ha habido y lo que se le perdió.
import { fichaDeMaterial, PERIODOS_DE_MATERIAL } from "../../../../../servidor/dominio/materiales-del-panel.ts";
import type { PeriodoDeMaterial } from "../../../../../servidor/dominio/materiales-del-panel.ts";
import { material, unoDe } from "../../../../../servidor/forma.ts";
import { Rechazo, ruta } from "../../../../../servidor/ruta.ts";

export const dynamic = "force-dynamic";

export const GET = ruta({ roles: ["responsable", "consulta"] }, async ({ bd, parametros, peticion }) => {
  const cual = material(parametros.material);
  const pedido = new URL(peticion.url).searchParams.get("dias");
  const dias = pedido === null ? 30 : (Number(unoDe(pedido, "el periodo", PERIODOS_DE_MATERIAL.map(String))) as PeriodoDeMaterial);
  const ficha = await fichaDeMaterial(bd, cual, { dias });
  if (ficha === null) throw new Rechazo(404, "NO_EXISTE", "Ese material no existe");
  return { ficha };
});
