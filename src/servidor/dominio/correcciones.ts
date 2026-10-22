// Corregir una cuenta ya cobrada (migración 0040): se dice cuántos kilos eran de verdad, o qué
// material era, y se liquida solo la diferencia. El comprobante original no cambia; las
// correcciones quedan aparte, con quién las autorizó y por qué. La regla —qué precio, qué entra y
// sale del patio, si cuenta en el cajón— es de la base; aquí se le pregunta y se lee.
import type { Bd, Persona } from "../bd.ts";
import { ErrorDeNegocio } from "../errores.ts";

/** «credito»: a lo que debe el cliente; solo en una venta fiada, que no se deja «pendiente» (0043). */
export type Liquidacion = "efectivo" | "transferencia" | "pendiente" | "credito";
export const LIQUIDACIONES: readonly Liquidacion[] = ["efectivo", "transferencia", "pendiente", "credito"];

export interface CorreccionDeCuenta {
  numero: number;
  /** El material de cada renglón, antes y después; el mismo si solo cambiaron los kilos. */
  materialAntes: string;
  materialDespues: string;
  kgAntes: string;
  kgDespues: string;
  precio: string;
  importeAntes: string;
  importeDespues: string;
  /** Lo de después menos lo de antes. En una compra, positiva es que se pagó de menos; en una venta, que se cobró de menos. */
  diferencia: string;
  liquidacion: Liquidacion;
  /** Cuándo, AAAA-MM-DD y HH:MM en el patio. */
  fecha: string;
  hora: string;
  motivo: string;
  autorizo: string;
  registro: string;
}

export interface RenglonParaCorregir {
  linea: string;
  /** Lo que vale ahora: lo de su última corrección, o lo del comprobante. */
  material: { id: number; nombre: string };
  kg: string;
  precio: string;
  importe: string;
  /** Cuántas correcciones lleva: lo que se manda como «vistas» al corregirlo. */
  correcciones: number;
}

export interface CuentaParaCorregir {
  id: string;
  folio: string;
  tipo: "compra" | "venta";
  /** El día en que se cobró, AAAA-MM-DD. */
  fecha: string;
  /** Si se fió: entonces la diferencia va a lo que debe el cliente, o se liquida en el momento. */
  fiada: boolean;
  renglones: RenglonParaCorregir[];
  correcciones: CorreccionDeCuenta[];
}

/** Una cuenta cobrada, con lo que vale ahora cada material y las correcciones que lleva. Nada si no está cobrada. */
export async function cuentaParaCorregir(bd: Bd, operacion: string): Promise<CuentaParaCorregir | null> {
  const [f] = await bd.leer(
    `SELECT o.id, o.folio::text AS folio, o.tipo, to_char(j.fecha, 'YYYY-MM-DD') AS fecha, o.forma_de_pago = 'credito' AS fiada,
            (SELECT jsonb_agg(jsonb_build_object(
                      'linea', l.id, 'material', jsonb_build_object('id', m.id, 'nombre', m.nombre),
                      'kg', coalesce(u.kg_despues, l.peso_liquidable)::text, 'precio', coalesce(u.precio, l.precio_unitario)::text,
                      'importe', coalesce(u.importe_despues, l.importe)::text, 'correcciones', coalesce(u.numero, 0)
                    ) ORDER BY l.creada_en, l.id)
             FROM operacion_linea l
             LEFT JOIN LATERAL (SELECT * FROM correccion_de_cuenta c WHERE c.linea_id = l.id ORDER BY c.numero DESC LIMIT 1) u ON true
             JOIN material m ON m.id = coalesce(u.material_despues, l.material_id)
             WHERE l.operacion_id = o.id) AS renglones,
            coalesce((SELECT jsonb_agg(jsonb_build_object(
                        'numero', c.numero, 'materialAntes', ma.nombre, 'materialDespues', md.nombre,
                        'kgAntes', c.kg_antes::text, 'kgDespues', c.kg_despues::text, 'precio', c.precio::text,
                        'importeAntes', c.importe_antes::text, 'importeDespues', c.importe_despues::text, 'diferencia', c.diferencia::text,
                        'liquidacion', c.liquidacion, 'fecha', to_char(c.creado_en AT TIME ZONE s.zona, 'YYYY-MM-DD'),
                        'hora', to_char(c.creado_en AT TIME ZONE s.zona, 'HH24:MI'), 'motivo', c.motivo,
                        'autorizo', ua.nombre, 'registro', ur.nombre
                      ) ORDER BY c.creado_en, c.id)
                      FROM correccion_de_cuenta c
                      JOIN material ma ON ma.id = c.material_antes JOIN material md ON md.id = c.material_despues
                      JOIN usuario ua ON ua.id = c.autorizado_por JOIN usuario ur ON ur.id = c.registrado_por
                      WHERE c.operacion_id = o.id), '[]'::jsonb) AS correcciones
     FROM operacion o
     JOIN jornada j ON j.id = o.confirmada_en_jornada
     JOIN sucursal s ON s.id = o.sucursal_id
     WHERE o.id = $1 AND o.estado = 'confirmada'`,
    [operacion],
  );
  if (!f) return null;
  return { id: f.id, folio: f.folio, tipo: f.tipo, fecha: f.fecha, fiada: f.fiada, renglones: f.renglones, correcciones: f.correcciones };
}

export interface OrdenDeCorreccion {
  /** El identificador del envío: repetirlo devuelve lo que hizo. */
  id: string;
  linea: string;
  /** Los kilos que de verdad eran (los que se pagan o cobran) y el material que de verdad era. */
  kg: string;
  material: number;
  /** Cuántas correcciones llevaba el renglón cuando se vio. */
  vistas: number;
  liquidacion: Liquidacion;
  motivo: string;
  autoriza: string;
  clave: string;
}

/** Corrige un renglón de una cuenta cobrada. Nada si la clave de quien autoriza no pasó: el intento queda contado. */
export async function corregirCuenta(
  bd: Bd, persona: Persona, huella: string, operacion: string, o: OrdenDeCorreccion,
): Promise<CuentaParaCorregir | null> {
  const hecho = await bd.enTransaccion(persona, async (c) => {
    // Desde una cuenta no se corrige el material de otra: lo que la pantalla tiene a la vista no es lo que cambiaría.
    const pertenece = await c.query("SELECT 1 FROM operacion_linea WHERE id = $1 AND operacion_id = $2", [o.linea, operacion]);
    if (pertenece.rows.length === 0) throw new ErrorDeNegocio("RC005", "Ese material no es de esta cuenta");
    return (await c.query("SELECT id FROM corregir_cuenta($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)",
      [o.id, o.linea, o.kg, o.material, o.vistas, o.liquidacion, o.motivo, o.autoriza, o.clave, huella, persona])).rows[0];
  });
  if (!hecho || hecho.id === null) return null;
  return cuentaParaCorregir(bd, operacion);
}
