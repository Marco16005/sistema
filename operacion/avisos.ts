// Los avisos que salen del sistema, una vez que hay servidor. Los corre el servicio de respaldos, que
// es el que siempre está prendido (operacion/respaldar.ts, «servicio»):
//
//   · el aviso del cajón —un corte que no cuadró, un cajón que se abrió con otra cantidad que la que
//     se dejó (migración 0038)— por Telegram y por correo, a quien se diga. Dentro del sistema ya
//     sale en la barra del responsable; aquí sale además afuera. Uno que alguien ya vio en la
//     pantalla no se manda. Si un canal falla, se vuelve a intentar al minuto: mejor dos avisos que
//     ninguno. Lo que se manda queda dicho en la base (aviso.enviado_en).
//   · el latido: cada tanto se le pregunta al sitio, por HTTPS y por el proxy, si contesta; si sí, se
//     le avisa a un vigilante de fuera (Healthchecks). Si el sitio deja de contestar —o se cae el
//     servidor entero—, el vigilante deja de oírlo y alerta. Y avisa antes de que se caiga: si queda
//     poco disco, o si el certificado está por vencer sin que el proxy lo haya renovado.
//
// Las claves (la del bot de Telegram, la contraseña del correo) nunca salen en un error ni en el registro.
import { randomUUID } from "node:crypto";
import { statfs } from "node:fs/promises";
import { enviarCorreo } from "./correo.ts";

/** Por donde sale un aviso. */
export interface Canal {
  nombre: string;
  enviar(texto: string): Promise<void>;
}

/** A quien se le avisa con el protocolo de Healthchecks (ver `vigiaHttp` en operacion/respaldar.ts). */
export interface Vigilante {
  bien(corrida: string): Promise<void>;
  fallo(corrida: string, que: string): Promise<void>;
}

/** Lo que dice un aviso del cajón. */
export interface Aviso {
  clase: "corte" | "apertura";
  /** AAAA-MM-DD, el día de la jornada. */
  fecha: string;
  /** Contado menos esperado (corte) o menos lo que se dejó (apertura). */
  diferencia: string;
  /** Quien firmó el corte o contó el cajón, y a qué hora (HH:MM, en el patio). */
  quien: string;
  hora: string;
}

const dia = (fecha: string): string =>
  new Date(`${fecha}T12:00:00Z`).toLocaleDateString("es-MX", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).replace(",", "");
const pesos = (n: number): string => `$${Math.abs(n).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** El texto de un aviso, en llano: qué pasó, de qué día, cuánto y quién. */
export function textoDeAviso(a: Aviso & { negocio: string }): string {
  const d = Number(a.diferencia);
  if (a.clase === "corte") {
    return `${a.negocio} · El corte del ${dia(a.fecha)} no cuadró: ${d < 0 ? "faltaron" : "sobraron"} ${pesos(d)}. Lo firmó ${a.quien} a las ${a.hora}.`;
  }
  return `${a.negocio} · El cajón del ${dia(a.fecha)} se abrió con ${pesos(d)} de ${d < 0 ? "menos" : "más"} de lo que se dejó en el último corte. Lo contó ${a.quien} a las ${a.hora}.`;
}

/** Por Telegram, con un bot, a un chat (una persona o un grupo). */
export function canalTelegram(token: string, chat: string, o: { base?: string; plazo?: number } = {}): Canal {
  const base = (o.base ?? "https://api.telegram.org").replace(/\/+$/, "");
  return {
    nombre: "Telegram",
    enviar: async (texto) => {
      let r: Response;
      try {
        r = await fetch(`${base}/bot${token}/sendMessage`, {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ chat_id: chat, text: texto, disable_web_page_preview: true }),
          signal: AbortSignal.timeout(o.plazo ?? 15_000),
        });
      } catch (e) {
        // Sin la dirección: lleva la clave del bot.
        throw new Error(`no se pudo llegar a Telegram (${(e as { cause?: { code?: string } }).cause?.code ?? (e as Error).name})`);
      }
      if (!r.ok) throw new Error(`Telegram contestó ${r.status}`);
    },
  };
}

/** Por correo, con la cuenta y el servidor que se digan (ver operacion/correo.ts). */
export function canalCorreo(o: { url: string; de: string; para: readonly string[]; negocio: string }): Canal {
  return {
    nombre: "correo",
    enviar: (texto) => enviarCorreo({ url: o.url, de: o.de, para: o.para, asunto: `${o.negocio}: aviso del cajón`, texto }),
  };
}

/** Lo que basta de una conexión a la base: la del dueño, la del servicio de respaldos. */
interface Consulta {
  query(sql: string, valores?: unknown[]): Promise<{ rows: Array<Record<string, any>> }>;
}

/**
 * Manda los avisos del cajón que nadie ha visto y que todavía no salen, por todos los canales. Uno
 * sale cuando salió por todos; si alguno falla, se queda para la vuelta siguiente.
 */
export async function avisarPendientes(
  db: Consulta, canales: readonly Canal[], negocio: string, decir: (linea: string) => void = () => {},
): Promise<{ enviados: number; pendientes: number }> {
  const { rows } = await db.query(
    `SELECT a.id::text AS id, a.clase, to_char(j.fecha, 'YYYY-MM-DD') AS fecha, a.diferencia::text AS diferencia, u.nombre AS quien,
            to_char(a.creado_en AT TIME ZONE s.zona, 'HH24:MI') AS hora
     FROM aviso a JOIN jornada j ON j.id = a.jornada_id JOIN sucursal s ON s.id = j.sucursal_id JOIN usuario u ON u.id = a.creado_por
     WHERE a.enviado_en IS NULL AND a.visto_en IS NULL
     ORDER BY a.creado_en, a.id`,
  );
  let enviados = 0;
  let pendientes = 0;
  for (const a of rows) {
    const texto = textoDeAviso({ ...(a as Aviso), negocio });
    let todos = true;
    for (const canal of canales) {
      try {
        await canal.enviar(texto);
      } catch (e) {
        todos = false;
        decir(`El aviso del cajón del ${a.fecha} no salió por ${canal.nombre}: ${(e as Error).message}. Se intenta otra vez en un momento.`);
      }
    }
    if (todos) {
      await db.query("UPDATE aviso SET enviado_en = clock_timestamp() WHERE id = $1 AND enviado_en IS NULL", [a.id]);
      enviados += 1;
    } else {
      pendientes += 1;
    }
  }
  return { enviados, pendientes };
}

/** El certificado que presenta el sitio: desde cuándo y hasta cuándo vale. */
export interface Certificado {
  desde: Date;
  hasta: Date;
}

/** Un disco, en bytes: lo que queda libre para quien no es root, y lo que mide. */
export interface Disco {
  libre: number;
  total: number;
}

/** Cuánto disco queda donde está esa ruta. Dentro de un contenedor, «/» es el disco donde Docker guarda todo. */
export async function discoDe(ruta: string): Promise<Disco> {
  const s = await statfs(ruta);
  return { libre: s.bavail * s.bsize, total: s.blocks * s.bsize };
}

const GB = 1e9;
const DIA = 86_400_000;
const numero = (n: number, decimales: number): string =>
  n.toLocaleString("es-MX", { minimumFractionDigits: decimales, maximumFractionDigits: decimales });

/**
 * Lo que el latido revisa además de que el sitio conteste, para avisar ANTES de que se caiga:
 *   · el disco: menos del 10 % libre, o menos de 5 GB. Lleno, la base deja de escribir y no hay
 *     lugar para restaurar ni para publicar.
 *   · el certificado: el proxy lo renueva solo cuando le queda un tercio de su vida (en uno de 90
 *     días, a los 30 de vencer). Si le queda menos de un sexto (unos 15 días) es que no ha podido.
 * Falla con lo que encontró, dicho en llano; el vigilante lo enseña con su alerta.
 */
export async function revisarSitio(o: {
  estado: () => Promise<{ certificado?: Certificado | null }>;
  disco: () => Promise<Disco>;
  ahora?: () => Date;
}): Promise<void> {
  const { certificado } = await o.estado();
  const ahora = (o.ahora ?? (() => new Date()))().getTime();
  const problemas: string[] = [];
  try {
    const d = await o.disco();
    if (d.libre < 5 * GB || d.libre < 0.1 * d.total) {
      const parte = d.total > 0 ? ` (${Math.floor((100 * d.libre) / d.total)} %)` : "";
      problemas.push(`Queda poco disco: ${numero(d.libre / GB, 1)} GB libres de ${numero(d.total / GB, 0)} GB${parte}. Ver «Se llenó el disco» en la guía.`);
    }
  } catch (e) {
    problemas.push(`No se pudo ver cuánto disco queda (${(e as Error).message}).`);
  }
  if (certificado) {
    const quedan = certificado.hasta.getTime() - ahora;
    const vida = certificado.hasta.getTime() - certificado.desde.getTime();
    if (quedan < vida / 6) {
      const dias = Math.floor(quedan / DIA);
      const cuando = quedan <= 0 ? "ya venció" : dias === 0 ? "vence hoy" : `vence en ${dias} ${dias === 1 ? "día" : "días"}`;
      const fecha = certificado.hasta.toLocaleDateString("es-MX", { day: "numeric", month: "long", timeZone: "UTC" });
      problemas.push(`El certificado del sitio ${cuando} (el ${fecha}) y no se ha renovado: el proxy debió renovarlo cuando le quedaba un tercio de su vida.`);
    }
  }
  if (problemas.length > 0) throw new Error(problemas.join(" "));
}

/** Un latido: si el sitio contesta, se le dice al vigilante; si no, también, con por qué. */
export async function latir(estado: () => Promise<unknown>, vigia: Vigilante, corrida: string = randomUUID()): Promise<void> {
  try {
    await estado();
  } catch (e) {
    await vigia.fallo(corrida, (e as Error).message);
    return;
  }
  await vigia.bien(corrida);
}
