// Lo que el mostrador necesita para atender: los materiales por familia con el precio de hoy, y
// las básculas. En venta, además, cuánto hay disponible de cada material.
import type { Bd } from "../bd.ts";

export interface MaterialDelCatalogo {
  id: number;
  nombre: string;
  /** Como se lee dentro de su familia: «Bote», no «Aluminio bote». */
  nombreCorto: string;
  frecuente: boolean;
  /** Pesos por kilo según el sentido de la cuenta; vacío si hoy no tiene precio y no se puede atender. */
  precio: string | null;
  /** Solo en venta: kilos en existencia menos lo apartado en ventas abiertas. Es un aviso, no una reserva. */
  disponible: string | null;
}

export interface Catalogo {
  frecuentes: MaterialDelCatalogo[];
  familias: Array<{ id: number; nombre: string; materiales: MaterialDelCatalogo[] }>;
  basculas: Array<{ id: number; nombre: string; doblePesaje: boolean }>;
}

export async function catalogo(bd: Bd, tipo: "compra" | "venta"): Promise<Catalogo> {
  // Una sola consulta: materiales y básculas son del mismo instante.
  const [f] = await bd.leer(
    `SELECT
       (SELECT coalesce(jsonb_agg(jsonb_build_object(
                 'familia_id', f.id, 'familia', f.nombre, 'id', m.id, 'nombre', m.nombre, 'nombreCorto', m.nombre_corto,
                 'frecuente', m.frecuente,
                 'precio', (CASE $1 WHEN 'compra' THEN p.compra ELSE p.venta END)::text,
                 'disponible', CASE WHEN $1 = 'venta' THEN d.disponible_kg::text END
               ) ORDER BY f.orden, m.id), '[]'::jsonb)
        FROM material m
        JOIN familia f ON f.id = m.familia_id
        -- Solo vale la lista de la jornada abierta y ya publicada.
        LEFT JOIN lista_precios l ON l.publicada_en IS NOT NULL
             AND l.jornada_id = (SELECT id FROM jornada WHERE sucursal_id = 1 AND cerrada_en IS NULL)
        LEFT JOIN precio p ON p.lista_id = l.id AND p.material_id = m.id
        LEFT JOIN disponible d ON d.material_id = m.id
        WHERE m.activo) AS materiales,
       (SELECT coalesce(jsonb_agg(jsonb_build_object('id', i.id, 'nombre', i.nombre, 'doblePesaje', i.doble_pesaje) ORDER BY i.id), '[]'::jsonb)
        FROM instrumento i WHERE i.sucursal_id = 1) AS basculas`,
    [tipo],
  );
  const c: Catalogo = { frecuentes: [], familias: [], basculas: f!.basculas };
  for (const fila of f!.materiales as Array<Record<string, any>>) {
    let familia = c.familias.at(-1);
    if (!familia || familia.id !== fila.familia_id) {
      familia = { id: fila.familia_id, nombre: fila.familia, materiales: [] };
      c.familias.push(familia);
    }
    const m: MaterialDelCatalogo = {
      id: fila.id, nombre: fila.nombre, nombreCorto: fila.nombreCorto, frecuente: fila.frecuente, precio: fila.precio, disponible: fila.disponible,
    };
    familia.materiales.push(m);
    if (m.frecuente) c.frecuentes.push(m);
  }
  return c;
}
