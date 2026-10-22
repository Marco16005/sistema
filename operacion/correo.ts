// Mandar un correo, para los avisos que salen del sistema. Habla SMTP directo con el servidor de
// correo que se diga —el del dominio, o el de un servicio de envío—, sin bibliotecas: es poco lo que
// hace falta y así no entra otra dependencia al servidor.
//
// La dirección del servidor va como una URL, con el usuario y la contraseña de la cuenta que manda:
//   smtps://avisos%40patio.mx:clave@smtp.proveedor.mx:465   cifrado desde el principio (el puerto 465)
//   smtp://avisos%40patio.mx:clave@smtp.proveedor.mx:587    se cifra antes de entrar (STARTTLS)
// Sin cifrar no se manda nada: la contraseña viajaría a la vista. (Solo las pruebas lo permiten.)
// La contraseña nunca aparece en un error ni en el registro.
import { connect as conectarPlano } from "node:net";
import type { Socket } from "node:net";
import { randomUUID } from "node:crypto";
import { connect as conectarCifrado } from "node:tls";
import type { TLSSocket } from "node:tls";

export interface Correo {
  /** El servidor de correo y la cuenta que manda (ver arriba). */
  url: string;
  de: string;
  para: readonly string[];
  asunto: string;
  texto: string;
  /** Cuánto esperar cada respuesta del servidor, en milisegundos. */
  plazo?: number;
  /** Solo para las pruebas: mandar sin cifrar a un servidor de mentira en esta máquina. */
  sinCifrar?: boolean;
}

const DIRECCION = /^[^\s@<>,"]+@[^\s@<>,"]+\.[^\s@<>,"]+$/;

/** Lo que se lee del servidor: renglones, y respuestas completas (las de varios renglones, juntas). */
class Conversacion {
  private pendiente = "";
  private esperando: ((r: { codigo: number; texto: string }) => void) | null = null;
  private renglones: string[] = [];
  private error: Error | null = null;
  private enlace!: Socket | TLSSocket;
  private readonly alLlegar = (trozo: Buffer): void => {
    this.pendiente += trozo.toString("utf8");
    let k: number;
    while ((k = this.pendiente.indexOf("\r\n")) >= 0) {
      this.renglones.push(this.pendiente.slice(0, k));
      this.pendiente = this.pendiente.slice(k + 2);
    }
    this.entregar();
  };
  private readonly alFallar = (e: Error): void => {
    this.error = new Error(`el servidor de correo no contestó bien (${(e as NodeJS.ErrnoException).code ?? e.name})`);
    this.entregar();
  };
  private readonly alCerrar = (): void => {
    this.error ??= new Error("el servidor de correo cerró la conexión");
    this.entregar();
  };

  private readonly plazo: number;

  constructor(enlace: Socket | TLSSocket, plazo: number) {
    this.plazo = plazo;
    this.escuchar(enlace);
  }

  /**
   * Escucha esa conexión. Al cifrarla se deja de escuchar la de antes, y lo que se hubiera leído de
   * ella se tira: nada de lo que llegó sin cifrar vale ya.
   */
  escuchar(enlace: Socket | TLSSocket): void {
    this.soltar();
    this.pendiente = "";
    this.renglones = [];
    this.enlace = enlace;
    enlace.on("data", this.alLlegar);
    enlace.on("error", this.alFallar);
    enlace.on("close", this.alCerrar);
  }

  /** ¿Llegó algo más de lo que se esperaba? Antes de cifrar, eso es que alguien quiere colar una respuesta. */
  nadaDeMas(): boolean {
    return this.pendiente === "" && this.renglones.length === 0;
  }

  soltar(): void {
    if (!this.enlace) return;
    this.enlace.off("data", this.alLlegar);
    this.enlace.off("error", this.alFallar);
    this.enlace.off("close", this.alCerrar);
  }

  /** Una respuesta está completa cuando su último renglón es «250 …» y no «250-…». */
  private entregar(): void {
    if (!this.esperando) return;
    const fin = this.renglones.findIndex((x) => /^\d{3}( |$)/.test(x));
    const listo = this.esperando;
    if (fin >= 0) {
      const suyos = this.renglones.splice(0, fin + 1);
      this.esperando = null;
      listo({ codigo: Number(suyos.at(-1)!.slice(0, 3)), texto: suyos.map((x) => x.slice(4)).join(" ") });
    } else if (this.error) {
      this.esperando = null;
      listo({ codigo: 0, texto: this.error.message });
    }
  }

  /** Espera la respuesta siguiente del servidor; falla si no es la que se espera. */
  respuesta(esperado: number[], que: string): Promise<{ codigo: number; texto: string }> {
    return new Promise((bien, mal) => {
      const reloj = setTimeout(() => { this.esperando = null; mal(new Error(`el servidor de correo no contestó a tiempo (${que})`)); }, this.plazo);
      this.esperando = (r) => {
        clearTimeout(reloj);
        if (r.codigo === 0) return mal(new Error(r.texto));
        if (!esperado.includes(r.codigo)) return mal(new Error(`el servidor de correo no aceptó ${que}: ${r.codigo} ${r.texto}`.slice(0, 300)));
        bien(r);
      };
      this.entregar();
    });
  }

  decir(renglon: string): void {
    this.enlace.write(`${renglon}\r\n`);
  }

  /** Lo que se dice y la respuesta que se espera. */
  async pedir(renglon: string, esperado: number[], que: string): Promise<{ codigo: number; texto: string }> {
    this.decir(renglon);
    return this.respuesta(esperado, que);
  }
}

/** Un encabezado con letras de fuera del ASCII, como lo pide el correo (RFC 2047). */
const encabezado = (texto: string): string => (/^[\x20-\x7e]*$/.test(texto) ? texto : `=?UTF-8?B?${Buffer.from(texto, "utf8").toString("base64")}?=`);

/** El mensaje entero: encabezados y el texto en base64, en renglones de 76. */
function mensaje(c: Correo): string {
  const dominio = c.de.split("@")[1]!;
  const cuerpo = Buffer.from(c.texto, "utf8").toString("base64").replace(/.{1,76}/g, "$&\r\n");
  return [
    `From: ${c.de}`, `To: ${c.para.join(", ")}`, `Subject: ${encabezado(c.asunto)}`, `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${randomUUID()}@${dominio}>`, "MIME-Version: 1.0", "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: base64", "", cuerpo,
  ].join("\r\n");
}

const enlazar = (crear: () => Socket | TLSSocket, cuando: "connect" | "secureConnect", plazo: number): Promise<Socket | TLSSocket> =>
  new Promise((bien, mal) => {
    const enlace = crear();
    const reloj = setTimeout(() => { enlace.destroy(); mal(new Error("no se pudo llegar al servidor de correo a tiempo")); }, plazo);
    enlace.once(cuando, () => { clearTimeout(reloj); bien(enlace); });
    enlace.once("error", (e) => { clearTimeout(reloj); mal(new Error(`no se pudo llegar al servidor de correo (${(e as NodeJS.ErrnoException).code ?? e.name})`)); });
  });

/** Manda ese correo. Falla —sin decir la contraseña— si el servidor no lo acepta. */
export async function enviarCorreo(c: Correo): Promise<void> {
  let u: URL;
  try {
    u = new URL(c.url);
  } catch {
    throw new Error("La dirección del servidor de correo no se entiende");
  }
  const cifrado = u.protocol === "smtps:";
  if (!cifrado && u.protocol !== "smtp:") throw new Error("La dirección del servidor de correo empieza con smtps:// o smtp://");
  if (!DIRECCION.test(c.de) || c.para.length === 0 || !c.para.every((p) => DIRECCION.test(p))) throw new Error("El correo lleva de quién y para quién, como direcciones de correo");
  const usuario = decodeURIComponent(u.username);
  const clave = decodeURIComponent(u.password);
  const maquina = u.hostname;
  const puerto = Number(u.port || (cifrado ? 465 : 587));
  const plazo = c.plazo ?? 30_000;

  if (!cifrado && c.sinCifrar && !/^(127\.0\.0\.1|localhost|::1)$/.test(maquina)) {
    throw new Error("Sin cifrar solo se manda a esta misma máquina, y solo en las pruebas");
  }
  let enlace = await enlazar(
    () => (cifrado ? conectarCifrado({ host: maquina, port: puerto, servername: maquina }) : conectarPlano({ host: maquina, port: puerto })),
    cifrado ? "secureConnect" : "connect", plazo,
  );
  const habla = new Conversacion(enlace, plazo);
  try {
    await habla.respuesta([220], "la conexión");
    let ehlo = await habla.pedir("EHLO feruga", [250], "el saludo");
    if (!cifrado && !c.sinCifrar) {
      if (!/\bSTARTTLS\b/i.test(ehlo.texto)) throw new Error("El servidor de correo no ofrece cifrar la conexión: no se manda nada sin cifrar");
      await habla.pedir("STARTTLS", [220], "cifrar la conexión");
      // Lo que llegue después de «adelante» y antes de cifrar se colaría como si viniera cifrado (el
      // ataque conocido de STARTTLS): si llegó algo, no se sigue. (Revisión de seguridad del 22 de octubre.)
      if (!habla.nadaDeMas()) throw new Error("El servidor de correo mandó algo de más antes de cifrar la conexión: no se sigue");
      habla.soltar();
      const plano = enlace as Socket;
      enlace = await enlazar(() => conectarCifrado({ socket: plano, servername: maquina }), "secureConnect", plazo);
      habla.escuchar(enlace);
      ehlo = await habla.pedir("EHLO feruga", [250], "el saludo cifrado");
    }
    if (usuario) await habla.pedir(`AUTH PLAIN ${Buffer.from(`\0${usuario}\0${clave}`, "utf8").toString("base64")}`, [235], "el usuario y la contraseña");
    await habla.pedir(`MAIL FROM:<${c.de}>`, [250], "el remitente");
    for (const p of c.para) await habla.pedir(`RCPT TO:<${p}>`, [250, 251], `el destinatario ${p}`);
    await habla.pedir("DATA", [354], "el mensaje");
    // Un renglón que empieza con punto se dobla, para que no se confunda con el final.
    habla.decir(mensaje(c).replace(/\r\n\./g, "\r\n.."));
    await habla.pedir(".", [250], "el mensaje");
    await habla.pedir("QUIT", [221, 250], "la despedida").catch(() => {});
  } finally {
    enlace.destroy();
  }
}
