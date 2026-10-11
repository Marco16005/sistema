// En qué va el día: si ya se terminó el arranque, si hay jornada abierta, si los precios están
// publicados. Y las dos acciones que lo echan a andar: terminar el arranque y abrir la jornada.
import type { Bd, Persona } from "../bd.ts";

export interface EstadoDelDia {
  /** La fecha de hoy en el patio, AAAA-MM-DD. */
  hoy: string;
  arranqueTerminado: boolean;
  /** La jornada abierta, con los cierres que lleva: quien la cierra dice cuántos le vio. */
  jornada: { id: string; fecha: string; esDeHoy: boolean; cierres: number } | null;
  /** La jornada de HOY, si ya se cerró: es la que se puede reabrir, diciendo cuál cierre se vio. */
  cerradaHoy: { id: string; cierre: number } | null;
  lista: { id: string; publicada: boolean; precios: number } | null;
  /** Cuentas de vehículos que no volvieron a pesarse antes de que su jornada cerrara. */
  vehiculosPorVolver: number;
  /** Hay jornada abierta con precios publicados: se puede atender. */
  listo: boolean;
}

export async function estadoDelDia(bd: Bd): Promise<EstadoDelDia> {
  // Una sola consulta: todo corresponde al mismo instante.
  const [f] = await bd.leer(
    // Qué día es hoy lo dice la base, con la zona horaria del patio.
    `WITH hoy AS (SELECT hoy_en(1::smallint) AS fecha),
          abierta AS (SELECT j.id, j.fecha, j.cierres FROM jornada j WHERE j.sucursal_id = 1 AND j.cerrada_en IS NULL),
          cerrada AS (SELECT j.id, j.cierres FROM jornada j, hoy WHERE j.sucursal_id = 1 AND j.fecha = hoy.fecha AND j.cerrada_en IS NOT NULL)
     SELECT to_char(hoy.fecha, 'YYYY-MM-DD') AS hoy,
            abierta.cierres AS cierres, cerrada.id AS cerrada_id, cerrada.cierres AS cerrada_cierre,
            (SELECT corte_cerrado_en IS NOT NULL FROM sucursal WHERE id = 1) AS arranque_terminado,
            abierta.id AS jornada_id, to_char(abierta.fecha, 'YYYY-MM-DD') AS jornada_fecha, abierta.fecha = hoy.fecha AS es_de_hoy,
            l.id AS lista_id, l.publicada_en IS NOT NULL AS publicada,
            (SELECT count(*)::int FROM precio p WHERE p.lista_id = l.id) AS precios,
            (SELECT count(*)::int FROM operacion o JOIN jornada j ON j.id = o.jornada_id
             WHERE o.estado = 'borrador' AND j.cerrada_en IS NOT NULL) AS vehiculos
     FROM hoy
     LEFT JOIN abierta ON true
     LEFT JOIN cerrada ON true
     LEFT JOIN lista_precios l ON l.jornada_id = abierta.id`,
  );
  const d = f!;
  return {
    hoy: d.hoy,
    arranqueTerminado: d.arranque_terminado,
    jornada: d.jornada_id ? { id: d.jornada_id, fecha: d.jornada_fecha, esDeHoy: d.es_de_hoy, cierres: d.cierres } : null,
    cerradaHoy: d.cerrada_id ? { id: d.cerrada_id, cierre: d.cerrada_cierre } : null,
    lista: d.lista_id ? { id: d.lista_id, publicada: d.publicada, precios: d.precios } : null,
    vehiculosPorVolver: d.vehiculos,
    listo: Boolean(d.jornada_id && d.publicada),
  };
}

export interface Saldo {
  material: number | string;
  /** Kilos, como texto decimal. */
  kg: string;
  origen: "contado" | "estimado";
}

/** Carga lo que ya hay en el patio y cierra el arranque. O entra todo, o nada. */
export async function terminarArranque(bd: Bd, persona: Persona, saldos: Saldo[]): Promise<void> {
  await bd.enTransaccion(persona, (c) => c.query("SELECT terminar_arranque($1::jsonb, $2)", [JSON.stringify(saldos), persona]));
}

export interface HojaDeSaldo {
  terminado: boolean;
  familias: Array<{
    id: number;
    nombre: string;
    materiales: Array<{ id: number; nombre: string; nombreCorto: string; kg: string | null; origen: string | null }>;
  }>;
}

/** Los materiales del catálogo, por familia, con el saldo inicial de los que lo tengan. */
export async function saldoInicial(bd: Bd): Promise<HojaDeSaldo> {
  const filas = await bd.leer(
    `SELECT (SELECT corte_cerrado_en IS NOT NULL FROM sucursal WHERE id = 1) AS terminado,
            f.id AS familia_id, f.nombre AS familia, m.id, m.nombre, m.nombre_corto,
            a.kg::text AS kg, a.origen
     FROM material m
     JOIN familia f ON f.id = m.familia_id
     LEFT JOIN (
       SELECT material_id, sum(cantidad_kg) AS kg, min(origen_saldo) AS origen
       FROM movimiento_inventario WHERE tipo = 'apertura' GROUP BY material_id
     ) a ON a.material_id = m.id
     WHERE m.activo OR a.kg IS NOT NULL
     ORDER BY f.orden, m.id`,
  );
  const hoja: HojaDeSaldo = { terminado: filas[0]?.terminado ?? false, familias: [] };
  for (const f of filas) {
    let familia = hoja.familias.at(-1);
    if (!familia || familia.id !== f.familia_id) {
      familia = { id: f.familia_id, nombre: f.familia, materiales: [] };
      hoja.familias.push(familia);
    }
    familia.materiales.push({ id: f.id, nombre: f.nombre, nombreCorto: f.nombre_corto, kg: f.kg, origen: f.origen });
  }
  return hoja;
}

/** Abre la jornada de hoy. Deja lista, sin publicar, una copia de los últimos precios publicados. */
export async function abrirJornada(bd: Bd, persona: Persona): Promise<{ id: string; fecha: string }> {
  return bd.enTransaccion(persona, async (c) => {
    const { rows } = await c.query(
      "SELECT j.id, to_char(j.fecha, 'YYYY-MM-DD') AS fecha FROM abrir_jornada_de_hoy($1) j",
      [persona],
    );
    return rows[0];
  });
}
