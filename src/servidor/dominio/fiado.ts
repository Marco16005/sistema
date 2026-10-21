// El fiado (migración 0041): ventas a crédito a clientes conocidos, con la clave de una persona
// facultada, y los abonos que van llegando. Solo se fían ventas; no hay adelantos ni compras a
// crédito. Las reglas son de la base; aquí se le pregunta y se lee.
import type { Bd, Persona } from "../bd.ts";
import { comoQuedo } from "./cuentas.ts";
import type { Cuenta } from "./cuentas.ts";

export interface SaldoDeCliente {
  cliente: string;
  nombre: string;
  /** Lo fiado, lo abonado y lo que debe, en pesos. */
  fiado: string;
  abonado: string;
  debe: string;
  /** Lo que debe de ventas cuyo plazo ya pasó, aplicando los abonos a lo más viejo. */
  vencido: string;
  /** AAAA-MM-DD: la primera y la última venta fiada, y el último abono (nada si ninguno). */
  primeraVenta: string;
  ultimaVenta: string;
  ultimoAbono: string | null;
}

/** Los clientes con algo fiado: primero los que deben, del que más debe al que menos; después los que ya pagaron. */
export const saldos = (bd: Bd): Promise<SaldoDeCliente[]> =>
  bd.leer<SaldoDeCliente>(
    `SELECT s.cliente_id::text AS cliente, s.nombre, s.fiado::numeric(14,2)::text AS fiado, s.abonado::numeric(14,2)::text AS abonado,
            s.debe::numeric(14,2)::text AS debe, s.vencido::numeric(14,2)::text AS vencido,
            to_char(s.primera_venta AT TIME ZONE z.zona, 'YYYY-MM-DD') AS "primeraVenta",
            to_char(s.ultima_venta AT TIME ZONE z.zona, 'YYYY-MM-DD') AS "ultimaVenta",
            to_char(s.ultimo_abono AT TIME ZONE z.zona, 'YYYY-MM-DD') AS "ultimoAbono"
     FROM saldo_de_clientes s, (SELECT zona FROM sucursal WHERE id = 1) z
     ORDER BY s.tiene_deuda DESC, s.debe DESC, s.nombre`,
  );

export interface OrdenDeFiar {
  revision: number;
  /** Un cliente que ya existe, o el nombre de uno nuevo: uno de los dos. */
  cliente: string | null;
  clienteNuevo: string | null;
  /** La fecha en que debe pagar, si se pactó (AAAA-MM-DD). */
  vence: string | null;
  autoriza: string;
  clave: string;
}

/** Cobra la venta a crédito. Nada si la clave de quien autoriza no pasó: el intento queda contado. */
export async function fiar(bd: Bd, persona: Persona, huella: string, cuenta: string, o: OrdenDeFiar): Promise<Cuenta | null> {
  const hecha = await bd.enTransaccion(persona, async (c) =>
    (await c.query("SELECT id FROM cobrar_a_credito($1, $2, $3, $4, $5, $6, $7, $8, $9)",
      [cuenta, persona, o.revision, o.cliente, o.clienteNuevo, o.vence, o.autoriza, o.clave, huella])).rows[0]);
  if (!hecha || hecha.id === null) return null;
  return comoQuedo(bd, cuenta);
}

export interface OrdenDeAbono {
  /** El identificador del envío: repetirlo no abona dos veces. */
  id: string;
  cliente: string;
  importe: string;
  forma: "efectivo" | "transferencia";
  nota: string | null;
}

/** Registra un abono de un cliente. En efectivo entra al cajón de hoy. */
export async function registrarAbono(bd: Bd, persona: Persona, o: OrdenDeAbono): Promise<SaldoDeCliente[]> {
  await bd.enTransaccion(persona, (c) =>
    c.query("SELECT registrar_abono($1, $2, $3, $4, $5, $6)", [o.id, o.cliente, o.importe, o.forma, o.nota, persona]));
  return saldos(bd);
}
