// De un respaldo, qué versión del sistema lo tomó.
//
// Cada respaldo dice en su manifiesto qué publicación corría cuando se tomó, y el identificador de
// una publicación lleva su commit. Con eso, el día que se pierda la máquina, se sabe en qué commit
// poner la carpeta para volver a armar la instalación (operacion/publicar.sh --desde-respaldo).
//
// Lo que dice el manifiesto se cree solo si lleva el sello de la llave del dueño (operacion/destino.ts):
// por eso este programa pide la llave privada, por la entrada estándar, igual que restaurar. Sin
// eso, quien pudiera escribir en el almacenamiento decidiría en qué commit se pone la carpeta. Y el
// respaldo tiene que estar cifrado para ESA llave: el sello solo dice que el manifiesto es auténtico,
// y un servidor con el sello de una llave y la pública de otra toma respaldos sellados que el dueño
// no puede abrir (revisión de Codex del 21 de octubre). Por eso también se compara la pública.
//
// Las imágenes se construyen ahí, de ese commit: lo que se confía es el repositorio. Del
// almacenamiento se baja el respaldo —cifrado para el dueño, y auditado al restaurarlo— y nada que
// se vaya a ejecutar. (Antes se guardaban también las imágenes de cada publicación, para bajarlas en
// la máquina nueva; Codex señaló en su décima revisión que nada ataba esas imágenes al commit: quien
// pudiera escribir en el almacenamiento decidía qué corría en el servidor nuevo, con la llave del
// dueño enfrente.)
//
//   node operacion/version-del-respaldo.ts [<respaldo>] < llave-privada.txt    «respaldo publicación commit», del que se nombre o del último
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { claveDeSello, destinoRclone, manifiestoDe, respaldos, ultimoUtilizable } from "./destino.ts";
import type { Destino } from "./destino.ts";
import { identidadDe } from "./llave.ts";

export interface DelRespaldo {
  objeto: string;
  /** La publicación que corría cuando se tomó. */
  publicacion: string;
  /** El commit de esa publicación, como lo lleva su identificador: sus doce primeras letras. */
  commit: string;
}

/**
 * Qué publicación corría cuando se tomó ese respaldo —o el último—, y de qué commit es: lo dice su
 * manifiesto. Uno que no lo dice es de antes de que se publicara así. `publica` es la de la llave del
 * dueño: el respaldo tiene que estar cifrado para ella.
 */
export async function versionDe(destino: Destino, publica: string, objeto?: string): Promise<DelRespaldo> {
  const carpeta = await mkdtemp(join(tmpdir(), "feruga-version-"));
  try {
    let manifiesto;
    if (objeto === undefined) {
      const util = await ultimoUtilizable(destino);
      if (!util) throw new Error("No hay ningún respaldo con su manifiesto en orden en el destino.");
      if (util.saltados.length > 0) {
        throw new Error(`Hay respaldos más nuevos con el manifiesto dañado o sin el sello de este negocio (${util.saltados[0]}): no se toma uno más viejo sin que se pida. El último en orden es ${util.manifiesto.objeto}; pídelo por su nombre.`);
      }
      manifiesto = util.manifiesto;
    } else {
      const de = (await respaldos(destino)).find((r) => r.objeto === objeto);
      if (!de) throw new Error(`No hay un respaldo con ese nombre en el destino: ${objeto}`);
      manifiesto = await manifiestoDe(destino, de, carpeta);
    }
    if (manifiesto.llavePublica !== publica) {
      throw new Error(
        `El respaldo ${manifiesto.objeto} lleva el sello de esta llave, pero se cifró para otra llave (${manifiesto.llavePublica}): ` +
        "el servidor tiene el sello de esta llave y la pública de otra, y con esta llave no se abre. Se ponen en su .env los dos " +
        "renglones que da operacion/sello.ts con esta llave, se levanta otra vez y se toma otro respaldo.",
      );
    }
    if (manifiesto.publicacion === undefined) {
      throw new Error(`El respaldo ${manifiesto.objeto} no dice qué publicación corría cuando se tomó: es de antes de que se publicara así, o de desarrollo. De él no se instala con este guion.`);
    }
    // (Que lo que dice sea de verdad el identificador de una publicación ya lo exigió leer su manifiesto.)
    return { objeto: manifiesto.objeto, publicacion: manifiesto.publicacion, commit: manifiesto.publicacion.split("-")[1]! };
  } finally {
    await rm(carpeta, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  if (args.length > 1 || process.stdin.isTTY) {
    console.error("Uso: node operacion/version-del-respaldo.ts [<respaldo>] < llave-privada.txt");
    console.error("La llave privada entra por la entrada estándar, desde un archivo: con ella se comprueba el sello del respaldo.");
    process.exit(2);
  }
  try {
    // Sirve también en otra máquina, con la credencial de recuperación: necesita llegar al destino, y la llave.
    if (!process.env.RESPALDO_DESTINO) throw new Error("Falta RESPALDO_DESTINO");
    let llave = "";
    for await (const trozo of process.stdin) llave += trozo;
    const de = await versionDe(destinoRclone(process.env.RESPALDO_DESTINO, {}, { sello: claveDeSello(llave) }), identidadDe(llave).publica, args[0]);
    console.log(`${de.objeto} ${de.publicacion} ${de.commit}`);
  } catch (e) {
    console.error((e as Error).message);
    process.exitCode = 1;
  }
}
