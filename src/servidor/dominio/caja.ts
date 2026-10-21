// El cajón (migración 0038): con cuánto se abrió, lo que entró y salió en efectivo, lo que se metió
// y se sacó, cuánto debería haber, y los cortes. Las reglas —quién puede, si la clave pasó, la
// fórmula de lo que debería haber— son de la base; aquí se le pregunta y se lee.
//
// El dinero cruza como texto decimal con dos centavos: así no se redondea por el camino.
import type { Bd, Persona } from "../bd.ts";

export interface MovimientoDeCaja {
  id: string;
  tipo: "sacar" | "meter";
  importe: string;
  motivo: string;
  /** Quien lo registró y quien lo autorizó con su clave. */
  registro: string;
  autorizo: string;
  /** HH:MM en el patio. */
  hora: string;
}

export interface CorteDeCaja {
  /** Qué cierre del día fue: el primero, o el que siguió a una reapertura. */
  cierre: number;
  esperado: string;
  contado: string;
  /** Lo contado menos lo esperado: negativo es que faltó. */
  diferencia: string;
  /** Lo que se quedó en el cajón para el día siguiente, y lo que se llevó quien hizo el corte. */
  seQueda: string;
  retirado: string;
  /** Quien lo firmó con su clave. */
  hizo: string;
  hora: string;
}

export interface Cajon {
  jornada: { id: string; fecha: string; abierta: boolean; cierres: number };
  /** El conteo al abrir. `anterior` es lo que se había dejado en el último corte: si no coincide, hubo aviso. */
  apertura: { contado: string; anterior: string | null; conto: string; hora: string } | null;
  /** Lo que se dejó en el último corte de un día anterior: es lo que se propone al contar. */
  sugerido: string | null;
  /** De las cuentas terminadas en este día, por forma de pago. Solo el efectivo pasa por el cajón. */
  efectivo: { cobrado: string; pagado: string };
  transferencia: { cobrado: string; pagado: string };
  movimientos: MovimientoDeCaja[];
  metido: string;
  sacado: string;
  /**
   * Lo que movieron en el cajón las correcciones de cuentas cobradas que se liquidaron en efectivo
   * ese día (0040): positivo es que entró (devolvió el vendedor, completó el cliente).
   */
  correcciones: string;
  /** Los abonos de lo fiado que llegaron en efectivo ese día (0041): entran al cajón. */
  abonos: string;
  /** Lo que se vendió fiado ese día: no pasa por el cajón. */
  fiado: string;
  /** Lo que se llevaron en los cortes anteriores de este mismo día, si se reabrió. */
  retiradoAntes: string;
  /** Lo que debería haber ahora en el cajón. Nada mientras no se cuente al abrir. */
  esperado: string | null;
  cortes: CorteDeCaja[];
}

export interface Aviso {
  id: string;
  /** «corte»: al cerrar no cuadró. «apertura»: al abrir había distinto de lo que se dejó. */
  clase: "corte" | "apertura";
  /** El día, AAAA-MM-DD. */
  fecha: string;
  diferencia: string;
  /** Quien contó, y a qué hora. */
  conto: string;
  hora: string;
}

const PESOS = (que: string): string => `coalesce(${que}, 0)::numeric(14,2)::text`;

/** El cajón de una jornada. Sin decir cuál: la que está abierta, o si no hay, la última. */
export async function estadoDelCajon(bd: Bd, jornada: string | null = null): Promise<Cajon | null> {
  const [f] = await bd.leer(
    `WITH j AS (
       SELECT jornada.id, jornada.fecha, jornada.cerrada_en, jornada.cierres, s.zona
       FROM jornada JOIN sucursal s ON s.id = jornada.sucursal_id
       WHERE sucursal_id = 1 AND ($1::bigint IS NULL OR jornada.id = $1)
       ORDER BY cerrada_en IS NULL DESC, fecha DESC LIMIT 1
     ),
     cuentas AS (
       SELECT o.tipo, o.forma_de_pago, sum(o.total) AS total
       FROM operacion o, j WHERE o.confirmada_en_jornada = j.id AND o.estado = 'confirmada'
       GROUP BY 1, 2
     )
     SELECT j.id, to_char(j.fecha, 'YYYY-MM-DD') AS fecha, j.cerrada_en IS NULL AS abierta, j.cierres,
            (SELECT jsonb_build_object('contado', a.contado::text, 'anterior', a.anterior::text, 'conto', u.nombre,
                                       'hora', to_char(a.contado_en AT TIME ZONE j.zona, 'HH24:MI'))
             FROM caja_apertura a JOIN usuario u ON u.id = a.contado_por WHERE a.jornada_id = j.id) AS apertura,
            (SELECT c.se_queda::text FROM caja_corte c JOIN jornada x ON x.id = c.jornada_id
             WHERE x.sucursal_id = 1 AND x.fecha < j.fecha ORDER BY x.fecha DESC, c.cierre DESC LIMIT 1) AS sugerido,
            jsonb_build_object(
              'cobrado', (SELECT ${PESOS("sum(total)")} FROM cuentas WHERE tipo = 'venta' AND forma_de_pago = 'efectivo'),
              'pagado', (SELECT ${PESOS("sum(total)")} FROM cuentas WHERE tipo = 'compra' AND forma_de_pago = 'efectivo')) AS efectivo,
            jsonb_build_object(
              'cobrado', (SELECT ${PESOS("sum(total)")} FROM cuentas WHERE tipo = 'venta' AND forma_de_pago = 'transferencia'),
              'pagado', (SELECT ${PESOS("sum(total)")} FROM cuentas WHERE tipo = 'compra' AND forma_de_pago = 'transferencia')) AS transferencia,
            coalesce((SELECT jsonb_agg(jsonb_build_object('id', m.id::text, 'tipo', m.tipo, 'importe', m.importe::text, 'motivo', m.motivo,
                                                          'registro', r.nombre, 'autorizo', a.nombre,
                                                          'hora', to_char(m.creado_en AT TIME ZONE j.zona, 'HH24:MI'))
                                       ORDER BY m.creado_en, m.id)
                      FROM caja_movimiento m JOIN usuario r ON r.id = m.registrado_por JOIN usuario a ON a.id = m.autorizado_por
                      WHERE m.jornada_id = j.id), '[]'::jsonb) AS movimientos,
            (SELECT ${PESOS("sum(importe)")} FROM caja_movimiento WHERE jornada_id = j.id AND tipo = 'meter') AS metido,
            (SELECT ${PESOS("sum(importe)")} FROM caja_movimiento WHERE jornada_id = j.id AND tipo = 'sacar') AS sacado,
            (SELECT ${PESOS("sum(CASE WHEN o.tipo = 'venta' THEN c.diferencia ELSE -c.diferencia END)")}
             FROM correccion_de_cuenta c JOIN operacion o ON o.id = c.operacion_id
             WHERE c.jornada_id = j.id AND c.liquidacion = 'efectivo') AS correcciones,
            (SELECT ${PESOS("sum(importe)")} FROM abono WHERE jornada_id = j.id AND forma = 'efectivo') AS abonos,
            (SELECT ${PESOS("sum(total)")} FROM cuentas WHERE tipo = 'venta' AND forma_de_pago = 'credito') AS fiado,
            (SELECT ${PESOS("sum(retirado)")} FROM caja_corte WHERE jornada_id = j.id AND (j.cerrada_en IS NULL OR cierre < j.cierres)) AS retirado_antes,
            esperado_en_cajon(j.id)::numeric(14,2)::text AS esperado,
            coalesce((SELECT jsonb_agg(jsonb_build_object('cierre', c.cierre, 'esperado', c.esperado::text, 'contado', c.contado::text,
                                                          'diferencia', c.diferencia::text, 'seQueda', c.se_queda::text, 'retirado', c.retirado::text,
                                                          'hizo', u.nombre, 'hora', to_char(c.hecho_en AT TIME ZONE j.zona, 'HH24:MI'))
                                       ORDER BY c.cierre)
                      FROM caja_corte c JOIN usuario u ON u.id = c.hecho_por WHERE c.jornada_id = j.id), '[]'::jsonb) AS cortes
     FROM j`,
    [jornada],
  );
  if (!f) return null;
  return {
    jornada: { id: f.id, fecha: f.fecha, abierta: f.abierta, cierres: f.cierres },
    apertura: f.apertura, sugerido: f.sugerido, efectivo: f.efectivo, transferencia: f.transferencia,
    movimientos: f.movimientos, metido: f.metido, sacado: f.sacado, correcciones: f.correcciones, abonos: f.abonos, fiado: f.fiado, retiradoAntes: f.retirado_antes,
    // Con el día cerrado, lo que «debería haber» ya lo dijo su último corte.
    esperado: f.abierta ? f.esperado : null,
    cortes: f.cortes,
  };
}

/** Cuenta el cajón al abrir el día. Repetir el mismo envío no cuenta dos veces. */
export async function abrirCajon(bd: Bd, persona: Persona, o: { id: string; jornada: string; contado: string }): Promise<Cajon> {
  await bd.enTransaccion(persona, (c) => c.query("SELECT abrir_el_cajon($1, $2, $3, $4)", [o.id, o.jornada, o.contado, persona]));
  return (await estadoDelCajon(bd, o.jornada))!;
}

export interface OrdenDeMovimiento {
  id: string;
  jornada: string;
  tipo: "sacar" | "meter";
  importe: string;
  motivo: string;
  /** El responsable que lo autoriza, y su clave. */
  autoriza: string;
  clave: string;
}

/** Saca o mete dinero, con la clave de un responsable. Nada si la clave no pasó: el intento queda contado. */
export async function moverCaja(bd: Bd, persona: Persona, huella: string, o: OrdenDeMovimiento): Promise<Cajon | null> {
  const hecho = await bd.enTransaccion(persona, async (c) =>
    (await c.query("SELECT id FROM mover_caja($1, $2, $3, $4, $5, $6, $7, $8, $9)",
      [o.id, o.jornada, o.tipo, o.importe, o.motivo, o.autoriza, o.clave, huella, persona])).rows[0]);
  if (!hecho || hecho.id === null) return null;
  return estadoDelCajon(bd, o.jornada);
}

/** Los avisos que ningún responsable ha visto, del más reciente al más viejo. */
export const avisosSinVer = (bd: Bd): Promise<Aviso[]> =>
  bd.leer<Aviso>(
    `SELECT a.id::text AS id, a.clase, to_char(j.fecha, 'YYYY-MM-DD') AS fecha, a.diferencia::text AS diferencia,
            u.nombre AS conto, to_char(a.creado_en AT TIME ZONE s.zona, 'HH24:MI') AS hora
     FROM aviso a JOIN jornada j ON j.id = a.jornada_id JOIN sucursal s ON s.id = j.sucursal_id JOIN usuario u ON u.id = a.creado_por
     WHERE a.visto_en IS NULL
     ORDER BY a.creado_en DESC, a.id DESC`,
  );

/** Un responsable dice que ya vio el aviso. Repetirlo no cambia quién lo vio. */
export async function verAviso(bd: Bd, persona: Persona, aviso: string): Promise<void> {
  await bd.enTransaccion(persona, (c) => c.query("SELECT ver_aviso($1, $2)", [aviso, persona]));
}
