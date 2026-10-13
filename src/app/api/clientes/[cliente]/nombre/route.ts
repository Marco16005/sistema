// Cambiarle el nombre a un cliente: es de un responsable. Lo ya cobrado conserva el nombre que el
// cliente tenía ese día.
import { cambiarNombreDeCliente } from "../../../../../servidor/dominio/clientes.ts";
import { fila, objeto, texto } from "../../../../../servidor/forma.ts";
import { ruta } from "../../../../../servidor/ruta.ts";

export const dynamic = "force-dynamic";

export const POST = ruta({ roles: ["responsable"] }, async ({ bd, cuerpo, parametros, persona }) => {
  const cliente = fila(parametros.cliente, "el cliente");
  const o = objeto(cuerpo, "el cambio");
  return { cliente: await cambiarNombreDeCliente(bd, persona.id, cliente, texto(o.nombre, "el nombre", 1000)) };
});
