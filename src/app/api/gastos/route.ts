// Los gastos del negocio: los de un periodo (sin decirlo, lo que va del mes), y registrar uno. Los
// registra un responsable; quien consulta los ve.
import { estadoDelDia } from "../../../servidor/dominio/dia.ts";
import { gastos, registrarGasto } from "../../../servidor/dominio/gastos.ts";
import { dia, fila, textoConAlgo, unoDe, uuid } from "../../../servidor/forma.ts";
import { ErrorDeForma, pesos } from "../../../servidor/numeros.ts";
import { ruta } from "../../../servidor/ruta.ts";

export const dynamic = "force-dynamic";

export const GET = ruta({ roles: ["responsable", "consulta"] }, async ({ bd, peticion }) => {
  const consulta = new URL(peticion.url).searchParams;
  const [d, h] = [consulta.get("desde"), consulta.get("hasta")];
  const hoy = (await estadoDelDia(bd)).hoy;
  const desde = d === null ? `${hoy.slice(0, 8)}01` : dia(d, "el primer día");
  const hasta = h === null ? hoy : dia(h, "el último día");
  if (desde > hasta) throw new ErrorDeForma("El primer día del periodo no puede ser posterior al último");
  return { gastos: await gastos(bd, { desde, hasta }) };
});

export const POST = ruta({ roles: ["responsable"] }, async ({ bd, cuerpo, persona }) => {
  await registrarGasto(bd, persona.id, {
    id: uuid(cuerpo.id, "el gasto"),
    fecha: dia(cuerpo.fecha, "la fecha del gasto"),
    tipo: fila(cuerpo.tipo, "el tipo de gasto"),
    concepto: textoConAlgo(cuerpo.concepto, "el concepto", 200),
    importe: pesos(cuerpo.importe, "El gasto"),
    deDonde: unoDe(cuerpo.deDonde, "de dónde salió", ["cajon", "otro"] as const),
    movimiento: cuerpo.movimiento === undefined || cuerpo.movimiento === null ? null : fila(cuerpo.movimiento, "el movimiento del cajón"),
  });
  return { hecho: true };
});
