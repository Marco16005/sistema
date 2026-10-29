// Plan de conservación: solo lee la historia. Docker y el candado quedan en limpiar.sh.
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { todas, vigente, type Manifiesto, type Conjunto } from "./publicacion.ts";
import { PUBLICACION } from "./destino.ts";

export function conservar(publicaciones: Manifiesto[], actual: string | null): Set<string> {
  const ids = new Set<string>();
  const agregar = (id: string) => {
    if (!publicaciones.some((m) => m.publicacion === id)) throw new Error(`Falta el manifiesto de ${id}: no se limpia.`);
    ids.add(id);
  };
  if (actual) {
    agregar(actual);
    const m = publicaciones.find((p) => p.publicacion === actual)!;
    if (m.anterior) agregar(m.anterior.publicacion);
  }
  // También los dos últimos cierres publicados: una restauración no cambia esta reserva.
  for (const m of publicaciones.filter((p) => p.cierre?.como.startsWith("publicada")).slice(-2)) agregar(m.publicacion);
  for (const m of publicaciones.filter((p) => p.cierre === null)) {
    agregar(m.publicacion);
    if (m.anterior) agregar(m.anterior.publicacion);
  }
  return ids;
}

export async function plan(carpeta: string, proyecto: string, commit: string): Promise<string> {
  if (!/^[a-z0-9][a-z0-9_-]*$/.test(proyecto) || !/^[a-f0-9]{12,40}$/.test(commit)) throw new Error("Proyecto o commit inválido: no se limpia.");
  const publicaciones = await todas(carpeta);
  if (!publicaciones.length) throw new Error("Todavía no hay manifiestos: no se limpia.");
  if (new Set(publicaciones.map((m) => m.instalacion)).size !== 1) throw new Error("Hay manifiestos de distintas instalaciones: no se limpia.");
  const v = await vigente(carpeta);
  const ids = conservar(publicaciones, v?.publicacion ?? null);
  const lineas = new Set<string>([`herramienta ${proyecto}-herramientas:${commit.slice(0, 12)}`]);
  for (const m of publicaciones) {
    if (!PUBLICACION.test(m.publicacion)) throw new Error("Identificador de publicación inválido: no se limpia.");
    // El nombre de hoy no basta para atribuir las etiquetas históricas a esta instalación.
    const conf = JSON.parse(await readFile(join(carpeta, m.candidato.configuracion), "utf8"));
    if (conf.name !== proyecto) throw new Error("El proyecto cambió o la configuración no coincide: no se limpia.");
    if (!ids.has(m.publicacion)) continue;
    if (!/^[a-f0-9]{12,40}$/.test(m.commit)) throw new Error("Commit del manifiesto inválido: no se limpia.");
    lineas.add(`publicacion ${m.publicacion}`);
    lineas.add(`herramienta ${proyecto}-herramientas:${m.commit.slice(0, 12)}`);
    const conjuntos: Conjunto[] = [m.candidato];
    if (!m.cierre && m.anterior) conjuntos.push(m.anterior);
    for (const c of conjuntos) for (const id of Object.values(c.imagenes)) {
      if (!/^sha256:[a-f0-9]{64}$/.test(id)) throw new Error("Huella de imagen inválida: no se limpia.");
      lineas.add(`imagen ${id}`);
    }
  }
  return [...lineas].join("\n");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { console.log(await plan(process.argv[2]!, process.argv[3]!, process.argv[4]!)); }
  catch (e) { console.error((e as Error).message); process.exitCode = 1; }
}
