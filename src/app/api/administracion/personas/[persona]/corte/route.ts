// Dar o quitar a una persona de mostrador el permiso de hacer el corte del cajón. Lo pide un
// responsable facultado, con su clave.
import { claveQueNoPaso, claveTecleada } from "../../../../../../servidor/clave.ts";
import { permisoDeCorte } from "../../../../../../servidor/dominio/administracion.ts";
import { fila } from "../../../../../../servidor/forma.ts";
import { ErrorDeForma } from "../../../../../../servidor/numeros.ts";
import { ruta } from "../../../../../../servidor/ruta.ts";

export const POST = ruta({ roles: ["responsable"] }, async ({ bd, cuerpo, parametros, persona, equipo }) => {
  if (typeof cuerpo.puede !== "boolean") throw new ErrorDeForma("Falta decir si se da o se quita el permiso");
  const hecho = await permisoDeCorte(bd, persona.id, equipo.huella, {
    quien: fila(parametros.persona, "la persona"), puede: cuerpo.puede, clave: claveTecleada(cuerpo.clave),
  });
  if (!hecho) throw claveQueNoPaso();
  return { hecho: true };
});
