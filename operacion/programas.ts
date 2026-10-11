// Correr los programas de los que dependen respaldar y restaurar (pg_dump, pg_restore, age, rclone)
// sin que ningún secreto viaje a la vista: lo que un programa necesita en secreto le llega por la
// entrada estándar o por su entorno, nunca por sus argumentos, que cualquiera en la máquina puede
// ver. Cada uno corre con un plazo: uno que se queda detenido se termina y cuenta como fallo.
import { spawn } from "node:child_process";

export interface Corrida {
  /** Lo que se le da por la entrada estándar. */
  entrada?: string;
  /** Variables que se agregan a su entorno. */
  entorno?: Record<string, string>;
  /** Cuánto puede tardar, en milisegundos. Sin plazo, lo que tarde. */
  plazo?: number;
}

/** Corre un programa hasta que termina y devuelve lo que escribió. Si falla, el error trae lo último de lo que se quejó. */
export function correr(programa: string, args: string[], o: Corrida = {}): Promise<string> {
  return new Promise((bien, mal) => {
    const hijo = spawn(programa, args, {
      stdio: [o.entrada === undefined ? "ignore" : "pipe", "pipe", "pipe"],
      env: { ...process.env, ...o.entorno },
    });
    const salida: Buffer[] = [];
    hijo.stdout!.on("data", (trozo: Buffer) => salida.push(trozo));
    // De lo que el programa se queje se guarda el principio y el final: el principio suele decir
    // qué falló, y el final, en qué quedó. (Es un resumen para el registro, no un filtro de secretos.)
    let cabeza = "";
    let cola = "";
    let vencido = false;
    const reloj = o.plazo === undefined ? null : setTimeout(() => {
      vencido = true;
      hijo.kill("SIGKILL");
    }, o.plazo);
    hijo.stderr!.on("data", (trozo: Buffer) => {
      const texto = trozo.toString();
      if (cabeza.length < 400) {
        const cabe = 400 - cabeza.length;
        cabeza += texto.slice(0, cabe);
        cola = (cola + texto.slice(cabe)).slice(-400);
      } else {
        cola = (cola + texto).slice(-400);
      }
    });
    hijo.on("error", (e) => {
      if (reloj) clearTimeout(reloj);
      mal(new Error(`No se pudo correr ${programa}: ${e.message}`));
    });
    hijo.on("close", (codigo) => {
      if (reloj) clearTimeout(reloj);
      if (vencido) mal(new Error(`${programa} no terminó en ${o.plazo! < 1000 ? `${o.plazo} ms` : `${Math.round(o.plazo! / 1000)} s`} y se detuvo`));
      else if (codigo === 0) bien(Buffer.concat(salida).toString());
      else mal(new Error((cabeza + (cola ? ` […] ${cola}` : "")).trim() || `${programa} terminó con ${codigo}`));
    });
    if (o.entrada !== undefined) {
      hijo.stdin!.on("error", () => {});      // si el programa termina antes de leerla, el fallo lo cuenta su salida
      hijo.stdin!.end(o.entrada);
    }
  });
}

/**
 * La conexión a una base, como variables de entorno para los programas de Postgres. Así la clave
 * no aparece en los argumentos de pg_dump ni de pg_restore.
 */
export function entornoDePg(direccion: string): Record<string, string> {
  const u = new URL(direccion);
  const entorno: Record<string, string> = {
    PGHOST: u.hostname, PGPORT: u.port || "5432", PGUSER: decodeURIComponent(u.username),
    PGPASSWORD: decodeURIComponent(u.password), PGDATABASE: decodeURIComponent(u.pathname.replace(/^\//, "")),
  };
  const ssl = u.searchParams.get("sslmode");
  if (ssl) entorno.PGSSLMODE = ssl;
  return entorno;
}
