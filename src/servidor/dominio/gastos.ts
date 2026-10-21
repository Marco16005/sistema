// Los gastos del negocio (migración 0042): se capturan a mano, por tipo, y cada tipo dice si se resta
// en la utilidad. Uno del cajón es también un «sacar»; un «sacar» que ya estaba se puede clasificar.
// Las reglas son de la base; aquí se le pregunta y se lee.
import type { Bd, Persona } from "../bd.ts";

export interface TipoDeGasto {
  id: string;
  nombre: string;
  /** Si se resta en la utilidad. */
  cuenta: boolean;
  activo: boolean;
}

export interface Gasto {
  id: string;
  /** AAAA-MM-DD */
  fecha: string;
  tipo: string;
  concepto: string;
  importe: string;
  deDonde: "cajon" | "otro";
  registro: string;
  /** Si se anuló: quién, cuándo (AAAA-MM-DD) y por qué. Ya no suma. */
  anulado: { por: string; fecha: string; motivo: string } | null;
}

/** Un «sacar» del cajón que todavía no se clasifica como gasto: se ofrece para clasificarlo. */
export interface SacarSinGasto {
  id: string;
  fecha: string;
  hora: string;
  importe: string;
  motivo: string;
}

export interface Gastos {
  desde: string;
  hasta: string;
  tipos: TipoDeGasto[];
  gastos: Gasto[];
  /** Por tipo, sin anulados, y el total de los que se restan en la utilidad. */
  porTipo: Array<{ tipo: string; cuenta: boolean; total: string; cuantos: number }>;
  totalQueCuenta: string;
  /** Los «sacar» de los últimos 30 días sin un gasto vivo: nunca clasificados, o cuyo gasto se anuló. */
  sinClasificar: SacarSinGasto[];
}

export async function gastos(bd: Bd, o: { desde: string; hasta: string }): Promise<Gastos> {
  const [f] = await bd.leer(
    `WITH z AS (SELECT zona FROM sucursal WHERE id = 1)
     SELECT
       (SELECT coalesce(jsonb_agg(jsonb_build_object('id', t.id::text, 'nombre', t.nombre, 'cuenta', t.cuenta, 'activo', t.activo)
                                  ORDER BY t.activo DESC, t.id), '[]'::jsonb) FROM tipo_de_gasto t) AS tipos,
       (SELECT coalesce(jsonb_agg(jsonb_build_object(
                  'id', g.id::text, 'fecha', to_char(g.fecha, 'YYYY-MM-DD'), 'tipo', t.nombre, 'concepto', g.concepto,
                  'importe', g.importe::text, 'deDonde', g.de_donde, 'registro', r.nombre,
                  'anulado', CASE WHEN g.anulado_en IS NOT NULL THEN jsonb_build_object(
                    'por', a.nombre, 'fecha', to_char(g.anulado_en AT TIME ZONE z.zona, 'YYYY-MM-DD'), 'motivo', g.motivo_anulacion) END)
                ORDER BY g.fecha DESC, g.id DESC), '[]'::jsonb)
        FROM gasto g JOIN tipo_de_gasto t ON t.id = g.tipo_id JOIN usuario r ON r.id = g.registrado_por
        LEFT JOIN usuario a ON a.id = g.anulado_por, z
        WHERE g.fecha BETWEEN $1::date AND $2::date) AS gastos,
       (SELECT coalesce(jsonb_agg(jsonb_build_object('tipo', x.tipo, 'cuenta', x.cuenta, 'total', x.total::numeric(16,2)::text, 'cuantos', x.cuantos)
                                  ORDER BY x.total DESC, x.tipo), '[]'::jsonb)
        FROM gastos_del_periodo($1::date, $2::date) x) AS por_tipo,
       (SELECT coalesce(sum(x.total) FILTER (WHERE x.cuenta), 0)::numeric(16,2)::text FROM gastos_del_periodo($1::date, $2::date) x) AS total_que_cuenta,
       (SELECT coalesce(jsonb_agg(jsonb_build_object('id', m.id::text, 'fecha', to_char(j.fecha, 'YYYY-MM-DD'),
                  'hora', to_char(m.creado_en AT TIME ZONE z.zona, 'HH24:MI'), 'importe', m.importe::text, 'motivo', m.motivo)
                ORDER BY m.creado_en DESC), '[]'::jsonb)
        FROM caja_movimiento m JOIN jornada j ON j.id = m.jornada_id, z
        WHERE m.tipo = 'sacar' AND j.fecha >= hoy_en(1::smallint) - 29
          AND NOT EXISTS (SELECT 1 FROM gasto g WHERE g.caja_movimiento_id = m.id AND g.anulado_en IS NULL)) AS sin_clasificar`,
    [o.desde, o.hasta],
  );
  return {
    desde: o.desde, hasta: o.hasta, tipos: f!.tipos, gastos: f!.gastos, porTipo: f!.por_tipo,
    totalQueCuenta: f!.total_que_cuenta, sinClasificar: f!.sin_clasificar,
  };
}

export interface OrdenDeGasto {
  /** El identificador del envío: repetirlo no gasta dos veces. */
  id: string;
  fecha: string;
  tipo: string;
  concepto: string;
  importe: string;
  deDonde: "cajon" | "otro";
  /** El «sacar» que se clasifica, si es eso. */
  movimiento: string | null;
}

export async function registrarGasto(bd: Bd, persona: Persona, o: OrdenDeGasto): Promise<void> {
  await bd.enTransaccion(persona, (c) =>
    c.query("SELECT registrar_gasto($1, $2, $3, $4, $5, $6, $7, $8)", [o.id, o.fecha, o.tipo, o.concepto, o.importe, o.deDonde, o.movimiento, persona]));
}

export async function anularGasto(bd: Bd, persona: Persona, gasto: string, motivo: string): Promise<void> {
  await bd.enTransaccion(persona, (c) => c.query("SELECT anular_gasto($1, $2, $3)", [gasto, motivo, persona]));
}

export async function altaTipoDeGasto(bd: Bd, persona: Persona, nombre: string): Promise<void> {
  await bd.enTransaccion(persona, (c) => c.query("SELECT alta_tipo_de_gasto($1, $2)", [nombre, persona]));
}

export async function cambiarTipoDeGasto(bd: Bd, persona: Persona, tipo: string, o: { cuenta: boolean; activo: boolean }): Promise<void> {
  await bd.enTransaccion(persona, (c) => c.query("SELECT cambiar_tipo_de_gasto($1, $2, $3, $4)", [tipo, o.cuenta, o.activo, persona]));
}
