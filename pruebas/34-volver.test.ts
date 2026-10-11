// Volver al respaldo previo: lo que se le hace al servidor de la base. La base que falló no se
// borra: se aparta con otro nombre, para dejarle libre el suyo a la que se restaura. Qué bases
// existen, con qué nombre y con qué marca, es la evidencia con que se retoma una vuelta que murió
// a la mitad.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import pg from "pg";
import { comoApp, conBase, conBaseVacia, una, urlDe } from "./apoyo.ts";
import { apartar, bases, quitarVacia } from "../operacion/volver.ts";

const correr = promisify(execFile);
const RAIZ = fileURLToPath(new URL("..", import.meta.url));
const SERVIDOR = urlDe("postgres");

/** Borra, al terminar, las bases que la prueba haya dejado con esos nombres. */
async function conLimpieza(nombres: string[], prueba: () => Promise<void>): Promise<void> {
  try {
    await prueba();
  } finally {
    const admin = new pg.Client({ connectionString: SERVIDOR });
    await admin.connect();
    for (const nombre of nombres) await admin.query(`DROP DATABASE IF EXISTS ${nombre} WITH (FORCE)`);
    await admin.end();
  }
}

test("apartar le cambia el nombre a la base, sin borrarla: su nombre queda libre y lo que traía sigue ahí", () =>
  conBase(async (db, base) => {
    const marca = (await una(db, "SELECT id FROM vida")).id as string;
    await db.query("SELECT cerrar_operacion('Publicar una versión', 'pub-1')");
    const aparte = `${base}_fallida_7`;
    await conLimpieza([aparte], async () => {
      assert.deepEqual(await bases(SERVIDOR, base), [{ nombre: base, marca }]);
      await db.end();
      await apartar(SERVIDOR, base, aparte);
      assert.deepEqual(await bases(SERVIDOR, base), [{ nombre: aparte, marca }]);
      const apartada = new pg.Client({ connectionString: urlDe(aparte) });
      await apartada.connect();
      try {
        assert.deepEqual(await una(apartada, "SELECT abierta, publicacion FROM mantenimiento"), { abierta: false, publicacion: "pub-1" });
      } finally {
        await apartada.end();
      }
      // Repetirlo —se perdió la respuesta— no encuentra qué apartar, y lo dice: no aparta otra cosa.
      await assert.rejects(apartar(SERVIDOR, base, aparte), /ya existe/);
    });
  }));

test("no se aparta con alguien adentro, ni sobre un nombre que ya existe, ni lo que no hay; y nada cambia", () =>
  conBase(async (db, base) => {
    const aparte = `${base}_fallida_7`;
    await conLimpieza([aparte], async () => {
      const marca = (await una(db, "SELECT id FROM vida")).id as string;
      // La conexión de la propia prueba, y una de la aplicación: dos sesiones adentro.
      const app = await comoApp(base);
      try {
        await assert.rejects(apartar(SERVIDOR, base, aparte), /2 sesiones/);
      } finally {
        await app.end();
      }
      await assert.rejects(apartar(SERVIDOR, base, aparte), /1 sesión/);
      assert.deepEqual(await bases(SERVIDOR, base), [{ nombre: base, marca }]);
      await db.end();
      await assert.rejects(apartar(SERVIDOR, `${base}_que_no_hay`, `${base}_que_no_hay_fallida_1`), /no existe/);
      await assert.rejects(apartar(SERVIDOR, base, `${base}_x; DROP DATABASE postgres`), /no es válido/);
      await assert.rejects(apartar(SERVIDOR, `${base}"; DROP`, `${base}"; DROP_fallida_1`), /no es válido/);
      await assert.rejects(apartar(SERVIDOR, "postgres", aparte), /nombre|no es de esta instalación/);
      // El nombre de destino tiene que ser de la misma instalación: el de la base, y algo más.
      await assert.rejects(apartar(SERVIDOR, base, "otra_cosa_fallida_7"), /no es de esta instalación/);
      assert.deepEqual(await bases(SERVIDOR, base), [{ nombre: base, marca }]);
    });
  }));

test("las bases de la instalación: la que atiende, las apartadas y la que quedó a medio restaurar; las de otros no", () =>
  conBase(async (db, base) =>
    conBase(async (_ajena, otraInstalacion) => {
      const marca = (await una(db, "SELECT id FROM vida")).id as string;
      const admin = new pg.Client({ connectionString: SERVIDOR });
      await admin.connect();
      await conLimpieza([`${base}_restaurando`, `${base}_fallida_3`], async () => {
        try {
          // Una a medio restaurar: existe, y todavía no tiene marca.
          await admin.query(`CREATE DATABASE ${base}_restaurando`);
          await admin.query(`CREATE DATABASE ${base}_fallida_3`);
          const hay = await bases(SERVIDOR, base);
          assert.deepEqual(hay, [{ nombre: base, marca }, { nombre: `${base}_fallida_3`, marca: null }, { nombre: `${base}_restaurando`, marca: null }]);
          assert.equal(hay.some((b) => b.nombre === otraInstalacion), false);
        } finally {
          await admin.end();
        }
      });
    }),
  ));

test("en una máquina nueva la base existe, vacía: se quita para restaurar en su lugar; una que tiene algo no se quita nunca", () =>
  conBaseVacia(async (vacia) => {
    const existe = async (nombre: string): Promise<boolean> => {
      const admin = new pg.Client({ connectionString: SERVIDOR });
      await admin.connect();
      try {
        return (await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [nombre])).rows.length > 0;
      } finally {
        await admin.end();
      }
    };
    // Con alguien adentro, no.
    const adentro = new pg.Client({ connectionString: urlDe(vacia) });
    await adentro.connect();
    try {
      await assert.rejects(quitarVacia(SERVIDOR, vacia), /1 sesión/);
    } finally {
      await adentro.end();
    }
    assert.equal(await existe(vacia), true);
    await quitarVacia(SERVIDOR, vacia);
    assert.equal(await existe(vacia), false);
    // Quitar lo que ya no está no es un error: se perdió la respuesta, y se manda otra vez.
    await quitarVacia(SERVIDOR, vacia);
    await assert.rejects(quitarVacia(SERVIDOR, "Nombre Raro; DROP"), /no es válido/);

    // Una base con algo —la del sistema, o una con una sola tabla de quien sea— no es «vacía».
    await conBase(async (db, conDatos) => {
      await db.end();
      await assert.rejects(quitarVacia(SERVIDOR, conDatos), /no está vacía/);
      assert.equal(await existe(conDatos), true);
    });
    await conBaseVacia(async (casi) => {
      const db = new pg.Client({ connectionString: urlDe(casi) });
      await db.connect();
      await db.query("CREATE TABLE algo (id int)");
      await db.end();
      await assert.rejects(quitarVacia(SERVIDOR, casi), /no está vacía/);
      assert.equal(await existe(casi), true);
    });
  }));

test("por la línea de órdenes: las bases, una por renglón con su marca; y apartar la de la instalación", () =>
  conBase(async (db, base) => {
    const marca = (await una(db, "SELECT id FROM vida")).id as string;
    const aparte = `${base}_fallida_2`;
    const orden = (...args: string[]) =>
      correr("node", ["operacion/volver.ts", ...args], { cwd: RAIZ, env: { PATH: process.env.PATH, DATABASE_URL: urlDe(base), MODO: "desarrollo" } });
    await conLimpieza([aparte], async () => {
      assert.equal((await orden("bases")).stdout.trim(), `${base} ${marca}`);
      for (const args of [[], ["apartar"], ["apartar", "a", "b"], ["borrar", base], ["bases", "todas"], ["quitar-vacia", "ya"]]) {
        await assert.rejects(orden(...args), (e: any) => e.code === 2 && /Uso:/.test(e.stderr), args.join(" "));
      }
      await assert.rejects(orden("apartar", aparte), (e: any) => e.code === 1 && /1 sesión/.test(e.stderr));
      // La de la instalación tiene datos: por la línea de órdenes tampoco se quita.
      await assert.rejects(orden("quitar-vacia"), (e: any) => e.code === 1 && /1 sesión|no está vacía/.test(e.stderr));
      await db.end();
      await orden("apartar", aparte);
      assert.equal((await orden("bases")).stdout.trim(), `${aparte} ${marca}`);
    });
  }));
