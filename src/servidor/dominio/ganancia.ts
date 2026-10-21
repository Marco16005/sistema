// La ganancia, para quien dirige: lo que se vendió, lo que costó, lo que se perdió y lo que hay en
// el patio valuado a lo que costó (migración 0039). El costo de cada movimiento lo pone la base al
// asentarlo; aquí se suma por periodo y se lee, como texto decimal.
//
// Qué es cada cifra, de un periodo:
//   vendido     lo que se cobró por las ventas (los importes de sus renglones, con centavos);
//   costo       lo que costó lo que se vendió, a costo promedio del material en ese momento;
//   margen      vendido − costo;
//   perdidas    lo que costaba lo que se dio de baja y lo que un conteo encontró de menos;
//   aFavor      lo que un conteo encontró de más, a costo promedio;
//   resultado   margen − perdidas + aFavor. Es lo que dejó el material;
//   gastos      los gastos del negocio de los tipos que cuentan, sin los anulados (0042);
//   utilidad    resultado − gastos: lo que queda.
// Las ventas son del día en que se cobraron (la regla del cierre); bajas y ajustes, del día de su
// jornada. Separar no gana ni pierde: el costo pasa entero a las partes.
import type { Bd } from "../bd.ts";

export type Agrupar = "dia" | "semana" | "mes";
export const AGRUPAR: readonly Agrupar[] = ["dia", "semana", "mes"];

export interface Cifras {
  vendido: string;
  costo: string;
  margen: string;
  perdidas: string;
  aFavor: string;
  resultado: string;
  kgVendido: string;
}

/** Los gastos no son de un material: van en los totales y en cada tramo. */
export interface Utilidad {
  gastos: string;
  utilidad: string;
}

export interface MaterialEnElPatio {
  nombre: string;
  kg: string;
  /** Lo que costó lo que hay, y a cuánto sale el kilo. */
  valor: string;
  costoPorKilo: string | null;
  /** El precio de compra de la última lista publicada, y lo que valdría a ese precio. Nada si no tiene. */
  precioDeLista: string | null;
  valorALista: string | null;
}

export interface Ganancia {
  desde: string;
  hasta: string;
  agrupar: Agrupar;
  totales: Cifras & Utilidad;
  /** Todos los tramos del periodo, en orden, también los vacíos; el primero y el último, recortados al periodo. */
  serie: Array<Cifras & Utilidad & { desde: string; hasta: string }>;
  /** Los materiales con algo en el periodo, del de mejor resultado al de peor. */
  materiales: Array<Cifras & { nombre: string }>;
  /** Lo que hay hoy en el patio, no en el periodo. */
  patio: { valor: string; valorALista: string; listaDel: string | null; materiales: MaterialEnElPatio[] };
}

const PESOS = (que: string): string => `coalesce(${que}, 0)::numeric(16,2)::text`;

/** Las cifras de un conjunto de movimientos `m` (columnas tipo, cantidad_kg, costo, importe). */
const CIFRAS = `
  jsonb_build_object(
    'vendido', ${PESOS("sum(m.importe) FILTER (WHERE m.tipo = 'venta')")},
    'costo', ${PESOS("-sum(m.costo) FILTER (WHERE m.tipo = 'venta')")},
    'margen', ${PESOS("sum(m.importe + m.costo) FILTER (WHERE m.tipo = 'venta')")},
    'perdidas', ${PESOS("-sum(m.costo) FILTER (WHERE m.tipo = 'merma' OR (m.tipo = 'ajuste' AND m.cantidad_kg < 0))")},
    'aFavor', ${PESOS("sum(m.costo) FILTER (WHERE m.tipo = 'ajuste' AND m.cantidad_kg > 0)")},
    'resultado', ${PESOS("sum(CASE WHEN m.tipo = 'venta' THEN m.importe + m.costo ELSE m.costo END)")},
    'kgVendido', coalesce(-sum(m.cantidad_kg) FILTER (WHERE m.tipo = 'venta'), 0)::numeric(14,3)::text)`;

const RESULTADO = "coalesce(sum(CASE WHEN m.tipo = 'venta' THEN m.importe + m.costo ELSE m.costo END), 0)";
/** Los gastos que cuentan entre `desde` y `hasta`, y lo que queda: el resultado de esos movimientos menos ellos. */
const UTILIDAD = (desde: string, hasta: string, donde: string): string => `
  jsonb_build_object(
    'gastos', (SELECT coalesce(sum(g.importe), 0)::numeric(16,2)::text FROM gas g WHERE g.fecha BETWEEN ${desde} AND ${hasta}),
    'utilidad', ((SELECT ${RESULTADO} FROM m WHERE ${donde})
                 - (SELECT coalesce(sum(g.importe), 0) FROM gas g WHERE g.fecha BETWEEN ${desde} AND ${hasta}))::numeric(16,2)::text)`;

// $1 desde, $2 hasta, $3 'day' | 'week' | 'month'.
const CONSULTA = `
  WITH r AS (SELECT $1::date AS desde, $2::date AS hasta, s.zona FROM sucursal s WHERE s.id = 1),
  mov AS (
    SELECT mi.material_id, mi.tipo, mi.cantidad_kg, mi.costo, l.importe,
           coalesce(jc.fecha, jm.fecha, (mi.creado_en AT TIME ZONE r.zona)::date) AS fecha
    FROM movimiento_inventario mi
    LEFT JOIN operacion_linea l ON l.id = mi.linea_id
    LEFT JOIN operacion o ON o.id = l.operacion_id
    LEFT JOIN jornada jc ON jc.id = o.confirmada_en_jornada
    LEFT JOIN jornada jm ON jm.id = mi.jornada_id, r
    WHERE mi.sucursal_id = 1 AND mi.tipo IN ('venta', 'merma', 'ajuste')
  ),
  m AS (SELECT mov.* FROM mov, r WHERE mov.fecha BETWEEN r.desde AND r.hasta),
  gas AS (
    SELECT g.fecha, g.importe FROM gasto g JOIN tipo_de_gasto t ON t.id = g.tipo_id, r
    WHERE g.anulado_en IS NULL AND t.cuenta AND g.fecha BETWEEN r.desde AND r.hasta
  ),
  tramo AS (
    SELECT DISTINCT greatest(date_trunc($3, d)::date, r.desde) AS desde,
                    least((date_trunc($3, d) + ('1 ' || $3)::interval - interval '1 day')::date, r.hasta) AS hasta
    FROM r, generate_series(r.desde, r.hasta, interval '1 day') AS d
  ),
  ultima AS (
    SELECT l.id, j.fecha FROM lista_precios l JOIN jornada j ON j.id = l.jornada_id
    WHERE j.sucursal_id = 1 AND l.publicada_en IS NOT NULL ORDER BY j.fecha DESC, l.id DESC LIMIT 1
  ),
  hay AS (
    SELECT mat.nombre, c.kg, c.valor, p.compra,
           CASE WHEN p.compra IS NOT NULL THEN round(c.kg * p.compra, 2) END AS a_lista
    FROM costo_material c JOIN material mat ON mat.id = c.material_id
    LEFT JOIN ultima ON true LEFT JOIN precio p ON p.lista_id = ultima.id AND p.material_id = c.material_id
    WHERE c.kg > 0
  )
  SELECT to_char(r.desde, 'YYYY-MM-DD') AS desde, to_char(r.hasta, 'YYYY-MM-DD') AS hasta,
    (SELECT ${CIFRAS} FROM m) || ${UTILIDAD("r.desde", "r.hasta", "true")} AS totales,
    (SELECT jsonb_agg(x.fila ORDER BY x.desde)
     FROM (SELECT t.desde, jsonb_build_object('desde', to_char(t.desde, 'YYYY-MM-DD'), 'hasta', to_char(t.hasta, 'YYYY-MM-DD'))
                           || (SELECT ${CIFRAS} FROM m WHERE m.fecha BETWEEN t.desde AND t.hasta)
                           || ${UTILIDAD("t.desde", "t.hasta", "m.fecha BETWEEN t.desde AND t.hasta")} AS fila
           FROM tramo t) x) AS serie,
    (SELECT coalesce(jsonb_agg(x.fila ORDER BY (x.fila->>'resultado')::numeric DESC, x.nombre), '[]'::jsonb)
     FROM (SELECT mat.nombre, jsonb_build_object('nombre', mat.nombre) || ${CIFRAS} AS fila
           FROM m JOIN material mat ON mat.id = m.material_id GROUP BY mat.id, mat.nombre) x) AS materiales,
    jsonb_build_object(
      'valor', (SELECT ${PESOS("sum(valor)")} FROM hay),
      'valorALista', (SELECT ${PESOS("sum(a_lista)")} FROM hay),
      'listaDel', (SELECT to_char(fecha, 'YYYY-MM-DD') FROM ultima),
      'materiales', (SELECT coalesce(jsonb_agg(jsonb_build_object(
                       'nombre', nombre, 'kg', kg::numeric(14,3)::text, 'valor', valor::numeric(16,2)::text,
                       'costoPorKilo', (valor / kg)::numeric(14,4)::text, 'precioDeLista', compra::numeric(14,4)::text,
                       'valorALista', a_lista::numeric(16,2)::text) ORDER BY valor DESC, nombre), '[]'::jsonb)
                     FROM hay)) AS patio
  FROM r`;

const UNIDAD: Record<Agrupar, string> = { dia: "day", semana: "week", mes: "month" };

/** La ganancia de tal día a tal día (los dos incluidos), en tramos de un día, una semana o un mes. */
export async function ganancia(bd: Bd, o: { desde: string; hasta: string; agrupar: Agrupar }): Promise<Ganancia> {
  const [f] = await bd.leer(CONSULTA, [o.desde, o.hasta, UNIDAD[o.agrupar]]);
  const d = f!;
  return { desde: d.desde, hasta: d.hasta, agrupar: o.agrupar, totales: d.totales, serie: d.serie, materiales: d.materiales, patio: d.patio };
}
