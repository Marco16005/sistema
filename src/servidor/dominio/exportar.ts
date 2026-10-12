// Las hojas para descargar: los números llegan hechos, como texto decimal.
import type { Bd } from "../bd.ts";
import { ErrorDeForma } from "../numeros.ts";

export const HOJAS = ["dias", "cuentas", "renglones", "precios"] as const;
export type Hoja = (typeof HOJAS)[number];

export interface Tabla {
  encabezados: string[];
  /** Cada celda ya es texto. `null` es una celda vacía. */
  filas: Array<Array<string | null>>;
  /** Qué columnas (por índice) traen texto escrito por una persona: nombres, etiquetas. */
  deTexto: number[];
}

// Con qué empieza una fórmula en una hoja de cálculo, también escrita en ancho completo.
const SIGNOS = "=+\\-@＝＋－＠";
// Una celda de texto que empieza con uno de esos signos —aunque lleve espacios por delante—, o con
// tabulador o retorno, que algunos programas se comen antes de leerla.
const AL_PRINCIPIO = new RegExp(`^(?:[\\t\\r]|\\s*[${SIGNOS}])`);
// El mismo archivo no lo leen igual todos los programas: donde las listas se separan con punto y
// coma (o con tabulador), o donde no se respetan las comillas, lo que aquí es una celda allá son
// dos, y la segunda empezaría con lo que sigue al separador.
const TRAS_SEPARADOR = new RegExp(`([,;\\t\\r\\n]\\s*)(?=[${SIGNOS}])`, "g");

/**
 * Lo que escribió una persona (un nombre, una etiqueta), sin nada que una hoja de cálculo pueda
 * ejecutar como fórmula: lleva un apóstrofo delante de cada signo que quedaría al principio de una
 * celda, en este archivo o leído con otro separador.
 */
function sinFormulas(texto: string): string {
  const s = texto.replace(TRAS_SEPARADOR, "$1'");
  return AL_PRINCIPIO.test(s) ? "'" + s : s;
}

/** La tabla como texto CSV, lista para que Excel la abra con sus acentos. */
export function comoCsv(tabla: Tabla): string {
  const celda = (valor: string | null, texto: boolean): string => {
    const s = texto ? sinFormulas(valor ?? "") : valor ?? "";
    return /[,"\r\n]/.test(s) ? '"' + s.replaceAll('"', '""') + '"' : s;
  };
  const encabezado = tabla.encabezados.map((s) => celda(s, false)).join(",");
  return "\uFEFF" + [encabezado, ...tabla.filas.map((f) => f.map((s, i) => celda(s, tabla.deTexto.includes(i))).join(","))].join("\r\n") + "\r\n";
}

/** La tabla de esa hoja, del `desde` al `hasta`, los dos incluidos. */
export async function tablaPara(bd: Bd, o: { hoja: Hoja; desde: string; hasta: string }): Promise<Tabla> {
  for (const valor of [o.desde, o.hasta]) {
    const fecha = new Date(`${valor}T00:00:00Z`);
    if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(valor) || valor.startsWith("0000") ||
        !Number.isFinite(fecha.getTime()) || fecha.toISOString().slice(0, 10) !== valor) {
      throw new ErrorDeForma("La fecha debe ser válida y escribirse AAAA-MM-DD");
    }
  }
  if (o.desde > o.hasta) throw new ErrorDeForma("El primer día del periodo no puede ser posterior al último");
  if ((Date.parse(o.hasta) - Date.parse(o.desde)) / 86400000 + 1 > 366) {
    throw new ErrorDeForma("En un archivo caben hasta 366 días: pide un periodo más corto");
  }
  if (o.hoja === "precios") {
    const filas = await bd.leer(`
      SELECT ARRAY[to_char(j.fecha, 'YYYY-MM-DD'), f.nombre, m.nombre, p.compra::text, p.venta::text] AS fila
      FROM lista_precios l JOIN jornada j ON j.id = l.jornada_id JOIN precio p ON p.lista_id = l.id
      JOIN material m ON m.id = p.material_id JOIN familia f ON f.id = m.familia_id
      WHERE j.sucursal_id = 1 AND l.publicada_en IS NOT NULL AND j.fecha BETWEEN $1::date AND $2::date
      ORDER BY j.fecha, f.orden, m.id`, [o.desde, o.hasta]);
    return { encabezados: ["Fecha", "Familia", "Material", "Compra", "Venta"], filas: filas.map((f) => f.fila), deTexto: [1, 2] };
  }
  if (o.hoja === "renglones") {
    const filas = await bd.leer(`
      SELECT ARRAY[to_char(j.fecha, 'YYYY-MM-DD'), o.folio::text, o.tipo, o.cliente_nombre, m.nombre,
        l.peso_bruto::numeric(14,3)::text, l.tara::numeric(14,3)::text, l.descuento_kg::numeric(14,3)::text,
        l.peso_liquidable::numeric(14,3)::text, l.precio_lista::text, l.precio_unitario::text,
        l.importe::numeric(14,2)::text, CASE WHEN l.precio_autorizado_por IS NULL THEN 'no' ELSE 'sí' END] AS fila
      FROM operacion o JOIN jornada j ON j.id = o.confirmada_en_jornada
      JOIN operacion_linea l ON l.operacion_id = o.id JOIN material m ON m.id = l.material_id
      WHERE o.sucursal_id = 1 AND j.sucursal_id = 1 AND o.estado = 'confirmada' AND j.fecha BETWEEN $1::date AND $2::date
      ORDER BY j.fecha, o.folio, l.creada_en, l.id`, [o.desde, o.hasta]);
    return { encabezados: ["Fecha", "Folio", "Tipo", "Cliente", "Material", "Peso bruto", "Tara", "Descuento", "Kilos", "Precio de lista", "Precio", "Importe", "Precio especial"], filas: filas.map((f) => f.fila), deTexto: [3, 4] };
  }
  if (o.hoja === "dias") {
    const filas = await bd.leer(`
      WITH op AS (
        SELECT o.id, o.tipo, o.total, o.confirmada_en_jornada,
          (SELECT coalesce(sum(l.peso_recibido), 0) FROM operacion_linea l WHERE l.operacion_id = o.id) AS kg
        FROM operacion o WHERE o.sucursal_id = 1 AND o.estado = 'confirmada'
      )
      SELECT ARRAY[to_char(j.fecha, 'YYYY-MM-DD'), CASE WHEN j.cerrada_en IS NULL THEN 'abierto' ELSE 'cerrado' END,
        count(op.id)::text, (count(op.id) FILTER (WHERE op.tipo = 'compra'))::text,
        (count(op.id) FILTER (WHERE op.tipo = 'venta'))::text,
        coalesce(sum(op.total) FILTER (WHERE op.tipo = 'compra'), 0)::numeric(14,0)::text,
        coalesce(sum(op.total) FILTER (WHERE op.tipo = 'venta'), 0)::numeric(14,0)::text,
        coalesce(sum(op.kg) FILTER (WHERE op.tipo = 'compra'), 0)::numeric(14,3)::text,
        coalesce(sum(op.kg) FILTER (WHERE op.tipo = 'venta'), 0)::numeric(14,3)::text] AS fila
      FROM jornada j LEFT JOIN op ON op.confirmada_en_jornada = j.id
      WHERE j.sucursal_id = 1 AND j.fecha BETWEEN $1::date AND $2::date
      GROUP BY j.id ORDER BY j.fecha`, [o.desde, o.hasta]);
    return { encabezados: ["Fecha", "Estado", "Cuentas", "Compras", "Ventas", "Pagado", "Cobrado", "Kilos comprados", "Kilos vendidos"], filas: filas.map((f) => f.fila), deTexto: [] };
  }
  const filas = await bd.leer(`
    SELECT ARRAY[to_char(j.fecha, 'YYYY-MM-DD'), to_char(o.confirmada_en AT TIME ZONE s.zona, 'HH24:MI'),
      o.folio::text, o.tipo, o.cliente_nombre, o.etiqueta,
      (SELECT count(*)::text FROM operacion_linea l WHERE l.operacion_id = o.id),
      (SELECT coalesce(sum(l.peso_recibido), 0)::numeric(14,3)::text FROM operacion_linea l WHERE l.operacion_id = o.id),
      o.total::text, u.nombre] AS fila
    FROM operacion o JOIN jornada j ON j.id = o.confirmada_en_jornada
    JOIN sucursal s ON s.id = o.sucursal_id JOIN usuario u ON u.id = o.confirmada_por
    WHERE o.sucursal_id = 1 AND j.sucursal_id = 1 AND o.estado = 'confirmada' AND j.fecha BETWEEN $1::date AND $2::date
    ORDER BY j.fecha, o.folio`, [o.desde, o.hasta]);
  return { encabezados: ["Fecha", "Hora", "Folio", "Tipo", "Cliente", "Nombre", "Materiales", "Kilos", "Total", "Atendió"], filas: filas.map((f) => f.fila), deTexto: [4, 5, 9] };
}
