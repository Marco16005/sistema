// Lo que se comprueba antes de dar por buena una instalación de operación.
//
//   node operacion/comprobar.ts entorno          el entorno completo, de todas las piezas
//   docker compose config --format json | node operacion/comprobar.ts red [--local]
//                                                 que a la red solo se publique el proxy (80 y 443);
//                                                 con --local (un ensayo) se acepta que ni el proxy salga
//   node operacion/comprobar.ts https [máquina] [--abierta | --cerrada] [--version=…] [--base=…] [--rechaza-escribir]
//                                                 que el sitio conteste por HTTPS, con certificado válido, y esté
//                                                 listo; y, si se pide, que la operación esté abierta o cerrada,
//                                                 que conteste esa versión y que lo haga sobre esa base (su marca),
//                                                 y que un intento de escribir se rechace por mantenimiento
//   node operacion/comprobar.ts certificado [máquina]   la huella del certificado que presenta, y cuándo vence
//
// «entorno» es el primer servicio que corre en operación: avisa pronto. No es la garantía —cada
// proceso vuelve a validar lo suyo al iniciar—, salvo en una cosa: aquí no vale decir que es
// desarrollo. El Compose de operación publica el sitio a la red, y eso no se hace con claves de desarrollo.
import { randomUUID } from "node:crypto";
import { request } from "node:https";
import { connect } from "node:tls";
import type { TLSSocket } from "node:tls";
import { pathToFileURL } from "node:url";
import { encabezadoDelComprobador } from "../src/servidor/comprobador.ts";
import { faltasDelEntorno } from "../src/servidor/entorno.ts";

// ── la red ─────────────────────────────────────────────────────────────────

interface Puerto {
  host_ip?: string;
  target?: number;
  published?: string | number;
}
interface Montaje {
  source?: string;
  target?: string;
}
interface Configuracion {
  services?: Record<string, { ports?: Puerto[]; volumes?: Montaje[]; network_mode?: string; privileged?: boolean }>;
}

/** Las carpetas de la máquina que traen dentro el socket de Docker: montarlas es montarlo. */
const CON_EL_SOCKET = new Set(["/", "/var", "/var/run", "/run"]);

/** Lo que solo se alcanza desde esta misma máquina. Sin dirección, Docker publica en todas las interfaces. */
const soloLocal = (ip: string | undefined): boolean => ip !== undefined && (ip.startsWith("127.") || ip === "::1");

/**
 * Lo que la configuración efectiva publica de más. A la red, solo el proxy y solo 80 y 443: los
 * puertos que publica Docker no pasan por el cortafuegos del sistema, así que la regla es no
 * publicar, no «bloquear después». Ningún contenedor usa la red de la máquina ni sus privilegios,
 * ni recibe el socket de Docker. Lo que aquí no se ve —lo que de verdad contesta desde fuera— se
 * comprueba desde otra máquina.
 */
export function faltasDeRed(config: Configuracion, o: { local?: boolean } = {}): string[] {
  const servicios = config.services;
  if (!servicios || Object.keys(servicios).length === 0) return ["No es una configuración de Compose: no trae servicios"];
  const faltas: string[] = [];
  const delProxy = new Set<string>();
  for (const [nombre, servicio] of Object.entries(servicios)) {
    for (const p of servicio.ports ?? []) {
      if (soloLocal(p.host_ip)) continue;
      const par = `${p.published}:${p.target}`;
      if (nombre === "proxy" && (par === "80:80" || par === "443:443")) delProxy.add(par);
      else faltas.push(`${nombre} publica a la red el puerto ${p.published} (hacia su ${p.target}): a la red solo sale el proxy, en 80 y 443`);
    }
    // Con la red de la máquina, lo que el contenedor abra queda en la red sin publicar ningún puerto:
    // la revisión de arriba no lo vería. Solo se admite la red propia de los contenedores.
    if (servicio.network_mode !== undefined && servicio.network_mode !== "bridge") {
      faltas.push(servicio.network_mode === "host"
        ? `${nombre} usa la red de la máquina (network_mode: host): todo lo que abra sale a la red`
        : `${nombre} usa otra red que la de los contenedores (network_mode: ${servicio.network_mode}): no es lo que aquí se comprueba`);
    }
    if (servicio.privileged === true) faltas.push(`${nombre} corre con los privilegios de la máquina (privileged): nada lo contiene`);
    for (const v of servicio.volumes ?? []) {
      const origen = (v.source ?? "").replace(/\/+$/, "") || (v.source ? "/" : "");
      if (`${v.source ?? ""} ${v.target ?? ""}`.includes("docker.sock") || CON_EL_SOCKET.has(origen)) {
        faltas.push(`${nombre} recibe el socket de Docker (docker.sock, o la carpeta que lo contiene): es darle la máquina entera`);
      }
    }
  }
  // En un ensayo el proxy se queda en esta máquina; eso se acepta solo si se dice. Lo de arriba se exige igual.
  if (o.local) return faltas;
  if (!servicios.proxy) faltas.push("No hay proxy: nada atiende por HTTPS");
  else for (const par of ["80:80", "443:443"]) if (!delProxy.has(par)) faltas.push(`El proxy no publica el ${par.split(":")[0]}`);
  return faltas;
}

// ── el sitio ───────────────────────────────────────────────────────────────

/**
 * Pide la salud del sitio por HTTPS, validando el certificado contra ese dominio. Se puede dirigir
 * a una máquina en particular (el proxy, por su nombre en la red de contenedores): el certificado
 * que se exige sigue siendo el del dominio.
 */
export async function saludPorHttps(o: { dominio: string; maquina?: string; puerto?: number; plazo?: number }): Promise<void> {
  await estadoPorHttps(o);
}

/** Lo que el sitio dice de sí mismo. El detalle —versión, esquema, base— solo se lo da a quien se acredita con la clave de la instalación. */
export interface EstadoDelSitio {
  /** La operación está abierta, o en mantenimiento. */
  abierta: boolean;
  version: string | null;
  esquema: string | null;
  /** La marca de la base sobre la que contesta. */
  base: string | null;
  /** El certificado que presentó, para ver si está por vencer (operacion/avisos.ts, `revisarSitio`). */
  certificado: { desde: Date; hasta: Date } | null;
}

/** Desde cuándo y hasta cuándo vale el certificado que presentó esa conexión; null si no se puede saber. */
function vigenciaDe(enlace: TLSSocket): { desde: Date; hasta: Date } | null {
  const c = typeof enlace.getPeerCertificate === "function" ? enlace.getPeerCertificate() : null;
  if (!c || !c.valid_from || !c.valid_to) return null;
  const desde = new Date(c.valid_from);
  const hasta = new Date(c.valid_to);
  return Number.isNaN(desde.getTime()) || Number.isNaN(hasta.getTime()) ? null : { desde, hasta };
}

/**
 * Pide la salud por HTTPS, validando el certificado, y devuelve lo que el sitio dice. Falla si no
 * está listo (no contesta 200). Con `clave` —la de sesión de la instalación— se acredita como el
 * comprobador y recibe el detalle.
 */
export function estadoPorHttps(o: { dominio: string; maquina?: string; puerto?: number; plazo?: number; clave?: string; ca?: string }): Promise<EstadoDelSitio> {
  return new Promise((bien, mal) => {
    const peticion = request(
      {
        host: o.maquina ?? o.dominio, port: o.puerto ?? 443, servername: o.dominio, path: "/api/salud", method: "GET",
        headers: { Host: o.dominio, ...(o.clave ? encabezadoDelComprobador(o.clave) : {}) }, timeout: o.plazo ?? 10_000, rejectUnauthorized: true,
        ...(o.ca ? { ca: o.ca } : {}),
      },
      (respuesta) => {
        const certificado = vigenciaDe(respuesta.socket as TLSSocket);
        let cuerpo = "";
        respuesta.setEncoding("utf8");
        respuesta.on("data", (trozo: string) => { if (cuerpo.length < 10_000) cuerpo += trozo; });
        respuesta.on("end", () => {
          if (respuesta.statusCode !== 200) return mal(new Error(`el sitio contestó ${respuesta.statusCode}`));
          try {
            const d = JSON.parse(cuerpo) as Record<string, unknown>;
            if (d.bien !== true || typeof d.abierta !== "boolean") throw new Error("sin forma");
            const texto = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);
            bien({ abierta: d.abierta, version: texto(d.version), esquema: texto(d.esquema), base: texto(d.base), certificado });
          } catch {
            mal(new Error("el sitio contestó 200, pero no con lo que dice la salud de esta aplicación"));
          }
        });
      },
    );
    peticion.on("timeout", () => peticion.destroy(new Error("el sitio no contestó a tiempo")));
    peticion.on("error", (e) => mal(new Error(`no se pudo pedir por HTTPS con certificado válido: ${e.message}`)));
    peticion.end();
  });
}

/**
 * Intenta escribir de verdad —abrir una cuenta— y exige que el sitio lo rechace por estar en
 * mantenimiento. La petición va bien formada y desde el origen del sitio, pero sin sesión: la
 * puerta del mantenimiento contesta antes de mirar quién pide, y eso es lo que aquí se comprueba.
 * (Con una sesión de verdad lo prueba la batería, y el ensayo de publicación desde un navegador.)
 */
export function rechazoPorHttps(o: { dominio: string; maquina?: string; puerto?: number; plazo?: number }): Promise<void> {
  return new Promise((bien, mal) => {
    const cuerpo = JSON.stringify({ id: randomUUID(), tipo: "compra", etiqueta: null });
    const peticion = request(
      {
        host: o.maquina ?? o.dominio, port: o.puerto ?? 443, servername: o.dominio, path: "/api/cuentas", method: "POST",
        headers: { Host: o.dominio, Origin: `https://${o.dominio}`, "content-type": "application/json", "content-length": Buffer.byteLength(cuerpo) },
        timeout: o.plazo ?? 10_000, rejectUnauthorized: true,
      },
      (respuesta) => {
        let dicho = "";
        respuesta.setEncoding("utf8");
        respuesta.on("data", (trozo: string) => { if (dicho.length < 10_000) dicho += trozo; });
        respuesta.on("end", () => {
          let codigo: unknown;
          try {
            codigo = (JSON.parse(dicho) as { error?: { codigo?: unknown } }).error?.codigo;
          } catch {
            // Sin cuerpo que se entienda: abajo se dice con qué estado contestó.
          }
          if (respuesta.statusCode === 503 && codigo === "MANTENIMIENTO") return bien();
          mal(new Error(
            `a un intento de escribir el sitio contestó ${respuesta.statusCode}${typeof codigo === "string" ? ` (${codigo})` : ""}, y se esperaba que lo rechazara por mantenimiento`,
          ));
        });
      },
    );
    peticion.on("timeout", () => peticion.destroy(new Error("el sitio no contestó a tiempo")));
    peticion.on("error", (e) => mal(new Error(`no se pudo pedir por HTTPS con certificado válido: ${e.message}`)));
    peticion.end(cuerpo);
  });
}

/** El certificado que presenta el sitio, ya validado contra ese dominio: su huella y cuándo vence. */
export function certificadoDe(o: { dominio: string; maquina?: string; puerto?: number; plazo?: number }): Promise<{ huella: string; vence: Date }> {
  return new Promise((bien, mal) => {
    const enlace = connect({ host: o.maquina ?? o.dominio, port: o.puerto ?? 443, servername: o.dominio, rejectUnauthorized: true, timeout: o.plazo ?? 10_000 }, () => {
      const c = enlace.getPeerCertificate();
      enlace.end();
      bien({ huella: c.fingerprint256, vence: new Date(c.valid_to) });
    });
    enlace.on("timeout", () => enlace.destroy(new Error("el sitio no contestó a tiempo")));
    enlace.on("error", (e) => mal(new Error(`no hay un certificado válido para ${o.dominio}: ${e.message}`)));
  });
}

// ── la consola ─────────────────────────────────────────────────────────────

async function entradaEstandar(): Promise<string> {
  let texto = "";
  for await (const trozo of process.stdin) texto += trozo;
  return texto;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [orden, ...resto] = process.argv.slice(2);
  const argumento = resto.find((a) => !a.startsWith("--"));
  const opcion = (nombre: string): string | undefined => resto.find((a) => a.startsWith(`--${nombre}=`))?.slice(nombre.length + 3);
  let faltas: string[];
  if (orden === "entorno") {
    faltas = process.env.MODO === "desarrollo"
      ? ["MODO dice desarrollo: la operación no corre con el entorno de desarrollo"]
      : faltasDelEntorno(process.env, ["administracion", "conexion", "aplicacion", "respaldo", "sitio"]);
  } else if (orden === "red") {
    try {
      faltas = faltasDeRed(JSON.parse(await entradaEstandar()) as Configuracion, { local: resto.includes("--local") });
    } catch {
      faltas = ["Lo que llegó por la entrada estándar no es la configuración de Compose (docker compose config --format json)"];
    }
  } else if (orden === "https") {
    const dominio = process.env.DOMINIO;
    try {
      if (!dominio) throw new Error("Falta DOMINIO");
      const e = await estadoPorHttps({ dominio, ...(argumento ? { maquina: argumento } : {}), ...(process.env.SESION_CLAVE ? { clave: process.env.SESION_CLAVE } : {}) });
      faltas = [];
      // Listo ya está: contestó. Lo demás se comprueba solo si se pide.
      if (resto.includes("--abierta") && !e.abierta) faltas.push("la operación está en mantenimiento, y se esperaba abierta");
      if (resto.includes("--cerrada") && e.abierta) faltas.push("la operación está abierta, y se esperaba en mantenimiento");
      for (const [nombre, dice] of [["version", e.version], ["base", e.base]] as const) {
        const esperada = opcion(nombre);
        if (esperada === undefined) continue;
        if (dice === null) faltas.push(`el sitio no dijo su ${nombre === "base" ? "base" : "versión"}: no reconoció a este comprobador como el de su instalación`);
        else if (dice !== esperada) faltas.push(`el sitio contesta ${nombre === "base" ? "sobre la base" : "con la versión"} ${dice}, y se esperaba ${esperada}`);
      }
      if (resto.includes("--rechaza-escribir")) {
        await rechazoPorHttps({ dominio, ...(argumento ? { maquina: argumento } : {}) }).catch((e: Error) => faltas.push(e.message));
      }
    } catch (e) {
      faltas = [(e as Error).message];
    }
  } else if (orden === "certificado") {
    const dominio = process.env.DOMINIO;
    try {
      if (!dominio) throw new Error("Falta DOMINIO");
      const c = await certificadoDe({ dominio, ...(argumento ? { maquina: argumento } : {}) });
      console.log(`${c.huella} vence ${c.vence.toISOString()}`);
      process.exit(0);
    } catch (e) {
      faltas = [(e as Error).message];
    }
  } else {
    console.error("Uso: node operacion/comprobar.ts entorno | red [--local] | https [máquina] [--abierta|--cerrada] [--version=…] [--base=…] [--rechaza-escribir] | certificado [máquina]");
    process.exit(2);
  }
  if (faltas.length > 0) {
    console.error(`No pasa la comprobación de ${orden}:\n  · ${faltas.join("\n  · ")}`);
    process.exit(1);
  }
  console.log(`Comprobación de ${orden}: bien.`);
}
