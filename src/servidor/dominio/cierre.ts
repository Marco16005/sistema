// El cierre del día: lo que se asentó, lo que falta por terminar, el cajón, y cerrar con su corte.
import type { Bd, Persona } from "../bd.ts";
import { estadoDelCajon } from "./caja.ts";
import type { Cajon } from "./caja.ts";

export interface CuentaPendiente {
  id: string;
  tipo: "compra" | "venta";
  etiqueta: string | null;
  materiales: number;
}

export interface Reapertura {
  /** Cuál cierre de la jornada se reabrió. */
  cierre: number;
  /** A qué hora se había cerrado y a qué hora se reabrió, HH:MM en el patio. */
  cerradaEn: string;
  reabiertaEn: string;
  autorizo: string;
}

export interface PrecioEspecialDelDia {
  folio: string;
  cliente: string;
  material: string;
  /** Kilos que se pagaron o cobraron, ya con tara y descuento. */
  kg: string;
  precioDeLista: string;
  precio: string;
  /** En dinero: el importe cobrado menos el que habría dado la lista, cada uno redondeado a centavos. */
  diferencia: string;
  autorizo: string;
}

export interface Cierre {
  /**
   * `cierres`: cuántas veces se ha cerrado; si está cerrada, ese es el número de su cierre vigente.
   * `cerradaEn`: a qué hora se cerró, HH:MM en el patio.
   */
  jornada: { id: string; fecha: string; abierta: boolean; cierres: number; cerradaEn: string | null };
  /** Las veces que este día se reabrió después de cerrarse: un reporte impreso antes quedó viejo. */
  reaperturas: Reapertura[];
  /** Cuentas confirmadas en esta jornada. */
  operaciones: number;
  /** Lo que hay que pagar por las compras y cobrar por las ventas, en pesos cerrados. No es lo pagado: la caja se lleva aparte. */
  aPagar: string;
  aCobrar: string;
  /** Lo que el redondeo a pesos cerrados movió en total. */
  ajustes: string;
  materiales: Array<{ nombre: string; entro: string; salio: string }>;
  /**
   * Los precios especiales de lo cobrado en el día: qué se dio, a quién, y cuánto dinero significó.
   * La diferencia es lo cobrado menos lo que habría dado la lista: en una compra, positiva es que
   * se pagó de más; en una venta, que se cobró de más. Es informativo: la caja se lleva aparte.
   */
  preciosEspeciales: { compras: PrecioEspecialDelDia[]; ventas: PrecioEspecialDelDia[]; diferenciaEnCompras: string; diferenciaEnVentas: string };
  /** Cuentas abiertas que impiden cerrar: se terminan o se descartan. */
  porTerminar: CuentaPendiente[];
  /** Vehículos que se pesaron una vez y no han vuelto. No impiden cerrar: pueden volver otro día. */
  vehiculosPorVolver: CuentaPendiente[];
  /** El cajón de ese día: con cuánto se abrió, lo que entró y salió, y sus cortes. */
  cajon: Cajon;
}

const pendientes = (esperaVehiculo: boolean): string => `
  coalesce((SELECT jsonb_agg(jsonb_build_object('id', p.operacion_id, 'tipo', p.tipo, 'etiqueta', p.etiqueta, 'materiales', p.materiales)
                             ORDER BY p.creada_en, p.operacion_id)
            FROM cuenta_pendiente p WHERE p.jornada_id = j.id AND ${esperaVehiculo ? "" : "NOT "}p.espera_vehiculo), '[]'::jsonb)`;

/**
 * El resumen de una jornada. Sin decir cuál: la que está abierta, o si no hay, la última. Sus dos
 * lecturas —el día y su cajón— ven la misma foto: un corte a media lectura no las deja discrepar.
 */
export function resumenDelCierre(bd: Bd, jornada: string | null = null): Promise<Cierre | null> {
  return bd.instantanea((foto) => resumenEn(foto, jornada));
}

async function resumenEn(bd: Bd, jornada: string | null): Promise<Cierre | null> {
  const [f] = await bd.leer(
    `WITH j AS (
       SELECT jornada.id, fecha, cerrada_en, cierres, s.zona FROM jornada JOIN sucursal s ON s.id = jornada.sucursal_id
       WHERE sucursal_id = 1 AND ($1::bigint IS NULL OR jornada.id = $1)
       ORDER BY cerrada_en IS NULL DESC, fecha DESC LIMIT 1
     )
     SELECT j.id, to_char(j.fecha, 'YYYY-MM-DD') AS fecha, j.cerrada_en IS NULL AS abierta, j.cierres,
            to_char(j.cerrada_en AT TIME ZONE j.zona, 'HH24:MI') AS cerrada_en,
            coalesce((SELECT jsonb_agg(jsonb_build_object('cierre', x.cierre, 'cerradaEn', to_char(x.cerrada_en AT TIME ZONE j.zona, 'HH24:MI'),
                                                          'reabiertaEn', to_char(x.reabierta_en AT TIME ZONE j.zona, 'HH24:MI'), 'autorizo', u.nombre)
                                       ORDER BY x.cierre)
                      FROM reapertura x JOIN usuario u ON u.id = x.autorizada_por WHERE x.jornada_id = j.id), '[]'::jsonb) AS reaperturas,
            r.operaciones, r.total_compras::text AS a_pagar, r.total_ventas::text AS a_cobrar, r.ajustes_redondeo::text AS ajustes,
            coalesce((SELECT jsonb_agg(jsonb_build_object('nombre', m.nombre, 'entro', m.entro_kg::text, 'salio', m.salio_kg::text) ORDER BY m.nombre)
                      FROM cierre_material m WHERE m.jornada_id = j.id), '[]'::jsonb) AS materiales,
            (SELECT jsonb_build_object(
                      'compras', coalesce(jsonb_agg(y.fila ORDER BY y.orden) FILTER (WHERE y.tipo = 'compra'), '[]'::jsonb),
                      'ventas', coalesce(jsonb_agg(y.fila ORDER BY y.orden) FILTER (WHERE y.tipo = 'venta'), '[]'::jsonb),
                      'diferenciaEnCompras', coalesce(sum(y.diferencia) FILTER (WHERE y.tipo = 'compra'), 0)::numeric(14,2)::text,
                      'diferenciaEnVentas', coalesce(sum(y.diferencia) FILTER (WHERE y.tipo = 'venta'), 0)::numeric(14,2)::text)
             FROM (SELECT x.tipo, x.diferencia, x.ordinality AS orden,
                          jsonb_build_object('folio', x.folio::text, 'cliente', x.cliente, 'material', x.material, 'kg', x.kg::text,
                                             'precioDeLista', x.precio_lista::text, 'precio', x.precio_aplicado::text,
                                             'diferencia', x.diferencia::text, 'autorizo', x.autorizo_nombre) AS fila
                   FROM precios_especiales_del_dia(j.id) WITH ORDINALITY x) y) AS precios_especiales,
            ${pendientes(false)} AS por_terminar,
            ${pendientes(true)} AS vehiculos
     FROM j JOIN cierre_resumen r ON r.jornada_id = j.id`,
    [jornada],
  );
  if (!f) return null;
  const cajon = (await estadoDelCajon(bd, f.id))!;
  return {
    cajon,
    jornada: { id: f.id, fecha: f.fecha, abierta: f.abierta, cierres: f.cierres, cerradaEn: f.cerrada_en },
    reaperturas: f.reaperturas,
    operaciones: f.operaciones, aPagar: f.a_pagar, aCobrar: f.a_cobrar, ajustes: f.ajustes,
    materiales: f.materiales, preciosEspeciales: f.precios_especiales, porTerminar: f.por_terminar, vehiculosPorVolver: f.vehiculos,
  };
}

export interface OrdenDeCierre {
  /** El identificador del envío: repetirlo devuelve lo que hizo, aunque el día se haya reabierto después. */
  id: string;
  jornada: string;
  /** Cuántos cierres llevaba la jornada cuando la pantalla la vio abierta. */
  cierres: number;
  /** El corte: lo que se contó en el cajón y lo que se deja en él para mañana, en pesos. */
  contado: string;
  seQueda: string;
  /** Quien hace el corte —un responsable o alguien con permiso de corte— y su clave. */
  hace: string;
  clave: string;
}

/**
 * Cierra ESA jornada con su corte, si sigue abierta y como se vio. Devuelve cuál cierre fue y cómo
 * está la jornada ahora (que puede ser abierta otra vez, si el envío es un reintento y entre tanto
 * se reabrió). Nada si la clave de quien hace el corte no pasó: el día sigue abierto.
 */
export async function cerrarJornada(
  bd: Bd, persona: Persona, huella: string, orden: OrdenDeCierre,
): Promise<(Cierre & { cierre: number }) | null> {
  const hecho = await bd.enTransaccion(persona, async (c) =>
    (await c.query("SELECT jornada_id, cierre FROM cerrar_el_dia($1, $2, $3, $4, $5, $6, $7, $8, $9)",
      [orden.id, orden.jornada, orden.cierres, orden.contado, orden.seQueda, orden.hace, orden.clave, huella, persona])).rows[0]);
  if (!hecho || hecho.jornada_id === null) return null;
  return { ...(await resumenDelCierre(bd, hecho.jornada_id))!, cierre: hecho.cierre };
}

export interface OrdenDeReapertura {
  id: string;
  jornada: string;
  /** Cuál cierre vio la pantalla: si ya no es el vigente, no se reabre. */
  cierre: number;
  autoriza: string;
  clave: string;
}

/** Reabre ESE cierre de la jornada de hoy. Devuelve nada si la clave de quien autoriza no pasó. */
export async function reabrirJornada(
  bd: Bd, persona: Persona, huella: string, orden: OrdenDeReapertura,
): Promise<{ reapertura: string; cierre: number } | null> {
  return bd.enTransaccion(persona, async (c) => {
    const { rows } = await c.query(
      "SELECT id::text AS id, cierre FROM reabrir_jornada($1, $2, $3, $4, $5, $6, $7)",
      [orden.id, orden.jornada, orden.cierre, orden.autoriza, orden.clave, huella, persona],
    );
    return rows[0].id === null ? null : { reapertura: rows[0].id, cierre: rows[0].cierre };
  });
}
