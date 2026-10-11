// El inventario visto desde el servidor: lo que hay, los movimientos de un material, y las cuatro
// acciones que lo cambian fuera del mostrador —contar, dar merma, separar y corregir—.
//
// Cada acción llama a su función de entrada del núcleo. La clave de quien autoriza un conteo o
// una corrección viaja hasta la base, que es quien la comprueba, en la misma transacción en que
// escribe. Cuando la clave no pasa, la función contesta sin error, la transacción se confirma —el
// intento fallido queda contado— y aquí se devuelve nada.
import type { Bd, Persona } from "../bd.ts";

// ── lo que hay ──────────────────────────────────────────────────────────────

export interface Existencias {
  familias: Array<{
    id: number;
    nombre: string;
    materiales: Array<{
      id: number;
      nombre: string;
      nombreCorto: string;
      /** Kilos en el patio según el libro. */
      kg: string;
      /** Lo que ya está en ventas abiertas, sin terminar. */
      apartado: string;
      disponible: string;
      ultimoConteo: { fecha: string; hora: string; diferencia: string } | null;
    }>;
  }>;
}

export async function existencias(bd: Bd): Promise<Existencias> {
  const filas = await bd.leer(
    `SELECT f.id AS familia_id, f.nombre AS familia, m.id, m.nombre, m.nombre_corto,
            d.kg::text AS kg, d.apartado_kg::text AS apartado, d.disponible_kg::text AS disponible,
            (SELECT jsonb_build_object('fecha', to_char(c.contado_en AT TIME ZONE s.zona, 'YYYY-MM-DD'),
                                       'hora', to_char(c.contado_en AT TIME ZONE s.zona, 'HH24:MI'),
                                       'diferencia', c.diferencia_kg::text)
             FROM conteo c WHERE c.material_id = m.id ORDER BY c.contado_en DESC, c.id DESC LIMIT 1) AS ultimo_conteo
     FROM material m
     JOIN familia f ON f.id = m.familia_id
     JOIN sucursal s ON s.id = m.sucursal_id
     JOIN disponible d ON d.material_id = m.id
     WHERE m.activo OR d.kg <> 0
     ORDER BY f.orden, m.id`,
  );
  const e: Existencias = { familias: [] };
  for (const f of filas) {
    let familia = e.familias.at(-1);
    if (!familia || familia.id !== f.familia_id) {
      familia = { id: f.familia_id, nombre: f.familia, materiales: [] };
      e.familias.push(familia);
    }
    familia.materiales.push({
      id: f.id, nombre: f.nombre, nombreCorto: f.nombre_corto, kg: f.kg, apartado: f.apartado, disponible: f.disponible,
      ultimoConteo: f.ultimo_conteo,
    });
  }
  return e;
}

export interface Movimiento {
  id: string;
  tipo: "apertura" | "compra" | "venta" | "merma" | "ajuste" | "transformacion";
  /** Positivo entra, negativo sale. */
  kg: string;
  fecha: string;
  hora: string;
  quien: string;
  autorizo: string | null;
  motivo: string | null;
  /** El folio del comprobante, si salió de una cuenta. */
  folio: string | null;
  /** Si este movimiento es la corrección de otro: cuál, para poder ir a corregir ese. */
  original: { id: string; tipo: string; material: { id: number; nombre: string }; folio: string | null } | null;
  /** Cuántas correcciones lleva. Es lo que se manda al corregirlo, para corregir lo que se vio. */
  correcciones: number;
  /** Cómo quedó tras sus correcciones; vacío si no se ha corregido. Una lista vacía: quedó sin efecto. */
  quedo: Array<{ material: string; kg: string }> | null;
  /** Después de este movimiento ya se contó el material: el conteo manda, y esto ya no se corrige. */
  yaContado: boolean;
  corregible: boolean;
}

export interface MovimientosDeMaterial {
  material: { id: number; nombre: string };
  kg: string;
  movimientos: Movimiento[];
}

/** Los últimos movimientos de un material, del más reciente al más viejo. Nada si el material no existe. */
export async function movimientosDe(bd: Bd, material: number): Promise<MovimientosDeMaterial | null> {
  const [f] = await bd.leer(
    `SELECT m.id, m.nombre, e.kg::text AS kg,
            coalesce((
              SELECT jsonb_agg(x.fila ORDER BY x.id DESC)
              FROM (
                SELECT mv.id, jsonb_build_object(
                  'id', mv.id::text, 'tipo', mv.tipo, 'kg', mv.cantidad_kg::text,
                  'fecha', to_char(mv.creado_en AT TIME ZONE s.zona, 'YYYY-MM-DD'),
                  'hora', to_char(mv.creado_en AT TIME ZONE s.zona, 'HH24:MI'),
                  'quien', u.nombre, 'autorizo', a.nombre, 'motivo', mv.motivo,
                  'folio', (SELECT o.folio::text FROM operacion_linea l JOIN operacion o ON o.id = l.operacion_id WHERE l.id = mv.linea_id),
                  'original', (SELECT jsonb_build_object(
                                 'id', org.id::text, 'tipo', org.tipo,
                                 'material', jsonb_build_object('id', mo.id, 'nombre', mo.nombre),
                                 'folio', (SELECT o.folio::text FROM operacion_linea l JOIN operacion o ON o.id = l.operacion_id WHERE l.id = org.linea_id))
                               FROM movimiento_inventario org JOIN material mo ON mo.id = org.material_id
                               WHERE org.id = mv.referencia_id),
                  'correcciones', c.n,
                  'quedo', CASE WHEN c.n > 0 THEN coalesce((
                             SELECT jsonb_agg(jsonb_build_object('material', me.nombre, 'kg', q.kg::text) ORDER BY me.nombre)
                             FROM estado_de_movimiento(mv.id) q JOIN material me ON me.id = q.material_id), '[]'::jsonb) END,
                  'yaContado', cubierto.si,
                  'corregible', mv.referencia_id IS NULL AND mv.tipo IN ('apertura', 'compra', 'venta', 'merma') AND NOT cubierto.si
                ) AS fila
                FROM movimiento_inventario mv
                JOIN usuario u ON u.id = mv.creado_por
                LEFT JOIN usuario a ON a.id = mv.autorizado_por
                CROSS JOIN LATERAL (SELECT count(*)::int AS n FROM movimiento_inventario r WHERE r.referencia_id = mv.id) c
                -- ¿Ya lo cubrió un conteo? Se mira el material donde el movimiento cuenta hoy —el que dejaron sus
                -- correcciones—, no el que tenía al registrarse: es lo mismo que mira la base al corregir.
                CROSS JOIN LATERAL (SELECT EXISTS (
                  SELECT 1 FROM conteo k
                  WHERE k.contado_en >= mv.efectivo_en
                    AND k.material_id IN (SELECT q.material_id FROM estado_de_movimiento(coalesce(mv.referencia_id, mv.id)) q)
                ) AS si) cubierto
                WHERE mv.material_id = m.id
                ORDER BY mv.id DESC LIMIT 100
              ) x), '[]'::jsonb) AS movimientos
     FROM material m
     JOIN sucursal s ON s.id = m.sucursal_id
     JOIN existencia e ON e.material_id = m.id
     WHERE m.id = $1`,
    [material],
  );
  if (!f) return null;
  return { material: { id: f.id, nombre: f.nombre }, kg: f.kg, movimientos: f.movimientos };
}

/** Las personas que pueden autorizar un conteo o una corrección. */
export const quienesAutorizan = (bd: Bd): Promise<Array<{ id: string; nombre: string }>> =>
  bd.leer("SELECT id, nombre FROM usuario WHERE activo AND puede_autorizar ORDER BY nombre, id");

// ── contar ──────────────────────────────────────────────────────────────────

export interface PreviaDeConteo {
  contado: string;
  /** El momento del conteo, ya fijo: es el que se manda al autorizar. */
  contadoEn: string;
  hora: string;
  /** Lo que el libro decía a esa hora. También se manda al autorizar: si cambió, se rechaza. */
  registrado: string;
  diferencia: string;
}

/** Lo que se ve antes de autorizar un conteo. `hora` (HH:MM de hoy) si no se contó ahorita. */
export async function previaDeConteo(bd: Bd, material: number, contado: string, hora: string | null): Promise<PreviaDeConteo> {
  const [f] = await bd.leer(
    `SELECT p.contado_en::text AS contado_en, to_char(p.contado_en AT TIME ZONE s.zona, 'HH24:MI') AS hora,
            p.registrado_kg::text AS registrado, p.diferencia_kg::text AS diferencia
     FROM sucursal s,
          previa_de_conteo($1, $2, CASE WHEN $3::text IS NULL THEN NULL ELSE (hoy_en(s.id) + $3::time) AT TIME ZONE s.zona END) p
     WHERE s.id = 1`,
    [material, contado, hora],
  );
  return { contado, contadoEn: f!.contado_en, hora: f!.hora, registrado: f!.registrado, diferencia: f!.diferencia };
}

export interface Autorizacion {
  /** Quién autoriza y su clave, tecleada en el momento. La comprueba la base. */
  autoriza: Persona;
  clave: string;
}

export interface EnvioDeConteo extends Autorizacion {
  id: string;
  material: number;
  contado: string;
  contadoEn: string;
  registrado: string;
  nota: string | null;
}

/** Cuenta un material. Devuelve nada si la clave de quien autoriza no pasó. */
export async function contar(
  bd: Bd, persona: Persona, huella: string, envio: EnvioDeConteo,
): Promise<{ contado: string; registrado: string; diferencia: string } | null> {
  return bd.enTransaccion(persona, async (c) => {
    const { rows } = await c.query(
      `SELECT id, contado_kg::text AS contado, registrado_kg::text AS registrado, diferencia_kg::text AS diferencia
       FROM contar_material($1, $2, $3, $4::timestamptz, $5, $6, $7, $8, $9, $10)`,
      [envio.id, envio.material, envio.contado, envio.contadoEn, envio.registrado, envio.nota, envio.autoriza, envio.clave, huella, persona],
    );
    const f = rows[0];
    return f.id === null ? null : { contado: f.contado, registrado: f.registrado, diferencia: f.diferencia };
  });
}

// ── merma y separación ──────────────────────────────────────────────────────

export async function darMerma(
  bd: Bd, persona: Persona, envio: { id: string; material: number; kg: string; motivo: string },
): Promise<{ kg: string; motivo: string }> {
  return bd.enTransaccion(persona, async (c) => {
    const { rows } = await c.query("SELECT (-cantidad_kg)::text AS kg, motivo FROM dar_merma($1, $2, $3, $4, $5)", [
      envio.id, envio.material, envio.kg, envio.motivo, persona,
    ]);
    return rows[0];
  });
}

export interface Producto {
  material: number;
  kg: string;
}

/** Lo que se pierde al separar: el origen menos los productos. La resta la hace la base. */
export async function previaDeSeparacion(bd: Bd, origen: number, kg: string, productos: Producto[]): Promise<string> {
  const [f] = await bd.leer("SELECT previa_de_separacion($1, $2, $3::jsonb)::text AS merma", [origen, kg, JSON.stringify(productos)]);
  return f!.merma;
}

export async function separar(
  bd: Bd, persona: Persona, envio: { id: string; origen: number; kg: string; productos: Producto[]; nota: string | null },
): Promise<{ merma: string }> {
  return bd.enTransaccion(persona, async (c) => {
    const { rows } = await c.query("SELECT merma_kg::text AS merma FROM separar_material($1, $2, $3, $4::jsonb, $5, $6)", [
      envio.id, envio.origen, envio.kg, JSON.stringify(envio.productos), envio.nota, persona,
    ]);
    return rows[0];
  });
}

// ── corregir ────────────────────────────────────────────────────────────────

export interface EnvioDeCorreccion extends Autorizacion {
  id: string;
  movimiento: string;
  /** Cómo debió quedar: de qué material y de cuántos kilos. Cero: no debió registrarse. */
  material: number;
  kg: string;
  /** Cuántas correcciones tenía el movimiento cuando se revisó. */
  vistas: number;
  motivo: string;
}

/** Corrige un movimiento. Devuelve nada si la clave de quien autoriza no pasó. No toca dinero. */
export async function corregir(
  bd: Bd, persona: Persona, huella: string, envio: EnvioDeCorreccion,
): Promise<{ original: string; ajustes: number } | null> {
  return bd.enTransaccion(persona, async (c) => {
    const { rows } = await c.query(
      "SELECT original::text AS original, cardinality(ajustes) AS ajustes FROM corregir_movimiento($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)",
      [envio.id, envio.movimiento, envio.material, envio.kg, envio.vistas, envio.motivo, envio.autoriza, envio.clave, huella, persona],
    );
    const f = rows[0];
    return f.original === null ? null : { original: f.original, ajustes: f.ajustes };
  });
}
