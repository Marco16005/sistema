// El candado de la instalación. Publicar, recuperar, levantar, volver y migrar a mano lo piden por
// igual: dos operaciones a la vez no entran, lleguen como lleguen.
//
// Es un candado del sistema operativo sobre un archivo que el guion tiene abierto mientras trabaja.
// No hay «relevo» que hacer ni proceso que averiguar si sigue vivo: si el guion muere —se le mató,
// se apagó la máquina—, el sistema lo suelta en ese instante. Y mientras siga trabajando algo que
// ese guion dejó lanzado, sigue tomado: nadie entra a operar junto a un migrador huérfano.
//
// (Antes era una carpeta con un protocolo de relevo. Codex encontró en su décima revisión que un
// relevo atrasado podía pisar el candado de un dueño nuevo y vivo, que morir a medio relevo lo
// dejaba trabado para siempre, y que un fallo al anotar al dueño concedía la entrada.)
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readdir, readFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const BIBLIOTECA = fileURLToPath(new URL("../operacion/candado.sh", import.meta.url));
const CANDADO = ".operacion.candado";

/**
 * Un guion que toma el candado, dice «tomado», y lo tiene esos segundos. Si no lo consigue, sale
 * con 3. La limpieza va puesta desde antes de pedirlo: también la corre quien no lo consiguió.
 * La espera no se lleva el candado (9>&-): si al guion se le mata, no queda nadie con él.
 */
const TITULAR = `
set -eu
. "${BIBLIOTECA}"
trap soltar_candado EXIT
tomar_candado "$1" || exit 3
echo tomado
sleep "$2" >/dev/null 2>&1 9>&- &
wait $!
`;
/** Igual, pero deja trabajando algo suyo —que sí se lleva el candado— esos segundos, y se queda esperando mucho más. */
const CON_ALGO_LANZADO = `
set -eu
. "${BIBLIOTECA}"
tomar_candado "$1" || exit 3
sleep "$2" >/dev/null 2>&1 &
echo tomado
sleep 60 >/dev/null 2>&1 9>&- &
wait $!
`;

interface Corrida {
  pid: number;
  /** Se resuelve cuando dijo «tomado». Si termina sin decirlo, falla. */
  tomado: Promise<void>;
  fin: Promise<{ codigo: number | null; salida: string; queja: string }>;
  matar(): void;
}

function correr(instalacion: string, guion: string, args: string[], entorno: NodeJS.ProcessEnv = process.env): Corrida {
  const hijo = spawn("sh", ["-c", guion, "titular", ...args], { cwd: instalacion, env: entorno });
  let salida = "";
  let queja = "";
  let avisar: () => void;
  let negar: (e: Error) => void;
  const tomado = new Promise<void>((si, no) => { avisar = si; negar = no; });
  tomado.catch(() => {});
  hijo.stdout.on("data", (d) => {
    salida += d;
    if (salida.includes("tomado")) avisar();
  });
  hijo.stderr.on("data", (d) => { queja += d; });
  const fin = new Promise<{ codigo: number | null; salida: string; queja: string }>((listo) =>
    hijo.on("close", (codigo) => {
      negar(new Error(`terminó sin tomar el candado: ${queja}`));
      listo({ codigo, salida, queja });
    }),
  );
  return { pid: hijo.pid!, tomado, fin, matar: () => hijo.kill("SIGKILL") };
}
const titular = (instalacion: string, que: string, segundos: number, entorno?: NodeJS.ProcessEnv): Corrida => correr(instalacion, TITULAR, [que, String(segundos)], entorno);

const conInstalacion = async (prueba: (instalacion: string) => Promise<void>): Promise<void> => {
  const instalacion = await mkdtemp(join(tmpdir(), "instalacion-"));
  try {
    await prueba(instalacion);
  } finally {
    await rm(instalacion, { recursive: true, force: true });
  }
};
/** Lo que el candado dice de quien lo tiene. Vacío: nadie lo tiene, o quien lo tuvo lo soltó. */
const dueno = async (instalacion: string): Promise<Record<string, string>> =>
  Object.fromEntries((await readFile(join(instalacion, CANDADO), "utf8")).split("\n").filter(Boolean).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));
const espera = (ms: number): Promise<void> => new Promise((listo) => setTimeout(listo, ms));

test("doce a la vez: entra una, y a las demás se les dice cuál tiene el candado; solo quien lo tiene lo suelta", () =>
  conInstalacion(async (instalacion) => {
    const todas = Array.from({ length: 12 }, (_, k) => titular(instalacion, `operación ${k}`, 3));
    // Mientras la que entró lo tiene, las demás ya terminaron —con su limpieza puesta— y el candado sigue siendo suyo.
    const terminadas = await Promise.all(todas.map((t) => Promise.race([t.fin, t.tomado.then(() => null)])));
    const perdieron = terminadas.filter((t) => t !== null);
    assert.equal(perdieron.length, 11, "no entró exactamente una");
    const quien = await dueno(instalacion);
    for (const p of perdieron) {
      assert.equal(p!.codigo, 3);
      assert.match(p!.queja, /Hay otra operación en curso sobre esta instalación/);
      assert.match(p!.queja, new RegExp(`«${quien.que}»`));
    }
    const gano = todas.find((t) => String(t.pid) === quien.pid)!;
    assert.ok(gano, "el candado no dice quién lo tiene");
    assert.deepEqual([(await gano.fin).codigo, (await gano.fin).salida.trim()], [0, "tomado"]);
    // Al terminar lo suelta: queda el archivo, que no se borra nunca, sin decir de nadie.
    assert.deepEqual(await readdir(instalacion), [CANDADO]);
    assert.deepEqual(await dueno(instalacion), {});
    // Y otra puede entrar, sin que nadie le hable de interrupciones.
    const otra = await titular(instalacion, "la siguiente", 0).fin;
    assert.deepEqual([otra.codigo, otra.queja], [0, ""]);
  }));

test("si quien lo tenía murió sin soltarlo, el que sigue entra en el acto y dice de quién había quedado; de dos que llegan a la vez, entra uno; y si ese muere también, igual", () =>
  conInstalacion(async (instalacion) => {
    const muerta = titular(instalacion, "publicar", 60);
    await muerta.tomado;
    muerta.matar();
    await muerta.fin;
    assert.equal((await dueno(instalacion)).que, "publicar", "matarla borró lo que el candado decía: la prueba no prueba nada");

    const [a, b] = [titular(instalacion, "recuperar", 60), titular(instalacion, "levantar", 60)];
    const primero = await Promise.race([a.fin, b.fin, Promise.all([a.tomado, b.tomado]).then(() => null)]);
    assert.ok(primero, "entraron las dos");
    assert.equal(primero.codigo, 3, "la que perdió no perdió");
    assert.match(primero.queja, /Hay otra operación en curso/);
    const gano = (await Promise.race([a.tomado.then(() => a), b.tomado.then(() => b)]));
    // La que entró también muere con él tomado. La tercera entra igual: no hay nada que destrabar a mano.
    gano.matar();
    assert.match((await gano.fin).queja, /había quedado de «publicar», que se interrumpió/);
    const tercera = await titular(instalacion, "volver", 0).fin;
    assert.equal(tercera.codigo, 0, tercera.queja);
    assert.match(tercera.queja, /había quedado de «(recuperar|levantar)», que se interrumpió/);
    assert.deepEqual(await dueno(instalacion), {});
  }));

test("mientras siga trabajando algo que dejó lanzado la que se interrumpió, nadie más entra; cuando eso termina, sí", () =>
  conInstalacion(async (instalacion) => {
    const muerta = correr(instalacion, CON_ALGO_LANZADO, ["publicar", "2"]);
    await muerta.tomado;
    muerta.matar();
    await muerta.fin;
    // El guion ya no existe, pero lo que lanzó sigue: operar ahora sería operar junto a eso.
    const temprano = await titular(instalacion, "recuperar", 0).fin;
    assert.equal(temprano.codigo, 3, "entró con lo de la otra todavía trabajando");
    assert.match(temprano.queja, /Hay otra operación en curso.*«publicar».*sigue trabajando algo que dejó lanzado/s);
    await espera(2500);
    const despues = await titular(instalacion, "recuperar", 0).fin;
    assert.equal(despues.codigo, 0, despues.queja);
    assert.match(despues.queja, /había quedado de «publicar», que se interrumpió/);
  }));

test("ocho tomándolo y soltándolo sin parar, y dos que mueren con él tomado: nunca hay dos adentro, y ninguna se queda fuera", () =>
  conInstalacion(async (instalacion) => {
    // Adentro, cada una deja su número, espera, y comprueba que sigue siendo el suyo: si otra entró mientras, lo pisó.
    const OBRERA = `
. "${BIBLIOTECA}"
entradas=0
while [ "$entradas" -lt "$2" ]; do
  if tomar_candado "obrera $1" 2>/dev/null; then
    echo "$$" > adentro
    sleep 0.02 9>&-
    [ "$(cat adentro)" = "$$" ] || { echo "DOS ADENTRO"; exit 5; }
    entradas=$((entradas + 1))
    if [ "$3" = muere ] && [ "$entradas" -eq 3 ]; then kill -9 $$; fi
    soltar_candado
  else
    sleep 0.01 9>&-
  fi
done
echo terminó
`;
    const obreras = Array.from({ length: 8 }, (_, k) => correr(instalacion, OBRERA, [String(k), "12", k < 2 ? "muere" : "sigue"]));
    const fines = await Promise.all(obreras.map((o) => o.fin));
    for (const [k, f] of fines.entries()) {
      assert.ok(!f.salida.includes("DOS ADENTRO"), `la obrera ${k} encontró a otra adentro`);
      if (k < 2) assert.equal(f.codigo, null, `la obrera ${k} tenía que morir con el candado tomado`);
      else assert.deepEqual([f.codigo, f.salida.trim()], [0, "terminó"], `la obrera ${k} no terminó: ${f.queja}`);
    }
  }));

test("si no se puede anotar quién lo tiene, no se entra, y no se queda tomado", () =>
  conInstalacion(async (instalacion) => {
    // Como un disco lleno: el archivo se deja abrir y candar, y ya no admite que se le escriba nada.
    const SIN_ESPACIO = `
set -eu
. "${BIBLIOTECA}"
trap soltar_candado EXIT
trap '' XFSZ
ulimit -f 0
tomar_candado "$1" || exit 3
echo tomado
`;
    const fin = await correr(instalacion, SIN_ESPACIO, ["publicar"]).fin;
    assert.equal(fin.codigo, 3, `entró sin poder decir quién es: ${fin.salida} ${fin.queja}`);
    assert.match(fin.queja, /No se pudo anotar quién tiene el candado/);
    // No se quedó con él, ni dejó dicho nada: la que sigue entra sin más.
    const otra = await titular(instalacion, "levantar", 0).fin;
    assert.deepEqual([otra.codigo, otra.queja], [0, ""]);
    // Y lo suelta en el acto, no cuando termine: un guion que no lo consiguió y sigue vivo no estorba a nadie.
    const SIGUE_VIVO = `
. "${BIBLIOTECA}"
trap '' XFSZ
ulimit -f 0
tomar_candado "$1" 2>/dev/null || echo tomado
sleep 3 >/dev/null 2>&1
`;
    const viva = correr(instalacion, SIGUE_VIVO, ["publicar"]);
    await viva.tomado;                    // aquí «tomado» quiere decir que ya falló, y sigue viva
    const mientras = await titular(instalacion, "levantar", 0).fin;
    assert.equal(mientras.codigo, 0, `la que no pudo anotarse se quedó con el candado: ${mientras.queja}`);
    await viva.fin;
  }));

test("si no se puede abrir, o no hay con qué candarlo, no se entra; y lo que quedó del candado de antes —una carpeta— se dice", () =>
  conInstalacion(async (instalacion) => {
    const sinCarpeta = await titular(instalacion, "publicar", 0, { ...process.env, CANDADO: "no/existe/esta/carpeta/candado" }).fin;
    assert.equal(sinCarpeta.codigo, 3);
    assert.match(sinCarpeta.queja, /No se pudo abrir el candado de la instalación/);

    await mkdir(join(instalacion, CANDADO));
    const deAntes = await titular(instalacion, "publicar", 0).fin;
    assert.equal(deAntes.codigo, 3);
    assert.match(deAntes.queja, /es una carpeta.*bórrala/s);
    await rm(join(instalacion, CANDADO), { recursive: true });

    // Un sistema sin flock y sin perl: están las demás herramientas, y esas dos no.
    const herramientas = join(instalacion, "herramientas");
    await mkdir(herramientas);
    for (const cual of ["sh", "date", "od", "tr", "sed", "head", "sleep", "cat"]) {
      const donde = await new Promise<string>((listo) => {
        const h = spawn("sh", ["-c", `command -v ${cual}`]);
        let s = "";
        h.stdout.on("data", (d) => { s += d; });
        h.on("close", () => listo(s.trim()));
      });
      await symlink(donde, join(herramientas, cual));
    }
    const sinNada = await titular(instalacion, "publicar", 0, { ...process.env, PATH: herramientas }).fin;
    assert.equal(sinNada.codigo, 3, sinNada.queja);
    assert.match(sinNada.queja, /flock.*perl/s);
  }));

test("a quien le borraron el candado de las manos no borra lo que dice el de quien lo tomó después", () =>
  conInstalacion(async (instalacion) => {
    const primera = titular(instalacion, "publicar", 1);
    await primera.tomado;
    // Alguien creyó que estaba abandonado y borró el archivo. Otra operación entra, con un archivo nuevo.
    await rm(join(instalacion, CANDADO));
    const segunda = titular(instalacion, "levantar", 3);
    await segunda.tomado;
    // La primera termina, con su limpieza: lo que hay ya no dice de ella, y no lo toca.
    assert.equal((await primera.fin).codigo, 0);
    assert.equal((await dueno(instalacion)).que, "levantar", "la primera borró lo que decía el candado de otra");
    assert.equal((await segunda.fin).codigo, 0);
  }));

test("en los guiones, una variable pegada a una letra que no es ASCII va entre llaves: hay un sh —el de macOS— que se lleva un byte de la letra como parte del nombre", async () => {
  const carpeta = fileURLToPath(new URL("../operacion", import.meta.url));
  const guiones = (await readdir(carpeta, { recursive: true })).filter((a) => a.endsWith(".sh"));
  assert.ok(guiones.includes("candado.sh") && guiones.includes("levantar.sh"));
  for (const guion of guiones) {
    const lineas = (await readFile(join(carpeta, guion), "utf8")).split("\n");
    lineas.forEach((linea, k) => {
      if (/^\s*#/.test(linea)) return;
      assert.doesNotMatch(linea, /\$[A-Za-z_][A-Za-z0-9_]*[^\x00-\x7F]/, `${guion}:${k + 1}`);
      // Y «esto o aquello» dentro de un patrón de grep o sed (\|) solo lo entienden los de GNU: los de macOS no.
      assert.doesNotMatch(linea, /\\\|/, `${guion}:${k + 1}: «\\|» en un patrón no es portátil`);
    });
  }
});

