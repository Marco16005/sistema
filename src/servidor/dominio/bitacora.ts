// Lo que ocurrió en el patio, contado sin exponer el detalle interno de la bitácora.
import type { Bd } from "../bd.ts";
import { fila } from "../forma.ts";
import { ErrorDeForma } from "../numeros.ts";

export interface Asiento {
  id: string;
  fecha: string;
  hora: string;
  quien: string | null;
  accion: string;
  entidad: string;
  que: string;
}

// La consulta elige los campos públicos; los números llegan como texto, incluso desde JSON.
interface Registro extends Omit<Asiento, "que"> {
  kg: string | null;
  contado: string | null;
  merma: string | null;
  total: string | null;
  queda: string | null;
  folio: string | null;
  cierre: string | null;
  tipo: string | null;
  clase: string | null;
  paso: string | null;
  motivo: string | null;
  nombre: string | null;
  material: string | null;
  destino: string | null;
  persona: string | null;
  cliente: string | null;
  autoriza: string | null;
  equipo: string | null;
  activoAntes: string | null;
  activoDespues: string | null;
  frecuenteAntes: string | null;
  frecuenteDespues: string | null;
}

const numero = (t: string | null, minimo: number, maximo: number): string =>
  Number(t).toLocaleString("es-MX", { minimumFractionDigits: minimo, maximumFractionDigits: maximo });
const kilos = (t: string | null): string => t === null ? "" : `${numero(t, 0, 3)} kg`;
const pesos = (t: string): string => `$${numero(t, 2, 2)}`;
const de = (nombre: string | null): string => nombre ? ` de ${nombre}` : "";
const motivo = (r: Registro): string => r.motivo ? `: ${r.motivo}` : "";
const cantidad = (r: Registro): string => kilos(r.kg) + de(r.material);
const tipo = (r: Registro): string => r.tipo === "compra" ? "compra" : r.tipo === "venta" ? "venta" : "cuenta";
const nombre = (r: Registro): string => r.nombre ? ` ${r.nombre}` : "";

const frases: Record<string, (r: Registro) => string> = {
  "abrir jornada": () => "abrió el día",
  "cerrar jornada": () => "cerró el día",
  "reabrir jornada": (r) => `reabrió el día${r.cierre ? ` (cierre ${r.cierre})` : ""}`,
  "publicar lista_precios": () => "publicó los precios",
  "confirmar operacion": (r) => `confirmó la ${tipo(r)}${r.folio ? ` ${r.folio}` : ""}${r.total !== null ? ` por ${pesos(r.total)}` : ""}`,
  "apertura material": (r) => `registró ${cantidad(r)} al arrancar`,
  "cerrar_corte sucursal": () => "cerró el inventario de arranque",
  "conteo material": (r) => `contó ${kilos(r.contado)}${de(r.material)}`,
  "ajuste material": (r) => `ajustó ${cantidad(r)}${motivo(r)}`,
  "corregir_material movimiento_inventario": (r) => `cambió ${cantidad(r)}${r.destino ? ` a ${r.destino}` : ""}${motivo(r)}`,
  "merma material": (r) => `dio de baja ${cantidad(r)}${motivo(r)}`,
  "transformar transformacion": (r) => `separó ${cantidad(r)}${r.merma !== null ? ` (merma: ${kilos(r.merma)})` : ""}`,
  "descartar operacion": (r) => `descartó una ${tipo(r)} sin confirmar`,
  "bloquear credencial": (r) => `bloqueó temporalmente el acceso${de(r.persona)}`,
  "alta equipo": (r) => `dio de alta el equipo${nombre(r)}`,
  "codigo equipo": (r) => `pidió un código para dar de alta el equipo${nombre(r)}`,
  "clave credencial": (r) => `cambió la clave${de(r.persona)}`,
  "baja usuario": (r) => `dio de baja${r.persona ? ` a ${r.persona}` : " a una persona"}`,
  "baja equipo": (r) => `dio de baja el equipo${r.equipo ? ` ${r.equipo}` : ""}`,
  "reimprimir operacion": (r) => `reimprimió el comprobante${r.folio ? ` ${r.folio}` : ""}${motivo(r)}`,
  "corregir movimiento_inventario": (r) => `corrigió un movimiento a ${cantidad(r)}${motivo(r)}`,
  "cancelar_envio envio": () => "canceló un envío pendiente",
  "registrar_restauracion restauracion": () => "restauró un respaldo",
  "precio_especial operacion": (r) => {
    const cliente = r.cliente ? ` a ${r.cliente}` : "";
    if (r.clase === "quitar") return `quitó el precio especial${de(r.material)}${cliente}`;
    return `aplicó un precio especial${r.queda !== null ? ` de ${pesos(r.queda)} por kilo` : ""}${de(r.material)}${cliente}${r.autoriza ? ` (autorizó ${r.autoriza})` : ""}`;
  },
  "mantenimiento publicacion": (r) => r.paso === "cerrar" ? "cerró el acceso por mantenimiento" :
    r.paso === "abrir" ? "abrió el acceso después del mantenimiento" : "preparó la reapertura después del mantenimiento",
  "insert usuario": (r) => `dio de alta${r.nombre ? ` a ${r.nombre}` : " a una persona"}`,
  "update usuario": (r) => `actualizó los datos${de(r.nombre)}`,
  "delete usuario": (r) => `eliminó${r.nombre ? ` a ${r.nombre}` : " a una persona"}`,
  "insert material": (r) => `dio de alta el material${nombre(r)}`,
  "update material": (r) => {
    if (r.activoAntes === "true" && r.activoDespues === "false") return `dio de baja el material${nombre(r)}`;
    if (r.activoAntes === "false" && r.activoDespues === "true") return `reactivó el material${nombre(r)}`;
    if (r.frecuenteAntes === "false" && r.frecuenteDespues === "true") return `marcó como frecuente el material${nombre(r)}`;
    if (r.frecuenteAntes === "true" && r.frecuenteDespues === "false") return `quitó de frecuentes el material${nombre(r)}`;
    return `actualizó el material${nombre(r)}`;
  },
  "delete material": (r) => `eliminó el material${nombre(r)}`,
};

/** Las parejas (accion, entidad) que tienen frase propia. La prueba la compara con las migraciones. */
export const CON_FRASE: ReadonlySet<string> = new Set(Object.keys(frases));

/** Lo que quedó anotado, de lo más reciente a lo más viejo. */
export async function bitacora(
  bd: Bd, o: { antes?: string | null; cuantos?: number; persona?: string | null; dia?: string | null } = {},
): Promise<{ asientos: Asiento[]; hayMas: boolean }> {
  const antes = o.antes == null ? null : fila(o.antes, "el asiento anterior");
  const persona = o.persona == null ? null : fila(o.persona, "la persona");
  const dia = o.dia ?? null;
  if (dia !== null) {
    const fecha = new Date(`${dia}T00:00:00Z`);
    if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(dia) || dia.startsWith("0000") ||
        !Number.isFinite(fecha.getTime()) || fecha.toISOString().slice(0, 10) !== dia) {
      throw new ErrorDeForma("La fecha debe ser válida y escribirse AAAA-MM-DD");
    }
  }
  const pedido = o.cuantos ?? 50;
  if (!Number.isSafeInteger(pedido) || pedido < 1) throw new ErrorDeForma("La cantidad de asientos debe ser un entero positivo");
  const cuantos = Math.min(pedido, 200);
  const filas: Registro[] = await bd.leer(
    `WITH pagina AS (
       SELECT b.*, s.zona FROM bitacora b CROSS JOIN sucursal s
       WHERE s.id = 1 AND ($1::bigint IS NULL OR b.id < $1)
         AND ($2::bigint IS NULL OR b.usuario_id = $2)
         AND ($3::date IS NULL OR (b.ocurrido_en AT TIME ZONE s.zona)::date = $3)
       ORDER BY b.id DESC LIMIT ($4::int + 1)
     )
     SELECT b.id::text, to_char(b.ocurrido_en AT TIME ZONE b.zona, 'YYYY-MM-DD') AS fecha,
            to_char(b.ocurrido_en AT TIME ZONE b.zona, 'HH24:MI') AS hora,
            u.nombre AS quien, b.accion, b.entidad,
            b.detalle->>'kg' AS kg, b.detalle->>'contado' AS contado,
            b.detalle->>'merma' AS merma, b.detalle->>'total' AS total,
            b.detalle->>'queda' AS queda, b.detalle->>'folio' AS folio,
            b.detalle->>'cierre' AS cierre, b.detalle->>'tipo' AS tipo,
            b.detalle->>'clase' AS clase, b.detalle->>'paso' AS paso,
            b.detalle->>'motivo' AS motivo,
            b.detalle #>> '{antes,activo}' AS "activoAntes", b.detalle #>> '{despues,activo}' AS "activoDespues",
            b.detalle #>> '{antes,frecuente}' AS "frecuenteAntes", b.detalle #>> '{despues,frecuente}' AS "frecuenteDespues",
            CASE WHEN b.accion IN ('insert', 'update', 'delete')
              THEN coalesce(b.detalle #>> '{despues,nombre}', b.detalle #>> '{antes,nombre}')
              ELSE b.detalle->>'nombre' END AS nombre,
            m.nombre AS material, destino.nombre AS destino, p.nombre AS persona,
            c.nombre AS cliente, a.nombre AS autoriza,
            (SELECT alta.detalle->>'nombre' FROM bitacora alta
             WHERE b.entidad = 'equipo' AND alta.entidad = 'equipo' AND alta.accion = 'alta'
               AND alta.entidad_id = b.entidad_id AND alta.id <= b.id
             ORDER BY alta.id DESC LIMIT 1) AS equipo
     FROM pagina b
     LEFT JOIN usuario u ON u.id = b.usuario_id
     LEFT JOIN material m ON m.id::text = CASE
       WHEN b.entidad = 'material' THEN b.entidad_id
       WHEN b.accion = 'transformar' THEN b.detalle->>'origen'
       WHEN b.accion = 'corregir_material' THEN b.detalle->>'de'
       ELSE b.detalle->>'material' END
     LEFT JOIN material destino ON destino.id::text = b.detalle->>'a'
     LEFT JOIN usuario p ON p.id::text = b.entidad_id AND b.entidad IN ('usuario', 'credencial')
     LEFT JOIN cliente c ON c.id::text = b.detalle->>'cliente'
     LEFT JOIN usuario a ON a.id::text = b.detalle->>'autoriza'
     ORDER BY b.id DESC`,
    [antes, persona, dia, cuantos],
  );
  return {
    asientos: filas.slice(0, cuantos).map((r) => ({
      id: r.id, fecha: r.fecha, hora: r.hora, quien: r.quien, accion: r.accion, entidad: r.entidad,
      que: frases[`${r.accion} ${r.entidad}`]?.(r) ?? `hizo un cambio (${r.accion} · ${r.entidad})`,
    })),
    hayMas: filas.length > cuantos,
  };
}
