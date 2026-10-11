// Quién está del otro lado de una petición. Dos preguntas, en orden: ¿este equipo está dado de
// alta?, ¿quién atiende en él? Las dos se le hacen a la base; la cookie solo lleva con qué preguntar.
//
// La cookie va sellada (cifrada y firmada) con iron-session: el navegador no puede leerla ni
// alterarla. Lleva el secreto del equipo y el identificador de su sesión, nada más. Se lee del
// encabezado de la petición y se escribe en la respuesta, sin el almacén global de Next: así las
// rutas se pueden probar como funciones.
import { createHash, randomBytes } from "node:crypto";
import { sealData, unsealData } from "iron-session";
import type { Bd } from "./bd.ts";

export type Rol = "responsable" | "mostrador" | "patio" | "consulta" | "administracion";

export interface PersonaActiva {
  id: string;
  nombre: string;
  rol: Rol;
  puedeAutorizar: boolean;
}

export interface Equipo {
  secreto: string;
  /** Lo que la base conoce del equipo: la huella de su secreto. */
  huella: string;
}

export interface Acreditacion {
  equipo: Equipo | null;
  sesion: string | null;
  persona: PersonaActiva | null;
}

interface Sello {
  /** El secreto del equipo. */
  e: string;
  /** La sesión de quien atiende, si hay alguien. */
  s: string | null;
}

const COOKIE = "feruga";
const UN_ANIO = 60 * 60 * 24 * 365;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const NADIE: Acreditacion = { equipo: null, sesion: null, persona: null };

/** ¿Está la clave con que se sellan las cookies? Sin ella nadie puede darse de alta ni entrar. */
export const selloUtilizable = (): boolean => (process.env.SESION_CLAVE ?? "").length >= 32;

function clave(): string {
  if (!selloUtilizable()) throw new Error("Falta SESION_CLAVE, o tiene menos de 32 caracteres");
  return process.env.SESION_CLAVE!;
}

function minutos(nombre: string, porOmision: number): number {
  const n = Number(process.env[nombre]);
  return Number.isInteger(n) && n > 0 ? n : porOmision;
}

export const huellaDe = (secreto: string): string => createHash("sha256").update(secreto).digest("hex");
export const secretoNuevo = (): string => randomBytes(32).toString("base64url");

/** El encabezado Set-Cookie que deja al equipo con ese secreto y, si la hay, esa sesión. */
export async function cookieCon(secreto: string, sesion: string | null): Promise<string> {
  const sello: Sello = { e: secreto, s: sesion };
  // El sello no caduca: el equipo sigue dado de alta hasta que se le da de baja, y la sesión vence en la base.
  const valor = await sealData(sello, { password: clave(), ttl: 0 });
  const segura = process.env.COOKIE_SEGURA === "1" ? "; Secure" : "";
  return `${COOKIE}=${valor}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${UN_ANIO}${segura}`;
}

async function leerSello(peticion: Request): Promise<Sello | null> {
  const encabezado = peticion.headers.get("cookie") ?? "";
  const valor = encabezado.split(";").map((par) => par.trim()).find((par) => par.startsWith(COOKIE + "="))?.slice(COOKIE.length + 1);
  if (!valor) return null;
  try {
    const sello = await unsealData<Partial<Sello>>(valor, { password: clave(), ttl: 0 });
    if (typeof sello.e !== "string" || !sello.e) return null;
    return { e: sello.e, s: typeof sello.s === "string" && UUID.test(sello.s) ? sello.s : null };
  } catch {
    return null;    // alterada, de otra clave o que no es un sello
  }
}

export async function acreditar(peticion: Request, bd: Bd): Promise<Acreditacion> {
  const sello = await leerSello(peticion);
  if (!sello) return NADIE;
  const huella = huellaDe(sello.e);
  // Va en su propia transacción y se confirma antes de lo demás: usar la sesión cuenta como actividad.
  return bd.enTransaccion(null, async (c) => {
    const vigente = (await c.query("SELECT equipo_vigente($1) AS id", [huella])).rows[0].id;
    if (!vigente) return NADIE;
    const equipo: Equipo = { secreto: sello.e, huella };
    if (!sello.s) return { equipo, sesion: null, persona: null };
    const { rows } = await c.query(
      "SELECT * FROM sesion_vigente($1, $2, make_interval(mins => $3::int), make_interval(mins => $4::int))",
      [huella, sello.s, minutos("SESION_INACTIVIDAD_MIN", 30), minutos("SESION_DURACION_MIN", 12 * 60)],
    );
    if (rows.length === 0) return { equipo, sesion: null, persona: null };
    const p = rows[0];
    return {
      equipo,
      sesion: sello.s,
      persona: { id: p.usuario_id, nombre: p.nombre, rol: p.rol, puedeAutorizar: p.puede_autorizar },
    };
  });
}
