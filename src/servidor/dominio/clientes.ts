// Los clientes del panel: sus cuentas cobradas y lo que movieron sus precios especiales.
// Los importes y kilos se calculan en la base y llegan como texto decimal.
import type { Bd } from "../bd.ts";
import { fila } from "../forma.ts";

export interface ClienteDelPanel {
  id: string;
  nombre: string;
  activo: boolean;
  cuentas: number;
  compras: number;
  ventas: number;
  pagado: string;
  cobrado: string;
  kgComprado: string;
  kgVendido: string;
  /** Importe menos lo que habría dado la lista: positiva en compras es pagar de más; en ventas, cobrar de más. */
  diferenciaEnCompras: string;
  diferenciaEnVentas: string;
  /** El día en que se asentó su última cuenta, o nada si no tiene. */
  ultimaVez: string | null;
}

const de = (tipo: "compra" | "venta", que: string): string => `coalesce(sum(${que}) FILTER (WHERE op.tipo = '${tipo}'), 0)`;

// $1: un cliente, o todos. Cada cuenta ocupa una fila, aunque tenga varios materiales.
const RESUMEN = `WITH op AS (
  SELECT o.*, j.fecha,
    (SELECT coalesce(sum(l.peso_recibido), 0) FROM operacion_linea l WHERE l.operacion_id = o.id) AS kg,
    (SELECT coalesce(sum(l.importe - round(l.peso_liquidable * l.precio_lista, 2)), 0)
     FROM operacion_linea l WHERE l.operacion_id = o.id AND l.precio_autorizado_por IS NOT NULL) AS diferencia
  FROM operacion o JOIN jornada j ON j.id = o.confirmada_en_jornada
  WHERE o.sucursal_id = 1 AND o.estado = 'confirmada' AND o.cliente_id IS NOT NULL
    AND ($1::bigint IS NULL OR o.cliente_id = $1)
), resumen AS (
  SELECT c.id, c.nombre, max(op.fecha) AS ultima,
    jsonb_build_object(
      'id', c.id::text, 'nombre', c.nombre, 'activo', c.activo,
      'cuentas', count(op.id)::int,
      'compras', (count(op.id) FILTER (WHERE op.tipo = 'compra'))::int,
      'ventas', (count(op.id) FILTER (WHERE op.tipo = 'venta'))::int,
      'pagado', ${de("compra", "op.total")}::numeric(14,0)::text,
      'cobrado', ${de("venta", "op.total")}::numeric(14,0)::text,
      'kgComprado', ${de("compra", "op.kg")}::numeric(14,3)::text,
      'kgVendido', ${de("venta", "op.kg")}::numeric(14,3)::text,
      'diferenciaEnCompras', ${de("compra", "op.diferencia")}::numeric(14,2)::text,
      'diferenciaEnVentas', ${de("venta", "op.diferencia")}::numeric(14,2)::text,
      'ultimaVez', to_char(max(op.fecha), 'YYYY-MM-DD')) AS cliente
  FROM cliente c LEFT JOIN op ON op.cliente_id = c.id
  WHERE $1::bigint IS NULL OR c.id = $1
  GROUP BY c.id
)`;

/** Lo que suman todos los clientes juntos. */
export interface TotalesDeClientes {
  clientes: number;
  /** Los que no están dados de baja. */
  activos: number;
  cuentas: number;
  diferenciaEnCompras: string;
  diferenciaEnVentas: string;
}

/**
 * Todos los clientes —incluso los dados de baja y los que no tienen cuentas—, de la cuenta más
 * reciente a la más vieja, y lo que suman entre todos. Se leen en el mismo instante.
 */
export async function resumenDeClientes(bd: Bd): Promise<{ clientes: ClienteDelPanel[]; totales: TotalesDeClientes }> {
  const [f] = await bd.leer<{ clientes: ClienteDelPanel[]; totales: TotalesDeClientes }>(
    `${RESUMEN} SELECT
       coalesce(jsonb_agg(cliente ORDER BY ultima DESC NULLS LAST, lower(nombre), id), '[]'::jsonb) AS clientes,
       jsonb_build_object(
         'clientes', count(*)::int,
         'activos', (count(*) FILTER (WHERE (cliente->>'activo')::boolean))::int,
         'cuentas', coalesce(sum((cliente->>'cuentas')::int), 0)::int,
         'diferenciaEnCompras', coalesce(sum((cliente->>'diferenciaEnCompras')::numeric), 0)::numeric(14,2)::text,
         'diferenciaEnVentas', coalesce(sum((cliente->>'diferenciaEnVentas')::numeric), 0)::numeric(14,2)::text) AS totales
     FROM resumen`, [null],
  );
  return f!;
}

/** Solo la lista. */
export const clientesDelPanel = async (bd: Bd): Promise<ClienteDelPanel[]> => (await resumenDeClientes(bd)).clientes;

export interface FichaDeCliente {
  cliente: ClienteDelPanel;
  /** Por material, del que más kilos movió al que menos. */
  materiales: Array<{ nombre: string; kgComprado: string; importeComprado: string; kgVendido: string; importeVendido: string }>;
  /** Los últimos 200 renglones con precio especial, por día y folio descendentes. */
  precios: Array<{
    fecha: string;
    folio: string;
    tipo: "compra" | "venta";
    material: string;
    kg: string;
    precioLista: string;
    precio: string;
    diferencia: string;
    autorizo: string;
  }>;
  /** Las últimas 200 cuentas cobradas, por día y folio descendentes. */
  cuentas: Array<{ id: string; folio: string; fecha: string; tipo: "compra" | "venta"; total: string; materiales: number; atendio: string }>;
}

/** La ficha y el resumen se leen en el mismo instante. null si el cliente no existe. */
export async function fichaDeCliente(bd: Bd, cliente: string): Promise<FichaDeCliente | null> {
  const id = fila(cliente, "el cliente");
  const [f] = await bd.leer<FichaDeCliente>(`${RESUMEN}
    SELECT resumen.cliente,
      coalesce((SELECT jsonb_agg(jsonb_build_object(
        'nombre', x.nombre, 'kgComprado', x.kc::numeric(14,3)::text, 'importeComprado', x.ic::numeric(14,2)::text,
        'kgVendido', x.kv::numeric(14,3)::text, 'importeVendido', x.iv::numeric(14,2)::text)
        ORDER BY x.kc + x.kv DESC, x.nombre)
      FROM (
        SELECT m.nombre, ${de("compra", "l.peso_recibido")} AS kc, ${de("compra", "l.importe")} AS ic,
          ${de("venta", "l.peso_recibido")} AS kv, ${de("venta", "l.importe")} AS iv
        FROM op JOIN operacion_linea l ON l.operacion_id = op.id JOIN material m ON m.id = l.material_id
        GROUP BY m.id, m.nombre
      ) x), '[]'::jsonb) AS materiales,
      coalesce((SELECT jsonb_agg(x.datos ORDER BY x.fecha DESC, x.folio DESC, x.creada_en, x.id)
      FROM (
        SELECT op.fecha, op.folio, l.creada_en, l.id, jsonb_build_object(
          'fecha', to_char(op.fecha, 'YYYY-MM-DD'), 'folio', op.folio::text, 'tipo', op.tipo,
          'material', m.nombre, 'kg', l.peso_liquidable::numeric(14,3)::text,
          'precioLista', l.precio_lista::text, 'precio', l.precio_unitario::text,
          'diferencia', (l.importe - round(l.peso_liquidable * l.precio_lista, 2))::numeric(14,2)::text,
          'autorizo', u.nombre) AS datos
        FROM op JOIN operacion_linea l ON l.operacion_id = op.id
        JOIN material m ON m.id = l.material_id JOIN usuario u ON u.id = l.precio_autorizado_por
        ORDER BY op.fecha DESC, op.folio DESC, l.creada_en, l.id LIMIT 200
      ) x), '[]'::jsonb) AS precios,
      coalesce((SELECT jsonb_agg(x.datos ORDER BY x.fecha DESC, x.folio DESC)
      FROM (
        SELECT op.fecha, op.folio, jsonb_build_object(
          'id', op.id, 'folio', op.folio::text, 'fecha', to_char(op.fecha, 'YYYY-MM-DD'), 'tipo', op.tipo,
          'total', op.total::text,
          'materiales', (SELECT count(*)::int FROM operacion_linea l WHERE l.operacion_id = op.id),
          'atendio', u.nombre) AS datos
        FROM op JOIN usuario u ON u.id = op.confirmada_por
        ORDER BY op.fecha DESC, op.folio DESC LIMIT 200
      ) x), '[]'::jsonb) AS cuentas
    FROM resumen`, [id]);
  return f ?? null;
}
