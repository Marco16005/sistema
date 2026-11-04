// Lo que se hace fuera del servidor con solo Docker (operacion/fuera.sh): la llave, el sello, de qué
// versión es un respaldo y el ensayo de restauración de cada mes. Aquí, con un «docker» de mentira
// que anota cada llamada: lo que se le pide, con qué, y que lo desechable siempre se borra. El camino
// de verdad —restaurar del almacenamiento y avisar al vigilante— lo recorre el ensayo de la operación.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const LLAVE = "# created: 2026-10-29T12:00:00Z\n# public key: age1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq\nAGE-SECRET-KEY-1QQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQ\n";

/** Un «docker» de mentira: anota cada llamada (una por renglón) y contesta según DOCKER_RESTAURAR. */
const DOCKER = `#!/bin/sh
printf '%s\\n' "$*" >> "$LLAMADAS"
case "$*" in
  info*|build*|"network create"*|"network rm"*|"network inspect"*|"exec "*) exit 0 ;;
  "rm -f"*) exit "\${DOCKER_RM:-0}" ;;
  "ps -aq"*) if [ "\${DOCKER_RM:-0}" != 0 ]; then echo idbase; fi ;;
  *"--entrypoint age-keygen"*) printf '%s' "$LLAVE_DE_MENTIRA"; echo "Public key: age1qqq" >&2 ;;
  *"operacion/sello.ts"*) cat > "$LLAMADAS.entrada"; echo RESPALDO_LLAVE_PUBLICA=age1qqq; echo RESPALDO_SELLO=abcd ;;
  *"operacion/version-del-respaldo.ts"*) cat > "$LLAMADAS.entrada"; echo "respaldo-1 pub-1 commit-1" ;;
  "run -d "*) echo idbase ;;
  *"operacion/restaurar.ts"*) cat > "$LLAMADAS.entrada"; echo "restaurando"; exit "\${DOCKER_RESTAURAR:-0}" ;;
  *) echo "docker de mentira: no sé qué hacer con: $*" >&2; exit 9 ;;
esac
`;

interface Corrida { codigo: number; salida: string; queja: string; llamadas: string[]; entrada: string }

/** Corre fuera.sh con el docker de mentira delante en el PATH. */
function fuera(args: string[], o: { entrada?: string; entorno?: string | null; mas?: Record<string, string> } = {}): Promise<Corrida> {
  const carpeta = mkdtempSync(join(tmpdir(), "fuera-"));
  writeFileSync(join(carpeta, "docker"), DOCKER);
  chmodSync(join(carpeta, "docker"), 0o755);
  const llamadas = join(carpeta, "llamadas");
  writeFileSync(llamadas, "");
  const entorno = join(carpeta, "recuperacion.env");
  if (o.entorno !== null) writeFileSync(entorno, o.entorno ?? "RESPALDO_DESTINO=respaldo:cubo/feruga\nRCLONE_CONFIG_RESPALDO_TYPE=s3\nENSAYO_VIGIA_URL=https://hc-ping.com/abc\n");
  return new Promise((bien) => {
    const p = spawn("sh", ["operacion/fuera.sh", ...args], {
      env: { ...process.env, PATH: `${carpeta}:${process.env.PATH}`, LLAMADAS: llamadas, LLAVE_DE_MENTIRA: LLAVE, FUERA_ENTORNO: entorno, ...o.mas },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let salida = "";
    let queja = "";
    p.stdout.on("data", (t) => { salida += t; });
    p.stderr.on("data", (t) => { queja += t; });
    p.stdin.on("error", () => {});
    p.stdin.end(o.entrada ?? "");
    p.on("close", (codigo) => {
      const leer = (f: string): string => { try { return readFileSync(f, "utf8"); } catch { return ""; } };
      bien({ codigo: codigo ?? -1, salida, queja, llamadas: leer(llamadas).split("\n").filter(Boolean), entrada: leer(`${llamadas}.entrada`) });
      rmSync(carpeta, { recursive: true, force: true });
    });
  });
}

const sinLlave = (r: Corrida): void => {
  // La llave nunca va en una orden: ni como argumento ni en una variable de entorno.
  for (const l of r.llamadas) assert.ok(!l.includes("AGE-SECRET-KEY"), `la llave salió en una orden: ${l}`);
};

test("una llave nueva: la escribe en el archivo que se le dice, solo para su dueño, y nunca encima de otra; dice lo que va al .env", async () => {
  // Con «llave > archivo», la terminal vaciaba el archivo antes de que el guion arrancara: repetir la
  // orden borraba la única llave (revisión de Codex del 4 de noviembre, H06). Ahora el guion crea el archivo.
  const carpeta = mkdtempSync(join(tmpdir(), "llave-"));
  try {
    const archivo = join(carpeta, "llave-privada.txt");
    const r = await fuera(["llave", archivo]);
    assert.equal(r.codigo, 0, r.queja);
    assert.equal(readFileSync(archivo, "utf8"), LLAVE, "el archivo no tiene la llave tal cual");
    assert.equal(statSync(archivo).mode & 0o777, 0o600, "el archivo de la llave se puede leer por otros");
    assert.match(r.salida, /RESPALDO_LLAVE_PUBLICA=age1qqq\nRESPALDO_SELLO=abcd/);
    assert.ok(!r.salida.includes("AGE-SECRET-KEY") && !r.queja.includes("AGE-SECRET-KEY"), "la llave salió en pantalla");
    assert.match(r.salida, /paquete de recuperación/);
    assert.equal(r.entrada, LLAVE, "el sello se sacó de esa misma llave, por la entrada estándar");
    for (const l of r.llamadas.filter((x) => x.startsWith("run "))) assert.match(l, /--network none/, `con red: ${l}`);
    sinLlave(r);
    // Otra vez con el mismo nombre: se niega, y la llave que había sigue igual.
    writeFileSync(archivo, "la de antes\n");
    const otra = await fuera(["llave", archivo]);
    assert.equal(otra.codigo, 1);
    assert.match(otra.queja, /Ya existe .*: una llave no se escribe encima de otra/);
    assert.equal(readFileSync(archivo, "utf8"), "la de antes\n");
    // Sin a dónde, o a una carpeta que no existe: se niega sin generar nada.
    assert.equal((await fuera(["llave"])).codigo, 2);
    const sinCarpeta = await fuera(["llave", join(carpeta, "no-existe", "llave.txt")]);
    assert.equal(sinCarpeta.codigo, 1);
    assert.ok(!sinCarpeta.llamadas.some((l) => l.includes("age-keygen")), "generó una llave sin dónde guardarla");
  } finally {
    rmSync(carpeta, { recursive: true, force: true });
  }
});

test("el sello: la llave por la entrada estándar, sin red; solo admite --hasta", async () => {
  const r = await fuera(["sello", "--hasta=2026-12-01T06:00:00Z"], { entrada: LLAVE });
  assert.equal(r.codigo, 0, r.queja);
  assert.equal(r.salida, "RESPALDO_LLAVE_PUBLICA=age1qqq\nRESPALDO_SELLO=abcd\n");
  assert.equal(r.entrada, LLAVE);
  const corrida = r.llamadas.find((l) => l.includes("sello.ts"))!;
  assert.match(corrida, /--network none .*operacion\/sello\.ts --hasta=2026-12-01T06:00:00Z$/);
  sinLlave(r);
  assert.equal((await fuera(["sello", "--cualquiera"], { entrada: LLAVE })).codigo, 2);
  assert.equal((await fuera(["nada"])).codigo, 2);
});

test("de qué versión es un respaldo: con la credencial de recuperación, que no trae nada de la base del servidor", async () => {
  const r = await fuera(["version"], { entrada: LLAVE });
  assert.equal(r.codigo, 0, r.queja);
  assert.equal(r.salida, "respaldo-1 pub-1 commit-1\n");
  assert.match(r.llamadas.find((l) => l.includes("version-del-respaldo"))!, /--env-file \S+recuperacion\.env .*version-del-respaldo\.ts$/);
  sinLlave(r);
  const sin = await fuera(["version"], { entrada: LLAVE, entorno: null });
  assert.equal(sin.codigo, 1);
  assert.match(sin.queja, /Falta \S+recuperacion\.env: la credencial de recuperación/);
  // Solo lo del almacenamiento y el vigilante, y como Docker lo lee: ni con espacios delante, ni un
  // nombre suelto que hereda su valor del entorno, ni otra variable (revisión de Codex del 3 de noviembre, H4).
  for (const otro of ["DATABASE_URL=postgres://feruga:x@db/feruga", "  BD_CLAVE=abc", "BD_CLAVE", "  DATABASE_URL=postgres://x",
    "NODE_OPTIONS=--require /tmp/x.js", "export RESPALDO_DESTINO=x"]) {
    const conBase = await fuera(["version"], { entrada: LLAVE, entorno: `RESPALDO_DESTINO=respaldo:cubo/feruga\n${otro}\n` });
    assert.equal(conBase.codigo, 1, otro);
    assert.match(conBase.queja, /renglón 2: ahí solo va lo del almacenamiento/, otro);
    assert.ok(!conBase.llamadas.some((l) => l.includes("version-del-respaldo")), `corrió con «${otro}»`);
  }
  const bien = await fuera(["version"], { entrada: LLAVE, entorno: "# la de recuperación\n\nRESPALDO_DESTINO=respaldo:cubo/feruga\nRCLONE_CONFIG_RESPALDO_TYPE=s3\nRCLONE_CONFIG_DIARIO_KEY=x\nRESPALDO_DESTINO_DIARIO=diario:cubo/feruga\nENSAYO_VIGIA_URL=https://hc-ping.com/abc\n" });
  assert.equal(bien.codigo, 0, bien.queja);
  // Del diario, y como estaba el almacenamiento en un momento: las mismas opciones que instalar desde un respaldo.
  const delDiario = await fuera(["version", "un-respaldo", "--diario", "--como-estaba=2026-11-01T12:00:00-06:00"], { entrada: LLAVE });
  assert.equal(delDiario.codigo, 0, delDiario.queja);
  assert.match(delDiario.llamadas.find((l) => l.includes("version-del-respaldo"))!, /version-del-respaldo\.ts un-respaldo --diario --como-estaba=2026-11-01T12:00:00-06:00$/);
  for (const malo of [["--remoto"], ["--como-estaba"], ["uno", "otro"], ["--diario=algo"]]) {
    const r = await fuera(["version", ...malo], { entrada: LLAVE });
    assert.equal(r.codigo, 2, malo.join(" "));
    assert.ok(!r.llamadas.some((l) => l.includes("version-del-respaldo")), `corrió con ${malo.join(" ")}`);
  }
});

test("el ensayo de cada mes: una base desechable de la imagen del servidor, restaurar del almacenamiento, avisar al vigilante, y borrar lo desechable", async () => {
  const huella = /^FROM (\S+@sha256:[0-9a-f]{64})/m.exec(readFileSync("docker/db.Dockerfile", "utf8"))![1]!;
  const r = await fuera(["ensayo"], { entrada: LLAVE });
  assert.equal(r.codigo, 0, r.queja);
  assert.match(r.salida, /El ensayo pasó: .* en \d+ min\. La base desechable ya se borró\./);
  const base = r.llamadas.find((l) => l.startsWith("run -d "))!;
  assert.ok(base.endsWith(huella), `la base no es la imagen del servidor por su huella: ${base}`);
  assert.ok(!/ -p |--publish/.test(base), "la base desechable publicó un puerto");
  const nombre = /--name (\S+)/.exec(base)![1]!;
  const red = /--network (\S+)/.exec(base)![1]!;
  const restaurar = r.llamadas.find((l) => l.includes("restaurar.ts"))!;
  assert.match(restaurar, new RegExp(`--network ${red} .*-e DATABASE_URL=postgres://feruga:[A-Za-z0-9]{32}@${nombre}:5432/feruga `));
  assert.match(restaurar, /-e WEB_BD_CLAVE=[A-Za-z0-9]{32} /);
  assert.match(restaurar, /operacion\/restaurar\.ts --remoto --ensayo$/);
  assert.equal(r.entrada, LLAVE);
  sinLlave(r);
  // Lo desechable se borra al final: la base y su red.
  const despues = r.llamadas.slice(r.llamadas.indexOf(restaurar));
  assert.ok(despues.includes(`rm -f ${nombre}`), "no borró la base desechable");
  assert.ok(despues.includes(`network rm ${red}`), "no borró la red del ensayo");
  // Del diario, sin --remoto.
  const diario = await fuera(["ensayo", "--diario"], { entrada: LLAVE });
  assert.equal(diario.codigo, 0, diario.queja);
  assert.match(diario.llamadas.find((l) => l.includes("restaurar.ts"))!, /operacion\/restaurar\.ts --ensayo --diario$/);
});

test("si el ensayo no pasa, se dice, y lo desechable se borra igual; si no se pudo avisar al vigilante, se dice que va a alertar", async () => {
  const mal = await fuera(["ensayo"], { entrada: LLAVE, mas: { DOCKER_RESTAURAR: "1" } });
  assert.equal(mal.codigo, 1);
  assert.match(mal.queja, /El ensayo NO pasó/);
  const nombre = /--name (\S+)/.exec(mal.llamadas.find((l) => l.startsWith("run -d "))!)![1]!;
  assert.ok(mal.llamadas.includes(`rm -f ${nombre}`), "con el ensayo fallido, la base desechable se quedó");
  const sinAviso = await fuera(["ensayo"], { entrada: LLAVE, mas: { DOCKER_RESTAURAR: "3" } });
  assert.equal(sinAviso.codigo, 3);
  assert.match(sinAviso.queja, /el vigilante de los ensayos no recibió el aviso: va a alertar/);
  assert.equal((await fuera(["ensayo", "--sin-sentido"], { entrada: LLAVE })).codigo, 2);
  // Si la base desechable no se pudo borrar, no se calla: tiene una copia de los datos del negocio
  // (revisión de Codex del 3 de noviembre, H5).
  const sinBorrar = await fuera(["ensayo"], { entrada: LLAVE, mas: { DOCKER_RM: "1" } });
  assert.notEqual(sinBorrar.codigo, 0, "dijo que todo bien con la base desechable todavía ahí");
  assert.match(sinBorrar.queja, /No se pudo borrar la base desechable del ensayo \(feruga-fuera-base-\d+\).*docker rm -f feruga-fuera-base-\d+/s);
  // Y «pasó» no se dice con la base todavía ahí (observación de Codex al verificar, 3 de noviembre).
  assert.doesNotMatch(sinBorrar.salida, /El ensayo pasó/);
  const conBase = await fuera(["ensayo"], { entrada: LLAVE, entorno: "RESPALDO_DESTINO=respaldo:x/y\nWEB_BD_CLAVE=abc\n" });
  assert.equal(conBase.codigo, 1);
  assert.ok(!conBase.llamadas.some((l) => l.startsWith("run -d ")), "arrancó una base con un entorno que no debía");
});

test("la llave y la credencial de recuperación no entran al repositorio ni a una imagen, aunque alguien las deje en la carpeta", () => {
  // Revisión de Codex del 4 de noviembre, H18. La guía pide guardarlas fuera; esto es por si acaso.
  for (const archivo of [".gitignore", ".dockerignore"]) {
    const renglones = readFileSync(archivo, "utf8").split("\n").map((l) => l.trim());
    for (const patron of ["recuperacion*.env", "llave*.txt"]) assert.ok(renglones.includes(patron), `${archivo} no ignora ${patron}`);
  }
});
