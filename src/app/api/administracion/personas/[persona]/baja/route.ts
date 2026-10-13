// Dar de baja a una persona de mostrador, de patio o de consulta: ya no entra, y su sesión se cierra.
import { claveQueNoPaso, claveTecleada } from "../../../../../../servidor/clave.ts";
import { bajaDePersona } from "../../../../../../servidor/dominio/administracion.ts";
import { fila } from "../../../../../../servidor/forma.ts";
import { ruta } from "../../../../../../servidor/ruta.ts";

export const POST = ruta({ roles: ["responsable"] }, async ({ bd, cuerpo, parametros, persona, equipo }) => {
  const hecho = await bajaDePersona(bd, persona.id, equipo.huella, { quien: fila(parametros.persona, "la persona"), clave: claveTecleada(cuerpo.clave) });
  if (!hecho) throw claveQueNoPaso();
  return { hecho: true };
});
