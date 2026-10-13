// Dar de alta a una persona de mostrador, de patio o de consulta, con la clave de quien lo pide.
// Contesta con la clave de la persona nueva, que se ve esta sola vez.
import { claveQueNoPaso, claveTecleada, unaSolaVez } from "../../../../servidor/clave.ts";
import { ROLES, altaDePersona } from "../../../../servidor/dominio/administracion.ts";
import { textoConAlgo, unoDe } from "../../../../servidor/forma.ts";
import { ruta } from "../../../../servidor/ruta.ts";

export const POST = ruta({ roles: ["responsable"] }, async ({ bd, cuerpo, persona, equipo }) => {
  const alta = await altaDePersona(bd, persona.id, equipo.huella, {
    nombre: textoConAlgo(cuerpo.nombre, "el nombre de la persona", 80),
    // Cualquier rol que exista tiene forma; que desde aquí no se dé de alta a un responsable lo dice la base.
    rol: unoDe(cuerpo.rol, "el rol", ROLES),
    clave: claveTecleada(cuerpo.clave),
  });
  if (!alta) throw claveQueNoPaso();
  return unaSolaVez({ ...alta });
});
