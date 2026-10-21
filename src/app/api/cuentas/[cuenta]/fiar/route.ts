// Cobrar una venta a crédito: a nombre de un cliente conocido (o uno nuevo), con la fecha en que
// debe pagar si se pactó, y la clave de una persona facultada. No pasa por el cajón.
import { claveQueNoPaso, claveTecleada } from "../../../../../servidor/clave.ts";
import { fiar } from "../../../../../servidor/dominio/fiado.ts";
import { dia, entero, fila, textoOpcional, uuid } from "../../../../../servidor/forma.ts";
import { ErrorDeForma } from "../../../../../servidor/numeros.ts";
import { ruta } from "../../../../../servidor/ruta.ts";

export const POST = ruta({ roles: ["mostrador", "responsable"] }, async ({ bd, cuerpo, parametros, persona, equipo }) => {
  const cliente = cuerpo.cliente === undefined || cuerpo.cliente === null ? null : fila(cuerpo.cliente, "el cliente");
  const clienteNuevo = textoOpcional(cuerpo.clienteNuevo, "el nombre del cliente nuevo", 80);
  if ((cliente === null) === (clienteNuevo === null)) throw new ErrorDeForma("Se dice un cliente que ya existe, o el nombre de uno nuevo: uno de los dos");
  const hecha = await fiar(bd, persona.id, equipo.huella, uuid(parametros.cuenta, "la cuenta"), {
    revision: entero(cuerpo.revision, "la revisión"),
    cliente, clienteNuevo,
    vence: cuerpo.vence === undefined || cuerpo.vence === null ? null : dia(cuerpo.vence, "hasta cuándo paga"),
    autoriza: fila(cuerpo.autoriza, "quien autoriza"),
    clave: claveTecleada(cuerpo.clave),
  });
  if (!hecha) throw claveQueNoPaso();
  return { cuenta: hecha };
});
