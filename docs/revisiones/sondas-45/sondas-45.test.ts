// Los guiones de la operación, por dentro: lo que comparten (operacion/pasos.sh) y lo que cada
// uno decide antes de tocar nada. Lo que hacen de principio a fin —con Docker de verdad, matando
// el guion a la mitad— lo prueban los ensayos (operacion/ensayo.sh y ensayo-publicacion.sh); aquí
// se prueba, con un Docker y un Git de mentira, lo que un ensayo no puede provocar: que fallen.
//
// La regla que recorre todo: no poder preguntar no es una respuesta. Si falla el programa que iba a
// decir si la carpeta está limpia, qué huella tiene una configuración o si un migrador sigue vivo,
// el guion se detiene; no contesta «limpia», «iguales» ni «no hay nadie». Codex encontró en su
// décima revisión que varias de esas preguntas, al fallar, se daban por contestadas a favor.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chmod, cp, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const OPERACION = fileURLToPath(new URL("../operacion", import.meta.url));
const MARCA = "11111111-1111-4111-8111-111111111111";

interface Fin { codigo: number | null; salida: string; queja: string }

function correr(orden: string, args: string[], carpeta: string, entorno: NodeJS.ProcessEnv, entrada = ""): Promise<Fin> {
  return new Promise((listo) => {
    // En su propio grupo, para poder terminarlo con todo y lo que haya lanzado: un guion que se quede dando vueltas
    // —es justo lo que algunas de estas pruebas descartan— no debe dejar colgada la batería.
    const hijo = spawn(orden, args, { cwd: carpeta, env: entorno, detached: true });
    let salida = "";
    let queja = "";
    const tope = setTimeout(() => {
      queja += "\n(no terminó en veinte segundos: se le detuvo)";
      try {
        process.kill(-hijo.pid!, "SIGKILL");
      } catch { /* ya no estaba */ }
    }, 20_000);
    hijo.stdout.on("data", (d) => { salida += d; });
    hijo.stderr.on("data", (d) => { queja += d; });
    hijo.on("close", (codigo) => {
      clearTimeout(tope);
      listo({ codigo, salida: salida.trim(), queja: queja.trim() });
    });
    // Un guion que termina sin leer su entrada deja la tubería cerrada, y escribirle da EPIPE. No es
    // de la prueba: lo que el guion hizo lo dicen su salida y su código.
    hijo.stdin.on("error", () => {});
    hijo.stdin.end(entrada);
  });
}

/**
 * Una instalación de mentira: los guiones de verdad, y en lugar de Docker y de Git, dos programas
 * que anotan cómo los llamaron y contestan lo que diga su «caso» —un pedazo de sh que mira "$*"—.
 * Cada anotación de Docker dice además si en ese momento el candado de la instalación tenía dueño.
 */
interface Instalacion {
  carpeta: string;
  /** Corre un guion de la instalación. */
  guion(nombre: string, args?: string[], o?: { entorno?: NodeJS.ProcessEnv; entrada?: string }): Promise<Fin>;
  /** Corre un pedazo de sh con candado.sh y pasos.sh ya incluidos. */
  sh(cuerpo: string, entorno?: NodeJS.ProcessEnv): Promise<Fin>;
  docker(caso: string): Promise<void>;
  git(caso: string): Promise<void>;
  /** Cómo se llamó a Docker, un renglón por llamada: «con candado|sin candado» y los argumentos. */
  llamadas(): Promise<string[]>;
}

const FALSO = (nombre: string): string => `#!/bin/sh
# Anota la llamada y contesta lo que diga el caso.
if [ "${nombre}" = docker ]; then
  if [ -s "$INSTALACION/.operacion.candado" ]; then con="con candado"; else con="sin candado"; fi
  printf '%s %s\\n' "$con" "$*" >> "$INSTALACION/docker.llamadas"
  # Y si le llegó en las manos el candado mismo —el descriptor 9 del guion—: quien lo recibe lo retiene mientras viva.
  if (: >&9) 2>/dev/null; then manos="con el candado en las manos"; else manos="sin el candado en las manos"; fi
  printf '%s: %s\\n' "$manos" "$*" >> "$INSTALACION/docker.manos"
fi
if [ "${nombre}" = docker ] && [ "$*" = "compose config" ]; then echo "name: prueba"; exit 0; fi
. "$INSTALACION/${nombre}.caso"
`;

async function conInstalacion(prueba: (i: Instalacion) => Promise<void>): Promise<void> {
  const carpeta = await mkdtemp(join(tmpdir(), "guiones-"));
  try {
    await cp(OPERACION, join(carpeta, "operacion"), { recursive: true, filter: (de) => !de.includes("/ensayo") });
    await mkdir(join(carpeta, "bin"));
    for (const nombre of ["docker", "git"]) {
      await writeFile(join(carpeta, "bin", nombre), FALSO(nombre));
      await chmod(join(carpeta, "bin", nombre), 0o755);
      await writeFile(join(carpeta, `${nombre}.caso`), "exit 0\n");
    }
    const entornoDe = (mas: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv => ({ ...process.env, PATH: `${join(carpeta, "bin")}:${process.env.PATH}`, INSTALACION: carpeta, ...mas });
    await prueba({
      carpeta,
      guion: (nombre, args = [], o = {}) => correr("sh", [`operacion/${nombre}`, ...args], carpeta, entornoDe(o.entorno), o.entrada),
      sh: (cuerpo, entorno) => correr("sh", ["-c", `set -eu\n. operacion/candado.sh\n. operacion/pasos.sh\n${cuerpo}`], carpeta, entornoDe(entorno)),
      docker: (caso) => writeFile(join(carpeta, "docker.caso"), caso),
      git: (caso) => writeFile(join(carpeta, "git.caso"), caso),
      llamadas: async () => (await readFile(join(carpeta, "docker.llamadas"), "utf8").catch(() => "")).split("\n").filter(Boolean),
    });
  } finally {
    await rm(carpeta, { recursive: true, force: true });
  }
}


// Sondas de revisión: documentan lo que hace el código actual; no son pruebas de aceptación.
async function prepararSonda(i: Instalacion) {
  await i.git('case "$*" in rev-parse*) echo abc123def4567890 ;; esac');
  for (const pub of ["pub1", "pub2"]) {
    await mkdir(join(i.carpeta, "publicaciones", pub), { recursive: true });
    await writeFile(join(i.carpeta, "publicaciones", pub, "conjunto.json"), "{}");
  }
  await i.docker(`case "$*" in
    "image inspect "*) exit 0 ;;
    *"publicacion.ts /publicaciones pendiente") echo pub2 ;;
    *"publicacion.ts /publicaciones dato pub2 commit") echo abc123def4567890 ;;
    *"publicacion.ts /publicaciones dato pub2 anterior.configuracion") echo pub1/conjunto.json ;;
    *"publicacion.ts /publicaciones dato pub2 anterior.publicacion") echo pub1 ;;
    *"publicacion.ts /publicaciones dato pub2 respaldo.nombre") echo previo ;;
    *"publicacion.ts /publicaciones dato pub2 base.marca") echo marca ;;
    *"publicacion.ts /publicaciones dato pub2 numero") echo 2 ;;
    *"pub2/conjunto.json config --hash db") echo "db nueva" ;;
    *"pub1/conjunto.json config --hash db") echo "db vieja" ;;
    *"conjunto.json config") echo "name: prueba" ;;
    *"ps -q --status running db") echo abc123 ;;
    *"operacion.ts estado") exit 1 ;;
  esac`);
}
for (const nombre of ["publicar.sh", "volver.sh"]) {
  test(`R45-02: ${nombre} no repara db corriendo sin SQL, aun sin procesos pendientes`, () => conInstalacion(async (i) => {
    await prepararSonda(i);
    for (let intento = 0; intento < 2; intento++) {
      const r = await i.guion(nombre, nombre === "publicar.sh" ? ["--recuperar"] : [], { entrada: "llave-de-sonda" });
      assert.equal(r.codigo, 1);
      assert.match(r.queja, /La base no contesta: no se puede comprobar que el migrador terminó/);
    }
    const llamadas = await i.llamadas();
    assert.ok(llamadas.some(l => l.endsWith("ps -q --status running db")));
    assert.ok(llamadas.some(l => l.endsWith("operacion.ts estado")));
    assert.ok(!llamadas.some(l => l.endsWith("up -d --wait --no-deps db")));
    console.log(`${nombre}: dos intentos, ambos código 1; ninguna recreación; consulta SQL antes de reparar.`);
  }));
}

for (const nombre of ["publicar.sh", "volver.sh"]) {
  test(`R45-06: ${nombre} recrea antes de esperar si falla preguntar Running`, () => conInstalacion(async (i) => {
    await prepararSonda(i);
    const caso = await readFile(join(i.carpeta, "docker.caso"), "utf8");
    await i.docker(caso
      .replace('*"ps -q --status running db") echo abc123 ;;', '*"ps -q --status running db") exit 1 ;;')
      .replace('*"operacion.ts estado") exit 1 ;;', `*"operacion.ts estado") echo '{"marca":"11111111-1111-4111-8111-111111111111"}' ;;
      *"ps -q --filter label=com.docker.compose.project=prueba --filter label=com.docker.compose.service=comprobacion --filter label=com.docker.compose.oneoff=True") echo restauracion-viva ;;`));
    const r = await i.guion(nombre, nombre === "publicar.sh" ? ["--recuperar"] : [], {
      entrada: "llave-de-sonda", entorno: { ESPERA_DE_LO_QUE_QUEDO: "1" }
    });
    assert.equal(r.codigo, 1);
    assert.match(r.queja, /Lo que dejó corriendo una operación interrumpida no termina/);
    const llamadas = await i.llamadas();
    const arranque = llamadas.findIndex(l => l.endsWith("up -d --wait --no-deps db"));
    const espera = llamadas.findIndex(l => l.includes("ps -q --filter label=com.docker.compose.project=prueba --filter label=com.docker.compose.service=comprobacion"));
    assert.ok(arranque >= 0 && espera > arranque);
    console.log(`${nombre}: fallo de inspección; up db anterior en llamada ${arranque}, búsqueda de restauración viva después en ${espera}.`);
  }));
}
