// La operación se cierra y se abre en la base. «En mantenimiento» es un estado durable: sobrevive a
// reiniciar el motor y a recrear contenedores, viaja en el respaldo, y cada ruta lo consulta en
// cada petición (eso se prueba en pruebas/17-rutas.test.ts). Lo cambia solo la administración.
//
// Cerrar y abrir pertenecen a una publicación, que se nombra. Abrir va en dos pasos —decidir, y
// abrir— porque de la decisión en adelante ya no hay vuelta: quien retome una publicación que
// murió a la mitad necesita saber, leyendo la base, si ya se había decidido.
import assert from "node:assert/strict";
import { cp, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { comoApp, conBase, conBaseVacia, rechaza, una, urlDe } from "./apoyo.ts";
import { migrar } from "../db/migrar.ts";
import { LIMPIO, conDestino, conPatio, llaves, respaldoCifrado, retrato, urlEn } from "./patio.ts";
import { restaurar } from "../operacion/restaurar.ts";

const estado = (db: pg.Client) => una(db, "SELECT abierta, motivo, publicacion, decidida_en, abrio_en FROM mantenimiento");
const marca = async (db: pg.Client): Promise<string> => (await una(db, "SELECT id FROM vida")).id;
const cerrar = (db: pg.Client, publicacion: string, motivo = "Publicar una versión") => una(db, "SELECT * FROM cerrar_operacion($1, $2)", [motivo, publicacion]);
const decidir = (db: pg.Client, publicacion: string) => una(db, "SELECT * FROM decidir_abrir($1)", [publicacion]);
const abrir = (db: pg.Client, publicacion: string, deCual: string) => una(db, "SELECT * FROM abrir_operacion($1, $2)", [publicacion, deCual]);
const notas = async (db: pg.Client) =>
  (await db.query("SELECT entidad_id, detalle FROM bitacora WHERE accion = 'mantenimiento' ORDER BY id")).rows.map((n) => [n.entidad_id, n.detalle.paso, n.detalle.publicacion]);

test("la operación nace abierta; cerrarla dice por qué y para cuál publicación, y queda en la bitácora", () =>
  conBase(async (db) => {
    assert.deepEqual(await estado(db), { abierta: true, motivo: null, publicacion: null, decidida_en: null, abrio_en: null });
    const cerrada = await cerrar(db, "pub-1", "  Publicar la versión de octubre ");
    assert.deepEqual([cerrada.abierta, cerrada.motivo, cerrada.publicacion], [false, "Publicar la versión de octubre", "pub-1"]);
    assert.deepEqual(await notas(db), [["pub-1", "cerrar", "pub-1"]]);
    // Sin motivo o sin decir de cuál publicación, no se cierra.
    await rechaza(db.query("SELECT cerrar_operacion('  ', 'pub-2')"), "RC005");
    await rechaza(db.query("SELECT cerrar_operacion('Motivo', NULL)"), "RC005");
    await rechaza(db.query("SELECT cerrar_operacion('Motivo', '   ')"), "RC005");
  }));

test("se abre en dos pasos —decidir y abrir—, comprobando la publicación y la marca de la base; cada paso queda anotado", () =>
  conBase(async (db) => {
    await cerrar(db, "pub-1");
    // Abrir sin haber decidido: no.
    await rechaza(abrir(db, "pub-1", await marca(db)), "RC005");
    const decidida = await decidir(db, "pub-1");
    assert.ok(decidida.decidida_en);
    assert.equal(decidida.abierta, false, "decidir no abre");
    // Abrir para otra publicación, o diciendo otra base: no.
    await rechaza(abrir(db, "pub-2", await marca(db)), "RC005");
    await rechaza(abrir(db, "pub-1", "00000000-0000-4000-8000-000000000000"), "RC005");
    await rechaza(db.query("SELECT abrir_operacion('pub-1', NULL)"), "RC005");
    assert.equal((await estado(db)).abierta, false);

    const abierta = await abrir(db, "pub-1", await marca(db));
    assert.deepEqual([abierta.abierta, abierta.motivo, abierta.publicacion], [true, null, "pub-1"]);
    assert.ok(abierta.abrio_en && abierta.decidida_en, "no dejó escrito que se decidió y que abrió");
    assert.deepEqual((await notas(db)).map((n) => n[1]), ["cerrar", "decidir", "abrir"]);
  }));

test("repetir un paso con la misma publicación no cambia nada: se perdió la respuesta, y se manda otra vez", () =>
  conBase(async (db) => {
    const uno = await cerrar(db, "pub-1");
    const dos = await cerrar(db, "pub-1", "Otro texto, pero el mismo cierre");
    assert.deepEqual([dos.motivo, String(dos.cambio_en)], [uno.motivo, String(uno.cambio_en)]);
    const d1 = await decidir(db, "pub-1");
    const d2 = await decidir(db, "pub-1");
    assert.equal(String(d2.decidida_en), String(d1.decidida_en));
    const a1 = await abrir(db, "pub-1", await marca(db));
    const a2 = await abrir(db, "pub-1", await marca(db));
    assert.equal(String(a2.abrio_en), String(a1.abrio_en));
    // Ni la bitácora se llena de repeticiones.
    assert.deepEqual((await notas(db)).map((n) => n[1]), ["cerrar", "decidir", "abrir"]);
  }));

test("una publicación no pisa a otra: cerrar lo que otra cerró, decidir por otra, o volver a decidir cuando ya abrió, se rechaza", () =>
  conBase(async (db) => {
    await cerrar(db, "pub-1");
    await rechaza(cerrar(db, "pub-2"), "RC005");
    await rechaza(decidir(db, "pub-2"), "RC005");
    await decidir(db, "pub-1");
    // Ya se decidió abrir: cerrar «otra vez» esa misma publicación no deshace la decisión.
    const sigue = await cerrar(db, "pub-1");
    assert.ok(sigue.decidida_en, "volver a cerrar borró la decisión de abrir");
    await abrir(db, "pub-1", await marca(db));
    // Abierta por pub-1. Decidir de nuevo no tiene sentido; cerrar para la misma publicación, tampoco: ya terminó.
    await rechaza(decidir(db, "pub-1"), "RC005");
    await rechaza(cerrar(db, "pub-1"), "RC005");
    // La siguiente publicación sí cierra, y empieza limpia: sin decisión ni apertura heredadas.
    const otra = await cerrar(db, "pub-2");
    assert.deepEqual([otra.abierta, otra.publicacion, otra.decidida_en, otra.abrio_en], [false, "pub-2", null, null]);
    await rechaza(abrir(db, "pub-1", await marca(db)), "RC005");
  }));

// Lo encontró Codex en su décima revisión: «ya terminó» solo se comparaba con la última publicación. Una de antes
// podía volver a cerrar la operación, y quedarse con ella.
test("una publicación que ya terminó no vuelve a cerrar, aunque después hayan pasado otras: la base lleva el registro de las que ya cerraron, y no se toca", () =>
  conBase(async (db) => {
    const laMarca = await marca(db);
    for (const publicacion of ["pub-1", "pub-2"]) {
      await cerrar(db, publicacion);
      await decidir(db, publicacion);
      await abrir(db, publicacion, laMarca);
    }
    await rechaza(cerrar(db, "pub-1"), "RC005");
    const sigue = await estado(db);
    assert.deepEqual([sigue.abierta, sigue.publicacion], [true, "pub-2"]);
    // Una nueva sí cierra; y repetir su cierre —se perdió la respuesta— sigue sin cambiar nada.
    const tres = await cerrar(db, "pub-3");
    assert.equal(String((await cerrar(db, "pub-3")).cambio_en), String(tres.cambio_en));
    assert.deepEqual((await db.query("SELECT publicacion FROM mantenimiento_publicacion ORDER BY cerro_en, publicacion")).rows.map((f) => f.publicacion), ["pub-1", "pub-2", "pub-3"]);
    // El registro solo crece: como dueño de la base, sin apagar reglas, no se edita, no se borra ni se vacía.
    await rechaza(db.query("UPDATE mantenimiento_publicacion SET publicacion = 'otra' WHERE publicacion = 'pub-1'"), "RC001");
    await rechaza(db.query("DELETE FROM mantenimiento_publicacion WHERE publicacion = 'pub-1'"), "RC001");
    await rechaza(db.query("TRUNCATE mantenimiento_publicacion"), "RC001");
  }));

test("al instalar ese registro en una base que ya había cerrado y abierto, entran las publicaciones de antes: las dice la bitácora", () =>
  conBaseVacia(async (base) => {
    const todas = fileURLToPath(new URL("../db/migraciones", import.meta.url));
    const sinEl = await mkdtemp(join(tmpdir(), "sin-registro-"));
    const db = new pg.Client({ connectionString: urlDe(base) });
    await db.connect();
    try {
      await cp(todas, sinEl, { recursive: true });
      for (const archivo of await readdir(sinEl)) if (archivo >= "0028") await rm(join(sinEl, archivo));
      await migrar(db, sinEl);
      const laMarca = await marca(db);
      for (const publicacion of ["pub-1", "pub-2"]) {
        await cerrar(db, publicacion);
        await decidir(db, publicacion);
        await abrir(db, publicacion, laMarca);
      }
      // Y una tercera que solo alcanzó a cerrar: es la que tiene la operación ahora.
      await cerrar(db, "pub-3");
      await migrar(db, todas);
      assert.deepEqual((await db.query("SELECT publicacion FROM mantenimiento_publicacion ORDER BY publicacion")).rows.map((f) => f.publicacion), ["pub-1", "pub-2", "pub-3"]);
      // La que la tenía cerrada la sigue teniendo, y termina lo suyo; las de antes ya no vuelven.
      assert.equal((await cerrar(db, "pub-3")).publicacion, "pub-3");
      await decidir(db, "pub-3");
      await abrir(db, "pub-3", laMarca);
      for (const publicacion of ["pub-1", "pub-2", "pub-3"]) await rechaza(cerrar(db, publicacion), "RC005");
    } finally {
      await db.end();
      await rm(sinEl, { recursive: true, force: true });
    }
  }));

test("la aplicación no puede cerrar ni abrir: solo lee el estado", () =>
  conBase(async (db, base) => {
    const app = await comoApp(base);
    try {
      assert.equal((await una(app, "SELECT abierta FROM mantenimiento")).abierta, true);
      for (const sql of [
        "SELECT cerrar_operacion('Porque sí', 'pub-x')", "SELECT decidir_abrir('pub-x')", `SELECT abrir_operacion('pub-x', '${await marca(db)}')`,
        "UPDATE mantenimiento SET abierta = false, motivo = 'x', publicacion = 'y'", "DELETE FROM mantenimiento", "INSERT INTO mantenimiento (unica, abierta) VALUES (false, true)",
      ]) {
        await rechaza(app.query(sql), "42501");
      }
      await cerrar(db, "pub-1");
      assert.equal((await una(app, "SELECT abierta FROM mantenimiento")).abierta, false);
      await rechaza(app.query("UPDATE mantenimiento SET abierta = true, motivo = NULL"), "42501");
    } finally {
      await app.end();
    }
  }));

test("como dueño de la base, el estado no queda a medias: es una sola fila, y abierta no lleva motivo ni cerrada va sin él", () =>
  conBase(async (db) => {
    await rechaza(db.query("INSERT INTO mantenimiento (unica, abierta) VALUES (false, true)"), "23514");
    await rechaza(db.query("UPDATE mantenimiento SET abierta = false"), "23514");
    await rechaza(db.query("UPDATE mantenimiento SET motivo = 'x'"), "23514");
    await rechaza(db.query("DELETE FROM mantenimiento"), "RC001");
    await rechaza(db.query("TRUNCATE mantenimiento"), "RC001");
  }));

test("viaja en el respaldo: uno tomado con la operación cerrada, restaura cerrado; y ahí se abre con la marca de la base restaurada, no con la de antes", () =>
  conPatio(async (p) => {
    const carpeta = await mkdtemp(join(tmpdir(), "mantenimiento-"));
    const llaveDeAntes = await llaves();
    // Un respaldo de cuando estaba abierta, para comparar: restaura abierta, y lo dice.
    const abierto = await respaldoCifrado(p.base, carpeta, llaveDeAntes.publica, "abierto");
    await cerrar(p.db, "pub-1");
    const marcaDeAntes = await marca(p.db);
    try {
      await conDestino(async (destino) => {
        const dicho: string[] = [];
        await restaurar({ servidor: LIMPIO, base: destino, archivo: abierto, llave: llaveDeAntes.privada, usuarioWeb: "feruga_prueba", claveWeb: "prueba", nota: "Ensayo", decir: (l) => dicho.push(l) });
        assert.match(dicho.join("\n"), /La operación quedó abierta, como estaba en el respaldo/);
      });
      const llave = await llaves();
      const antes = await retrato(p.db);
      assert.deepEqual([antes.mantenimiento.abierta, antes.mantenimiento.publicacion], [false, "pub-1"]);
      const archivo = await respaldoCifrado(p.base, carpeta, llave.publica);
      // Después del respaldo, en la base de origen se termina la publicación: eso no viene en el respaldo.
      await decidir(p.db, "pub-1");
      await abrir(p.db, "pub-1", marcaDeAntes);
      await conDestino(async (destino) => {
        const dicho: string[] = [];
        await restaurar({ servidor: LIMPIO, base: destino, archivo, llave: llave.privada, usuarioWeb: "feruga_prueba", claveWeb: "prueba", nota: "Ensayo", decir: (l) => dicho.push(l) });
        // Restaurar dice en qué quedó la operación: quien restaura tiene que saber que no está atendiendo.
        assert.match(dicho.join("\n"), /LA OPERACIÓN QUEDÓ CERRADA.*pub-1.*Abrirla es un paso aparte/s);
        const restaurada = new pg.Client({ connectionString: urlEn(LIMPIO, destino) });
        await restaurada.connect();
        try {
          assert.deepEqual((await retrato(restaurada)).mantenimiento, antes.mantenimiento);
          assert.equal((await estado(restaurada)).abierta, false, "restaurar abrió la operación");
          // Abrir es un paso expreso, y sobre ESTA base: su marca es otra.
          await decidir(restaurada, "pub-1");
          const marcaNueva = await marca(restaurada);
          assert.notEqual(marcaNueva, marcaDeAntes);
          await rechaza(abrir(restaurada, "pub-1", marcaDeAntes), "RC005");
          assert.equal((await abrir(restaurada, "pub-1", marcaNueva)).abierta, true);
        } finally {
          await restaurada.end();
        }
      });
    } finally {
      await rm(carpeta, { recursive: true, force: true });
    }
  }));
