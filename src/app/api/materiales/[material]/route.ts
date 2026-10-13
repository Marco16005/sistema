// Un material conserva su nombre y familia: aquí solo cambian vigencia y frecuencia.
import { cambiarMaterial } from "../../../../servidor/dominio/materiales.ts";
import { material, objeto } from "../../../../servidor/forma.ts";
import { ErrorDeForma } from "../../../../servidor/numeros.ts";
import { ruta } from "../../../../servidor/ruta.ts";

export const dynamic = "force-dynamic";

export const POST = ruta({ roles: ["responsable"] }, async ({ bd, cuerpo, parametros, persona }) => {
  const o = objeto(cuerpo, "el cambio");
  if (o.activo !== undefined && typeof o.activo !== "boolean") throw new ErrorDeForma("Activo debe ser verdadero o falso");
  if (o.frecuente !== undefined && typeof o.frecuente !== "boolean") throw new ErrorDeForma("Frecuente debe ser verdadero o falso");
  return { material: await cambiarMaterial(bd, persona.id, material(parametros.material), {
    activo: o.activo ?? null, frecuente: o.frecuente ?? null,
  }) };
});
