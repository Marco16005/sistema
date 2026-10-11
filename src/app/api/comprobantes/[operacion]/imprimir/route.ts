// Registra que el comprobante se manda a imprimir, antes de abrir el diálogo. Devuelve su número:
// 1 es el original; de ahí en adelante es reimpresión y lleva motivo.
import { comprobante, registrarImpresion, negocio } from "../../../../../servidor/dominio/comprobante.ts";
import { textoOpcional, uuid } from "../../../../../servidor/forma.ts";
import { ruta } from "../../../../../servidor/ruta.ts";

export const POST = ruta({ roles: ["mostrador", "responsable"] }, async ({ bd, cuerpo, parametros, persona }) => {
  const operacion = uuid(parametros.operacion, "la cuenta");
  const impresion = await registrarImpresion(bd, persona.id, {
    id: uuid(cuerpo.id, "la impresión"), operacion, motivo: textoOpcional(cuerpo.motivo, "el motivo", 200),
  });
  return { impresion, comprobante: await comprobante(bd, operacion), negocio: negocio() };
});
