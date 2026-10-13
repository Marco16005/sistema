// La ficha de un cliente, con sus materiales, precios especiales y cuentas cobradas; y darlo de
// baja o reactivarlo, que es de un responsable. El nombre no se cambia aquí.
import { cambiarCliente, fichaDeCliente } from "../../../../servidor/dominio/clientes.ts";
import { fila, objeto } from "../../../../servidor/forma.ts";
import { ErrorDeForma } from "../../../../servidor/numeros.ts";
import { Rechazo, ruta } from "../../../../servidor/ruta.ts";

export const dynamic = "force-dynamic";

export const GET = ruta({ roles: ["responsable", "consulta"] }, async ({ bd, parametros }) => {
  const ficha = await fichaDeCliente(bd, parametros.cliente!);
  if (ficha === null) throw new Rechazo(404, "NO_EXISTE", "Ese cliente no existe");
  return { ficha };
});

export const POST = ruta({ roles: ["responsable"] }, async ({ bd, cuerpo, parametros, persona }) => {
  const cliente = fila(parametros.cliente, "el cliente");
  const o = objeto(cuerpo, "el cambio");
  if (typeof o.activo !== "boolean") throw new ErrorDeForma("Activo debe ser verdadero o falso");
  return { cliente: await cambiarCliente(bd, persona.id, cliente, o.activo) };
});
