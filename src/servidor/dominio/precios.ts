// La lista de precios del día: verla, cambiarla mientras no se publique, y publicarla.
import type { Bd, Persona } from "../bd.ts";

export interface MaterialConPrecio {
  id: number;
  nombre: string;
  nombreCorto: string;
  /** Pesos por kilo, como texto decimal; vacío si hoy no tiene precio. */
  compra: string | null;
  venta: string | null;
  /** El precio de la última lista publicada antes de esta, de referencia. */
  antes: { compra: string; venta: string } | null;
}

export interface ListaDelDia {
  /** Vacía si nunca ha habido una lista. `abierta` dice si es la de la jornada en curso. */
  lista: { id: string; fecha: string; abierta: boolean; publicada: boolean } | null;
  familias: Array<{ id: number; nombre: string; materiales: MaterialConPrecio[] }>;
}

/**
 * La lista de la jornada abierta; si no hay jornada, la última publicada, para consultarla.
 * Sale del catálogo, no de los precios: un material sin precio aparece, y aparece sin precio.
 */
export async function listaDelDia(bd: Bd): Promise<ListaDelDia> {
  const filas = await bd.leer(
    `WITH esta AS (
       SELECT l.id, j.fecha, j.cerrada_en IS NULL AS abierta, l.publicada_en IS NOT NULL AS publicada
       FROM lista_precios l JOIN jornada j ON j.id = l.jornada_id
       WHERE j.sucursal_id = 1 AND (j.cerrada_en IS NULL OR l.publicada_en IS NOT NULL)
       ORDER BY j.cerrada_en IS NULL DESC, j.fecha DESC LIMIT 1
     ), anterior AS (
       SELECT l.id FROM lista_precios l JOIN jornada j ON j.id = l.jornada_id
       WHERE j.sucursal_id = 1 AND l.publicada_en IS NOT NULL AND j.fecha < (SELECT fecha FROM esta)
       ORDER BY j.fecha DESC LIMIT 1
     )
     SELECT esta.id AS lista_id, to_char(esta.fecha, 'YYYY-MM-DD') AS fecha, esta.abierta, esta.publicada,
            f.id AS familia_id, f.nombre AS familia, m.id, m.nombre, m.nombre_corto,
            p.compra::text AS compra, p.venta::text AS venta, a.compra::text AS antes_compra, a.venta::text AS antes_venta
     FROM material m
     JOIN familia f ON f.id = m.familia_id
     LEFT JOIN esta ON true
     LEFT JOIN precio p ON p.lista_id = esta.id AND p.material_id = m.id
     LEFT JOIN precio a ON a.lista_id = (SELECT id FROM anterior) AND a.material_id = m.id
     WHERE m.activo OR p.material_id IS NOT NULL
     ORDER BY f.orden, m.id`,
  );
  const primera = filas[0];
  const l: ListaDelDia = {
    lista: primera?.lista_id ? { id: primera.lista_id, fecha: primera.fecha, abierta: primera.abierta, publicada: primera.publicada } : null,
    familias: [],
  };
  for (const f of filas) {
    let familia = l.familias.at(-1);
    if (!familia || familia.id !== f.familia_id) {
      familia = { id: f.familia_id, nombre: f.familia, materiales: [] };
      l.familias.push(familia);
    }
    familia.materiales.push({
      id: f.id, nombre: f.nombre, nombreCorto: f.nombre_corto, compra: f.compra, venta: f.venta,
      antes: f.antes_compra === null ? null : { compra: f.antes_compra, venta: f.antes_venta },
    });
  }
  return l;
}

export type CambioDePrecio =
  | { material: number | string; compra: string; venta: string }
  | { material: number | string; quitar: true };

/** Guarda los cambios a la lista de hoy. Entran todos o ninguno. */
export async function guardarPrecios(bd: Bd, persona: Persona, cambios: CambioDePrecio[]): Promise<void> {
  await bd.enTransaccion(persona, async (c) => {
    for (const cambio of cambios) {
      if ("quitar" in cambio) {
        await c.query("SELECT quitar_precio($1, $2)", [cambio.material, persona]);
      } else {
        await c.query("SELECT fijar_precio($1, $2, $3, $4)", [cambio.material, cambio.compra, cambio.venta, persona]);
      }
    }
  });
}

/** Publica la lista de la jornada abierta. Desde ese momento no cambia. */
export async function publicarLista(bd: Bd, persona: Persona): Promise<void> {
  await bd.enTransaccion(persona, (c) => c.query("SELECT publicar_lista_de_hoy($1)", [persona]));
}
