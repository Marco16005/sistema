// Cambiar la clave de administración de la base (operacion/cambiar-clave-de-la-base.sh). La clave
// nueva llega a la base como verificador SCRAM, calculado fuera de ella (operacion/scram.ts): así no
// viaja en el SQL, y ningún registro de la base la puede anotar (revisión de Codex del 3 de noviembre,
// H7). Aquí se comprueba contra el PostgreSQL de las pruebas que con ese verificador se entra con la
// clave, y con otra no.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import pg from "pg";
import { verificadorScram } from "../operacion/scram.ts";
import { conBase, urlDe } from "./apoyo.ts";

test("el verificador SCRAM que se calcula fuera de la base le sirve a PostgreSQL: con la clave se entra, con otra no", () =>
  conBase(async (db, base) => {
    const rol = `scram_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
    const clave = "Abc123" + randomUUID().replaceAll("-", "").slice(0, 26);
    const verificador = verificadorScram(clave);
    assert.match(verificador, /^SCRAM-SHA-256\$4096:[A-Za-z0-9+/=]{24}\$[A-Za-z0-9+/=]{44}:[A-Za-z0-9+/=]{44}$/);
    assert.ok(!verificador.includes(clave));
    await db.query(`CREATE ROLE ${rol} LOGIN PASSWORD '${verificador}'`);
    try {
      // Lo guardó tal cual: no lo volvió a cifrar como si fuera la clave.
      assert.equal((await db.query("SELECT rolpassword FROM pg_authid WHERE rolname = $1", [rol])).rows[0].rolpassword, verificador);
      const entra = async (con: string): Promise<boolean> => {
        const u = new URL(urlDe(base));
        u.username = rol;
        u.password = con;
        const c = new pg.Client({ connectionString: u.toString(), connectionTimeoutMillis: 10_000 });
        try {
          await c.connect();
          await c.query("SELECT 1");
          return true;
        } catch {
          return false;
        } finally {
          await c.end().catch(() => {});
        }
      };
      assert.equal(await entra(clave), true, "con la clave no entró");
      assert.equal(await entra(clave + "x"), false, "entró con otra clave");
      // Dos verificadores de la misma clave no se parecen: cada uno lleva su sal.
      assert.notEqual(verificadorScram(clave), verificador);
      assert.throws(() => verificadorScram("con espacio"), /solo letras y números/);
    } finally {
      await db.query(`DROP ROLE ${rol}`);
    }
  }));

// ── el guion, con un docker de mentira que hace de base: recuerda su clave ──────────────────────
// La base de mentira guarda la clave que le llega en el verificador (aquí, la clave en base64, para
// poder comprobarla) y la exige a quien entra por la red. Con PSQL=falla no la aplica y falla; con
// PSQL=pierde la aplica y contesta mal (la respuesta se perdió); con PSQL=muere la aplica y mata al
// guion entero, de golpe (kill -9 a su grupo). Lo que queda se mira en el archivo de entorno, la marca
// del cambio a medias y la base.
const VIEJA = "ClaveViejaDeLaBaseDeEnsayo0123456789";
const DOCKER_DE_LA_BASE = `#!/bin/sh
printf '%s\\n' "$*" >> "$LLAMADAS"
case "$*" in
  "image inspect"*) exit 0 ;;
  "compose config") echo "name: prueba" ;;
  "compose -f "*" config") echo "name: prueba" ;;
  "compose -f "*" ps -q db") echo idbase ;;
  *"operacion/publicacion.ts /publicaciones pendiente") ;;
  *"operacion/publicacion.ts /publicaciones vigente configuracion") echo "pub1/conjunto.json" ;;
  *"operacion/publicacion.ts /publicaciones vigente") echo pub1 ;;
  *"operacion/scram.ts") printf 'SCRAM-SHA-256$4096:sal$%s:srv\\n' "$(base64 | tr -d '\\n')" ;;
  "exec -i idbase psql"*)
    cat > "$SQL"
    case "\${PSQL:-}" in falla) exit 1 ;; esac
    sed -n "s/.*PASSWORD 'SCRAM-SHA-256\\$4096:sal\\$\\([^:]*\\):srv'.*/\\1/p" "$SQL" | base64 -d > "$ESTADO"
    case "\${PSQL:-}" in pierde) exit 1 ;; muere) kill -9 0 ;; esac ;;
  *"--entrypoint psql"*"-h db"*) if [ "$PGPASSWORD" = "$(cat "$ESTADO")" ]; then echo 1; else exit 2; fi ;;
  *) echo "docker de mentira: no sé qué hacer con: $*" >&2; exit 9 ;;
esac
`;

interface Instalacion { carpeta: string; correr: (args?: string[], psql?: string) => Promise<{ codigo: number | null; senal: string | null; salida: string; queja: string }>;
  env: () => string; clave: () => string; base: () => string; ponerBase: (c: string) => void; llamadas: () => string; sql: () => string; levantados: () => number }

function instalacion(): Instalacion {
  const carpeta = mkdtempSync(join(tmpdir(), "clave-"));
  mkdirSync(join(carpeta, "operacion"));
  for (const f of ["cambiar-clave-de-la-base.sh", "pasos.sh", "candado.sh"]) copyFileSync(join("operacion", f), join(carpeta, "operacion", f));
  writeFileSync(join(carpeta, "operacion", "levantar.sh"), 'echo levantado >> "$ANOTAR"\n');
  const bin = join(carpeta, ".bin");
  mkdirSync(bin);
  writeFileSync(join(bin, "docker"), DOCKER_DE_LA_BASE);
  writeFileSync(join(bin, "git"), '#!/bin/sh\ncase "$*" in *rev-parse*) echo 0123456789abcdef0123456789abcdef01234567 ;; esac\n');
  chmodSync(join(bin, "docker"), 0o755);
  chmodSync(join(bin, "git"), 0o755);
  writeFileSync(join(carpeta, ".env"), `SESION_CLAVE=una\nBD_CLAVE=${VIEJA}\nWEB_BD_CLAVE=otra\n`);
  const f = (n: string) => join(carpeta, n);
  writeFileSync(f(".base"), VIEJA);
  for (const n of [".llamadas", ".sql", ".levantados"]) writeFileSync(f(n), "");
  const leer = (n: string) => { try { return readFileSync(f(n), "utf8"); } catch { return ""; } };
  return {
    carpeta,
    correr: (args = [], psql = "") => new Promise((bien) => {
      const p = spawn("sh", ["operacion/cambiar-clave-de-la-base.sh", ...args], {
        cwd: carpeta, detached: true, stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, LLAMADAS: f(".llamadas"), SQL: f(".sql"), ESTADO: f(".base"), ANOTAR: f(".levantados"), PSQL: psql },
      });
      let salida = "";
      let queja = "";
      p.stdout.on("data", (t) => { salida += t; });
      p.stderr.on("data", (t) => { queja += t; });
      p.on("close", (codigo, senal) => bien({ codigo, senal, salida, queja }));
    }),
    env: () => leer(".env"),
    clave: () => /^BD_CLAVE=(.*)$/m.exec(leer(".env"))?.[1] ?? "",
    base: () => leer(".base"),
    ponerBase: (c) => writeFileSync(f(".base"), c),
    llamadas: () => leer(".llamadas"),
    sql: () => leer(".sql"),
    levantados: () => leer(".levantados").split("\n").filter(Boolean).length,
  };
}
const sinClave = (env: string) => env.split("\n").filter((l) => !l.startsWith("BD_CLAVE=")).join("\n");

test("cambiar la clave: la nueva queda en la base y en el .env, sin ir en ninguna orden ni en el SQL, y se levanta", async () => {
  const i = instalacion();
  try {
    const antes = i.env();
    const r = await i.correr();
    assert.equal(r.codigo, 0, r.queja);
    const nueva = i.clave();
    assert.match(nueva, /^[A-Za-z0-9]{32}$/);
    assert.notEqual(nueva, VIEJA);
    assert.equal(i.base(), nueva, "la base no quedó con la del .env");
    assert.equal(sinClave(i.env()), sinClave(antes), "se tocó otro renglón del .env");
    assert.ok(!existsSync(join(i.carpeta, ".env.nueva")), "quedó la marca del cambio a medias");
    assert.equal(i.levantados(), 1);
    // Ni en las órdenes, ni en lo que dijo, ni en el SQL: ahí va el verificador, y las sentencias no se anotan.
    for (const [donde, texto] of [["órdenes", i.llamadas()], ["salida", r.salida + r.queja], ["SQL", i.sql()]] as const) {
      assert.ok(!texto.includes(nueva), `la clave nueva salió en ${donde}`);
    }
    assert.match(i.sql(), /PASSWORD 'SCRAM-SHA-256\$/);
    for (const ajuste of ["log_statement = 'none'", "log_min_duration_statement = -1", "log_min_duration_sample = -1", "log_min_error_statement = panic"]) {
      assert.ok(i.sql().includes(`SET ${ajuste};`), `falta SET ${ajuste}`);
    }
  } finally {
    rmSync(i.carpeta, { recursive: true, force: true });
  }
});

test("si se muere de golpe recién cambiada en la base, queda la marca: levantar no entra, y correrlo otra vez lo termina", async () => {
  const i = instalacion();
  try {
    const r = await i.correr([], "muere");
    assert.equal(r.senal, "SIGKILL", `no murió: ${r.codigo} ${r.queja}`);
    assert.equal(i.clave(), VIEJA, "el .env cambió antes de tiempo");
    const marca = readFileSync(join(i.carpeta, ".env.nueva"), "utf8");
    const enLaMarca = /^BD_CLAVE=(.*)$/m.exec(marca)![1]!;
    assert.equal(i.base(), enLaMarca, "la marca no lleva la clave que quedó en la base");
    // Mientras esté la marca, lo que levanta, publica o vuelve no entra.
    const levantar = spawnSync("sh", ["-c", ". operacion/candado.sh; . operacion/pasos.sh; exigir_sin_clave_a_medias"], { cwd: i.carpeta, encoding: "utf8" });
    assert.equal(levantar.status, 1);
    assert.match(levantar.stderr, /quedó a medias.*cambiar-clave-de-la-base\.sh/s);
    // Otra vez: la base tiene la de la marca, así que se termina con esa.
    const otra = await i.correr();
    assert.equal(otra.codigo, 0, otra.queja);
    assert.match(otra.salida, /Se terminó un cambio de clave que había quedado a medias/);
    assert.equal(i.clave(), enLaMarca);
    assert.equal(i.base(), enLaMarca);
    assert.ok(!existsSync(join(i.carpeta, ".env.nueva")));
    assert.equal(i.levantados(), 1);
  } finally {
    rmSync(i.carpeta, { recursive: true, force: true });
  }
});

test("lo que decide es la base, no su respuesta: si contestó mal pero la cambió, se sigue; si no la cambió, no se toca nada", async () => {
  const pierde = instalacion();
  try {
    const r = await pierde.correr([], "pierde");
    assert.equal(r.codigo, 0, r.queja);
    assert.equal(pierde.base(), pierde.clave());
    assert.notEqual(pierde.clave(), VIEJA);
  } finally {
    rmSync(pierde.carpeta, { recursive: true, force: true });
  }
  const falla = instalacion();
  try {
    const r = await falla.correr([], "falla");
    assert.equal(r.codigo, 1);
    assert.match(r.queja, /sigue la de antes\. No se tocó nada/);
    assert.equal(falla.clave(), VIEJA);
    assert.equal(falla.base(), VIEJA);
    assert.ok(!existsSync(join(falla.carpeta, ".env.nueva")), "dejó la marca de un cambio que no llegó a la base");
    assert.equal(falla.levantados(), 0);
  } finally {
    rmSync(falla.carpeta, { recursive: true, force: true });
  }
});

test("un cambio a medias que no llegó a la base se descarta y va uno nuevo; si ninguna clave entra, se niega y dice --la-del-env, que la arregla", async () => {
  const i = instalacion();
  try {
    writeFileSync(join(i.carpeta, ".env.nueva"), `SESION_CLAVE=una\nBD_CLAVE=LaDeUnCambioQueNoLlegoALaBase000\nWEB_BD_CLAVE=otra\n`);
    const r = await i.correr();
    assert.equal(r.codigo, 0, r.queja);
    assert.match(r.salida, /no llegó a la base: se descartó/);
    assert.notEqual(i.clave(), VIEJA);
    assert.notEqual(i.clave(), "LaDeUnCambioQueNoLlegoALaBase000");
    assert.equal(i.base(), i.clave());
    // Ahora la base tiene otra que nadie sabe: no se adivina.
    i.ponerBase("UnaTerceraQueNoEstaEnNingunLado0");
    const antes = i.env();
    const n = await i.correr();
    assert.equal(n.codigo, 1);
    assert.match(n.queja, /--la-del-env/);
    assert.equal(i.env(), antes);
    assert.equal(i.base(), "UnaTerceraQueNoEstaEnNingunLado0");
    const arregla = await i.correr(["--la-del-env"]);
    assert.equal(arregla.codigo, 0, arregla.queja);
    assert.equal(i.base(), i.clave(), "--la-del-env no puso en la base la del .env");
  } finally {
    rmSync(i.carpeta, { recursive: true, force: true });
  }
});
