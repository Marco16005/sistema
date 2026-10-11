// El nombre con que el mostrador reconoce la cuenta.
import { etiquetar } from "../../../../../servidor/dominio/cuentas.ts";
import { textoOpcional, uuid } from "../../../../../servidor/forma.ts";
import { ruta } from "../../../../../servidor/ruta.ts";

export const POST = ruta({ roles: ["mostrador", "responsable", "patio"] }, async ({ bd, cuerpo, parametros, persona, equipo }) => {
  const cuenta = uuid(parametros.cuenta, "la cuenta");
  return { cuenta: await etiquetar(bd, persona.id, cuenta, textoOpcional(cuerpo.etiqueta, "la etiqueta", 80)) };
});
