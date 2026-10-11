// Da un precio especial a un material de la cuenta: para un cliente, con una diferencia por kilo
// respecto del precio de lista, y con la clave de quien autoriza. Dice qué cambio de precio le vio
// la pantalla a ese material: si ya tiene otro, la petición llegó tarde y no pisa nada.
import { darPrecioEspecial } from "../../../../../servidor/dominio/precio-especial.ts";
import { fila, texto, textoOpcional, uuid } from "../../../../../servidor/forma.ts";
import { ErrorDeForma } from "../../../../../servidor/numeros.ts";
import { Rechazo, ruta } from "../../../../../servidor/ruta.ts";

export const POST = ruta({ roles: ["mostrador", "responsable"] }, async ({ bd, cuerpo, parametros, persona, equipo }) => {
  // La diferencia viaja como texto, tal como se tecleó: un número de máquina ya perdió decimales.
  if (typeof cuerpo.diferencia !== "string" || !/^-?\d{1,5}(\.\d{1,4})?$/.test(cuerpo.diferencia)) {
    throw new ErrorDeForma("La diferencia se escribe en pesos por kilo, con punto y hasta cuatro decimales");
  }
  const cuenta = await darPrecioEspecial(bd, persona.id, equipo.huella, {
    id: uuid(cuerpo.id, "el envío"),
    cuenta: uuid(parametros.cuenta, "la cuenta"),
    linea: uuid(cuerpo.linea, "el material"),
    visto: cuerpo.visto === null ? null : fila(cuerpo.visto, "lo que se vio"),
    cliente: cuerpo.cliente === null || cuerpo.cliente === undefined ? null : fila(cuerpo.cliente, "el cliente"),
    clienteNuevo: textoOpcional(cuerpo.clienteNuevo, "el nombre del cliente", 80),
    diferencia: cuerpo.diferencia,
    autoriza: fila(cuerpo.autoriza, "quien autoriza"),
    clave: texto(cuerpo.clave, "la clave", 16),
  });
  if (!cuenta) throw new Rechazo(401, "CLAVE", "La clave no pasó. Después de varios intentos se bloquea unos minutos.");
  return { cuenta };
});
