// Descarta la cuenta con todo lo que tenía.
import { descartar } from "../../../../../servidor/dominio/cuentas.ts";
import { uuid } from "../../../../../servidor/forma.ts";
import { ruta } from "../../../../../servidor/ruta.ts";

export const POST = ruta({ roles: ["mostrador", "responsable", "patio"] }, async ({ bd, cuerpo, parametros, persona, equipo }) => {
  const cuenta = uuid(parametros.cuenta, "la cuenta");
  await descartar(bd, persona.id, cuenta);
  return { bien: true };
});
