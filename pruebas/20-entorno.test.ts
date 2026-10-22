// Nada arranca con valores de desarrollo si no se dijo expresamente que es desarrollo. Lo
// comprueba cada proceso al iniciar, con la misma función: el migrador, la consola y la aplicación.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import pg from "pg";
import { conBase, conBaseVacia, urlApp, urlDe } from "./apoyo.ts";
import { GET as salud } from "../src/app/api/salud/route.ts";
import { GET as dia } from "../src/app/api/dia/route.ts";
import { crearBd, usarBd } from "../src/servidor/bd.ts";
import { exigirEntorno, faltasDelEntorno } from "../src/servidor/entorno.ts";
import type { Parte } from "../src/servidor/entorno.ts";
import { leerHorario } from "../operacion/horario.ts";

const correr = promisify(execFile);
const RAIZ = fileURLToPath(new URL("..", import.meta.url));
const TODAS: Parte[] = ["administracion", "conexion", "aplicacion", "respaldo", "sitio"];

/** Un entorno de operación completo y bien puesto. */
const BUENO = {
  BD_CLAVE: "Qm3vT8xLp2Rk9Zc4Wn7Yb5Hd",
  WEB_BD_CLAVE: "Jf6Gs1Ua0Ve8Xi3Ko9Ml2Np7",
  SESION_CLAVE: "A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8",
  COOKIE_SEGURA: "1",
  DOMINIO: "patio.ejemplo.mx",
  ORIGEN: "https://patio.ejemplo.mx",
  RESPALDO_LLAVE_PUBLICA: "age1" + "q".repeat(58),
  RESPALDO_SELLO: "0f".repeat(32),
  RESPALDO_DESTINO: "respaldo:respaldos-del-patio/feruga",
  RESPALDO_HORARIO: "07:00,08:00,19:30",
  RESPALDO_VIGIA_URL: "https://vigia.ejemplo.mx/ping/0b2c1f",
  RCLONE_CONFIG_RESPALDO_TYPE: "s3",
  RCLONE_CONFIG_RESPALDO_ACCESS_KEY_ID: "llaveDelServidor",
  RCLONE_CONFIG_RESPALDO_SECRET_ACCESS_KEY: "secretoDelServidor0123456789",
  // El respaldo diario, que se guarda un año: otro depósito, con su credencial y su propio vigilante.
  RESPALDO_DESTINO_DIARIO: "diario:respaldos-de-un-anio/feruga",
  RESPALDO_VIGIA_DIARIO_URL: "https://vigia.ejemplo.mx/ping/7d9e3a",
  RCLONE_CONFIG_DIARIO_TYPE: "s3",
  RCLONE_CONFIG_DIARIO_ACCESS_KEY_ID: "llaveDelDiario",
  RCLONE_CONFIG_DIARIO_SECRET_ACCESS_KEY: "secretoDelDiario0123456789",
};

test("un entorno de operación completo se acepta", () => {
  assert.deepEqual(faltasDelEntorno(BUENO, TODAS), []);
  exigirEntorno(BUENO, TODAS);
});

test("cada cosa que falta o viene de desarrollo se rechaza diciendo cuál", () => {
  const casos: Array<[Record<string, string | undefined>, RegExp]> = [
    [{ BD_CLAVE: undefined }, /BD_CLAVE/],
    [{ BD_CLAVE: "desarrollo" }, /BD_CLAVE.*desarrollo/],
    [{ BD_CLAVE: "Corta123" }, /BD_CLAVE.*20/],
    [{ BD_CLAVE: "con-guiones-no-viaja-bien-en-url" }, /BD_CLAVE.*letras y números/],
    [{ WEB_BD_CLAVE: "desarrollo_web" }, /WEB_BD_CLAVE.*desarrollo/],
    [{ WEB_BD_CLAVE: BUENO.BD_CLAVE }, /WEB_BD_CLAVE.*distinta/],
    [{ SESION_CLAVE: "solo-para-desarrollo-cambiar-antes-de-usar-en-serio" }, /SESION_CLAVE.*desarrollo/],
    [{ SESION_CLAVE: "demasiado-corta" }, /SESION_CLAVE.*32/],
    [{ COOKIE_SEGURA: "0" }, /COOKIE_SEGURA/],
    [{ COOKIE_SEGURA: undefined }, /COOKIE_SEGURA/],
    [{ ORIGEN: "http://patio.ejemplo.mx" }, /ORIGEN.*https/],
    [{ ORIGEN: "https://patio.ejemplo.mx/ruta" }, /ORIGEN/],
    [{ ORIGEN: "https://otro.ejemplo.mx" }, /ORIGEN.*DOMINIO/],
    [{ ORIGEN: undefined }, /ORIGEN/],
    [{ DOMINIO: undefined }, /DOMINIO/],
    [{ DOMINIO: "https://patio.ejemplo.mx", ORIGEN: "https://https://patio.ejemplo.mx" }, /DOMINIO/],
    [{ DOMINIO: "patio.ejemplo.mx/app" }, /DOMINIO/],
    [{ RESPALDO_SELLO: undefined }, /Falta RESPALDO_SELLO/],
    [{ RESPALDO_SELLO: "0F".repeat(32) }, /RESPALDO_SELLO no tiene su forma/],
    [{ RESPALDO_SELLO: "AGE-SECRET-KEY-1" + "Q".repeat(58) }, /RESPALDO_SELLO no tiene su forma.*La llave privada misma no va aquí/],
    // Los sellos de llaves cambiadas: «sello@momento», el momento con su zona (revisión de Codex del 21 de octubre).
    [{ RESPALDO_SELLOS_ANTERIORES: "0f".repeat(32) }, /RESPALDO_SELLOS_ANTERIORES no tiene su forma/],
    [{ RESPALDO_SELLOS_ANTERIORES: `${"0f".repeat(32)}@2026-12-01T06:00:00` }, /RESPALDO_SELLOS_ANTERIORES no tiene su forma/],
    [{ RESPALDO_SELLOS_ANTERIORES: `AGE-SECRET-KEY-1${"Q".repeat(58)}@2026-12-01T06:00:00Z` }, /RESPALDO_SELLOS_ANTERIORES no tiene su forma/],
    [{ RESPALDO_LLAVE_PUBLICA: undefined }, /RESPALDO_LLAVE_PUBLICA/],
    [{ RESPALDO_LLAVE_PUBLICA: "AGE-SECRET-KEY-1QQQQQQ" }, /RESPALDO_LLAVE_PUBLICA/],
    [{ RESPALDO_DESTINO: "" }, /RESPALDO_DESTINO/],
    // El destino es un remoto de rclone y un camino, y el remoto tiene que estar configurado en el entorno.
    [{ RESPALDO_DESTINO: "respaldos-del-patio" }, /RESPALDO_DESTINO.*remoto:/],
    [{ RESPALDO_DESTINO: "otro:respaldos-del-patio" }, /RCLONE_CONFIG_OTRO_TYPE/],
    [{ RCLONE_CONFIG_RESPALDO_TYPE: undefined }, /RCLONE_CONFIG_RESPALDO_TYPE/],
    [{ RCLONE_CONFIG_RESPALDO_ACCESS_KEY_ID: "" }, /RCLONE_CONFIG_RESPALDO_ACCESS_KEY_ID/],
    [{ RCLONE_CONFIG_RESPALDO_SECRET_ACCESS_KEY: undefined }, /RCLONE_CONFIG_RESPALDO_SECRET_ACCESS_KEY/],
    // A qué horas, y a quién se le avisa: sin vigilante nadie se entera de que un respaldo no se tomó.
    [{ RESPALDO_HORARIO: undefined }, /RESPALDO_HORARIO/],
    [{ RESPALDO_HORARIO: "cada hora" }, /RESPALDO_HORARIO/],
    [{ RESPALDO_HORARIO: "07:00,25:00" }, /RESPALDO_HORARIO/],
    [{ RESPALDO_VIGIA_URL: undefined }, /RESPALDO_VIGIA_URL/],
    [{ RESPALDO_VIGIA_URL: "http://vigia.ejemplo.mx/ping/0b2c1f" }, /RESPALDO_VIGIA_URL.*https/],
    [{ RESPALDO_VIGIA_URL: "vigia.ejemplo.mx" }, /RESPALDO_VIGIA_URL.*https/],
    // El diario va a OTRO depósito —el candado de un año lo da el depósito—, con su remoto configurado y su propia señal.
    [{ RESPALDO_DESTINO_DIARIO: undefined }, /RESPALDO_DESTINO_DIARIO/],
    [{ RESPALDO_DESTINO_DIARIO: "respaldos-de-un-anio" }, /RESPALDO_DESTINO_DIARIO.*remoto:/],
    [{ RESPALDO_DESTINO_DIARIO: BUENO.RESPALDO_DESTINO }, /RESPALDO_DESTINO_DIARIO.*otro depósito/],
    [{ RESPALDO_DESTINO_DIARIO: "respaldo:respaldos-del-patio/diario" }, /RESPALDO_DESTINO_DIARIO.*otro depósito/],
    [{ RCLONE_CONFIG_DIARIO_TYPE: undefined }, /RCLONE_CONFIG_DIARIO_TYPE/],
    [{ RCLONE_CONFIG_DIARIO_SECRET_ACCESS_KEY: "" }, /RCLONE_CONFIG_DIARIO_SECRET_ACCESS_KEY/],
    [{ RESPALDO_VIGIA_DIARIO_URL: undefined }, /RESPALDO_VIGIA_DIARIO_URL/],
    [{ RESPALDO_VIGIA_DIARIO_URL: "http://vigia.ejemplo.mx/ping/7d9e3a" }, /RESPALDO_VIGIA_DIARIO_URL.*https/],
    [{ RESPALDO_VIGIA_DIARIO_URL: BUENO.RESPALDO_VIGIA_URL }, /RESPALDO_VIGIA_DIARIO_URL.*propia/],
    // Lo encontró Codex en su décima revisión. Dos nombres de remoto que llevan al mismo depósito no son dos depósitos:
    // lo que cuenta es a dónde llegan —el mismo cubo en el mismo servicio—, no cómo se llama el remoto.
    [{ RESPALDO_DESTINO_DIARIO: "diario:respaldos-del-patio/diario" }, /RESPALDO_DESTINO_DIARIO.*otro depósito/],
    [{
      RESPALDO_DESTINO_DIARIO: "diario:respaldos-del-patio/diario",
      RCLONE_CONFIG_RESPALDO_ENDPOINT: "https://s3.us-west-004.backblazeb2.com", RCLONE_CONFIG_DIARIO_ENDPOINT: "S3.US-WEST-004.backblazeb2.com/",
    }, /RESPALDO_DESTINO_DIARIO.*otro depósito/],
    // La señal del diario es la misma que la de cada hora aunque se escriba con una diagonal de más o con otras mayúsculas:
    // al avisar se le quita la diagonal, y el nombre de la máquina no distingue mayúsculas.
    [{ RESPALDO_VIGIA_DIARIO_URL: `${BUENO.RESPALDO_VIGIA_URL}/` }, /RESPALDO_VIGIA_DIARIO_URL.*propia/],
    [{ RESPALDO_VIGIA_DIARIO_URL: "https://VIGIA.ejemplo.mx/ping/0b2c1f" }, /RESPALDO_VIGIA_DIARIO_URL.*propia/],
    [{ RESPALDO_VIGIA_URL: `${BUENO.RESPALDO_VIGIA_DIARIO_URL}//` }, /RESPALDO_VIGIA_DIARIO_URL.*propia/],
    // Una dirección con usuario y contraseña no se acepta: acabaría impresa en un registro.
    [{ RESPALDO_VIGIA_URL: "https://usuario:Secreto123@vigia.ejemplo.mx/ping/0b2c1f" }, /RESPALDO_VIGIA_URL.*usuario ni contraseña/],
    [{ RESPALDO_VIGIA_DIARIO_URL: "https://usuario:Secreto123@vigia.ejemplo.mx/ping/7d9e3a" }, /RESPALDO_VIGIA_DIARIO_URL.*usuario ni contraseña/],
  ];
  for (const [cambio, dice] of casos) {
    const faltas = faltasDelEntorno({ ...BUENO, ...cambio }, TODAS);
    assert.ok(faltas.length > 0, `debió rechazar ${JSON.stringify(cambio)}`);
    assert.match(faltas.join("\n"), dice, JSON.stringify(cambio));
    assert.ok(!faltas.join("\n").includes("Secreto123"), "la queja repite una contraseña");
    assert.throws(() => exigirEntorno({ ...BUENO, ...cambio }, TODAS), dice);
  }
  // El mismo nombre de cubo en dos servicios distintos sí son dos depósitos.
  assert.deepEqual(
    faltasDelEntorno({ ...BUENO, RESPALDO_DESTINO_DIARIO: "diario:respaldos-del-patio/feruga", RCLONE_CONFIG_DIARIO_ENDPOINT: "https://s3.otro-proveedor.mx" }, TODAS),
    [],
  );
});

test("cada proceso pide solo lo suyo: lo que no usa no lo detiene", () => {
  const soloBase = { BD_CLAVE: BUENO.BD_CLAVE, WEB_BD_CLAVE: BUENO.WEB_BD_CLAVE };
  assert.deepEqual(faltasDelEntorno(soloBase, ["administracion", "conexion"]), []);
  assert.ok(faltasDelEntorno(soloBase, ["aplicacion"]).length > 0);
});

test("las claves de la base se toman de la dirección de conexión cuando no vienen sueltas", () => {
  // Así las recibe cada contenedor: el migrador, la del dueño; la aplicación, la de su usuario.
  const migrador = { DATABASE_URL: `postgres://feruga:${BUENO.BD_CLAVE}@db:5432/feruga`, WEB_BD_CLAVE: BUENO.WEB_BD_CLAVE };
  assert.deepEqual(faltasDelEntorno(migrador, ["administracion", "conexion"]), []);
  assert.match(faltasDelEntorno({ ...migrador, DATABASE_URL: "postgres://feruga:desarrollo@db:5432/feruga" }, ["administracion"]).join(), /BD_CLAVE.*desarrollo/);
  const aplicacion = { DATABASE_URL: `postgres://feruga_web:${BUENO.WEB_BD_CLAVE}@db:5432/feruga` };
  assert.deepEqual(faltasDelEntorno(aplicacion, ["conexion"]), []);
  assert.match(faltasDelEntorno({ DATABASE_URL: "postgres://feruga_web:desarrollo_web@db:5432/feruga" }, ["conexion"]).join(), /WEB_BD_CLAVE.*desarrollo/);
});

test("solo si se dice expresamente que es desarrollo se aceptan los valores de desarrollo", () => {
  const deDesarrollo = { BD_CLAVE: "desarrollo", WEB_BD_CLAVE: "desarrollo_web", SESION_CLAVE: "solo-para-desarrollo-cambiar-antes-de-usar-en-serio", COOKIE_SEGURA: "0" };
  assert.deepEqual(faltasDelEntorno({ ...deDesarrollo, MODO: "desarrollo" }, TODAS), []);
  for (const modo of [undefined, "", "operacion", "Desarrollo", "desarrollo "]) {
    assert.ok(faltasDelEntorno({ ...deDesarrollo, MODO: modo }, TODAS).length > 0, `MODO=${modo}`);
  }
});

// ── cada proceso lo comprueba al iniciar ───────────────────────────────────

/** Corre algo con el entorno del proceso cambiado, y lo deja como estaba. */
async function conEntorno<T>(valores: Record<string, string | undefined>, hacer: () => Promise<T>): Promise<T> {
  const antes = Object.fromEntries(Object.keys(valores).map((k) => [k, process.env[k]]));
  const poner = (v: Record<string, string | undefined>): void => {
    for (const [k, valor] of Object.entries(v)) {
      if (valor === undefined) delete process.env[k];
      else process.env[k] = valor;
    }
  };
  poner(valores);
  try {
    return await hacer();
  } finally {
    poner(antes);
  }
}

const DE_LA_APLICACION = {
  MODO: undefined,
  DATABASE_URL: `postgres://feruga_web:${BUENO.WEB_BD_CLAVE}@db:5432/feruga`,
  SESION_CLAVE: BUENO.SESION_CLAVE,
  COOKIE_SEGURA: "1",
  ORIGEN: BUENO.ORIGEN,
};

test("la aplicación no atiende con un entorno de operación mal puesto: ni la salud ni las rutas", () =>
  conBase(async (db, base) => {
    // Fuera de desarrollo la aplicación exige además que la base esté emparejada con su servidor
    // (22-restauracion): una copia de la plantilla no lo está hasta que se le da su marca.
    await db.query("SELECT estrenar_vida()");
    const bd = crearBd(await urlApp(base), { conexiones: 1 });
    usarBd(bd);
    try {
      await conEntorno(DE_LA_APLICACION, async () => {
        assert.equal((await salud()).status, 200);
      });
      for (const cambio of [{ COOKIE_SEGURA: "0" }, { SESION_CLAVE: "solo-para-desarrollo-cambiar-antes-de-usar-en-serio" }, { ORIGEN: "http://patio.ejemplo.mx" }]) {
        await conEntorno({ ...DE_LA_APLICACION, ...cambio }, async () => {
          const s = await salud();
          assert.equal(s.status, 503, JSON.stringify(cambio));
          assert.deepEqual(await s.json(), { bien: false });
          // Las rutas tampoco: contestan que no hay servicio, sin decir qué falta.
          const r = await dia(new Request("https://patio.ejemplo.mx/api/dia"));
          assert.equal(r.status, 503, JSON.stringify(cambio));
          assert.doesNotMatch(await r.text(), /COOKIE|SESION_CLAVE|ORIGEN/);
        });
      }
    } finally {
      usarBd(null);
      await bd.cerrar();
    }
  }));

test("el migrador y el paso del usuario de conexión se niegan a correr con claves de desarrollo fuera de desarrollo", () =>
  conBaseVacia(async (base) => {
    const entorno = { PATH: process.env.PATH, DATABASE_URL: urlDe(base), WEB_BD_CLAVE: "desarrollo_web" };
    for (const guion of ["db/migrar.ts", "db/rol.ts"]) {
      await assert.rejects(correr("node", [guion], { cwd: RAIZ, env: entorno }), (e: any) => /BD_CLAVE/.test(e.stderr) && /WEB_BD_CLAVE/.test(e.stderr));
    }
    // No llegó a tocar la base.
    const db = new pg.Client({ connectionString: urlDe(base) });
    await db.connect();
    try {
      assert.equal((await db.query("SELECT to_regclass('migracion') AS t")).rows[0].t, null);
    } finally {
      await db.end();
    }
    // Dicho que es desarrollo, sí corre.
    const { stdout } = await correr("node", ["db/migrar.ts"], { cwd: RAIZ, env: { ...entorno, MODO: "desarrollo" } });
    assert.match(stdout, /aplicadas: 0001/);
  }));

test("en operación cada servicio corre con una imagen que no se mueve: por su identificador, sin construir al levantar, y de bases fijadas por su huella", async () => {
  const operacion = await readFile(join(RAIZ, "docker-compose.operacion.yml"), "utf8");
  /** El trozo del archivo que define ese servicio (o ese bloque compartido). */
  const bloque = (nombre: string): string => {
    const desde = operacion.search(new RegExp(`^(  ${nombre}:|x-${nombre}: &${nombre})$`, "m"));
    assert.notEqual(desde, -1, `no está ${nombre}`);
    const resto = operacion.slice(desde + 1);
    const hasta = resto.search(/^(  [a-z_-]+:|[a-z]+:)$/m);
    return hasta === -1 ? resto : resto.slice(0, hasta);
  };
  for (const [servicio, variable] of [["db", "IMAGEN_DB"], ["migracion", "IMAGEN_ADMIN"], ["consola", "IMAGEN_ADMIN"], ["web", "IMAGEN_WEB"], ["respaldo", "IMAGEN_RESPALDO"], ["proxy", "IMAGEN_PROXY"]] as const) {
    const suyo = bloque(servicio);
    // La imagen la pone la publicación: sin ella Compose no arranca, y dice qué usar en su lugar.
    assert.match(suyo, new RegExp(`image: "\\$\\{${variable}:\\?[^}]*operacion/compose\\.sh[^}]*\\}"`), `${servicio} no exige ${variable}`);
    assert.match(suyo, /pull_policy: never/, `${servicio} podría traer su imagen de fuera`);
    assert.doesNotMatch(suyo, /^\s+build:\s*$/m, `${servicio} trae cómo construirse`);
  }
  // Los que en desarrollo se construyen, aquí no: se les quita.
  for (const servicio of ["migracion", "consola", "web"]) assert.match(bloque(servicio), /build: !reset null/, servicio);
  // La comprobación y el respaldo comparten imagen, y es la misma regla.
  assert.match(operacion, /^  comprobacion:\n    <<: \*respaldo$/m);
  assert.match(operacion, /^  respaldo:\n    <<: \*respaldo$/m);
  // El proxy lleva su configuración adentro: no la monta de la carpeta del proyecto.
  assert.doesNotMatch(bloque("proxy"), /Caddyfile/);
  assert.match(await readFile(join(RAIZ, "docker/proxy.Dockerfile"), "utf8"), /^COPY operacion\/Caddyfile \/etc\/caddy\/Caddyfile$/m);
  // La aplicación dice qué publicación contesta.
  assert.match(bloque("web"), /VERSION: "\$\{VERSION:\?/);

  // Las imágenes de las que se parte van por su huella: una etiqueta se mueve.
  const de = async (archivo: string): Promise<string[]> => [...(await readFile(join(RAIZ, archivo), "utf8")).matchAll(/^FROM (\S+)/gm)].map((m) => m[1]!);
  for (const archivo of ["docker/web.Dockerfile", "docker/respaldo.Dockerfile", "docker/proxy.Dockerfile", "docker/db.Dockerfile"]) {
    const externas = (await de(archivo)).filter((imagen) => imagen.includes(":") || imagen.includes("/"));
    assert.ok(externas.length > 0, archivo);
    for (const imagen of externas) assert.match(imagen, /^[a-z]+:[a-z0-9.-]+@sha256:[0-9a-f]{64}$/, `${archivo}: ${imagen}`);
  }
  // Y la base de datos es la misma en desarrollo, en las pruebas y en operación.
  const [deOperacion] = await de("docker/db.Dockerfile");
  const enCompose = [...(await readFile(join(RAIZ, "docker-compose.yml"), "utf8")).matchAll(/^    image: (postgres\S*)$/gm)].map((m) => m[1]);
  assert.ok(enCompose.length >= 3);
  for (const imagen of enCompose) assert.equal(imagen, deOperacion);

  // Lo que guarda cada publicación lleva claves: ni al repositorio ni a ninguna imagen.
  assert.match(await readFile(join(RAIZ, ".gitignore"), "utf8"), /^publicaciones\/$/m);
  assert.match(await readFile(join(RAIZ, ".dockerignore"), "utf8"), /^publicaciones$/m);
});

test("el archivo de Compose no trae valores por omisión para lo que debe venir del entorno", async () => {
  const compose = await readFile(join(RAIZ, "docker-compose.yml"), "utf8");
  for (const variable of ["BD_CLAVE", "WEB_BD_CLAVE", "SESION_CLAVE", "COOKIE_SEGURA", "ORIGEN"]) {
    assert.doesNotMatch(compose, new RegExp(`\\$\\{${variable}:-`), `${variable} trae un valor por omisión`);
    assert.match(compose, new RegExp(`\\$\\{${variable}:\\?`), `${variable} no se exige`);
  }
  // Los de desarrollo viven en su propio archivo, que se declara como tal.
  const desarrollo = await readFile(join(RAIZ, ".env.desarrollo"), "utf8");
  assert.match(desarrollo, /^MODO=desarrollo$/m);
  const leido = Object.fromEntries(desarrollo.split("\n").filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));
  assert.deepEqual(faltasDelEntorno(leido, ["administracion", "conexion", "aplicacion"]), []);
});

// ── generar el entorno de operación ────────────────────────────────────────

/** Lee un archivo de entorno como lo leería Compose: NOMBRE=valor, una por línea. */
async function leerEntorno(archivo: string): Promise<Record<string, string>> {
  const texto = await readFile(archivo, "utf8");
  return Object.fromEntries(texto.split("\n").filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));
}

test("el guion genera un entorno de operación que solo espera lo que el dueño debe poner", async () => {
  const carpeta = await mkdtemp(join(tmpdir(), "entorno-"));
  const otra = await mkdtemp(join(tmpdir(), "entorno-"));
  const guion = join(RAIZ, "operacion/entorno.sh");
  try {
    const { stdout, stderr } = await correr("sh", [guion, "patio.ejemplo.mx"], { cwd: carpeta });
    const archivo = join(carpeta, ".env");
    assert.equal((await stat(archivo)).mode & 0o777, 0o600);
    const entorno = await leerEntorno(archivo);
    // Lo que no puede generar: la llave pública del respaldo, a dónde va y con qué credencial, y a
    // quién se le avisa. Lo demás, completo; también el horario, que trae uno por omisión.
    const faltas = faltasDelEntorno(entorno, TODAS);
    assert.equal(faltas.length, 6, faltas.join("\n"));
    assert.match(faltas.join("\n"), /RESPALDO_LLAVE_PUBLICA/);
    assert.match(faltas.join("\n"), /Falta RESPALDO_SELLO/);
    assert.match(faltas.join("\n"), /Falta RESPALDO_DESTINO\b/);
    assert.match(faltas.join("\n"), /RESPALDO_VIGIA_URL/);
    assert.match(faltas.join("\n"), /Falta RESPALDO_DESTINO_DIARIO/);
    assert.match(faltas.join("\n"), /RESPALDO_VIGIA_DIARIO_URL/);
    assert.deepEqual(leerHorario(entorno.RESPALDO_HORARIO!).length, 14, "cada hora, de 07:00 a 20:00");
    // Con el destino puesto, pide también la credencial del almacenamiento, que viene vacía.
    const conDestino = {
      ...entorno, RESPALDO_LLAVE_PUBLICA: BUENO.RESPALDO_LLAVE_PUBLICA, RESPALDO_SELLO: BUENO.RESPALDO_SELLO, RESPALDO_VIGIA_URL: BUENO.RESPALDO_VIGIA_URL, RESPALDO_DESTINO: BUENO.RESPALDO_DESTINO,
      RESPALDO_DESTINO_DIARIO: BUENO.RESPALDO_DESTINO_DIARIO, RESPALDO_VIGIA_DIARIO_URL: BUENO.RESPALDO_VIGIA_DIARIO_URL,
    };
    assert.match(faltasDelEntorno(conDestino, TODAS).join("\n"), /RCLONE_CONFIG_RESPALDO_ACCESS_KEY_ID[^]*RCLONE_CONFIG_RESPALDO_SECRET_ACCESS_KEY[^]*RCLONE_CONFIG_DIARIO_ACCESS_KEY_ID[^]*RCLONE_CONFIG_DIARIO_SECRET_ACCESS_KEY/);
    assert.deepEqual(faltasDelEntorno({
      ...conDestino, RCLONE_CONFIG_RESPALDO_ACCESS_KEY_ID: BUENO.RCLONE_CONFIG_RESPALDO_ACCESS_KEY_ID,
      RCLONE_CONFIG_RESPALDO_SECRET_ACCESS_KEY: BUENO.RCLONE_CONFIG_RESPALDO_SECRET_ACCESS_KEY,
      RCLONE_CONFIG_DIARIO_ACCESS_KEY_ID: BUENO.RCLONE_CONFIG_DIARIO_ACCESS_KEY_ID,
      RCLONE_CONFIG_DIARIO_SECRET_ACCESS_KEY: BUENO.RCLONE_CONFIG_DIARIO_SECRET_ACCESS_KEY,
    }, TODAS), []);
    assert.equal(entorno.DOMINIO, "patio.ejemplo.mx");
    assert.equal(entorno.COMPOSE_FILE, "docker-compose.yml:docker-compose.operacion.yml");
    assert.notEqual(entorno.MODO, "desarrollo");
    // Ninguna clave salió por la pantalla.
    for (const clave of [entorno.BD_CLAVE, entorno.WEB_BD_CLAVE, entorno.SESION_CLAVE]) {
      assert.ok(clave && !(stdout + stderr).includes(clave));
    }
    // No pisa uno que ya existe.
    const antes = await readFile(archivo, "utf8");
    await assert.rejects(correr("sh", [guion, "otro.ejemplo.mx"], { cwd: carpeta }), (e: any) => /ya existe/.test(e.stderr));
    assert.equal(await readFile(archivo, "utf8"), antes);
    // Dos corridas no repiten ninguna clave.
    await correr("sh", [guion, "patio.ejemplo.mx"], { cwd: otra });
    const segundo = await leerEntorno(join(otra, ".env"));
    for (const clave of ["BD_CLAVE", "WEB_BD_CLAVE", "SESION_CLAVE"]) assert.notEqual(segundo[clave], entorno[clave], clave);
    // Sin dominio, o con uno que no lo es, no genera nada.
    for (const malo of [[], ["https://patio.ejemplo.mx"], ["patio.ejemplo.mx/app"]]) {
      const vacia = await mkdtemp(join(tmpdir(), "entorno-"));
      await assert.rejects(correr("sh", [guion, ...malo], { cwd: vacia }));
      await assert.rejects(stat(join(vacia, ".env")));
      await rm(vacia, { recursive: true });
    }
  } finally {
    await rm(carpeta, { recursive: true });
    await rm(otra, { recursive: true });
  }
});

test("el horario que el entorno acepta es el que el respaldo sabe leer", () => {
  for (const horario of ["07:00", "07:00,08:00", "07:00, 19:30", "00:00,23:59"]) {
    assert.deepEqual(faltasDelEntorno({ ...BUENO, RESPALDO_HORARIO: horario }, ["respaldo"]), [], horario);
    assert.ok(leerHorario(horario).length > 0);
  }
  for (const horario of ["7:00", "07:00;08:00", "07:00,", "24:00", "07:60", " "]) {
    assert.match(faltasDelEntorno({ ...BUENO, RESPALDO_HORARIO: horario }, ["respaldo"]).join("\n"), /RESPALDO_HORARIO/, horario);
    assert.throws(() => leerHorario(horario), horario);
  }
});
