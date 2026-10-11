// Quita un material de la cuenta.
import { quitarMaterial } from "../../../../../servidor/dominio/cuentas.ts";
import { uuid } from "../../../../../servidor/forma.ts";
import { ruta } from "../../../../../servidor/ruta.ts";

export const POST = ruta({ roles: ["mostrador", "responsable", "patio"] }, async ({ bd, cuerpo, parametros, persona, equipo }) => {
  const cuenta = uuid(parametros.cuenta, "la cuenta");
  return { cuenta: await quitarMaterial(bd, persona.id, cuenta, uuid(cuerpo.linea, "el material")) };
});
