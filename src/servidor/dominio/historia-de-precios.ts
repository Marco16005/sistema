// La historia de las listas publicadas: los días sin publicación conservan el último precio.
import type { Bd } from "../bd.ts";
import { ErrorDeForma } from "../numeros.ts";

export const PERIODOS_DE_PRECIOS = [30, 91, 365] as const;
export type PeriodoDePrecios = (typeof PERIODOS_DE_PRECIOS)[number];

/** Un día en que el precio de un material quedó distinto del que traía. */
export interface CambioDePrecio {
  fecha: string;
  /** Pesos por kilo, como texto decimal; ambos null si dejó de tener precio. */
  compra: string | null;
  venta: string | null;
}

export interface HistoriaDeMaterial {
  id: number;
  nombre: string;
  familia: string;
  /** Su precio en la última lista publicada antes de desde; null si no tenía. */
  alEmpezar: { compra: string; venta: string } | null;
  /** Su precio en la última lista publicada hasta el corte; null si no tiene. */
  ahora: { compra: string; venta: string } | null;
  /** Los cambios dentro del periodo, del más viejo al más reciente. */
  cambios: CambioDePrecio[];
  /** Contra qué se compara: lo que valía al empezar o, si entonces no tenía precio, el primero que tuvo en el periodo. */
  base: { compra: string; venta: string } | null;
  /** De la base a lo de ahora, en por ciento con un decimal; null si falta alguno de los dos o la base es cero. */
  variacion: { compra: string | null; venta: string | null };
  /** Cuántas veces cambió después de su base: haber aparecido no cuenta; quedarse sin precio, sí. */
  veces: number;
}

export interface HistoriaDePrecios {
  /** El periodo, ambos días incluidos, AAAA-MM-DD. */
  desde: string;
  hasta: string;
  dias: PeriodoDePrecios;
  /** Cuántas listas publicadas hay dentro del periodo. */
  listas: number;
  materiales: HistoriaDeMaterial[];
}

const par = (compra: string, venta: string): string =>
  `CASE WHEN ${compra} IS NOT NULL THEN jsonb_build_object('compra', ${compra}::text, 'venta', ${venta}::text) END`;
const variacion = (cual: string): string =>
  `CASE WHEN x.p_${cual} IS NULL OR x.b_${cual} IS NULL OR x.b_${cual} = 0 THEN NULL
        ELSE round((x.p_${cual} - x.b_${cual}) * 100.0 / x.b_${cual}, 1)::text END`;

// $1: hasta qué día (null es hoy en el patio); $2: cuántos días, contando el último.
const CONSULTA = `
  WITH r AS (
    SELECT hasta, hasta - ($2::int - 1) AS desde
    FROM (SELECT coalesce($1::date, hoy_en(1::smallint)) AS hasta) h
  ), publicadas AS (
    SELECT l.id, j.fecha FROM lista_precios l JOIN jornada j ON j.id = l.jornada_id, r
    WHERE j.sucursal_id = 1 AND l.publicada_en IS NOT NULL AND j.fecha <= r.hasta
  ), anterior AS (
    SELECT id, fecha FROM publicadas, r WHERE fecha < r.desde ORDER BY fecha DESC LIMIT 1
  ), ultima AS (
    SELECT id FROM publicadas ORDER BY fecha DESC LIMIT 1
  ), serie AS (
    SELECT id, fecha, lag(id) OVER (ORDER BY fecha) AS anterior
    FROM publicadas, r WHERE fecha >= r.desde OR id = (SELECT id FROM anterior)
  ), cambios AS (
    -- Comparamos números, incluidos los ausentes; a texto se pasan solo a la salida.
    SELECT m.id, jsonb_agg(jsonb_build_object(
      'fecha', to_char(s.fecha, 'YYYY-MM-DD'), 'compra', p.compra::text, 'venta', p.venta::text
    ) ORDER BY s.fecha) AS cambios
    FROM material m CROSS JOIN serie s CROSS JOIN r
    LEFT JOIN precio p ON p.lista_id = s.id AND p.material_id = m.id
    LEFT JOIN precio a ON a.lista_id = s.anterior AND a.material_id = m.id
    WHERE m.sucursal_id = 1 AND s.fecha >= r.desde
      AND (p.compra IS DISTINCT FROM a.compra OR p.venta IS DISTINCT FROM a.venta)
    GROUP BY m.id
  )
  SELECT to_char(r.desde, 'YYYY-MM-DD') AS desde, to_char(r.hasta, 'YYYY-MM-DD') AS hasta,
    (SELECT count(*)::int FROM publicadas WHERE fecha >= r.desde) AS listas,
    coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'id', x.id, 'nombre', x.nombre, 'familia', x.familia,
        'alEmpezar', ${par("x.a_compra", "x.a_venta")},
        'ahora', ${par("x.p_compra", "x.p_venta")},
        'cambios', x.cambios,
        'base', ${par("x.b_compra", "x.b_venta")},
        'variacion', jsonb_build_object('compra', ${variacion("compra")}, 'venta', ${variacion("venta")}),
        'veces', jsonb_array_length(x.cambios) - CASE WHEN x.a_compra IS NULL AND jsonb_array_length(x.cambios) > 0 THEN 1 ELSE 0 END
      ) ORDER BY x.orden, x.id)
      FROM (
        -- Sin precio al empezar, el primer cambio del periodo es haber aparecido: trae precio, y es la base.
        SELECT m.id, m.nombre, f.nombre AS familia, f.orden,
               a.compra AS a_compra, a.venta AS a_venta, p.compra AS p_compra, p.venta AS p_venta,
               coalesce(c.cambios, '[]'::jsonb) AS cambios,
               coalesce(a.compra, (c.cambios->0->>'compra')::numeric) AS b_compra,
               coalesce(a.venta, (c.cambios->0->>'venta')::numeric) AS b_venta
        FROM material m JOIN familia f ON f.id = m.familia_id
        LEFT JOIN precio a ON a.lista_id = (SELECT id FROM anterior) AND a.material_id = m.id
        LEFT JOIN precio p ON p.lista_id = (SELECT id FROM ultima) AND p.material_id = m.id
        LEFT JOIN cambios c ON c.id = m.id
        WHERE m.sucursal_id = 1 AND (a.material_id IS NOT NULL OR c.id IS NOT NULL)
      ) x
    ), '[]'::jsonb) AS materiales
  FROM r`;

/** Una sola consulta: límites, precios y cambios se leen en el mismo instante. */
export async function historiaDePrecios(bd: Bd, o: { dias: PeriodoDePrecios; hasta?: string | null }): Promise<HistoriaDePrecios> {
  if (o.hasta != null) {
    const fecha = new Date(`${o.hasta}T00:00:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(o.hasta) || o.hasta.startsWith("0000")
      || !Number.isFinite(fecha.getTime()) || fecha.toISOString().slice(0, 10) !== o.hasta) {
      throw new ErrorDeForma("La fecha hasta debe ser un día válido AAAA-MM-DD");
    }
  }
  const [h] = await bd.leer(CONSULTA, [o.hasta ?? null, o.dias]);
  return { desde: h!.desde, hasta: h!.hasta, dias: o.dias, listas: h!.listas, materiales: h!.materiales };
}
