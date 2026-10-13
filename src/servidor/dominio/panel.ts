// El panel del negocio: lo que se compró, se vendió y se movió en un periodo, para quien dirige.
// No lleva cuentas propias: todo sale de los comprobantes y del libro de inventario, con la misma
// regla del cierre —una cuenta es del día en que se asentó—, así que cada día del panel dice lo
// mismo que su cierre. Los números llegan hechos, como texto decimal; aquí no se suma nada.
import type { Bd } from "../bd.ts";
import { ErrorDeForma } from "../numeros.ts";

/** Los periodos de un toque: una semana, un mes y tres meses (trece semanas). Todos terminan hoy. */
export const PERIODOS = [7, 30, 91] as const;
export type Periodo = (typeof PERIODOS)[number];
/** Lo más largo que se puede pedir de tal día a tal día: un año y un día. */
export const TOPE_DE_DIAS = 366;

export interface Totales {
  /** Cuentas terminadas, y cuántas fueron compras y cuántas ventas. */
  cuentas: number;
  compras: number;
  ventas: number;
  /** Lo que suman los comprobantes, en pesos cerrados. No es lo que hay en el cajón: la caja se lleva aparte. */
  pagado: string;
  cobrado: string;
  /** Lo cobrado menos lo pagado. No es la ganancia: falta lo que costó lo que se vendió. */
  diferencia: string;
  /** Kilos que entraron al patio por compras y que salieron por ventas. */
  kgComprado: string;
  kgVendido: string;
}

/** Un tramo de la serie: un día; una semana cuando el periodo pasa de un mes; cuatro semanas cuando pasa de siete meses. */
export interface Tramo extends Totales {
  desde: string;
  hasta: string;
}

export interface Panel {
  /** El periodo, los dos días incluidos, AAAA-MM-DD. */
  desde: string;
  hasta: string;
  /** Cuántos días tiene el periodo. */
  dias: number;
  totales: Totales;
  /** El periodo anterior, del mismo largo: con qué se compara. */
  antes: Totales;
  /** Cuánto cambió respecto del periodo anterior, en por ciento con un decimal. Nada si antes no hubo. */
  cambio: { cuentas: string | null; pagado: string | null; cobrado: string | null };
  /**
   * La cuenta promedio: lo que se pagó y los kilos que entraron por cuenta de compra, y lo que se
   * cobró y los kilos que salieron por cuenta de venta. Nada donde no hubo cuentas.
   */
  promedio: { pagado: string | null; kgComprado: string | null; cobrado: string | null; kgVendido: string | null };
  paso: "dia" | "semana" | "cuatro-semanas";
  /** Todos los tramos del periodo, en orden, también los que no tuvieron nada. El último termina el último día, aunque quede corto. */
  serie: Tramo[];
  /** Los materiales que se movieron, del que más kilos al que menos. Los importes llevan centavos. */
  materiales: Array<{ nombre: string; kgComprado: string; importeComprado: string; kgVendido: string; importeVendido: string }>;
  /** Quién terminó las cuentas, del que más al que menos; y quien, sin cobrar ninguna, hizo algo de lo que conviene vigilar. */
  personas: PersonaDelPanel[];
  /** Cuántas cuentas se terminaron a cada hora del día (0 a 23, hora del patio). Solo las horas con alguna. */
  horas: Array<{ hora: number; cuentas: number }>;
  /**
   * Cada día de la semana que cae en el periodo (1 es lunes; 7, domingo): cuántos días de ese
   * nombre hay, cuántas cuentas se terminaron en ellos y cuántas tocan por día, con un decimal.
   */
  semana: Array<{ dia: number; dias: number; cuentas: number; porDia: string }>;
  /**
   * Lo que hay en el patio ahora, sin importar el periodo, y lo que valdría comprarlo hoy: kilos por
   * el precio de compra de la última lista publicada. Es una estimación, no lo que costó.
   */
  inventario: {
    listaDel: string | null;
    valor: string;
    /** Materiales con existencia que esa lista no trae: no entran en el valor. */
    sinPrecio: number;
    materiales: Array<{ nombre: string; kg: string; precio: string | null; valor: string | null }>;
  };
  /** Lo que conviene vigilar: lo dado de baja, lo que ajustaron conteos y correcciones, los precios especiales y las reaperturas. */
  control: {
    mermas: number;
    mermaKg: string;
    ajustes: number;
    ajusteEntroKg: string;
    ajusteSalioKg: string;
    preciosEspeciales: number;
    /** Como en el cierre: positiva en compras es que se pagó de más; en ventas, que se cobró de más. */
    diferenciaEnCompras: string;
    diferenciaEnVentas: string;
    reaperturas: number;
    /** Renglones con kilos que se pesaron y no se pagaron (en compras) o no se cobraron (en ventas), y cuántos kilos. */
    descuentos: number;
    descuentoEnComprasKg: string;
    descuentoEnVentasKg: string;
    /** A qué materiales se les descontó, del que más kilos al que menos, sumando compras y ventas. */
    descontados: Array<{ nombre: string; kg: string }>;
  };
}

/** Lo que hizo una persona en el periodo. */
export interface PersonaDelPanel {
  nombre: string;
  /** Las cuentas que terminó, lo que pagó y cobró en ellas (pesos cerrados) y los kilos que pesó. */
  cuentas: number;
  compras: number;
  ventas: number;
  pagado: string;
  cobrado: string;
  kg: string;
  /** Los kilos descontados en las cuentas que cobró: el descuento lo decide quien cobra. */
  descuentoKg: string;
  /** Según la bitácora, en el día en que pasó cada cosa: cuentas que descartó sin confirmar, movimientos que corrigió y comprobantes que reimprimió. */
  descartadas: number;
  correcciones: number;
  reimpresiones: number;
}

const de = (tipo: "compra" | "venta", que: string): string => `coalesce(sum(${que}) FILTER (WHERE op.tipo = '${tipo}'), 0)`;

/** Los totales de las cuentas que queden a la vista en la consulta donde se ponga. */
const TOTALES = `jsonb_build_object(
  'cuentas', count(op.id)::int,
  'compras', (count(op.id) FILTER (WHERE op.tipo = 'compra'))::int,
  'ventas', (count(op.id) FILTER (WHERE op.tipo = 'venta'))::int,
  'pagado', ${de("compra", "op.total")}::numeric(14,0)::text,
  'cobrado', ${de("venta", "op.total")}::numeric(14,0)::text,
  'diferencia', (${de("venta", "op.total")} - ${de("compra", "op.total")})::numeric(14,0)::text,
  'kgComprado', ${de("compra", "op.kg")}::numeric(14,3)::text,
  'kgVendido', ${de("venta", "op.kg")}::numeric(14,3)::text)`;

/** De antes a ahora, en por ciento con un decimal. Sin nada antes no hay con qué comparar. */
const porCiento = (que: string, filtro = "true"): string => {
  const ahora = `coalesce(sum(${que}) FILTER (WHERE ${filtro} AND op.fecha >= r.desde), 0)`;
  const antes = `coalesce(sum(${que}) FILTER (WHERE ${filtro} AND op.fecha < r.desde), 0)`;
  return `CASE WHEN ${antes} = 0 THEN NULL ELSE round((${ahora} - ${antes}) * 100.0 / ${antes}, 1)::text END`;
};

const lista = (fila: string, orden: string): string => `coalesce(jsonb_agg(${fila} ORDER BY ${orden}), '[]'::jsonb)`;

// $1: hasta qué día (nada es hoy, en la fecha del patio); $2: cuántos días; $3: de cuántos días es cada tramo.
const CONSULTA = `
  WITH r AS (
    SELECT h.hasta, h.hasta - ($2::int - 1) AS desde, h.hasta - (2 * $2::int - 1) AS desde_antes, s.zona
    FROM sucursal s, LATERAL (SELECT coalesce($1::date, hoy_en(s.id)) AS hasta) h
    WHERE s.id = 1
  ),
  -- Cada cuenta terminada del periodo y del anterior, con el día en que se asentó: la regla del cierre.
  op AS (
    SELECT o.id, o.tipo, o.total, o.confirmada_en, o.confirmada_por, j.fecha, x.kg, x.descuento
    FROM operacion o JOIN jornada j ON j.id = o.confirmada_en_jornada
    CROSS JOIN LATERAL (SELECT coalesce(sum(l.peso_recibido), 0) AS kg, coalesce(sum(l.descuento_kg), 0) AS descuento
                        FROM operacion_linea l WHERE l.operacion_id = o.id) x, r
    WHERE o.sucursal_id = 1 AND o.estado = 'confirmada' AND j.fecha BETWEEN r.desde_antes AND r.hasta
  ),
  -- Lo dado de baja y lo ajustado en el periodo. Va en el día de su jornada; sin jornada, en el que se asentó.
  mov AS (
    SELECT mv.tipo, mv.cantidad_kg
    FROM movimiento_inventario mv LEFT JOIN jornada j ON j.id = mv.jornada_id, r
    WHERE mv.sucursal_id = 1 AND mv.tipo IN ('merma', 'ajuste')
      AND coalesce(j.fecha, (mv.creado_en AT TIME ZONE r.zona)::date) BETWEEN r.desde AND r.hasta
  ),
  -- Los precios especiales vigentes en lo cobrado: el importe menos lo que habría dado la lista, como en el cierre.
  especial AS (
    SELECT op.tipo, l.importe - round(l.peso_liquidable * l.precio_lista, 2) AS diferencia
    FROM op JOIN operacion_linea l ON l.operacion_id = op.id, r
    WHERE op.fecha >= r.desde AND l.precio_autorizado_por IS NOT NULL
  ),
  -- Los kilos que se pesaron y no se pagaron o no se cobraron, renglón por renglón.
  descuento AS (
    SELECT op.tipo, m.nombre, l.descuento_kg
    FROM op JOIN operacion_linea l ON l.operacion_id = op.id JOIN material m ON m.id = l.material_id, r
    WHERE op.fecha >= r.desde AND l.descuento_kg > 0
  ),
  -- Lo que cobró cada quien.
  cobro AS (
    SELECT op.confirmada_por AS quien, count(*)::int AS cuentas,
           (count(*) FILTER (WHERE op.tipo = 'compra'))::int AS compras, (count(*) FILTER (WHERE op.tipo = 'venta'))::int AS ventas,
           ${de("compra", "op.total")} AS pagado, ${de("venta", "op.total")} AS cobrado, sum(op.kg) AS kg, sum(op.descuento) AS descuento
    FROM op, r WHERE op.fecha >= r.desde GROUP BY 1
  ),
  -- Lo que la bitácora dice que hizo cada quien y conviene vigilar. No es de una jornada: va en el día en que pasó.
  hizo AS (
    SELECT b.usuario_id AS quien,
           (count(*) FILTER (WHERE b.accion = 'descartar'))::int AS descartadas,
           (count(*) FILTER (WHERE b.accion IN ('corregir', 'corregir_material')))::int AS correcciones,
           (count(*) FILTER (WHERE b.accion = 'reimprimir'))::int AS reimpresiones
    FROM bitacora b, r
    WHERE b.usuario_id IS NOT NULL
      AND b.ocurrido_en >= (r.desde::timestamp AT TIME ZONE r.zona) AND b.ocurrido_en < ((r.hasta + 1)::timestamp AT TIME ZONE r.zona)
      AND ((b.entidad = 'operacion' AND b.accion IN ('descartar', 'reimprimir'))
        OR (b.entidad = 'movimiento_inventario' AND b.accion IN ('corregir', 'corregir_material')))
    GROUP BY 1
  ),
  ultima AS (
    SELECT l.id, j.fecha FROM lista_precios l JOIN jornada j ON j.id = l.jornada_id
    WHERE j.sucursal_id = 1 AND l.publicada_en IS NOT NULL
    ORDER BY j.fecha DESC LIMIT 1
  ),
  hay AS (
    SELECT e.nombre, e.kg, p.compra, round(e.kg * p.compra, 2) AS valor
    FROM existencia e LEFT JOIN ultima ON true LEFT JOIN precio p ON p.lista_id = ultima.id AND p.material_id = e.material_id
    WHERE e.kg <> 0
  )
  SELECT to_char(r.desde, 'YYYY-MM-DD') AS desde, to_char(r.hasta, 'YYYY-MM-DD') AS hasta,
    (SELECT ${TOTALES} FROM op WHERE op.fecha >= r.desde) AS totales,
    (SELECT ${TOTALES} FROM op WHERE op.fecha < r.desde) AS antes,
    (SELECT jsonb_build_object('cuentas', ${porCiento("1")}, 'pagado', ${porCiento("op.total", "op.tipo = 'compra'")},
                               'cobrado', ${porCiento("op.total", "op.tipo = 'venta'")}) FROM op) AS cambio,
    (SELECT jsonb_build_object(
       'pagado', (avg(op.total) FILTER (WHERE op.tipo = 'compra'))::numeric(14,2)::text,
       'kgComprado', (avg(op.kg) FILTER (WHERE op.tipo = 'compra'))::numeric(14,3)::text,
       'cobrado', (avg(op.total) FILTER (WHERE op.tipo = 'venta'))::numeric(14,2)::text,
       'kgVendido', (avg(op.kg) FILTER (WHERE op.tipo = 'venta'))::numeric(14,3)::text)
     FROM op WHERE op.fecha >= r.desde) AS promedio,
    -- El último tramo termina el último día del periodo, aunque quede más corto que los demás.
    (SELECT jsonb_agg(t.fila ORDER BY t.k)
     FROM (SELECT k, ${TOTALES} || jsonb_build_object('desde', to_char(r.desde + k * $3::int, 'YYYY-MM-DD'),
                                                      'hasta', to_char(least(r.desde + k * $3::int + $3::int - 1, r.hasta), 'YYYY-MM-DD')) AS fila
           FROM generate_series(0, ($2::int - 1) / $3::int) AS k
           LEFT JOIN op ON op.fecha BETWEEN r.desde + k * $3::int AND r.desde + k * $3::int + $3::int - 1
           GROUP BY k) t) AS serie,
    (SELECT ${lista(`jsonb_build_object('nombre', x.nombre, 'kgComprado', x.kc::numeric(14,3)::text, 'importeComprado', x.ic::numeric(14,2)::text,
                                        'kgVendido', x.kv::numeric(14,3)::text, 'importeVendido', x.iv::numeric(14,2)::text)`, "x.kc + x.kv DESC, x.nombre")}
     FROM (SELECT m.nombre, ${de("compra", "l.peso_recibido")} AS kc, ${de("compra", "l.importe")} AS ic,
                  ${de("venta", "l.peso_recibido")} AS kv, ${de("venta", "l.importe")} AS iv
           FROM op JOIN operacion_linea l ON l.operacion_id = op.id JOIN material m ON m.id = l.material_id
           WHERE op.fecha >= r.desde
           GROUP BY m.id, m.nombre) x) AS materiales,
    (SELECT ${lista(`jsonb_build_object('nombre', x.nombre, 'cuentas', x.cuentas, 'compras', x.compras, 'ventas', x.ventas,
                                        'pagado', x.pagado::numeric(14,0)::text, 'cobrado', x.cobrado::numeric(14,0)::text,
                                        'kg', x.kg::numeric(14,3)::text, 'descuentoKg', x.descuento::numeric(14,3)::text,
                                        'descartadas', x.descartadas, 'correcciones', x.correcciones, 'reimpresiones', x.reimpresiones)`, "x.cuentas DESC, x.nombre")}
     FROM (SELECT u.nombre, coalesce(c.cuentas, 0) AS cuentas, coalesce(c.compras, 0) AS compras, coalesce(c.ventas, 0) AS ventas,
                  coalesce(c.pagado, 0) AS pagado, coalesce(c.cobrado, 0) AS cobrado, coalesce(c.kg, 0) AS kg, coalesce(c.descuento, 0) AS descuento,
                  coalesce(h.descartadas, 0) AS descartadas, coalesce(h.correcciones, 0) AS correcciones, coalesce(h.reimpresiones, 0) AS reimpresiones
           FROM cobro c FULL JOIN hizo h ON h.quien = c.quien JOIN usuario u ON u.id = coalesce(c.quien, h.quien)) x) AS personas,
    (SELECT ${lista("jsonb_build_object('hora', x.hora, 'cuentas', x.n)", "x.hora")}
     FROM (SELECT extract(hour FROM op.confirmada_en AT TIME ZONE r.zona)::int AS hora, count(*)::int AS n
           FROM op WHERE op.fecha >= r.desde GROUP BY 1) x) AS horas,
    (SELECT ${lista("jsonb_build_object('dia', x.dia, 'dias', x.dias, 'cuentas', x.n, 'porDia', round(x.n::numeric / x.dias, 1)::text)", "x.dia")}
     FROM (SELECT extract(isodow FROM d)::int AS dia, count(DISTINCT d)::int AS dias, count(op.id)::int AS n
           FROM generate_series(r.desde::timestamp, r.hasta::timestamp, interval '1 day') AS d LEFT JOIN op ON op.fecha = d::date
           GROUP BY 1) x) AS semana,
    jsonb_build_object(
      'listaDel', (SELECT to_char(fecha, 'YYYY-MM-DD') FROM ultima),
      'valor', (SELECT coalesce(sum(valor), 0)::numeric(14,2)::text FROM hay),
      'sinPrecio', (SELECT count(*)::int FROM hay WHERE compra IS NULL),
      'materiales', (SELECT ${lista("jsonb_build_object('nombre', nombre, 'kg', kg::text, 'precio', compra::text, 'valor', valor::numeric(14,2)::text)", "valor DESC NULLS LAST, nombre")}
                     FROM hay)) AS inventario,
    jsonb_build_object(
      'mermas', (SELECT count(*)::int FROM mov WHERE tipo = 'merma'),
      'mermaKg', (SELECT coalesce(-sum(cantidad_kg), 0)::numeric(14,3)::text FROM mov WHERE tipo = 'merma'),
      'ajustes', (SELECT count(*)::int FROM mov WHERE tipo = 'ajuste'),
      'ajusteEntroKg', (SELECT coalesce(sum(cantidad_kg), 0)::numeric(14,3)::text FROM mov WHERE tipo = 'ajuste' AND cantidad_kg > 0),
      'ajusteSalioKg', (SELECT coalesce(-sum(cantidad_kg), 0)::numeric(14,3)::text FROM mov WHERE tipo = 'ajuste' AND cantidad_kg < 0),
      'preciosEspeciales', (SELECT count(*)::int FROM especial),
      'diferenciaEnCompras', (SELECT coalesce(sum(diferencia), 0)::numeric(14,2)::text FROM especial WHERE tipo = 'compra'),
      'diferenciaEnVentas', (SELECT coalesce(sum(diferencia), 0)::numeric(14,2)::text FROM especial WHERE tipo = 'venta'),
      'reaperturas', (SELECT count(*)::int FROM reapertura x JOIN jornada j ON j.id = x.jornada_id
                      WHERE j.sucursal_id = 1 AND j.fecha BETWEEN r.desde AND r.hasta),
      'descuentos', (SELECT count(*)::int FROM descuento),
      'descuentoEnComprasKg', (SELECT coalesce(sum(descuento_kg), 0)::numeric(14,3)::text FROM descuento WHERE tipo = 'compra'),
      'descuentoEnVentasKg', (SELECT coalesce(sum(descuento_kg), 0)::numeric(14,3)::text FROM descuento WHERE tipo = 'venta'),
      'descontados', (SELECT ${lista("jsonb_build_object('nombre', x.nombre, 'kg', x.kg::numeric(14,3)::text)", "x.kg DESC, x.nombre")}
                      FROM (SELECT nombre, sum(descuento_kg) AS kg FROM descuento GROUP BY nombre) x)) AS control
  FROM r`;

/**
 * El panel de un periodo. Se pide de dos maneras: por cuántos días, terminando ese día —sin decir
 * cuál, hoy—, o de tal día a tal día. Una sola consulta: todo es del mismo instante.
 */
export async function panel(bd: Bd, o: { dias?: Periodo; desde?: string; hasta?: string | null }): Promise<Panel> {
  let dias: number = o.dias ?? 7;
  if (o.desde !== undefined) {
    const hasta = o.hasta ?? "";
    if (o.desde > hasta) throw new ErrorDeForma("El primer día del periodo no puede ser posterior al último");
    dias = Math.round((Date.parse(`${hasta}T00:00:00Z`) - Date.parse(`${o.desde}T00:00:00Z`)) / 86_400_000) + 1;
    if (!Number.isInteger(dias) || dias > TOPE_DE_DIAS) throw new ErrorDeForma("En el resumen cabe hasta un año: pide un periodo más corto");
  }
  // Día por día se lee hasta un mes; de ahí a unos siete meses va por semanas, y más allá, de cuatro en cuatro.
  const paso = dias <= 31 ? 1 : dias <= 217 ? 7 : 28;
  const [f] = await bd.leer(CONSULTA, [o.hasta ?? null, dias, paso]);
  const d = f!;
  return {
    desde: d.desde, hasta: d.hasta, dias, totales: d.totales, antes: d.antes, cambio: d.cambio, promedio: d.promedio,
    paso: paso === 1 ? "dia" : paso === 7 ? "semana" : "cuatro-semanas", serie: d.serie, materiales: d.materiales, personas: d.personas,
    horas: d.horas, semana: d.semana, inventario: d.inventario, control: d.control,
  };
}
