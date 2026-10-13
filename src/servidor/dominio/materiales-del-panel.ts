// Los materiales en el panel, para quien dirige: qué se está quedando en el patio, y la ficha de
// cada material —lo que entró y salió, a cuánto el kilo, cuánto ha habido y lo que se le perdió—.
// No llevan cuentas propias: lo comprado y lo vendido sale de los comprobantes, con la regla del
// cierre (una cuenta es del día en que se asentó), y lo que hay, del libro de inventario. Los
// números llegan hechos, como texto decimal; aquí no se suma nada.
import type { Bd } from "../bd.ts";
import { historiaDePrecios } from "./historia-de-precios.ts";
import type { HistoriaDeMaterial } from "./historia-de-precios.ts";

/** Los periodos de la ficha: un mes, día por día, y tres meses (trece semanas). Los dos terminan hoy. */
export const PERIODOS_DE_MATERIAL = [30, 91] as const;
export type PeriodoDeMaterial = (typeof PERIODOS_DE_MATERIAL)[number];
/** De cuántos días es el ritmo con que se dice para cuánto alcanza lo que hay: cuatro semanas. */
const RITMO = 28;
/** Cuántos días sin salir hacen que un material se esté quedando. */
const SE_QUEDA = 30;
/** Lo más que se dice que alcanza: diez años. De ahí en adelante es «diez años o más», y el número ya no importa. */
const ALCANZA_A_LO_MAS = 3650;

export interface MaterialDelPatio {
  id: number;
  nombre: string;
  familia: string;
  activo: boolean;
  /** Lo que hay en el patio ahora. */
  kg: string;
  /** Su precio de compra en la última lista publicada, y lo que valdría volver a comprar lo que hay. Nada si esa lista no lo trae. */
  precio: string | null;
  valor: string | null;
  /** El último día en que salió: se vendió o se separó en otros materiales. Lo dado de baja no cuenta. Nada si nunca ha salido. */
  ultimaSalida: string | null;
  /** De ese día a hoy; si nunca ha salido, desde el día en que llegó. Nada si no ha tenido ningún movimiento. */
  diasSinSalir: number | null;
  /** Lo que salió en las últimas cuatro semanas, contando hoy. */
  kgSalio: string;
  /**
   * Para cuántos días alcanza lo que hay, a ese ritmo. Nada si no hay existencia o si en cuatro
   * semanas no salió nada. Tiene tope: 3650 quiere decir «diez años o más».
   */
  alcanzaPara: number | null;
}

export interface Patio {
  hoy: string;
  /** De qué día es la lista con que se valúa; nada si no se ha publicado ninguna. */
  listaDel: string | null;
  /** Lo que vale todo lo que tiene precio. */
  valor: string;
  /**
   * Lo que se está quedando: los materiales con existencia que llevan esos días o más sin salir, y
   * lo que valen los que tienen precio.
   */
  seQuedan: { dias: number; materiales: number; valor: string };
  /**
   * Los materiales que alguna vez se han movido. Primero los que tienen existencia, del que más
   * lleva sin salir al que menos, y al final los que ya no tienen.
   */
  materiales: MaterialDelPatio[];
}

/** Un tramo de la ficha: un día, o una semana cuando el periodo es de tres meses. */
export interface TramoDeMaterial {
  desde: string;
  hasta: string;
  kgComprado: string;
  importeComprado: string;
  kgVendido: string;
  importeVendido: string;
  /** Lo que había en el patio al terminar el tramo, según el libro. */
  kgAlFinal: string;
}

export interface FichaDeMaterial {
  /** Cómo está ahora: no depende del periodo. */
  material: MaterialDelPatio;
  /** El periodo, los dos días incluidos, AAAA-MM-DD. */
  desde: string;
  hasta: string;
  dias: PeriodoDeMaterial;
  paso: "dia" | "semana";
  totales: {
    /** En cuántas cuentas terminadas se compró y en cuántas se vendió. */
    compras: number;
    ventas: number;
    /** Kilos que entraron y salieron, y lo que suman sus renglones, con centavos. */
    kgComprado: string;
    importeComprado: string;
    kgVendido: string;
    importeVendido: string;
    /** Lo que se pagó y se cobró por cada kilo que entró o salió, con cuatro decimales. Nada si no hubo. */
    porKiloComprado: string | null;
    porKiloVendido: string | null;
    /** Lo cobrado menos lo pagado, por kilo. No es la ganancia: lo vendido pudo comprarse antes, a otro precio. */
    diferenciaPorKilo: string | null;
    /** Kilos que se pesaron y no se pagaron (en compras) o no se cobraron (en ventas). */
    kgDescontadoEnCompras: string;
    kgDescontadoEnVentas: string;
  };
  /** Lo que había en el patio antes del primer día del periodo. */
  kgAlEmpezar: string;
  /** Todos los tramos del periodo, en orden, también los que no tuvieron nada. */
  serie: TramoDeMaterial[];
  /** Lo que se le perdió, se le ajustó o se separó en el periodo. */
  control: {
    mermas: number;
    mermaKg: string;
    ajustes: number;
    ajusteEntroKg: string;
    ajusteSalioKg: string;
    /** Lo que salió por separarse en otros materiales, y lo que llegó por la separación de otro. */
    separadoKg: string;
    deSeparacionKg: string;
  };
  /** Su historia de precios en el mismo periodo; nada si nunca ha tenido precio. */
  precios: HistoriaDeMaterial | null;
}

/** Salir es venderse o separarse en otros materiales. */
const SALE = "(mov.tipo = 'venta' OR (mov.tipo = 'transformacion' AND mov.cantidad_kg < 0))";

// Lo que comparten las dos consultas. $1: qué día es hoy (nada es la fecha del patio); $2: un material, o todos.
const HOY = "SELECT coalesce($1::date, hoy_en(s.id)) AS hoy, s.zona FROM sucursal s WHERE s.id = 1";
const DEL_PATIO = `
  -- Cada movimiento del libro con su día: el de su jornada; sin jornada, el día en que se asentó.
  mov AS (
    SELECT mv.material_id, mv.tipo, mv.cantidad_kg, coalesce(j.fecha, (mv.creado_en AT TIME ZONE r.zona)::date) AS fecha
    FROM movimiento_inventario mv LEFT JOIN jornada j ON j.id = mv.jornada_id, r
    WHERE mv.sucursal_id = 1 AND ($2::int IS NULL OR mv.material_id = $2)
  ),
  ultima AS (
    SELECT l.id, j.fecha FROM lista_precios l JOIN jornada j ON j.id = l.jornada_id
    WHERE j.sucursal_id = 1 AND l.publicada_en IS NOT NULL
    ORDER BY j.fecha DESC LIMIT 1
  ),
  patio AS (
    SELECT m.id, m.nombre, f.nombre AS familia, m.activo, x.n, coalesce(x.kg, 0) AS kg, p.compra AS precio, x.salio,
      -- Desde cuándo está sin salir: desde su última salida o, si nunca ha salido, desde que llegó.
      coalesce(x.ultima, x.primera) AS quieto_desde,
      jsonb_build_object(
        'id', m.id, 'nombre', m.nombre, 'familia', f.nombre, 'activo', m.activo,
        'kg', coalesce(x.kg, 0)::numeric(14,3)::text, 'precio', p.compra::text,
        'valor', round(coalesce(x.kg, 0) * p.compra, 2)::numeric(14,2)::text,
        'ultimaSalida', to_char(x.ultima, 'YYYY-MM-DD'), 'diasSinSalir', greatest(r.hoy - coalesce(x.ultima, x.primera), 0),
        'kgSalio', x.salio::numeric(14,3)::text,
        'alcanzaPara', CASE WHEN x.kg > 0 AND x.salio > 0 THEN least(ceil(x.kg * ${RITMO} / x.salio), ${ALCANZA_A_LO_MAS})::int END) AS fila
    FROM material m JOIN familia f ON f.id = m.familia_id CROSS JOIN r
    CROSS JOIN LATERAL (
      SELECT count(*) AS n, sum(mov.cantidad_kg) AS kg, min(mov.fecha) AS primera,
             max(mov.fecha) FILTER (WHERE ${SALE} AND mov.fecha <= r.hoy) AS ultima,
             coalesce(-sum(mov.cantidad_kg) FILTER (WHERE ${SALE} AND mov.fecha > r.hoy - ${RITMO} AND mov.fecha <= r.hoy), 0) AS salio
      FROM mov WHERE mov.material_id = m.id
    ) x
    LEFT JOIN precio p ON p.lista_id = (SELECT id FROM ultima) AND p.material_id = m.id
    WHERE m.sucursal_id = 1 AND ($2::int IS NULL OR m.id = $2)
  )`;

const PATIO = `
  WITH r AS (${HOY}), ${DEL_PATIO}
  SELECT to_char(r.hoy, 'YYYY-MM-DD') AS hoy,
    (SELECT to_char(fecha, 'YYYY-MM-DD') FROM ultima) AS lista_del,
    (SELECT coalesce(sum(round(kg * precio, 2)), 0)::numeric(14,2)::text FROM patio WHERE n > 0) AS valor,
    (SELECT jsonb_build_object('dias', ${SE_QUEDA}, 'materiales', count(*)::int, 'valor', coalesce(sum(round(kg * precio, 2)), 0)::numeric(14,2)::text)
     FROM patio, r WHERE kg > 0 AND r.hoy - quieto_desde >= ${SE_QUEDA}) AS se_quedan,
    (SELECT coalesce(jsonb_agg(fila ORDER BY (kg > 0) DESC, quieto_desde, nombre), '[]'::jsonb) FROM patio WHERE n > 0) AS materiales
  FROM r`;

/** Lo que hay de cada material y qué tanto se mueve, a hoy. Una sola consulta: todo es del mismo instante. */
export async function materialesDelPatio(bd: Bd, o: { hoy?: string | null }): Promise<Patio> {
  const [f] = await bd.leer(PATIO, [o.hoy ?? null, null]);
  return { hoy: f!.hoy, listaDel: f!.lista_del, valor: f!.valor, seQuedan: f!.se_quedan, materiales: f!.materiales };
}

const de = (tipo: "compra" | "venta", que: string): string => `coalesce(sum(${que}) FILTER (WHERE ren.tipo = '${tipo}'), 0)`;
const LO_DEL_TRAMO = `
  'kgComprado', ${de("compra", "ren.kg")}::numeric(14,3)::text, 'importeComprado', ${de("compra", "ren.importe")}::numeric(14,2)::text,
  'kgVendido', ${de("venta", "ren.kg")}::numeric(14,3)::text, 'importeVendido', ${de("venta", "ren.importe")}::numeric(14,2)::text`;
const porKilo = (tipo: "compra" | "venta"): string =>
  `CASE WHEN ${de(tipo, "ren.kg")} > 0 THEN round(${de(tipo, "ren.importe")} / ${de(tipo, "ren.kg")}, 4)::text END`;
const delPeriodo = (que: string, filtro: string): string => `(SELECT ${que} FROM mov WHERE mov.fecha BETWEEN r.desde AND r.hoy AND ${filtro})`;
const kilosDe = (signo: "" | "-", filtro: string): string => delPeriodo(`coalesce(${signo}sum(mov.cantidad_kg), 0)::numeric(14,3)::text`, filtro);

// $1: hasta qué día (nada es hoy); $2: el material; $3: cuántos días; $4: de cuántos días es cada tramo.
const FICHA = `
  WITH r AS (SELECT h.hoy, h.zona, h.hoy - ($3::int - 1) AS desde FROM (${HOY}) h), ${DEL_PATIO},
  -- Los renglones de ese material en las cuentas terminadas del periodo, con el día en que se asentó su cuenta.
  ren AS (
    SELECT o.id AS cuenta, o.tipo, j.fecha, l.peso_recibido AS kg, l.importe, l.descuento_kg
    FROM operacion_linea l JOIN operacion o ON o.id = l.operacion_id JOIN jornada j ON j.id = o.confirmada_en_jornada, r
    WHERE o.sucursal_id = 1 AND o.estado = 'confirmada' AND l.material_id = $2 AND j.fecha BETWEEN r.desde AND r.hoy
  )
  SELECT to_char(r.desde, 'YYYY-MM-DD') AS desde, to_char(r.hoy, 'YYYY-MM-DD') AS hasta,
    (SELECT fila FROM patio) AS material,
    (SELECT jsonb_build_object(
       'compras', (count(DISTINCT ren.cuenta) FILTER (WHERE ren.tipo = 'compra'))::int,
       'ventas', (count(DISTINCT ren.cuenta) FILTER (WHERE ren.tipo = 'venta'))::int, ${LO_DEL_TRAMO},
       'porKiloComprado', ${porKilo("compra")}, 'porKiloVendido', ${porKilo("venta")},
       'diferenciaPorKilo', CASE WHEN ${de("compra", "ren.kg")} > 0 AND ${de("venta", "ren.kg")} > 0
         THEN round(${de("venta", "ren.importe")} / ${de("venta", "ren.kg")} - ${de("compra", "ren.importe")} / ${de("compra", "ren.kg")}, 4)::text END,
       'kgDescontadoEnCompras', ${de("compra", "ren.descuento_kg")}::numeric(14,3)::text,
       'kgDescontadoEnVentas', ${de("venta", "ren.descuento_kg")}::numeric(14,3)::text)
     FROM ren) AS totales,
    (SELECT coalesce(sum(mov.cantidad_kg), 0)::numeric(14,3)::text FROM mov WHERE mov.fecha < r.desde) AS al_empezar,
    (SELECT jsonb_agg(t.fila ORDER BY t.k)
     FROM (SELECT k, jsonb_build_object(
             'desde', to_char(r.desde + k * $4::int, 'YYYY-MM-DD'), 'hasta', to_char(r.desde + k * $4::int + $4::int - 1, 'YYYY-MM-DD'), ${LO_DEL_TRAMO},
             'kgAlFinal', (SELECT coalesce(sum(mov.cantidad_kg), 0)::numeric(14,3)::text FROM mov WHERE mov.fecha <= r.desde + k * $4::int + $4::int - 1)) AS fila
           FROM generate_series(0, $3::int / $4::int - 1) AS k
           LEFT JOIN ren ON ren.fecha BETWEEN r.desde + k * $4::int AND r.desde + k * $4::int + $4::int - 1
           GROUP BY k) t) AS serie,
    jsonb_build_object(
      'mermas', ${delPeriodo("count(*)::int", "mov.tipo = 'merma'")}, 'mermaKg', ${kilosDe("-", "mov.tipo = 'merma'")},
      'ajustes', ${delPeriodo("count(*)::int", "mov.tipo = 'ajuste'")},
      'ajusteEntroKg', ${kilosDe("", "mov.tipo = 'ajuste' AND mov.cantidad_kg > 0")}, 'ajusteSalioKg', ${kilosDe("-", "mov.tipo = 'ajuste' AND mov.cantidad_kg < 0")},
      'separadoKg', ${kilosDe("-", "mov.tipo = 'transformacion' AND mov.cantidad_kg < 0")},
      'deSeparacionKg', ${kilosDe("", "mov.tipo = 'transformacion' AND mov.cantidad_kg > 0")}) AS control
  FROM r`;

/**
 * La ficha de un material en un periodo que termina ese día; sin decir cuál, hoy. Nada si el
 * material no existe. Lo suyo sale de una sola consulta; su historia de precios, de la que ya hay
 * (historia-de-precios.ts), para el mismo periodo.
 */
export async function fichaDeMaterial(bd: Bd, material: number, o: { dias: PeriodoDeMaterial; hasta?: string | null }): Promise<FichaDeMaterial | null> {
  // A tres meses, día por día no se lee: va por semanas.
  const paso = o.dias === 91 ? 7 : 1;
  const [f] = await bd.leer(FICHA, [o.hasta ?? null, material, o.dias, paso]);
  if (!f?.material) return null;
  const historia = await historiaDePrecios(bd, { dias: o.dias, hasta: f.hasta });
  return {
    material: f.material, desde: f.desde, hasta: f.hasta, dias: o.dias, paso: paso === 7 ? "semana" : "dia",
    totales: f.totales, kgAlEmpezar: f.al_empezar, serie: f.serie, control: f.control,
    precios: historia.materiales.find((m) => m.id === material) ?? null,
  };
}
