// Lo que se comprueba antes de dar por buena una instalación de operación.
//
//   node operacion/comprobar.ts entorno          el entorno completo, de todas las piezas
//   docker compose config --format json | node operacion/comprobar.ts red [--local] [--entrada=<red>]
//                                                 que solo publique el proxy (80 y 443), y nadie más
//                                                 ni en esta máquina; con --local (un ensayo) se acepta
//                                                 que ni el proxy salga. Con --entrada (o RED_DE_ENTRADA),
//                                                 que el proxy vaya detrás de otro: sin publicar nada, y
//                                                 en esa red, que comparte solo con él
//   docker compose config --format json | node operacion/comprobar.ts redes-de-fuera
//                                                 las redes que la configuración usa sin crearlas: tienen
//                                                 que existir antes de levantar
//   node operacion/comprobar.ts https [máquina] [--abierta | --cerrada] [--version=…] [--base=…] [--rechaza-escribir]
//                                                 que el sitio conteste por HTTPS, con certificado válido, y esté
//                                                 (sin máquina, por donde diga SITIO_POR: su proxy, o la
//                                                 dirección pública si va detrás de otro)
//                                                 listo; y, si se pide, que la operación esté abierta o cerrada,
//                                                 que conteste esa versión y que lo haga sobre esa base (su marca),
//                                                 y que un intento de escribir se rechace por mantenimiento
//   node operacion/comprobar.ts certificado [máquina]   la huella del certificado que presenta, y cuándo vence
//
// «entorno» es el primer servicio que corre en operación: avisa pronto. No es la garantía —cada
// proceso vuelve a validar lo suyo al iniciar—, salvo en una cosa: aquí no vale decir que es
// desarrollo. El Compose de operación publica el sitio a la red, y eso no se hace con claves de desarrollo.
import { randomBytes, randomUUID } from "node:crypto";
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
  services?: Record<string, { ports?: Puerto[]; volumes?: Montaje[]; network_mode?: string; privileged?: boolean; networks?: Record<string, unknown> }>;
  networks?: Record<string, { name?: string; external?: boolean }>;
}

/**
 * Cada red de la configuración, por su clave: su nombre en Docker y si existe aparte («external»).
 * Lo que cuenta es el nombre: dos claves con el mismo nombre son la misma red (Codex, R43-01).
 */
function redesDe(config: Configuracion): Map<string, { nombre: string; externa: boolean }> {
  return new Map(Object.entries(config.networks ?? {}).map(([clave, red]) => [clave, { nombre: red?.name ?? clave, externa: red?.external === true }]));
}

/** Un nombre de red de Docker, uno solo: letras, números, «_», «.» y «-», sin blancos (Codex, R43-02). */
const NOMBRE_DE_RED = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/;

/** Las carpetas de la máquina que traen dentro el socket de Docker: montarlas es montarlo. */
const CON_EL_SOCKET = new Set(["/", "/var", "/var/run", "/run"]);

/** Lo que solo se alcanza desde esta misma máquina. Sin dirección, Docker publica en todas las interfaces. */
const soloLocal = (ip: string | undefined): boolean => ip !== undefined && (ip.startsWith("127.") || ip === "::1");

/**
 * Lo que la configuración efectiva publica de más. Solo publica el proxy, y solo 80 y 443: los
 * puertos que publica Docker no pasan por el cortafuegos del sistema, así que la regla es no
 * publicar, no «bloquear después». Y nadie más publica ni en esta máquina: publicado, aunque sea en
 * 127.0.0.1, otro contenedor llega a ese puerto por la dirección del servicio, aunque esté en otra
 * red (así llegó el proxy a la base: revisión de seguridad de Codex del 5 de noviembre, R40-01).
 * Ningún contenedor usa la red de la máquina ni sus privilegios, ni recibe el socket de Docker. Lo
 * que aquí no se ve —lo que de verdad contesta desde fuera— se comprueba desde otra máquina.
 *
 * Detrás de otro proxy (`entrada`, docker-compose.detras.yml), el de feruga no publica nada, ni en
 * esta máquina: el otro, que tiene 80 y 443, le llega por esa red, que existe aparte y que de
 * feruga solo tiene al proxy. Si no se dice, ningún servicio está en una red de fuera: sería una
 * puerta que nadie revisó.
 */
export function faltasDeRed(config: Configuracion, o: { local?: boolean; entrada?: string } = {}): string[] {
  const servicios = config.services;
  if (!servicios || Object.keys(servicios).length === 0) return ["No es una configuración de Compose: no trae servicios"];
  const faltas: string[] = [];
  const delProxy = new Set<string>();
  const redes = redesDe(config);
  const entrada = o.entrada === undefined || o.entrada === "" ? undefined : o.entrada;
  if (entrada !== undefined && !NOMBRE_DE_RED.test(entrada)) {
    faltas.push(`RED_DE_ENTRADA (${JSON.stringify(entrada)}) no es un nombre de red: uno solo, de letras, números, «_», «.» y «-», sin blancos`);
  }
  if (entrada) {
    for (const [clave, red] of redes) {
      if (red.nombre === entrada && !red.externa) {
        faltas.push(`La red ${entrada} la crearía esta configuración (como «${clave}»): tiene que existir aparte (docker network create --internal ${entrada}), y declararse solo como de fuera`);
      }
    }
  }
  for (const [nombre, servicio] of Object.entries(servicios)) {
    for (const clave of Object.keys(servicio.networks ?? {})) {
      const red = redes.get(clave) ?? { nombre: clave, externa: false };
      if (entrada && red.nombre === entrada) {
        // La compartida, por la clave que sea: solo el proxy.
        if (nombre !== "proxy") faltas.push(`${nombre} está en la red ${entrada}, que es solo del proxy: el otro proxy le llegaría sin pasar por el de feruga`);
        continue;
      }
      if (!red.externa) continue;
      faltas.push(`${nombre} está en la red de fuera ${red.nombre}${entrada ? `: la única de fuera es ${entrada}, y solo para el proxy` : ": sin decir que el proxy va detrás de otro (RED_DE_ENTRADA), ningún servicio está en una red de fuera"}`);
    }
    for (const p of servicio.ports ?? []) {
      const donde = soloLocal(p.host_ip) ? "en esta máquina" : "a la red";
      const puerto = `${nombre} publica ${donde} el puerto ${p.published} (hacia su ${p.target})`;
      if (nombre !== "proxy") {
        faltas.push(`${puerto}: solo publica el proxy; publicado, aunque sea solo aquí, otro contenedor lo alcanza por su dirección`);
      } else if (entrada) {
        faltas.push(`${puerto}: detrás de otro proxy, el de feruga no publica nada; el otro le llega por la red ${entrada}`);
      } else if (Number(p.target) !== 80 && Number(p.target) !== 443) {
        faltas.push(`${puerto}: del proxy solo se publican el 80 y el 443`);
      } else if (!soloLocal(p.host_ip)) {
        // A la red, cada uno en su número: en esta máquina (un ensayo) puede ir en otro.
        const par = `${p.published}:${p.target}`;
        if (par === "80:80" || par === "443:443") delProxy.add(par);
        else faltas.push(`${puerto}: a la red solo sale el proxy, en 80 y 443`);
      }
    }
    // Con la red de la máquina, lo que el contenedor abra queda en la red sin publicar ningún puerto:
    // la revisión de arriba no lo vería. Solo se admiten las redes de este proyecto (las de «networks»),
    // o ninguna. La general de Docker («bridge») tampoco: en ella cualquier otro contenedor del
    // servidor —el otro proxy, por ejemplo— llegaría a sus puertos por dirección (Codex, R43-07).
    if (servicio.network_mode !== undefined && servicio.network_mode !== "none") {
      faltas.push(servicio.network_mode === "host"
        ? `${nombre} usa la red de la máquina (network_mode: host): todo lo que abra sale a la red`
        : servicio.network_mode === "bridge"
          ? `${nombre} usa la red general de Docker (network_mode: bridge): no es la de este proyecto, y cualquier otro contenedor del servidor le llega por dirección`
          : `${nombre} usa otra red que las de este proyecto (network_mode: ${servicio.network_mode}): no es lo que aquí se comprueba`);
    }
    if (servicio.privileged === true) faltas.push(`${nombre} corre con los privilegios de la máquina (privileged): nada lo contiene`);
    for (const v of servicio.volumes ?? []) {
      const origen = (v.source ?? "").replace(/\/+$/, "") || (v.source ? "/" : "");
      if (`${v.source ?? ""} ${v.target ?? ""}`.includes("docker.sock") || CON_EL_SOCKET.has(origen)) {
        faltas.push(`${nombre} recibe el socket de Docker (docker.sock, o la carpeta que lo contiene): es darle la máquina entera`);
      }
    }
  }
  if (entrada) {
    // Detrás de otro proxy, igual en un ensayo: lo que atiende es el proxy, en la red que comparte con el otro.
    if (!servicios.proxy) faltas.push("No hay proxy: nada atiende");
    else if (!Object.keys(servicios.proxy.networks ?? {}).some((clave) => redes.get(clave)?.externa === true && redes.get(clave)?.nombre === entrada)) {
      faltas.push(`El proxy no está en la red ${entrada}: el otro proxy no tendría por dónde llegarle`);
    }
    return faltas;
  }
  // En un ensayo el proxy se queda en esta máquina; eso se acepta solo si se dice. Lo de arriba se exige igual.
  if (o.local) return faltas;
  if (!servicios.proxy) faltas.push("No hay proxy: nada atiende por HTTPS");
  else for (const par of ["80:80", "443:443"]) if (!delProxy.has(par)) faltas.push(`El proxy no publica el ${par.split(":")[0]}`);
  return faltas;
}

/**
 * Los nombres en Docker de las redes de fuera que usa algún servicio: las que tienen que existir
 * antes de levantar. Si alguno no es un nombre de red de los de NOMBRE_DE_RED, falla: quien los lee
 * los toma uno por renglón, y uno con blancos se revisaría como otros (Codex, R43-02).
 */
export function redesQueDebenExistir(config: Configuracion): string[] {
  const redes = redesDe(config);
  const usadas = new Set<string>();
  for (const servicio of Object.values(config.services ?? {})) {
    for (const clave of Object.keys(servicio.networks ?? {})) {
      const red = redes.get(clave);
      if (red?.externa) usadas.add(red.nombre);
    }
  }
  for (const nombre of usadas) {
    if (!NOMBRE_DE_RED.test(nombre)) throw new Error(`La red de fuera ${JSON.stringify(nombre)} no es un nombre de red: uno solo, de letras, números, «_», «.» y «-», sin blancos`);
  }
  return [...usadas].sort();
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
  // Dos plazos: el de silencio (sin nada del sitio en ese tiempo, falla) y uno total, tres veces más
  // holgado, para que un sitio a goteo, o que corta la respuesta, no deje esperando para siempre
  // (revisión de Codex del 3 de noviembre, H2). El total no es igual al de silencio: con la máquina
  // cargada, a media publicación, un sitio lento pero que contesta se daba por caído (ensayo del 4 de
  // noviembre).
  const plazo = o.plazo ?? 10_000;
  const total = plazo * 3;
  // Un reto nuevo en cada pregunta, que la salud repite: una respuesta guardada por algo de en medio
  // —otro proxy, al ir detrás de él—, o de otra aplicación con la misma forma, no lo trae (Codex, R43-04).
  const reto = randomBytes(16).toString("hex");
  return new Promise((bien, mal) => {
    let decidido = false;
    const decidir = (hacer: () => void): void => {
      if (decidido) return;
      decidido = true;
      clearTimeout(reloj);
      hacer();
    };
    const peticion = request(
      {
        host: o.maquina ?? o.dominio, port: o.puerto ?? 443, servername: o.dominio, path: `/api/salud?reto=${reto}`, method: "GET",
        headers: { Host: o.dominio, ...(o.clave ? encabezadoDelComprobador(o.clave) : {}) }, timeout: plazo, rejectUnauthorized: true,
        ...(o.ca ? { ca: o.ca } : {}),
        // Sin el agente compartido: cada vez se negocia la conexión entera. En una sesión TLS reanudada
        // el certificado no llega, y el latido avisaría en falso que no se pudo leer su vigencia (lo
        // encontró el ensayo de la operación el 3 de noviembre).
        agent: false,
      },
      (respuesta) => {
        const certificado = vigenciaDe(respuesta.socket as TLSSocket);
        let cuerpo = "";
        respuesta.setEncoding("utf8");
        respuesta.on("data", (trozo: string) => { if (cuerpo.length < 10_000) cuerpo += trozo; });
        respuesta.on("error", () => decidir(() => mal(new Error("el sitio cortó la respuesta antes de terminarla"))));
        respuesta.on("close", () => {
          if (!respuesta.complete) decidir(() => mal(new Error("el sitio cortó la respuesta antes de terminarla")));
        });
        respuesta.on("end", () => decidir(() => {
          if (respuesta.statusCode !== 200) return mal(new Error(`el sitio contestó ${respuesta.statusCode}`));
          let d: Record<string, unknown>;
          try {
            d = JSON.parse(cuerpo) as Record<string, unknown>;
            if (d.bien !== true || typeof d.abierta !== "boolean") throw new Error("sin forma");
          } catch {
            return mal(new Error("el sitio contestó 200, pero no con lo que dice la salud de esta aplicación"));
          }
          if (d.reto !== reto) {
            return mal(new Error("el sitio contestó la salud, pero no repitió el reto de esta pregunta: puede ser una respuesta guardada de antes, o de otra aplicación"));
          }
          const texto = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);
          bien({ abierta: d.abierta as boolean, version: texto(d.version), esquema: texto(d.esquema), base: texto(d.base), certificado });
        }));
      },
    );
    const reloj = setTimeout(() => {
      decidir(() => mal(new Error("el sitio no contestó a tiempo")));
      peticion.destroy();
    }, total);
    peticion.on("timeout", () => peticion.destroy(new Error("el sitio no contestó a tiempo")));
    peticion.on("error", (e) => decidir(() => mal(new Error(`no se pudo pedir por HTTPS con certificado válido: ${e.message}`))));
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
  // A qué máquina se le pregunta por el sitio: la que se diga; si no, por donde lo diga la
  // instalación (SITIO_POR: su proxy, o la dirección pública si va detrás de otro); si no, el dominio.
  const maquina = argumento ?? (process.env.SITIO_POR || undefined);
  let faltas: string[];
  if (orden === "entorno") {
    faltas = process.env.MODO === "desarrollo"
      ? ["MODO dice desarrollo: la operación no corre con el entorno de desarrollo"]
      : faltasDelEntorno(process.env, ["administracion", "conexion", "aplicacion", "respaldo", "sitio"]);
  } else if (orden === "red") {
    try {
      const entrada = opcion("entrada") ?? process.env.RED_DE_ENTRADA ?? "";
      faltas = faltasDeRed(JSON.parse(await entradaEstandar()) as Configuracion, { local: resto.includes("--local"), entrada });
    } catch {
      faltas = ["Lo que llegó por la entrada estándar no es la configuración de Compose (docker compose config --format json)"];
    }
  } else if (orden === "redes-de-fuera") {
    faltas = [];
    let config: Configuracion | undefined;
    try {
      config = JSON.parse(await entradaEstandar()) as Configuracion;
    } catch {
      faltas = ["Lo que llegó por la entrada estándar no es la configuración de Compose (docker compose config --format json)"];
    }
    if (config) {
      try {
        // Todas juntas, o ninguna: a medias, quien las lee creería que eran todas.
        process.stdout.write(redesQueDebenExistir(config).map((red) => `${red}\n`).join(""));
        process.exit(0);
      } catch (e) {
        faltas = [(e as Error).message];
      }
    }
  } else if (orden === "https") {
    const dominio = process.env.DOMINIO;
    try {
      if (!dominio) throw new Error("Falta DOMINIO");
      const e = await estadoPorHttps({ dominio, ...(maquina ? { maquina } : {}), ...(process.env.SESION_CLAVE ? { clave: process.env.SESION_CLAVE } : {}) });
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
        await rechazoPorHttps({ dominio, ...(maquina ? { maquina } : {}) }).catch((e: Error) => faltas.push(e.message));
      }
    } catch (e) {
      faltas = [(e as Error).message];
    }
  } else if (orden === "certificado") {
    const dominio = process.env.DOMINIO;
    try {
      if (!dominio) throw new Error("Falta DOMINIO");
      const c = await certificadoDe({ dominio, ...(maquina ? { maquina } : {}) });
      console.log(`${c.huella} vence ${c.vence.toISOString()}`);
      process.exit(0);
    } catch (e) {
      faltas = [(e as Error).message];
    }
  } else {
    console.error("Uso: node operacion/comprobar.ts entorno | red [--local] [--entrada=<red>] | redes-de-fuera | https [máquina] [--abierta|--cerrada] [--version=…] [--base=…] [--rechaza-escribir] | certificado [máquina]");
    process.exit(2);
  }
  if (faltas.length > 0) {
    console.error(`No pasa la comprobación de ${orden}:\n  · ${faltas.join("\n  · ")}`);
    process.exit(1);
  }
  console.log(`Comprobación de ${orden}: bien.`);
}
