// Las cuentas abiertas, y abrir una.
import { abrirCuenta, cuentasAbiertas } from "../../../servidor/dominio/cuentas.ts";
import { textoOpcional, unoDe, uuid } from "../../../servidor/forma.ts";
import { ruta } from "../../../servidor/ruta.ts";

export const dynamic = "force-dynamic";

export const GET = ruta({ roles: ["mostrador", "responsable", "patio"] }, async ({ bd }) => ({ cuentas: await cuentasAbiertas(bd) }));

export const POST = ruta({ roles: ["mostrador", "responsable", "patio"] }, async ({ bd, cuerpo, persona }) => ({
  cuenta: await abrirCuenta(bd, persona.id, {
    id: uuid(cuerpo.id, "la cuenta"),
    tipo: unoDe(cuerpo.tipo, "el sentido de la cuenta", ["compra", "venta"]),
    etiqueta: textoOpcional(cuerpo.etiqueta, "la etiqueta", 80),
  }),
}));
