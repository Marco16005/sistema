// Guarda en este equipo si la pantalla va con más contraste. No pide sesión ni equipo dado de alta
// y no toca la base: tiene que servir en la pantalla de entrada, con la base caída y en mantenimiento.
import { galletaDeContraste } from "../../../../servidor/contraste.ts";
import { unoDe } from "../../../../servidor/forma.ts";
import { conCookie, rutaSinBase } from "../../../../servidor/ruta.ts";

export const POST = rutaSinBase(async ({ cuerpo }) => {
  const contraste = unoDe(cuerpo.contraste, "el contraste", ["alto", "normal"] as const);
  return conCookie({ contraste }, galletaDeContraste(contraste));
});
