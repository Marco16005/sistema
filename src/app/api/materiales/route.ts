// El catálogo completo y sus altas son del responsable; los precios se ponen en su propia lista.
import { altaDeMaterial, materialesDelCatalogo } from "../../../servidor/dominio/materiales.ts";
import { entero, objeto, texto } from "../../../servidor/forma.ts";
import { ErrorDeForma } from "../../../servidor/numeros.ts";
import { ruta } from "../../../servidor/ruta.ts";

export const dynamic = "force-dynamic";

export const GET = ruta({ roles: ["responsable"] }, async ({ bd }) => ({ ...(await materialesDelCatalogo(bd)) }));

export const POST = ruta({ roles: ["responsable"] }, async ({ bd, cuerpo, persona }) => {
  const o = objeto(cuerpo, "el material");
  const familia = entero(o.familia, "la familia");
  if (familia < 1 || familia > 32_767) throw new ErrorDeForma("La familia no tiene la forma esperada");
  if (typeof o.frecuente !== "boolean") throw new ErrorDeForma("Frecuente debe ser verdadero o falso");
  return { material: await altaDeMaterial(bd, persona.id, {
    familia, nombre: texto(o.nombre, "el nombre", 1000), nombreCorto: texto(o.nombreCorto, "el nombre corto", 1000),
    frecuente: o.frecuente,
  }) };
});
