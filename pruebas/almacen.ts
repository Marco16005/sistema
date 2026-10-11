// El almacenamiento de las pruebas. Cada prueba recibe un cubo propio, con versiones y retención
// con candado, y las dos credenciales que habrá en la operación: la del servidor (sube, lista y lee
// lo cifrado de su prefijo; no borra ni cambia la retención) y la de recuperación (solo lee).
//
// Los cubos no se pueden borrar al terminar —para eso es el candado—: se pierden cuando se detiene
// el contenedor del almacenamiento, que guarda todo en memoria.
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const correr = promisify(execFile);
const ALMACEN = new URL(process.env.ALMACEN_URL ?? "http://raiz:raiz-solo-para-pruebas@localhost:9000");

export interface Credencial {
  usuario: string;
  clave: string;
}

export interface Version {
  id: string;
  bytes: number;
  /** Una marca de borrado: el objeto «ya no está», pero sus versiones siguen. */
  borrado: boolean;
}

export interface Cubo {
  nombre: string;
  /** El destino como se le dice al respaldo: remoto de rclone y camino. */
  destino: string;
  /** La administradora del almacenamiento. En la operación no la tiene el servidor. */
  raiz: Credencial;
  servidor: Credencial;
  recuperacion: Credencial;
  /** El entorno con que rclone llega al almacenamiento con esa credencial. */
  entorno(c: Credencial): Record<string, string>;
  /** Otra credencial, con los permisos que se le den sobre los objetos y el cubo. */
  credencial(objetos: Record<string, string[]>, cubo?: string[]): Promise<Credencial>;
  /** El cliente del almacenamiento con esa credencial. El cubo se nombra «c/<cubo>». */
  mc(c: Credencial, ...args: string[]): Promise<string>;
  /** Las versiones de ese objeto (camino dentro del destino), de la más nueva a la más vieja. */
  versiones(objeto: string): Promise<Version[]>;
  /** Pone ese contenido bajo ese nombre, con la credencial de administración. */
  poner(objeto: string, contenido: Buffer): Promise<void>;
  /** Lo que guarda esa versión. */
  leer(objeto: string, version?: string): Promise<Buffer>;
}

const PREFIJO = "feruga";

export interface OpcionesDeCubo {
  /** Cuánto retiene el cubo lo que recibe. Por omisión, 30 días: el de los respaldos de cada hora. */
  retencion?: string;
  /** El nombre del remoto de rclone con que se llega a él. Dos cubos con credenciales distintas piden dos nombres. */
  remoto?: string;
}

/** Lo que la credencial del servidor puede hacer: subir y leer objetos de su prefijo, y listarlo. Nada más. */
export const DEL_SERVIDOR = ["s3:PutObject", "s3:GetObject"];
export const DE_RECUPERACION = ["s3:GetObject"];

export async function conCubo(prueba: (cubo: Cubo) => Promise<void>, opciones: OpcionesDeCubo = {}): Promise<void> {
  const REMOTO = opciones.remoto ?? "prueba";
  const variable = (cual: string): string => `RCLONE_CONFIG_${REMOTO.toUpperCase()}_${cual}`;
  const nombre = "c" + randomUUID().replaceAll("-", "").slice(0, 20);
  const carpeta = await mkdtemp(join(tmpdir(), "almacen-"));
  const raiz: Credencial = { usuario: decodeURIComponent(ALMACEN.username), clave: decodeURIComponent(ALMACEN.password) };
  const creadas: string[] = [];

  const mc = async (c: Credencial, ...args: string[]): Promise<string> => {
    const servicio = new URL(ALMACEN.origin);
    servicio.username = c.usuario;
    servicio.password = c.clave;
    const { stdout } = await correr("mcli", ["--config-dir", carpeta, "--quiet", ...args], {
      env: { ...process.env, MC_HOST_c: servicio.toString().replace(/\/$/, "") }, maxBuffer: 64 * 1024 * 1024, encoding: "buffer",
    }) as unknown as { stdout: Buffer };
    return stdout.toString("latin1");
  };

  const credencial = async (objetos: Record<string, string[]>, cubo: string[] = ["s3:ListBucket"]): Promise<Credencial> => {
    const c: Credencial = { usuario: "u" + randomUUID().replaceAll("-", "").slice(0, 16), clave: "S" + randomUUID().replaceAll("-", "") };
    const politica = {
      Version: "2012-10-17",
      Statement: [
        ...(cubo.length ? [{ Effect: "Allow", Action: cubo, Resource: [`arn:aws:s3:::${nombre}`] }] : []),
        ...Object.entries(objetos).map(([patron, acciones]) => ({
          Effect: "Allow", Action: acciones, Resource: [`arn:aws:s3:::${nombre}/${PREFIJO}/${patron}`],
        })),
      ],
    };
    const archivo = join(carpeta, `${c.usuario}.json`);
    await writeFile(archivo, JSON.stringify(politica));
    await mc(raiz, "admin", "user", "add", "c", c.usuario, c.clave);
    await mc(raiz, "admin", "policy", "create", "c", `p-${c.usuario}`, archivo);
    await mc(raiz, "admin", "policy", "attach", "c", `p-${c.usuario}`, "--user", c.usuario);
    creadas.push(c.usuario);
    return c;
  };

  try {
    // Con candado desde su creación (que trae las versiones), y una retención que nadie puede acortar.
    await mc(raiz, "mb", "--with-lock", `c/${nombre}`);
    await mc(raiz, "retention", "set", "--default", "COMPLIANCE", opciones.retencion ?? "30d", `c/${nombre}`);
    const cubo: Cubo = {
      nombre, destino: `${REMOTO}:${nombre}/${PREFIJO}`, raiz,
      servidor: await credencial({ "*": DEL_SERVIDOR }),
      recuperacion: await credencial({ "*": DE_RECUPERACION }),
      entorno: (c) => ({
        [variable("TYPE")]: "s3", [variable("PROVIDER")]: "Minio", [variable("ENDPOINT")]: ALMACEN.origin,
        [variable("REGION")]: "us-east-1", [variable("ACCESS_KEY_ID")]: c.usuario, [variable("SECRET_ACCESS_KEY")]: c.clave,
      }),
      credencial, mc,
      versiones: async (objeto) =>
        (await mc(raiz, "ls", "--versions", "--json", `c/${nombre}/${PREFIJO}/${objeto}`))
          .split("\n").filter(Boolean).map((linea) => JSON.parse(linea) as Record<string, unknown>)
          .map((v) => ({ id: String(v.versionId), bytes: Number(v.size), borrado: v.isDeleteMarker === true })),
      poner: async (objeto, contenido) => {
        const archivo = join(carpeta, randomUUID());
        await writeFile(archivo, contenido);
        await mc(raiz, "cp", archivo, `c/${nombre}/${PREFIJO}/${objeto}`);
        await rm(archivo);
      },
      leer: async (objeto, version) =>
        Buffer.from(await mc(raiz, "cat", ...(version ? ["--version-id", version] : []), `c/${nombre}/${PREFIJO}/${objeto}`), "latin1"),
    };
    await prueba(cubo);
  } finally {
    for (const usuario of creadas) {
      await mc(raiz, "admin", "user", "remove", "c", usuario).catch(() => {});
      await mc(raiz, "admin", "policy", "remove", "c", `p-${usuario}`).catch(() => {});
    }
    await rm(carpeta, { recursive: true, force: true });
  }
}
