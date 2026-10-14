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

// ── no poder preguntar no es una respuesta ─────────────────────────────────

test("la carpeta limpia: si Git no contesta no se da por limpia; con cambios, se dice; limpia, se sigue", () =>
  conInstalacion(async (i) => {
    const pide = () => i.sh('exigir_carpeta_limpia "lo que se publica es un commit, entero"\necho limpia');
    await i.git("exit 128");
    const sinGit = await pide();
    assert.equal(sinGit.codigo, 1, "dio por limpia una carpeta de la que no pudo preguntar");
    assert.match(sinGit.queja, /No se pudo comprobar si en esta carpeta hay cambios sin commit/);
    await i.git('echo " M operacion/publicar.sh"');
    const conCambios = await pide();
    assert.equal(conCambios.codigo, 1);
    assert.match(conCambios.queja, /Hay cambios sin commit: lo que se publica es un commit, entero\. No se tocó nada\./);
    await i.git("exit 0");
    assert.deepEqual([(await pide()).codigo, (await pide()).salida], [0, "limpia"]);
  }));

test("la huella de una configuración: si no se pudo leer, dos configuraciones no se dan por iguales", () =>
  conInstalacion(async (i) => {
    const compara = () => i.sh("codigo=0\nmisma_huella una.json otra.json db || codigo=$?\necho \"codigo=$codigo\"");
    // Docker no contesta: no es «iguales» (dos huellas vacías lo serían), es «no se pudo saber».
    await i.docker("exit 1");
    assert.equal((await compara()).salida, "codigo=2");
    // Contesta sin huella —vacío, o solo el nombre del servicio—: tampoco.
    await i.docker("exit 0");
    assert.equal((await compara()).salida, "codigo=2");
    await i.docker("echo db");
    assert.equal((await compara()).salida, "codigo=2");
    // Falla una sola de las dos; o contesta algo, pero falló: lo que dijo no vale.
    await i.docker('case "$*" in *otra.json*) exit 1 ;; *) echo "db aaaa" ;; esac');
    assert.equal((await compara()).salida, "codigo=2");
    await i.docker('echo "db aaaa"; exit 1');
    assert.equal((await compara()).salida, "codigo=2");
    // Y cuando sí contesta: iguales, o distintas.
    await i.docker('echo "db aaaa"');
    assert.equal((await compara()).salida, "codigo=0");
    await i.docker('case "$*" in *otra.json*) echo "db bbbb" ;; *) echo "db aaaa" ;; esac');
    assert.equal((await compara()).salida, "codigo=1");
    assert.equal((await i.sh("huella_de una.json db")).salida, "db aaaa".split(" ")[1]);
  }));

test("lo que quedó corriendo se busca por el proyecto de la configuración guardada, no por el del entorno de hoy; y si no se pudo preguntar, no es «nadie»", () =>
  conInstalacion(async (i) => {
    await i.docker('case "$*" in "compose -f fija.json config") printf "name: el-de-entonces\\nservices: {}\\n" ;; ps*) echo abc123 ;; esac');
    const vivos = await i.sh("de_un_run_vivos fija.json migracion", { COMPOSE_PROJECT_NAME: "el-de-hoy" });
    assert.deepEqual([vivos.codigo, vivos.salida], [0, "abc123"]);
    const ps = (await i.llamadas()).find((l) => l.includes(" ps "))!;
    assert.match(ps, /label=com\.docker\.compose\.project=el-de-entonces /);
    assert.match(ps, /label=com\.docker\.compose\.service=migracion /);
    assert.match(ps, /label=com\.docker\.compose\.oneoff=True/);
    // La configuración no se deja leer, o no dice su nombre: falla, no contesta vacío.
    await i.docker('case "$*" in *config*) exit 1 ;; ps*) echo abc123 ;; esac');
    assert.equal((await i.sh("de_un_run_vivos fija.json migracion && echo nadie")).codigo, 1);
    await i.docker('case "$*" in *config*) echo "services: {}" ;; ps*) echo abc123 ;; esac');
    assert.equal((await i.sh("de_un_run_vivos fija.json migracion && echo nadie")).codigo, 1);
    await i.docker('case "$*" in *config*) echo "name: uno"; exit 1 ;; ps*) echo abc123 ;; esac');
    assert.equal((await i.sh("de_un_run_vivos fija.json migracion && echo nadie")).codigo, 1);
    // Docker no deja listar: tampoco.
    await i.docker('case "$*" in *config*) echo "name: uno" ;; ps*) exit 1 ;; esac');
    assert.equal((await i.sh("de_un_run_vivos fija.json migracion && echo nadie")).codigo, 1);
  }));

test("esperar al migrador: si no se puede preguntar por él, no se da por terminado; si no termina se le detiene; y si no se deja detener, no se sigue", () =>
  conInstalacion(async (i) => {
    // Las esperas no esperan de verdad, y lo que la base dice se pone aquí.
    const esperar = (estado: string, entorno: NodeJS.ProcessEnv = {}) =>
      i.sh(`sleep() { :; }\nestado_de_la_base() { echo '${estado}'; }\nen_la_base() { echo "en la base: $*"; }\nesperar_al_migrador fija.json\necho terminó`, { ESPERA_DEL_MIGRADOR: "3", ...entorno });
    const ABIERTA = JSON.stringify({ base: { marca: MARCA } });

    await i.docker('case "$*" in *config*) echo "name: uno" ;; ps*) exit 1 ;; esac');
    const sinSaber = await esperar(ABIERTA);
    assert.equal(sinSaber.codigo, 1, "dio por terminado un migrador del que no pudo preguntar");
    assert.match(sinSaber.queja, /No se pudo preguntar si el migrador/);
    assert.ok(!sinSaber.salida.includes("terminó"));
    // Tampoco si solo falla la pregunta por los que no están corriendo: uno creado sin arrancar también cuenta.
    await i.docker('case "$*" in *config*) echo "name: uno" ;; "ps -aq "*) exit 1 ;; esac');
    const sinSaberDeLosQuietos = await esperar(ABIERTA);
    assert.equal(sinSaberDeLosQuietos.codigo, 1, "dio por terminado sin poder preguntar por los migradores que no corren");
    assert.match(sinSaberDeLosQuietos.queja, /No se pudo preguntar si el migrador/);

    // Sigue vivo dos veces y termina solo: se le espera, y después se mira su sesión en la base.
    await i.docker(`case "$*" in *config*) echo "name: uno" ;; "ps -q "*) n=$(cat "$INSTALACION/veces" 2>/dev/null || echo 0); echo $((n + 1)) > "$INSTALACION/veces"; [ "$n" -ge 2 ] || echo abc123 ;; esac`);
    const termino = await esperar(ABIERTA);
    assert.equal(termino.codigo, 0, termino.queja);
    assert.match(termino.salida, /El migrador de la operación interrumpida sigue corriendo: se le espera\.\nen la base: fija\.json migrador 3\nterminó/);
    assert.ok(!(await i.llamadas()).some((l) => l.includes(" kill ")), "detuvo a un migrador que terminó a tiempo");

    // No termina: al plazo se le detiene. Aquí no se deja, y entonces no se sigue —ni se queda esperando para siempre—.
    await i.docker('case "$*" in *config*) echo "name: uno" ;; "ps -q "*) echo abc123 ;; kill*) exit 1 ;; esac');
    const terco = await esperar(ABIERTA);
    assert.equal(terco.codigo, 1);
    assert.match(terco.salida, /El migrador no terminó a tiempo: se le detiene\./);
    assert.match(terco.queja, /sigue ahí y no se le pudo detener ni quitar\. No se sigue\./);
    assert.ok((await i.llamadas()).some((l) => / kill abc123$/.test(l)));

    // Ya no está. Sin base todavía —una primera publicación— no hay sesión que mirar; con la base sin contestar, no se sigue.
    await i.docker('case "$*" in *config*) echo "name: uno" ;; esac');
    assert.equal((await esperar('{"base":"no hay"}')).salida, "terminó");
    const callada = await esperar("no-contesta");
    assert.equal(callada.codigo, 1);
    assert.match(callada.queja, /La base no contesta/);
  }));

test("un migrador creado que no llegó a arrancar —o que ya terminó— no se deja ahí: quien retoma lo quita, comprueba que ya no está, y si no se deja quitar no sigue", () =>
  conInstalacion(async (i) => {
    // Lo encontró Codex al verificar su décima revisión: quien retomaba miraba solo lo que corría. Un migrador
    // creado y todavía sin arrancar no se veía, y podía arrancar después, sobre la base que el otro ya había movido.
    const esperar = () =>
      i.sh(`sleep() { :; }\nestado_de_la_base() { echo '{"base":"no hay"}'; }\nesperar_al_migrador fija.json\necho terminó`, { ESPERA_DEL_MIGRADOR: "3" });
    await i.docker(`case "$*" in *config*) echo "name: uno" ;; "ps -aq "*) [ -e "$INSTALACION/quitado" ] || echo def456 ;; "rm def456") : > "$INSTALACION/quitado" ;; esac`);
    const quito = await esperar();
    assert.deepEqual([quito.codigo, quito.salida], [0, "terminó"], quito.queja);
    const llamadas = await i.llamadas();
    // Los busca en el mismo conjunto y servicio, sueltos, en cualquier estado que no sea corriendo.
    const pregunta = llamadas.find((l) => l.includes(" ps -aq "))!;
    assert.match(pregunta, /label=com\.docker\.compose\.project=uno /);
    assert.match(pregunta, /label=com\.docker\.compose\.service=migracion /);
    assert.match(pregunta, /label=com\.docker\.compose\.oneoff=True /);
    assert.match(pregunta, /--filter status=created --filter status=exited --filter status=dead$/);
    assert.ok(llamadas.some((l) => l.endsWith(" rm def456")), "no quitó al migrador que quedó creado sin arrancar");
    // Y después de quitarlo vuelve a preguntar: que «rm» no se queje no es que ya no esté.
    assert.ok(llamadas.findLastIndex((l) => l.includes(" ps -aq ")) > llamadas.findIndex((l) => l.endsWith(" rm def456")), "no comprobó que ya no estaba");
    assert.ok(!llamadas.some((l) => l.includes(" kill ")), "a uno que no corre no se le detiene: se le quita");

    // No se deja quitar: no se sigue, y no se queda dando vueltas.
    await i.docker('case "$*" in *config*) echo "name: uno" ;; "ps -aq "*) echo def456 ;; rm*) exit 1 ;; esac');
    const pegado = await esperar();
    assert.equal(pegado.codigo, 1, "siguió con un migrador creado que no pudo quitar");
    assert.match(pegado.queja, /sigue ahí y no se le pudo detener ni quitar\. No se sigue\./);
    assert.ok(!pegado.salida.includes("terminó"));
  }));

test("el migrador se crea y arranca con el candado en las manos, y se le sigue ya sin él: quien retoma lo encuentra creado, o ya no lo va a haber", () =>
  conInstalacion(async (i) => {
    // Lo encontró Codex al verificar su décima revisión: el migrador se lanzaba sin el candado, y un cliente de Docker
    // detenido antes de crear el contenedor podía crearlo después de que otro tomara el candado y no viera a nadie.
    const migrar = () => i.sh('tomar_candado prueba\ntrap soltar_candado EXIT\ncodigo=0\nmigrar_con fija.json || codigo=$?\necho "codigo=$codigo"');
    const manos = async () => (await readFile(join(i.carpeta, "docker.manos"), "utf8")).split("\n").filter(Boolean);
    await i.docker('case "$*" in *" run -d "*) echo abc123 ;; "logs "*) echo "aplicada 0029" ;; "wait "*) echo 0 ;; esac');
    const bien = await migrar();
    assert.deepEqual([bien.codigo, bien.salida], [0, "aplicada 0029\ncodigo=0"], bien.queja);
    const llamadas = (await i.llamadas()).map((l) => l.replace(/^(con|sin) candado /, ""));
    assert.equal(llamadas.length, 4, llamadas.join("\n"));
    assert.match(llamadas[0]!, /^compose -f fija\.json run -d --no-deps -T -e OPERACION_TURNO=\S+ migracion$/);
    assert.deepEqual(llamadas.slice(1), ["logs -f abc123", "wait abc123", "rm abc123"]);
    // Crear y arrancar, con el candado en las manos: mientras ese cliente viva, nadie más entra. Seguirlo, sin él:
    // un migrador que se queda esperando en la base no debe impedir que quien retoma entre a detenerlo.
    assert.deepEqual((await manos()).map((l) => l.replace(/:.*$/, "")), [
      "con el candado en las manos", "sin el candado en las manos", "sin el candado en las manos", "sin el candado en las manos",
    ]);

    // El migrador falla: se dice, con su código.
    await i.docker('case "$*" in *" run -d "*) echo abc123 ;; "wait "*) echo 3 ;; esac');
    assert.equal((await migrar()).salida, "codigo=3");
    // No se pudo crear: falla, y no se sigue a nadie.
    await rm(join(i.carpeta, "docker.llamadas"));
    await i.docker('case "$*" in *" run -d "*) exit 1 ;; esac');
    assert.equal((await migrar()).salida, "codigo=1");
    assert.equal((await i.llamadas()).length, 1, "siguió a un migrador que no se creó");
    // Docker no dijo cuál creó: no se da por migrado, ni se sigue a nadie.
    await rm(join(i.carpeta, "docker.llamadas"));
    await i.docker("exit 0");
    assert.equal((await migrar()).salida, "codigo=1");
    assert.ok(!(await i.llamadas()).some((l) => / (logs|wait|rm) /.test(l)), "siguió a un migrador del que no supo cuál era");
    // No se pudo preguntar cómo terminó, o no contestó un número: no poder preguntar no es «terminó bien».
    await i.docker('case "$*" in *" run -d "*) echo abc123 ;; "wait "*) exit 1 ;; esac');
    assert.equal((await migrar()).salida, "codigo=1");
    await i.docker('case "$*" in *" run -d "*) echo abc123 ;; "wait "*) echo ;; esac');
    assert.equal((await migrar()).salida, "codigo=1");
  }));

test("lo demás que quedó corriendo —una restauración, un respaldo, una consulta— se espera, sin detenerlo; y si no termina, se dice", () =>
  conInstalacion(async (i) => {
    const esperar = () => i.sh("sleep() { :; }\nesperar_lo_que_quedo fija.json\necho terminó", { ESPERA_DE_LO_QUE_QUEDO: "4" });
    await i.docker(`case "$*" in *config*) echo "name: uno" ;; ps*service=comprobacion*) n=$(cat "$INSTALACION/veces" 2>/dev/null || echo 0); echo $((n + 1)) > "$INSTALACION/veces"; [ "$n" -ge 2 ] || echo abc123 ;; esac`);
    const espero = await esperar();
    assert.equal(espero.codigo, 0, espero.queja);
    assert.match(espero.salida, /Sigue corriendo algo que dejó una operación interrumpida.*\nterminó/s);
    const vistas = (await i.llamadas()).filter((l) => l.includes(" ps "));
    assert.ok(vistas.some((l) => l.includes("service=comprobacion")) && vistas.some((l) => l.includes("service=respaldo")), "no miró los dos servicios");
    assert.ok(!(await i.llamadas()).some((l) => l.includes(" kill ")), "detuvo una restauración que seguía corriendo");
    // No termina: se dice, y no se sigue.
    await i.docker('case "$*" in *config*) echo "name: uno" ;; ps*service=respaldo*) echo abc123 ;; esac');
    const nunca = await esperar();
    assert.equal(nunca.codigo, 1);
    assert.match(nunca.queja, /no termina/);
    // No se pudo preguntar: tampoco.
    await i.docker('case "$*" in *config*) echo "name: uno" ;; ps*) exit 1 ;; esac');
    assert.equal((await esperar()).codigo, 1);
  }));

// ── lo que se construye, y dónde se trabaja ────────────────────────────────

test("una imagen se construye de una copia del commit —no de la carpeta—; si la copia no se pudo sacar, no se construye nada", () =>
  conInstalacion(async (i) => {
    await i.git('case "$*" in archive*) for a in "$@"; do ruta=$a; done; printf "%s\\n" "$*" > "$INSTALACION/git.llamada"; printf tar > "$INSTALACION/exportado" ;; esac');
    await i.docker('case "$*" in build*) cat > "$INSTALACION/contexto" ;; esac');
    const bien = await i.sh("construir_del_commit abc123 feruga-web:1 web.Dockerfile web && echo construida");
    assert.deepEqual([bien.codigo, bien.salida], [0, "construida"]);
    assert.match(await readFile(join(i.carpeta, "git.llamada"), "utf8"), /^archive --format=tar -o \S+ abc123$/m);
    const construir = (await i.llamadas()).find((l) => l.includes(" build "))!;
    // El contexto es lo que llega por la entrada —la copia del commit—, no «.»: la carpeta.
    assert.match(construir, / build -q -f docker\/web\.Dockerfile --target web -t feruga-web:1 -$/);
    // Sin etapa, no se pide ninguna.
    await i.sh("construir_del_commit abc123 feruga-respaldo:1 respaldo.Dockerfile");
    assert.match((await i.llamadas()).at(-1)!, / build -q -f docker\/respaldo\.Dockerfile -t feruga-respaldo:1 -$/);
    // Git no pudo sacar la copia: no se llama a construir, y falla.
    const antes = (await i.llamadas()).length;
    await i.git("exit 128");
    assert.equal((await i.sh("construir_del_commit abc123 feruga-web:1 web.Dockerfile web && echo construida")).codigo, 1);
    assert.equal((await i.llamadas()).length, antes, "construyó sin la copia del commit");
    // Construir falla: se dice.
    await i.git("exit 0");
    await i.docker("exit 1");
    assert.equal((await i.sh("construir_del_commit abc123 feruga-web:1 web.Dockerfile web && echo construida")).codigo, 1);
  }));

test("la imagen de la base de datos se lee del commit que se publica, no de la carpeta: cambiar el archivo después de comprobar que estaba limpia no cambia qué se publica", () =>
  conInstalacion(async (i) => {
    // Lo encontró Codex al verificar su décima revisión: las otras cuatro imágenes ya salían del commit; esta se leía de la carpeta.
    const DEL_COMMIT = `postgres@sha256:${"a".repeat(64)}`;
    await mkdir(join(i.carpeta, "docker"));
    await writeFile(join(i.carpeta, "docker", "db.Dockerfile"), `FROM postgres@sha256:${"b".repeat(64)}\n`);
    await i.git(`case "$*" in "show abc123:docker/db.Dockerfile") printf '# la base\\nFROM ${DEL_COMMIT} AS db\\n' ;; *) exit 1 ;; esac`);
    const lee = () => i.sh('codigo=0\nimagen=$(imagen_de_la_base abc123) || codigo=$?\necho "$codigo $imagen"');
    assert.equal((await lee()).salida, `0 ${DEL_COMMIT}`);
    // Git no contesta: no se cae a leer la carpeta.
    await i.git("exit 128");
    assert.equal((await lee()).salida, "1");
    // El commit no la nombra por su huella: tampoco sirve.
    await i.git("printf 'FROM postgres:17\\n'");
    assert.equal((await lee()).salida, "2");
    // Y publicar la pide así, del commit que publica; no vuelve a leer el archivo de la carpeta.
    const publicar = (await readFile(join(OPERACION, "publicar.sh"), "utf8")).split("\n").filter((l) => !l.trim().startsWith("#")).join("\n");
    assert.match(publicar, /base_de_datos=\$\(imagen_de_la_base "\$commit"\)/);
    assert.ok(!/docker\/db\.Dockerfile/.test(publicar.replace(/falla "[^"]*"/g, "")), "publicar.sh todavía lee docker/db.Dockerfile de la carpeta");
  }));

test("la carpeta de trabajo es de la instalación, privada, y empieza vacía: lo que dejó una operación que murió sin limpiar se quita al entrar", () =>
  conInstalacion(async (i) => {
    await mkdir(join(i.carpeta, ".operacion.trabajo"));
    await writeFile(join(i.carpeta, ".operacion.trabajo", "conjunto.json"), "con claves");
    assert.equal((await i.sh("preparar_trabajo")).codigo, 0);
    assert.deepEqual(await readdir(join(i.carpeta, ".operacion.trabajo")), []);
    assert.equal((await stat(join(i.carpeta, ".operacion.trabajo"))).mode & 0o777, 0o700);
  }));

test("la carpeta de publicaciones se manda a disco con su nombre una vez por operación, exista ya o no; y si no se pudo, no se da por lista", () =>
  conInstalacion(async (i) => {
    // Lo encontró Codex al verificar: que la carpeta ya exista no dice que se haya alcanzado a asegurar al crearla.
    const SYNC = 'sync() { echo sync >> "$INSTALACION/sync.llamadas"; }';
    const veces = async (): Promise<number> => (await readFile(join(i.carpeta, "sync.llamadas"), "utf8").catch(() => "")).split("\n").filter(Boolean).length;
    // La primera operación la crea y la asegura; dentro de la misma operación, no otra vez.
    assert.equal((await i.sh(`${SYNC}\nasegurar_publicaciones && asegurar_publicaciones && echo lista`)).salida, "lista");
    assert.equal((await stat(join(i.carpeta, "publicaciones"))).mode & 0o777, 0o700);
    assert.equal(await veces(), 1);
    // La operación que sigue la vuelve a asegurar, aunque ya exista.
    assert.equal((await i.sh(`${SYNC}\nasegurar_publicaciones && echo lista`)).salida, "lista");
    assert.equal(await veces(), 2, "con la carpeta ya creada, no se volvió a asegurar");
    // Si no se pudo mandar a disco, no se da por lista; y dentro de la misma operación se vuelve a intentar.
    const falla = await i.sh('n=0\nsync() { n=$((n + 1)); [ "$n" -gt 1 ]; }\nasegurar_publicaciones && echo "lista a la primera"\nasegurar_publicaciones && echo "lista a la segunda: $n"');
    assert.equal(falla.salida, "lista a la segunda: 2");
    // Preparar las herramientas la deja asegurada para todo lo que la operación pregunte después.
    await i.git('case "$*" in rev-parse*) echo abc123def4567890 ;; esac');
    const antes = await veces();
    assert.equal((await i.sh(`${SYNC}\npreparar_herramientas\nx=$(manifiesto pendiente)\ny=$(manifiesto vigente)\necho lista`)).salida, "lista");
    assert.equal(await veces(), antes + 1, "cada pregunta al manifiesto volvió a sincronizar el disco entero");
  }));

// ── qué corre ──────────────────────────────────────────────────────────────

test("comprobar qué corre mira TODOS los contenedores de la instalación y pide que no haya nada más; el paso que no puede pedirlo lo dice aparte; y si no se pudo listar, no pasa", () =>
  conInstalacion(async (i) => {
    const CASO = 'case "$*" in *"config --hash"*) for s in "$@"; do :; done; echo "$s huella-de-$s" ;; "compose -f fija.json ps -a -q") echo c1; echo c2; echo c3 ;; "compose -f fija.json ps -a -q "*) echo c1 ;; inspect*) echo "[{\\"Id\\":\\"$2\\"}]" ;; esac';
    await i.docker(CASO);
    const corre = (orden: string, entorno: NodeJS.ProcessEnv = {}) =>
      i.sh(`manifiesto_con_entrada() { printf 'orden: %s\\n' "$*"; cat; }\n${orden} pub1 candidato fija.json db web`, entorno);
    const completo = await corre("corre");
    assert.equal(completo.codigo, 0, completo.queja);
    assert.match(completo.salida, /^orden: corre pub1 candidato --nada-mas db=huella-de-db web=huella-de-web$/m);
    assert.ok((await i.llamadas()).some((l) => l.endsWith(" inspect c1 c2 c3")), "no miró todos los contenedores de la instalación");
    // En operación no se declara nada «de fuera»; en un ensayo, lo que el ensayo diga.
    assert.ok(!completo.salida.includes("--de-fuera"));
    assert.ok(!(await corre("corre", { ENSAYO_DE_FUERA: "almacen" })).salida.includes("--de-fuera"), "fuera de un ensayo se aceptó algo de fuera");
    assert.match((await corre("corre", { ENSAYO: "1", ENSAYO_DE_FUERA: "almacen,vigia" })).salida, /--nada-mas --de-fuera=almacen,vigia db=/);
    // El paso intermedio: solo esos servicios, y sin pedir que no haya nada más.
    const parte = await corre("corre_al_menos");
    assert.match(parte.salida, /^orden: corre pub1 candidato db=huella-de-db web=huella-de-web$/m);
    assert.ok((await i.llamadas()).at(-1)!.endsWith(" inspect c1"));
    // No se pudo listar, o no se pudo leer una huella: no se comprobó nada, y eso no es «todo bien».
    await i.docker('case "$*" in *"config --hash"*) echo "db h" ;; *"ps -a -q"*) exit 1 ;; esac');
    assert.equal((await corre("corre")).codigo, 1);
    assert.equal((await corre("corre_al_menos")).codigo, 1);
    await i.docker('case "$*" in *"config --hash"*) exit 1 ;; *"ps -a -q"*) echo c1 ;; inspect*) echo "[]" ;; esac');
    assert.equal((await corre("corre")).codigo, 1);
  }));

// ── cada guion, antes de tocar nada ────────────────────────────────────────

/** Un Docker de mentira que contesta como una instalación con una publicación vigente. */
const VIGENTE = (mas = ""): string => `case "$*" in
  ${mas}
  "image inspect "*) exit 0 ;;
  *" run -d "*) echo abc123 ;;
  "wait "*) echo 0 ;;
  *"publicacion.ts /publicaciones pendiente") ;;
  *"publicacion.ts /publicaciones vigente") echo pub1 ;;
  *"publicacion.ts /publicaciones vigente configuracion") echo pub1/conjunto.json ;;
  *"publicacion.ts /publicaciones vigente marca") echo ${MARCA} ;;
  *"publicacion.ts /publicaciones vigente commit") echo abc123 ;;
esac`;

test("el Compose de lo publicado: consultar pasa siempre; correr algo suelto pide el candado y que no haya nada pendiente; lo que cambia qué corre no pasa por ahí", () =>
  conInstalacion(async (i) => {
    await i.git('case "$*" in rev-parse*) echo abc123def4567890 ;; esac');
    await i.docker(VIGENTE());
    for (const orden of [["up", "-d"], ["down"], ["stop", "web"], ["start", "web"], ["restart", "web"], ["rm", "-f", "web"], ["kill", "web"], ["build"], ["pull"]]) {
      const fin = await i.guion("compose.sh", orden);
      assert.equal(fin.codigo, 1, `aceptó «${orden.join(" ")}»`);
      assert.match(fin.queja, /cambia lo que corre.*operacion\/levantar\.sh.*operacion\/publicar\.sh/s);
    }
    assert.deepEqual(await i.llamadas(), [], "una orden rechazada llegó a llamar a Docker");
    assert.equal((await i.guion("compose.sh")).codigo, 1);

    // Consultar: sin candado, sobre la configuración de lo publicado.
    assert.equal((await i.guion("compose.sh", ["ps", "-a"])).codigo, 0);
    assert.equal((await i.llamadas()).at(-1), "sin candado compose -f publicaciones/pub1/conjunto.json ps -a");

    // Correr algo suelto: con el candado tomado mientras corre, y suelto al terminar.
    const consola = await i.guion("compose.sh", ["run", "--rm", "consola", "persona", "lista"]);
    assert.equal(consola.codigo, 0, consola.queja);
    assert.equal((await i.llamadas()).at(-1), "con candado compose -f publicaciones/pub1/conjunto.json run --rm consola persona lista");
    assert.equal(await readFile(join(i.carpeta, ".operacion.candado"), "utf8"), "");
    // Lo que corrió falla: se dice con su mismo código, y el candado se suelta igual.
    await i.docker(VIGENTE('"compose -f publicaciones/pub1/conjunto.json run"*) exit 7 ;;'));
    assert.equal((await i.guion("compose.sh", ["run", "--rm", "consola", "x"])).codigo, 7);
    assert.equal(await readFile(join(i.carpeta, ".operacion.candado"), "utf8"), "");
    // Con una publicación sin cerrar no corre nada suelto; consultar sí.
    await i.docker(VIGENTE('*"publicacion.ts /publicaciones pendiente") echo pub2 ;;'));
    const pendiente = await i.guion("compose.sh", ["exec", "db", "psql"]);
    assert.equal(pendiente.codigo, 1);
    assert.match(pendiente.queja, /Hay una publicación sin cerrar \(pub2\)/);
    assert.ok(!(await i.llamadas()).some((l) => l.includes(" exec db psql")));
    assert.equal((await i.guion("compose.sh", ["logs", "web"])).codigo, 0);

    // Desacoplado no (lo encontró Codex al verificar su décima revisión): el cliente vuelve enseguida, el candado se
    // suelta, y lo lanzado sigue corriendo sin él. Tampoco pegado a otras opciones, ni detrás de una que lleva valor.
    await i.docker(VIGENTE());
    await rm(join(i.carpeta, "docker.llamadas"));
    for (const orden of [
      ["run", "-d", "--rm", "consola", "x"], ["run", "--rm", "--detach", "consola", "x"], ["run", "--detach=true", "consola"], ["run", "-dT", "consola"],
      ["run", "-Td", "consola"], ["run", "-e", "A=1", "-d", "consola"], ["exec", "-d", "db", "psql"], ["exec", "-T", "--detach", "db", "psql"],
    ]) {
      const fin = await i.guion("compose.sh", orden);
      assert.equal(fin.codigo, 1, `aceptó «${orden.join(" ")}»`);
      assert.match(fin.queja, /desacoplado/, orden.join(" "));
    }
    // Una opción que este guion no conoce tampoco pasa —podría ser otra forma de lo mismo—, ni una orden sin servicio.
    const rara = await i.guion("compose.sh", ["run", "--opcion-nueva", "consola"]);
    assert.equal(rara.codigo, 1);
    assert.match(rara.queja, /no conoce la opción «--opcion-nueva»/);
    assert.equal((await i.guion("compose.sh", ["run", "--rm", "-e"])).codigo, 1);
    assert.equal((await i.guion("compose.sh", ["exec", "-T"])).codigo, 1);
    assert.deepEqual(await i.llamadas(), [], "una orden rechazada por sus opciones llegó a llamar a Docker");
    // Lo que va después del servicio es de lo que se corre, no de Compose: ahí «-d» es suyo, y pasa.
    const suyo = await i.guion("compose.sh", ["exec", "-T", "-e", "PGUSER=feruga", "db", "psql", "-d", "feruga"]);
    assert.equal(suyo.codigo, 0, suyo.queja);
    assert.equal((await i.llamadas()).at(-1), "con candado compose -f publicaciones/pub1/conjunto.json exec -T -e PGUSER=feruga db psql -d feruga");
    // Y las opciones de todos los días siguen pasando.
    for (const orden of [
      ["run", "--rm", "--no-deps", "-T", "-e", "NODE_EXTRA_CA_CERTS", "respaldo", "ahora"], ["run", "--rm", "--entrypoint", "node", "comprobacion", "x.ts"],
      ["run", "--rm", "-iT", "--user=0", "consola"], ["exec", "--index", "1", "-w", "/tmp", "web", "ls"],
    ]) {
      const fin = await i.guion("compose.sh", orden);
      assert.equal(fin.codigo, 0, `rechazó «${orden.join(" ")}»: ${fin.queja}`);
      assert.ok((await i.llamadas()).at(-1)!.endsWith(orden.join(" ")));
    }
  }));

test("migrar a mano toma el candado ANTES de mirar cuál es el conjunto vigente; revisar no lo pide", () =>
  conInstalacion(async (i) => {
    await i.git('case "$*" in rev-parse*) echo abc123def4567890 ;; esac');
    await i.docker(VIGENTE());
    const fin = await i.guion("migrar.sh");
    assert.equal(fin.codigo, 0, fin.queja);
    const llamadas = await i.llamadas();
    const mira = llamadas.find((l) => l.endsWith("publicacion.ts /publicaciones vigente configuracion"))!;
    assert.ok(mira.startsWith("con candado "), `miró el conjunto vigente sin el candado: ${mira}`);
    // Y el migrador que corre es el de ese conjunto, con el turno de quien tiene el candado.
    const migra = llamadas.find((l) => l.includes(" run ") && l.endsWith(" migracion"))!;
    assert.match(migra, /^con candado compose -f publicaciones\/pub1\/conjunto\.json run -d --no-deps -T -e OPERACION_TURNO=\S+ migracion$/);
    assert.equal(await readFile(join(i.carpeta, ".operacion.candado"), "utf8"), "");
    // Todo lo que el guion lanza retiene el candado hasta terminar —también quien crea y arranca al migrador—.
    const manos = (await readFile(join(i.carpeta, "docker.manos"), "utf8")).split("\n").filter(Boolean);
    assert.ok(manos.find((l) => l.endsWith(" migracion"))!.startsWith("con el candado en las manos: "), "el migrador se creó sin el candado en las manos");
    assert.ok(manos.find((l) => l.endsWith("publicacion.ts /publicaciones pendiente"))!.startsWith("con el candado en las manos: "), "lo demás no retiene el candado");

    await rm(join(i.carpeta, "docker.llamadas"));
    assert.equal((await i.guion("migrar.sh", ["--revisar"])).codigo, 0);
    assert.ok((await i.llamadas()).every((l) => l.startsWith("sin candado ")), "revisar pidió el candado");
    assert.ok((await i.llamadas()).at(-1)!.endsWith("migracion node db/migrar.ts --revisar"));
  }));

test("abrir después de volver al respaldo: si ya había abierto —se repite porque antes no terminó—, no basta con decirlo; se repone el servicio de respaldo y se comprueba", () =>
  conInstalacion(async (i) => {
    await i.git('case "$*" in rev-parse*) echo abc123def4567890 ;; esac');
    const ABIERTA = `*"operacion.ts estado abierta") echo true ;;
  *"config --hash"*) for s in "$@"; do :; done; echo "$s h" ;;`;
    await i.docker(VIGENTE(ABIERTA));
    const fin = await i.guion("volver.sh", ["--abrir"]);
    assert.equal(fin.codigo, 0, fin.queja);
    assert.match(fin.salida, /ya estaba abierta: se termina lo que faltaba/);
    const llamadas = await i.llamadas();
    const levanta = llamadas.findIndex((l) => l.endsWith("up -d --wait --no-deps respaldo"));
    const comprueba = llamadas.findIndex((l) => / corre pub1 candidato --nada-mas db=h web=h proxy=h respaldo=h$/.test(l));
    const porHttps = llamadas.findIndex((l) => l.includes(" comprobacion https proxy --abierta --version=pub1 "));
    assert.ok(levanta >= 0, "dijo que ya estaba abierta y no levantó el servicio de respaldo");
    assert.ok(comprueba > levanta && porHttps > comprueba, "no comprobó, después de reponer el respaldo, qué corre y qué dice el sitio");
    // No volvió a decidir ni a abrir: eso ya estaba.
    assert.ok(!llamadas.some((l) => / operacion\.ts (decidir|abrir) /.test(l)));
    // Y si el servicio de respaldo no arranca, no dice que todo quedó bien.
    await i.docker(VIGENTE(`${ABIERTA}\n  *"up -d --wait --no-deps respaldo") exit 1 ;;`));
    const mal = await i.guion("volver.sh", ["--abrir"]);
    assert.equal(mal.codigo, 1);
    assert.match(mal.queja, /el servicio de respaldo no arrancó/);
  }));

test("si no se puede leer el manifiesto o preguntar a la base, los guiones no siguen con un dato vacío", () =>
  conInstalacion(async (i) => {
    await i.git('case "$*" in rev-parse*) echo abc123def4567890 ;; esac');
    // Abrir: la base no contesta qué es. No se abre, ni se dice que ya estaba abierta.
    await i.docker(VIGENTE('*"operacion.ts estado abierta") exit 1 ;;'));
    const sinBase = await i.guion("volver.sh", ["--abrir"]);
    assert.equal(sinBase.codigo, 1);
    assert.match(sinBase.queja, /No se pudo preguntar a la base si la operación está abierta/);
    assert.ok(!(await i.llamadas()).some((l) => l.includes(" up ")));
    // Levantar: no se pudo leer de qué commit es lo publicado.
    await i.docker(VIGENTE('*"publicacion.ts /publicaciones vigente commit") exit 1 ;;'));
    const sinCommit = await i.guion("levantar.sh");
    assert.equal(sinCommit.codigo, 1);
    assert.match(sinCommit.queja, /No se pudo leer de qué commit es lo publicado/);
    // Publicar: Git no dice si hay cambios sueltos.
    await i.docker(VIGENTE());
    await i.git('case "$*" in rev-parse*) echo abc123def4567890 ;; status*) exit 128 ;; esac');
    const sinGit = await i.guion("publicar.sh");
    assert.equal(sinGit.codigo, 1);
    assert.match(sinGit.queja, /No se pudo comprobar si en esta carpeta hay cambios sin commit/);
    assert.ok(!(await i.llamadas()).some((l) => l.includes(" build ")), "construyó sin saber si la carpeta estaba limpia");
  }));

// ── lo que se ve leyendo los guiones ───────────────────────────────────────

test("la llave privada no se escribe en ningún archivo: entra por la entrada estándar, se queda en la memoria del guion, y de ahí pasa a quien restaura", async () => {
  for (const guion of ["publicar.sh", "volver.sh"]) {
    const texto = await readFile(join(OPERACION, guion), "utf8");
    const lineas = texto.split("\n").filter((l) => !/^\s*#/.test(l));
    assert.ok(lineas.some((l) => /^\s*llave=\$\(cat\)/.test(l)), `${guion}: la llave no se lee de la entrada estándar a una variable`);
    assert.ok(lineas.some((l) => /printf '%s\\n' "\$llave" \| docker compose .*restaurar\.ts/.test(l)), `${guion}: la llave no pasa directo a quien restaura`);
    for (const linea of lineas) {
      assert.doesNotMatch(linea, />>?\s*"?\$[A-Za-z_{}]+\/[^"\s]*llave/, `${guion}: algo se escribe a un archivo de la llave: ${linea.trim()}`);
      assert.doesNotMatch(linea, /^\s*cat\s*>\s*[^&\s]/, `${guion}: la entrada estándar se copia a un archivo: ${linea.trim()}`);
      assert.doesNotMatch(linea, /<\s*"?\$privado\/llave/, `${guion}: la llave se lee de un archivo: ${linea.trim()}`);
      if (/\$llave/.test(linea)) assert.match(linea, /printf '%s\\n' "\$llave" \||\[ -n "\$llave" \]/, `${guion}: la llave se usa en otra cosa: ${linea.trim()}`);
    }
  }
});

test("todo guion que cambia algo toma el candado antes de leer el manifiesto, y trabaja en la carpeta de la instalación, no en la temporal de la máquina", async () => {
  for (const guion of ["publicar.sh", "volver.sh", "levantar.sh"]) {
    const lineas = (await readFile(join(OPERACION, guion), "utf8")).split("\n");
    const sinFunciones = lineas.map((l, k) => [l, k] as const).filter(([l]) => /^[a-z_]/.test(l));
    const toma = sinFunciones.find(([l]) => l.startsWith("tomar_candado "))?.[1];
    const lee = sinFunciones.find(([l]) => /^(preparar_herramientas|[a-z_]+=\$\(manifiesto )/.test(l))?.[1];
    assert.ok(toma !== undefined && lee !== undefined && toma < lee, `${guion}: lee el manifiesto antes de tomar el candado`);
  }
  for (const guion of ["publicar.sh", "volver.sh", "levantar.sh", "migrar.sh", "compose.sh", "pasos.sh"]) {
    const texto = (await readFile(join(OPERACION, guion), "utf8")).split("\n").filter((l) => !/^\s*#/.test(l)).join("\n");
    assert.doesNotMatch(texto, /mktemp -d/, `${guion}: usa una carpeta temporal de la máquina para lo que lleva claves`);
  }
});
