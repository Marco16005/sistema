// Pedir un código para dar de alta un equipo nuevo. El código se ve esta sola vez, sirve una vez y
// vence en quince minutos: se teclea en la pantalla del equipo nuevo.
import { claveQueNoPaso, claveTecleada, unaSolaVez } from "../../../../servidor/clave.ts";
import { codigoParaEquipo } from "../../../../servidor/dominio/administracion.ts";
import { textoConAlgo } from "../../../../servidor/forma.ts";
import { ruta } from "../../../../servidor/ruta.ts";

export const POST = ruta({ roles: ["responsable"] }, async ({ bd, cuerpo, persona, equipo }) => {
  const codigo = await codigoParaEquipo(bd, persona.id, equipo.huella, {
    nombre: textoConAlgo(cuerpo.nombre, "el nombre del equipo", 80), clave: claveTecleada(cuerpo.clave),
  });
  if (!codigo) throw claveQueNoPaso();
  return unaSolaVez({ codigo });
});
