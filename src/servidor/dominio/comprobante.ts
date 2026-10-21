// El comprobante de una cuenta terminada, y el registro de cada vez que se manda a imprimir.
import type { Bd, Persona } from "../bd.ts";

export interface Comprobante {
  id: string;
  folio: string;
  tipo: "compra" | "venta";
  etiqueta: string | null;
  /**
   * A nombre de quién, solo si al cobrar llevaba precio especial; las demás son anónimas. Es el
   * nombre como estaba ese día. El comprobante no dice que el precio fue especial ni trae el de
   * lista: eso es del negocio, no del cliente.
   */
  cliente: string | null;
  /** Cuándo se confirmó, con fecha y hora del patio. */
  fecha: string;
  hora: string;
  /** Quien confirmó la cuenta. */
  atendio: string;
  /** Cómo se pagó o se cobró. */
  formaDePago: "efectivo" | "transferencia" | "credito";
  /** Si se fió: hasta cuándo debe pagar, si se pactó (AAAA-MM-DD). */
  credito: { vence: string | null } | null;
  materiales: Array<{
    nombre: string;
    bascula: string;
    bruto: string;
    tara: string;
    /** Lo que pesó vacío el recipiente, en la báscula chica; cero en la grande, donde la tara es el vehículo. */
    recipiente: string;
    descuento: string;
    /** Kilos que se pagan o se cobran. */
    kg: string;
    precio: string;
    importe: string;
  }>;
  suma: string;
  ajuste: string;
  /** En pesos cerrados: a pagar en una compra, a cobrar en una venta. */
  total: string;
  /** Cuántas veces se ha mandado a imprimir. */
  impresiones: number;
}

const CONSULTA = `
  SELECT o.id, o.folio::text AS folio, o.tipo, o.etiqueta, o.cliente_nombre AS cliente,
         to_char(o.confirmada_en AT TIME ZONE s.zona, 'YYYY-MM-DD') AS fecha,
         to_char(o.confirmada_en AT TIME ZONE s.zona, 'HH24:MI') AS hora,
         u.nombre AS atendio, o.forma_de_pago AS "formaDePago",
         (SELECT jsonb_build_object('vence', to_char(cr.vence_el, 'YYYY-MM-DD')) FROM credito cr WHERE cr.operacion_id = o.id) AS credito, o.suma::text AS suma, o.ajuste_redondeo::text AS ajuste, o.total::text AS total,
         (SELECT count(*)::int FROM impresion i WHERE i.operacion_id = o.id) AS impresiones,
         (SELECT jsonb_agg(jsonb_build_object(
                   'nombre', m.nombre, 'bascula', i.nombre, 'bruto', l.peso_bruto::text, 'tara', l.tara::text,
                   'recipiente', (CASE WHEN i.doble_pesaje THEN 0 ELSE l.tara END)::numeric(12,3)::text,
                   'descuento', l.descuento_kg::text, 'kg', l.peso_liquidable::text,
                   'precio', l.precio_unitario::text, 'importe', l.importe::text
                 ) ORDER BY l.creada_en, l.id)
          FROM operacion_linea l
          JOIN material m ON m.id = l.material_id
          JOIN instrumento i ON i.id = l.instrumento_id
          WHERE l.operacion_id = o.id) AS materiales
  FROM operacion o
  JOIN sucursal s ON s.id = o.sucursal_id
  JOIN usuario u ON u.id = o.confirmada_por
  WHERE o.estado = 'confirmada'`;

/** El comprobante de esa cuenta, si ya está terminada. Leerlo no cuenta como imprimirlo. */
export async function comprobante(bd: Bd, cuenta: string): Promise<Comprobante | null> {
  const [f] = await bd.leer<Comprobante>(`${CONSULTA} AND o.id = $1`, [cuenta]);
  return f ?? null;
}

export async function buscarPorFolio(bd: Bd, folio: string): Promise<Comprobante | null> {
  const [f] = await bd.leer<Comprobante>(`${CONSULTA} AND o.folio = $1`, [folio]);
  return f ?? null;
}

/**
 * Registra que el comprobante se manda a imprimir. La primera vez es el original; después es una
 * reimpresión y lleva motivo. Devuelve su número, que es el que sale impreso.
 */
export async function registrarImpresion(
  bd: Bd, persona: Persona, envio: { id: string; operacion: string; motivo: string | null },
): Promise<{ numero: number; motivo: string | null }> {
  return bd.enTransaccion(persona, async (c) => {
    const { rows } = await c.query("SELECT numero, motivo FROM registrar_impresion($1, $2, $3, $4)", [
      envio.id, envio.operacion, envio.motivo, persona,
    ]);
    return rows[0];
  });
}

/** El nombre que encabeza el comprobante. Es de la instalación, no de la base. */
export const negocio = (): string => process.env.NEGOCIO_NOMBRE ?? "Recicladora";
