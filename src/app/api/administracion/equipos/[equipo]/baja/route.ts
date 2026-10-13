// Dar de baja un equipo: deja de valer, y quien atendía en él queda afuera. No el equipo desde el
// que se pide.
import { claveQueNoPaso, claveTecleada } from "../../../../../../servidor/clave.ts";
import { bajaDeEquipo } from "../../../../../../servidor/dominio/administracion.ts";
import { uuid } from "../../../../../../servidor/forma.ts";
import { ruta } from "../../../../../../servidor/ruta.ts";

export const POST = ruta({ roles: ["responsable"] }, async ({ bd, cuerpo, parametros, persona, equipo }) => {
  const hecho = await bajaDeEquipo(bd, persona.id, equipo.huella, { equipo: uuid(parametros.equipo, "el equipo"), clave: claveTecleada(cuerpo.clave) });
  if (!hecho) throw claveQueNoPaso();
  return { hecho: true };
});
