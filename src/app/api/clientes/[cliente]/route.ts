// La ficha de un cliente, con sus materiales, precios especiales y cuentas cobradas.
import { fichaDeCliente } from "../../../../servidor/dominio/clientes.ts";
import { Rechazo, ruta } from "../../../../servidor/ruta.ts";

export const dynamic = "force-dynamic";

export const GET = ruta({ roles: ["responsable", "consulta"] }, async ({ bd, parametros }) => {
  const ficha = await fichaDeCliente(bd, parametros.cliente!);
  if (ficha === null) throw new Rechazo(404, "NO_EXISTE", "Ese cliente no existe");
  return { ficha };
});
