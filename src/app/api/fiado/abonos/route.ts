// Un abono de un cliente que debe: cuánto, en efectivo (entra al cajón de hoy) o por transferencia.
import { registrarAbono } from "../../../../servidor/dominio/fiado.ts";
import { fila, textoOpcional, unoDe, uuid } from "../../../../servidor/forma.ts";
import { pesos } from "../../../../servidor/numeros.ts";
import { ruta } from "../../../../servidor/ruta.ts";

export const POST = ruta({ roles: ["mostrador", "responsable"] }, async ({ bd, cuerpo, persona }) => ({
  clientes: await registrarAbono(bd, persona.id, {
    id: uuid(cuerpo.id, "el abono"),
    cliente: fila(cuerpo.cliente, "el cliente"),
    importe: pesos(cuerpo.importe, "Lo que abona"),
    forma: unoDe(cuerpo.forma, "cómo pagó", ["efectivo", "transferencia"] as const),
    nota: textoOpcional(cuerpo.nota, "la nota", 200),
  }),
}));
