// Ponerle una clave nueva a una persona de mostrador, de patio o de consulta: la anterior deja de
// servir y se le quita el bloqueo. Contesta con la nueva, que se ve esta sola vez.
import { claveQueNoPaso, claveTecleada, unaSolaVez } from "../../../../../../servidor/clave.ts";
import { cambiarClaveDePersona } from "../../../../../../servidor/dominio/administracion.ts";
import { fila } from "../../../../../../servidor/forma.ts";
import { ruta } from "../../../../../../servidor/ruta.ts";

export const POST = ruta({ roles: ["responsable"] }, async ({ bd, cuerpo, parametros, persona, equipo }) => {
  const nueva = await cambiarClaveDePersona(bd, persona.id, equipo.huella, { quien: fila(parametros.persona, "la persona"), clave: claveTecleada(cuerpo.clave) });
  if (!nueva) throw claveQueNoPaso();
  return unaSolaVez({ ...nueva });
});
