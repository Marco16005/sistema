// Los días del patio y las cuentas que se asentaron en cada uno.
import type { Bd } from "../bd.ts";
import { fila } from "../forma.ts";
import { ErrorDeForma } from "../numeros.ts";

export interface DiaDelHistorial {
  jornada: string;
  fecha: string;
  abierta: boolean;
  cierres: number;
  cuentas: number;
  aPagar: string;
  aCobrar: string;
}

/** Los días que ha habido, del más reciente al más viejo. */
export async function diasDelHistorial(
  bd: Bd, o: { antes?: string | null; cuantos?: number } = {},
): Promise<{ dias: DiaDelHistorial[]; hayMas: boolean }> {
  const antes = o.antes ?? null;
  if (antes !== null) {
    const fecha = new Date(`${antes}T00:00:00Z`);
    if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(antes) || antes.startsWith("0000") ||
        !Number.isFinite(fecha.getTime()) || fecha.toISOString().slice(0, 10) !== antes) {
      throw new ErrorDeForma("La fecha debe ser válida y escribirse AAAA-MM-DD");
    }
  }
  const pedido = o.cuantos ?? 31;
  if (!Number.isSafeInteger(pedido) || pedido < 1) throw new ErrorDeForma("La cantidad de días debe ser un entero positivo");
  const cuantos = Math.min(pedido, 100);
  const filas = await bd.leer(
    `SELECT j.id::text AS jornada, to_char(j.fecha, 'YYYY-MM-DD') AS fecha,
            j.cerrada_en IS NULL AS abierta, j.cierres, r.operaciones AS cuentas,
            r.total_compras::text AS a_pagar, r.total_ventas::text AS a_cobrar
     FROM jornada j JOIN cierre_resumen r ON r.jornada_id = j.id
     WHERE j.sucursal_id = 1 AND ($1::date IS NULL OR j.fecha < $1)
     ORDER BY j.fecha DESC LIMIT ($2::int + 1)`,
    [antes, cuantos],
  );
  return {
    dias: filas.slice(0, cuantos).map((f) => ({
      jornada: f.jornada, fecha: f.fecha, abierta: f.abierta, cierres: f.cierres,
      cuentas: f.cuentas, aPagar: f.a_pagar, aCobrar: f.a_cobrar,
    })),
    hayMas: filas.length > cuantos,
  };
}

export interface CuentaDelDia {
  id: string;
  folio: string;
  tipo: "compra" | "venta";
  hora: string;
  cliente: string | null;
  etiqueta: string | null;
  materiales: number;
  total: string;
  atendio: string;
}

/** Las cuentas que se asentaron en esa jornada, por folio. null si esa jornada no existe. */
export async function cuentasDelDia(bd: Bd, jornada: string): Promise<CuentaDelDia[] | null> {
  const id = fila(jornada, "la jornada");
  const [f] = await bd.leer(
    `SELECT coalesce((
       SELECT jsonb_agg(jsonb_build_object(
         'id', o.id, 'folio', o.folio::text, 'tipo', o.tipo,
         'hora', to_char(o.confirmada_en AT TIME ZONE s.zona, 'HH24:MI'),
         'cliente', o.cliente_nombre, 'etiqueta', o.etiqueta,
         'materiales', (SELECT count(*)::int FROM operacion_linea l WHERE l.operacion_id = o.id),
         'total', o.total::text, 'atendio', u.nombre) ORDER BY o.folio)
       FROM operacion o JOIN usuario u ON u.id = o.confirmada_por
       WHERE o.confirmada_en_jornada = j.id
     ), '[]'::jsonb) AS cuentas
     FROM jornada j JOIN sucursal s ON s.id = j.sucursal_id
     WHERE j.sucursal_id = 1 AND j.id = $1::bigint`,
    [id],
  );
  return f ? f.cuentas : null;
}
