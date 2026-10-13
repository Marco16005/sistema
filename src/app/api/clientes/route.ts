// Los clientes a los que se les puede dar precio especial: la lista para elegirlos en el mostrador,
// y el alta, que es de un responsable (también nacen en el mostrador, al darles el primero).
import { altaDeCliente } from "../../../servidor/dominio/clientes.ts";
import { clientes } from "../../../servidor/dominio/precio-especial.ts";
import { objeto, texto } from "../../../servidor/forma.ts";
import { ruta } from "../../../servidor/ruta.ts";

export const dynamic = "force-dynamic";

export const GET = ruta({ roles: ["mostrador", "responsable"] }, async ({ bd }) => ({ clientes: await clientes(bd) }));

export const POST = ruta({ roles: ["responsable"] }, async ({ bd, cuerpo, persona }) => {
  const o = objeto(cuerpo, "el cliente");
  return { cliente: await altaDeCliente(bd, persona.id, texto(o.nombre, "el nombre", 1000)) };
});
