// Las entradas del mostrador: cada acción de la pantalla es una función del núcleo que recibe a la
// persona, valida su rol, hace la acción completa y se puede repetir sin duplicar.
// Todas las pruebas llaman con las credenciales de la aplicación.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import type pg from "pg";
import {
  CERRAR_CON_CORTE, CHICA_2, CHICA_3, GRANDE, abrirCuenta, abrirJornada, agregarMaterial, comoApp, conApp, conBase, contar, desenlace,
  equipoDeAlta, esperarQueEspere, material, paraElCorte, personaConClave, pidDe, rechaza, segundaPesada, una, usuario,
} from "./apoyo.ts";
import type { Escenario } from "./apoyo.ts";

const SIN_PERMISO = "42501";
const cuentaDe = (db: pg.Client, id: string) => una(db, "SELECT * FROM operacion WHERE id = $1", [id]);
const resumenDe = (c: pg.Client, id: string) => una(c, "SELECT * FROM cuenta_resumen WHERE operacion_id = $1", [id]);
const confirmarComo = (c: pg.Client, id: string, quien: string, revision: number) =>
  una(c, "SELECT * FROM confirmar_cuenta($1, $2, $3)", [id, quien, revision]);
const terminarVehiculo = (c: pg.Client, id: string, revision: number, responsable: string, clave: string, huella: string) =>
  una(c, "SELECT * FROM terminar_vehiculo($1, $2, $3, $4, $5)", [id, revision, responsable, clave, huella]);

// ── abrir una cuenta ───────────────────────────────────────────────────────

test("abrir una cuenta la deja en la jornada de hoy, con su lista y a nombre de quien la abrió", () =>
  conApp(async (app, db, e) => {
    const id = randomUUID();
    const op = await abrirCuenta(app, "compra", e.mostrador, id, "Camioneta roja");
    assert.equal(op.id, id);
    assert.equal(op.jornada_id, e.jornada);
    assert.equal(op.lista_id, e.lista);
    assert.equal(op.tipo, "compra");
    assert.equal(op.etiqueta, "Camioneta roja");
    assert.equal(op.estado, "borrador");
    assert.equal(op.creada_por, e.mostrador);
    assert.equal(op.revision, 0);
    assert.equal(await contar(db, "operacion"), 1);
  }));

test("abrir de nuevo la misma cuenta devuelve la que ya estaba, con lo que llevaba", () =>
  conApp(async (app, db, e) => {
    const id = randomUUID();
    const primera = await abrirCuenta(app, "compra", e.mostrador, id, "Camioneta roja");
    await agregarMaterial(app, id, e.mat["Cartón"], "10", e.mostrador);
    const revision = (await cuentaDe(db, id)).revision;
    const segunda = await abrirCuenta(app, "compra", e.mostrador, id, "Camioneta roja");
    assert.equal(segunda.id, primera.id);
    assert.equal(segunda.creada_en.getTime(), primera.creada_en.getTime());
    assert.equal(segunda.revision, revision);
    assert.equal(await contar(db, "operacion"), 1);
    assert.equal(await contar(db, "operacion_linea", "operacion_id = $1", [id]), 1);
  }));

test("una cuenta descartada no revive con un reintento", () =>
  conApp(async (app, db, e) => {
    const id = randomUUID();
    await abrirCuenta(app, "compra", e.mostrador, id);
    await app.query("SELECT descartar_cuenta($1, $2)", [id, e.mostrador]);
    await rechaza(abrirCuenta(app, "compra", e.mostrador, id), "RC005");
    assert.equal(await contar(db, "operacion"), 0);
    // Y descartarla otra vez sigue sin fallar.
    assert.equal((await una(app, "SELECT descartar_cuenta($1, $2) AS d", [id, e.mostrador])).d, false);
  }));

test("la misma cuenta con otra etiqueta se rechaza; con la suya, aunque después se le haya cambiado, no", () =>
  conApp(async (app, db, e) => {
    const id = randomUUID();
    await abrirCuenta(app, "compra", e.mostrador, id, "Camioneta roja");
    await rechaza(abrirCuenta(app, "compra", e.mostrador, id, "Camioneta azul"), "RC012");
    await rechaza(abrirCuenta(app, "compra", e.mostrador, id, null), "RC012");
    assert.equal((await cuentaDe(db, id)).etiqueta, "Camioneta roja");
    await app.query("SELECT etiquetar_cuenta($1, 'Don Chuy', $2)", [id, e.mostrador]);
    // El reintento del envío original no deshace el cambio posterior.
    assert.equal((await abrirCuenta(app, "compra", e.mostrador, id, " Camioneta roja ")).etiqueta, "Don Chuy");
  }));

test("el mismo identificador de cuenta con otro sentido se rechaza", () =>
  conApp(async (app, db, e) => {
    const id = randomUUID();
    await abrirCuenta(app, "compra", e.mostrador, id);
    await rechaza(abrirCuenta(app, "venta", e.mostrador, id), "RC012");
    assert.equal((await cuentaDe(db, id)).tipo, "compra");
  }));

test("una cuenta solo es de compra o de venta", () =>
  conApp(async (app, db, e) => {
    await rechaza(abrirCuenta(app, "regalo", e.mostrador), "RC005");
    await rechaza(abrirCuenta(app, "", e.mostrador), "RC005");
    assert.equal(await contar(db, "operacion"), 0);
  }));

test("sin jornada abierta no se abre una cuenta", () =>
  conBase(async (db, base) => {
    const luis = await usuario(db, "Luis", "mostrador");
    const app = await comoApp(base);
    try {
      await rechaza(abrirCuenta(app, "compra", luis), "RC006");
    } finally {
      await app.end();
    }
  }));

test("con la lista de precios sin publicar no se abre una cuenta", () =>
  conBase(async (db, base) => {
    const servando = await usuario(db, "Servando", "responsable", true);
    await abrirJornada(db, servando);
    const app = await comoApp(base);
    try {
      await rechaza(abrirCuenta(app, "compra", servando), "RC009");
    } finally {
      await app.end();
    }
  }));

test("dos envíos a la vez de la misma cuenta dejan una sola", () =>
  conApp(async (app, db, e, base) => {
    const otra = await comoApp(base);
    try {
      const id = randomUUID();
      const pid = await pidDe(otra);
      await app.query("BEGIN");
      const primera = await abrirCuenta(app, "compra", e.mostrador, id);
      const segunda = abrirCuenta(otra, "compra", e.mostrador, id);
      await esperarQueEspere(db, pid);
      await app.query("COMMIT");
      assert.equal((await segunda).id, primera.id);
      assert.equal(await contar(db, "operacion"), 1);
    } finally {
      await otra.end();
    }
  }));

// ── agregar un material con su peso ────────────────────────────────────────

test("agregar un material deja el renglón con su peso, el precio de la lista y la pesada a nombre de quien pesó", () =>
  conApp(async (app, db, e) => {
    const op = (await abrirCuenta(app, "compra", e.mostrador)).id;
    const linea = randomUUID();
    const captura = randomUUID();
    const l = await agregarMaterial(app, op, e.mat["Cartón"], "30.2", e.patio, { linea, captura });
    assert.equal(l.id, linea);
    assert.equal(l.operacion_id, op);
    assert.equal(l.precio_unitario, "2.1000");
    assert.equal(l.peso_bruto, "30.200");
    assert.equal(l.importe, "63.42");
    const c = await una(db, "SELECT * FROM captura_peso WHERE id = $1", [captura]);
    assert.equal(c.origen, "tecleada");
    assert.equal(c.tomada_por, e.patio);
    assert.equal(c.instrumento_id, CHICA_2);
    assert.equal(await contar(db, "linea_pesada", "linea_id = $1 AND orden = 1 AND captura_id = $2", [linea, captura]), 1);
    assert.ok((await cuentaDe(db, op)).revision > 0);
  }));

test("en una venta el material sale al precio de venta", () =>
  conApp(async (app, db, e) => {
    await db.query("SELECT registrar_apertura($1, 500, 'contado', $2)", [e.mat["Cartón"], e.responsable]);
    const op = (await abrirCuenta(app, "venta", e.mostrador)).id;
    const l = await agregarMaterial(app, op, e.mat["Cartón"], "10", e.mostrador);
    assert.equal(l.precio_unitario, "2.5000");
  }));

test("repetir el envío de un material devuelve el mismo y no agrega otro", () =>
  conApp(async (app, db, e) => {
    const op = (await abrirCuenta(app, "compra", e.mostrador)).id;
    const envio = { linea: randomUUID(), captura: randomUUID() };
    const primero = await agregarMaterial(app, op, e.mat["Cartón"], "30.2", e.mostrador, envio);
    const revision = (await cuentaDe(db, op)).revision;
    const segundo = await agregarMaterial(app, op, e.mat["Cartón"], "30.2", e.mostrador, envio);
    const conCeros = await agregarMaterial(app, op, e.mat["Cartón"], "30.200", e.mostrador, envio);
    assert.equal(segundo.id, primero.id);
    assert.equal(conCeros.id, primero.id);
    assert.equal(await contar(db, "operacion_linea"), 1);
    assert.equal(await contar(db, "captura_peso"), 1);
    assert.equal((await cuentaDe(db, op)).revision, revision);
  }));

test("el mismo envío con otro contenido se rechaza y no cambia nada", () =>
  conApp(async (app, db, e) => {
    const op = (await abrirCuenta(app, "compra", e.mostrador)).id;
    const otra = (await abrirCuenta(app, "compra", e.mostrador)).id;
    const envio = { linea: randomUUID(), captura: randomUUID() };
    await agregarMaterial(app, op, e.mat["Cartón"], "30.2", e.mostrador, envio);
    // RC012: ese identificador ya lo ocupa otro envío. No es una regla sobre el material: es que el identificador ya no sirve.
    await rechaza(agregarMaterial(app, op, e.mat["Cartón"], "31", e.mostrador, envio), "RC012");
    await rechaza(agregarMaterial(app, op, e.mat["PET"], "30.2", e.mostrador, envio), "RC012");
    await rechaza(agregarMaterial(app, op, e.mat["Cartón"], "30.2", e.mostrador, { ...envio, bascula: CHICA_3 }), "RC012");
    await rechaza(agregarMaterial(app, op, e.mat["Cartón"], "30.2", e.mostrador, { ...envio, captura: randomUUID() }), "RC012");
    await rechaza(agregarMaterial(app, otra, e.mat["Cartón"], "30.2", e.mostrador, envio), "RC012");
    assert.equal(await contar(db, "operacion_linea"), 1);
    assert.equal((await una(db, "SELECT peso_bruto FROM operacion_linea WHERE id = $1", [envio.linea])).peso_bruto, "30.200");
  }));

test("una pesada ya usada no sirve para otro material", () =>
  conApp(async (app, db, e) => {
    const op = (await abrirCuenta(app, "compra", e.mostrador)).id;
    const captura = randomUUID();
    const primero = await agregarMaterial(app, op, e.mat["Cartón"], "30.2", e.mostrador, { captura });
    await rechaza(agregarMaterial(app, op, e.mat["PET"], "30.2", e.mostrador, { captura }), "RC005");
    // Tampoco después de quitar el material que la usó.
    await app.query("SELECT quitar_material($1, $2)", [primero.id, e.mostrador]);
    await rechaza(agregarMaterial(app, op, e.mat["Cartón"], "30.2", e.mostrador, { linea: primero.id, captura }), "RC005");
    assert.equal(await contar(db, "operacion_linea"), 0);
  }));

test("un peso que la báscula no puede marcar no deja ni renglón ni pesada", () =>
  conApp(async (app, db, e) => {
    const op = (await abrirCuenta(app, "compra", e.mostrador)).id;
    await rechaza(agregarMaterial(app, op, e.mat["Cartón"], "1500", e.mostrador), "RC004"); // rebasa la capacidad
    await rechaza(agregarMaterial(app, op, e.mat["Cartón"], "10.5", e.mostrador, { bascula: GRANDE }), "RC004"); // la grande va de kilo en kilo
    assert.equal(await contar(db, "operacion_linea"), 0);
    assert.equal(await contar(db, "captura_peso"), 0);
    assert.equal((await cuentaDe(db, op)).revision, 0);
  }));

test("un peso con más de tres decimales se rechaza en vez de redondearse", () =>
  conApp(async (app, db, e) => {
    const op = (await abrirCuenta(app, "compra", e.mostrador)).id;
    await rechaza(agregarMaterial(app, op, e.mat["Cartón"], "10.0004", e.mostrador), "RC004");
    await rechaza(agregarMaterial(app, op, e.mat["Cartón"], "10.0005", e.mostrador), "RC004");
    assert.equal(await contar(db, "operacion_linea"), 0);
    assert.equal(await contar(db, "captura_peso"), 0);
  }));

test("un peso en cero, negativo o que no es número se rechaza", () =>
  conApp(async (app, db, e) => {
    const op = (await abrirCuenta(app, "compra", e.mostrador)).id;
    for (const malo of ["0", "-5", "NaN"]) {
      await rechaza(agregarMaterial(app, op, e.mat["Cartón"], malo, e.mostrador), "RC004");
    }
    await rechaza(
      app.query("SELECT agregar_material($1, $2, $3, 2::smallint, $4, NULL, $5)", [op, randomUUID(), e.mat["Cartón"], randomUUID(), e.mostrador]),
      "RC004",
    );
    assert.equal(await contar(db, "operacion_linea"), 0);
  }));

test("no se agrega a una cuenta que no existe ni a una ya confirmada", () =>
  conApp(async (app, db, e) => {
    await rechaza(agregarMaterial(app, randomUUID(), e.mat["Cartón"], "10", e.mostrador), "RC005");
    const op = (await abrirCuenta(app, "compra", e.mostrador)).id;
    await agregarMaterial(app, op, e.mat["Cartón"], "10", e.mostrador);
    await confirmarComo(app, op, e.mostrador, (await cuentaDe(db, op)).revision);
    await rechaza(agregarMaterial(app, op, e.mat["PET"], "5", e.mostrador), "RC001");
    assert.equal(await contar(db, "operacion_linea"), 1);
  }));

test("un material sin precio hoy, o dado de baja, no se agrega", () =>
  conApp(async (app, db, e) => {
    const op = (await abrirCuenta(app, "compra", e.mostrador)).id;
    await rechaza(agregarMaterial(app, op, await material(db, "Plomo"), "10", e.mostrador), "RC009");
    await db.query("UPDATE material SET activo = false WHERE id = $1", [e.mat["PET"]]);
    await rechaza(agregarMaterial(app, op, e.mat["PET"], "10", e.mostrador), "RC005");
    assert.equal(await contar(db, "operacion_linea"), 0);
    assert.equal(await contar(db, "captura_peso"), 0);
  }));

test("en la báscula grande el material queda esperando su segunda pesada", () =>
  conApp(async (app, db, e) => {
    const op = (await abrirCuenta(app, "compra", e.mostrador)).id;
    const l = await agregarMaterial(app, op, e.mat["Fierro pesado"], "5200", e.mostrador, { bascula: GRANDE });
    assert.equal(l.peso_bruto, null);
    assert.equal(await contar(db, "linea_pesada", "linea_id = $1", [l.id]), 1);
    const r = await resumenDe(app, op);
    assert.equal(r.materiales, 1);
    assert.equal(r.por_pesar, 1);
  }));

test("dos envíos a la vez del mismo material dejan uno solo", () =>
  conApp(async (app, db, e, base) => {
    const otra = await comoApp(base);
    try {
      const op = (await abrirCuenta(app, "compra", e.mostrador)).id;
      const envio = { linea: randomUUID(), captura: randomUUID() };
      const pid = await pidDe(otra);
      await app.query("BEGIN");
      const primero = await agregarMaterial(app, op, e.mat["Cartón"], "30.2", e.mostrador, envio);
      const segundo = agregarMaterial(otra, op, e.mat["Cartón"], "30.2", e.mostrador, envio);
      await esperarQueEspere(db, pid);
      await app.query("COMMIT");
      assert.equal((await segundo).id, primero.id);
      assert.equal(await contar(db, "operacion_linea"), 1);
      assert.equal(await contar(db, "captura_peso"), 1);
    } finally {
      await otra.end();
    }
  }));

test("el mismo identificador de material en dos cuentas a la vez: la segunda se rechaza", () =>
  conApp(async (app, db, e, base) => {
    const otra = await comoApp(base);
    try {
      const una_ = (await abrirCuenta(app, "compra", e.mostrador)).id;
      const dos = (await abrirCuenta(app, "compra", e.mostrador)).id;
      const linea = randomUUID();
      const pid = await pidDe(otra);
      await app.query("BEGIN");
      await agregarMaterial(app, una_, e.mat["Cartón"], "30.2", e.mostrador, { linea });
      const segundo = desenlace(agregarMaterial(otra, dos, e.mat["PET"], "5", e.mostrador, { linea }));
      await esperarQueEspere(db, pid);
      await app.query("COMMIT");
      assert.equal(await segundo, "RC012");
      assert.equal(await contar(db, "operacion_linea"), 1);
      assert.equal(await contar(db, "captura_peso"), 1);
    } finally {
      await otra.end();
    }
  }));

test("la misma pesada en dos materiales a la vez: la segunda se rechaza", () =>
  conApp(async (app, db, e, base) => {
    const otra = await comoApp(base);
    try {
      const una_ = (await abrirCuenta(app, "compra", e.mostrador)).id;
      const dos = (await abrirCuenta(app, "compra", e.mostrador)).id;
      const captura = randomUUID();
      const pid = await pidDe(otra);
      await app.query("BEGIN");
      await agregarMaterial(app, una_, e.mat["Cartón"], "30.2", e.mostrador, { captura });
      const segundo = desenlace(agregarMaterial(otra, dos, e.mat["Cartón"], "30.2", e.mostrador, { captura }));
      await esperarQueEspere(db, pid);
      await app.query("COMMIT");
      assert.equal(await segundo, "RC005");
      assert.equal(await contar(db, "operacion_linea"), 1);
      assert.equal(await contar(db, "captura_peso"), 1);
    } finally {
      await otra.end();
    }
  }));

test("el identificador de un material que se quitó no sirve para agregar otra cosa", () =>
  conApp(async (app, db, e) => {
    const op = (await abrirCuenta(app, "compra", e.mostrador)).id;
    const linea = randomUUID();
    await agregarMaterial(app, op, e.mat["Cartón"], "30.2", e.mostrador, { linea });
    await app.query("SELECT quitar_material($1, $2)", [linea, e.mostrador]);
    await rechaza(agregarMaterial(app, op, e.mat["PET"], "5", e.mostrador, { linea }), "RC012");
    assert.equal(await contar(db, "operacion_linea"), 0);
    assert.equal(await contar(db, "captura_peso"), 1);
  }));

test("un peso desmedido o infinito se rechaza como regla, no como error de la base", () =>
  conApp(async (app, db, e) => {
    const op = (await abrirCuenta(app, "compra", e.mostrador)).id;
    for (const malo of ["Infinity", "-Infinity", "1000000000", "1000000", "999999.9991"]) {
      await rechaza(agregarMaterial(app, op, e.mat["Cartón"], malo, e.mostrador), "RC004");
      await rechaza(agregarMaterial(app, op, e.mat["Fierro pesado"], malo, e.mostrador, { bascula: GRANDE }), "RC004");
    }
    const l = await agregarMaterial(app, op, e.mat["Fierro pesado"], "5200", e.mostrador, { bascula: GRANDE });
    for (const malo of ["Infinity", "1000000000"]) {
      await rechaza(segundaPesada(app, l.id, malo, e.mostrador), "RC004");
      await rechaza(app.query("SELECT poner_descuento($1, $2, $3)", [l.id, malo, e.mostrador]), "RC004");
    }
    assert.equal(await contar(db, "captura_peso"), 1);
  }));

test("cerrar la jornada mientras se agrega un material: el que llega segundo respeta al primero", () =>
  conApp(async (app, db, e, base) => {
    const otra = await comoApp(base);
    try {
      // Una cuenta con un vehículo a medio pesar: es la única que deja cerrar la jornada.
      const op = (await abrirCuenta(app, "compra", e.mostrador)).id;
      await agregarMaterial(app, op, e.mat["Fierro pesado"], "5200", e.mostrador, { bascula: GRANDE });
      const pid = await pidDe(otra);
      const corte = await paraElCorte(db, e.mostrador);

      // Primero el cierre: el material que llega después ya no entra.
      await app.query("BEGIN");
      await app.query(CERRAR_CON_CORTE, [e.mostrador, corte.firma, corte.huella, "271828"]);
      const agregado = desenlace(agregarMaterial(otra, op, e.mat["Cartón"], "10", e.mostrador));
      await esperarQueEspere(db, pid);
      await app.query("COMMIT");
      assert.equal(await agregado, "RC006");
      assert.equal(await contar(db, "operacion_linea", "operacion_id = $1", [op]), 1);
    } finally {
      await otra.end();
    }
  }));

test("agregar un material mientras se cierra la jornada: el cierre espera y el material queda", () =>
  conApp(async (app, db, e, base) => {
    const otra = await comoApp(base);
    try {
      const op = (await abrirCuenta(app, "compra", e.mostrador)).id;
      await agregarMaterial(app, op, e.mat["Fierro pesado"], "5200", e.mostrador, { bascula: GRANDE });
      const pid = await pidDe(otra);
      const corte = await paraElCorte(db, e.mostrador);
      await app.query("BEGIN");
      await agregarMaterial(app, op, e.mat["Cartón"], "10", e.mostrador);
      const cierre = desenlace(otra.query(CERRAR_CON_CORTE, [e.mostrador, corte.firma, corte.huella, "271828"]));
      await esperarQueEspere(db, pid);
      await app.query("COMMIT");
      assert.equal(await cierre, "pasó");
      assert.equal(await contar(db, "operacion_linea", "operacion_id = $1", [op]), 2);
    } finally {
      await otra.end();
    }
  }));

// ── la segunda pesada de un vehículo ───────────────────────────────────────

test("en una compra el vehículo se pesa cargado y después vacío", () =>
  conApp(async (app, _db, e) => {
    const op = (await abrirCuenta(app, "compra", e.mostrador)).id;
    const l = await agregarMaterial(app, op, e.mat["Fierro pesado"], "5200", e.mostrador, { bascula: GRANDE });
    const lista = await segundaPesada(app, l.id, "3400", e.patio);
    assert.equal(lista.peso_bruto, "5200.000");
    assert.equal(lista.tara, "3400.000");
    assert.equal(lista.peso_recibido, "1800.000");
    assert.equal((await resumenDe(app, op)).por_pesar, 0);
  }));

test("en una venta el vehículo se pesa vacío y después cargado", () =>
  conApp(async (app, db, e) => {
    await db.query("SELECT registrar_apertura($1, 5000, 'contado', $2)", [e.mat["Fierro pesado"], e.responsable]);
    const op = (await abrirCuenta(app, "venta", e.mostrador)).id;
    const l = await agregarMaterial(app, op, e.mat["Fierro pesado"], "3000", e.mostrador, { bascula: GRANDE });
    const lista = await segundaPesada(app, l.id, "4500", e.mostrador);
    assert.equal(lista.peso_recibido, "1500.000");
  }));

test("repetir la segunda pesada devuelve lo ya asentado; con otro peso se rechaza", () =>
  conApp(async (app, db, e) => {
    const op = (await abrirCuenta(app, "compra", e.mostrador)).id;
    const l = await agregarMaterial(app, op, e.mat["Fierro pesado"], "5200", e.mostrador, { bascula: GRANDE });
    const captura = randomUUID();
    await segundaPesada(app, l.id, "3400", e.mostrador, captura);
    const revision = (await cuentaDe(db, op)).revision;
    const otraVez = await segundaPesada(app, l.id, "3400", e.mostrador, captura);
    assert.equal(otraVez.peso_recibido, "1800.000");
    assert.equal((await cuentaDe(db, op)).revision, revision);
    await rechaza(segundaPesada(app, l.id, "3300", e.mostrador, captura), "RC005");
    await rechaza(segundaPesada(app, l.id, "3400", e.mostrador, randomUUID()), "RC005");
    assert.equal(await contar(db, "captura_peso"), 2);
  }));

test("una segunda pesada que no tiene sentido no deja pesada", () =>
  conApp(async (app, db, e) => {
    const op = (await abrirCuenta(app, "compra", e.mostrador)).id;
    const l = await agregarMaterial(app, op, e.mat["Fierro pesado"], "5200", e.mostrador, { bascula: GRANDE });
    await rechaza(segundaPesada(app, l.id, "5200", e.mostrador), "RC004"); // vacío no puede pesar lo mismo que cargado
    await rechaza(segundaPesada(app, l.id, "6000", e.mostrador), "RC004");
    await rechaza(segundaPesada(app, l.id, "3400.5", e.mostrador), "RC004");
    await rechaza(segundaPesada(app, l.id, "3400.0001", e.mostrador), "RC004");
    assert.equal(await contar(db, "captura_peso"), 1);
    assert.equal((await una(db, "SELECT peso_bruto FROM operacion_linea WHERE id = $1", [l.id])).peso_bruto, null);
  }));

test("en báscula chica no hay segunda pesada, ni en un material que no existe", () =>
  conApp(async (app, _db, e) => {
    const op = (await abrirCuenta(app, "compra", e.mostrador)).id;
    const l = await agregarMaterial(app, op, e.mat["Cartón"], "30", e.mostrador);
    await rechaza(segundaPesada(app, l.id, "10", e.mostrador), "RC004");
    await rechaza(segundaPesada(app, randomUUID(), "10", e.mostrador), "RC005");
  }));

/** Un vehículo pesado cargado ayer; hoy hay jornada nueva, con el fierro a otro precio. */
async function vehiculoDeAyer(app: pg.Client, db: pg.Client, e: Escenario) {
  const op = (await abrirCuenta(app, "compra", e.mostrador)).id;
  const l = await agregarMaterial(app, op, e.mat["Fierro pesado"], "5200", e.mostrador, { bascula: GRANDE });
  const corte = await paraElCorte(db, e.mostrador);
  await app.query(CERRAR_CON_CORTE, [e.mostrador, corte.firma, corte.huella, "271828"]);
  const hoy = await abrirJornada(db, e.responsable, "2026-10-02");
  await db.query("UPDATE precio SET compra = 99 WHERE lista_id = $1", [hoy.lista]);
  await db.query("SELECT publicar_lista($1, $2)", [hoy.lista, e.responsable]);
  const huella = await equipoDeAlta(db);
  const marco = await personaConClave(db, "Marco", "responsable", "481516", true);
  return { op, linea: l.id as string, hoy, huella, marco };
}

test("el vehículo que vuelve otro día se pesa aunque su jornada ya cerró", () =>
  conApp(async (app, db, e) => {
    const v = await vehiculoDeAyer(app, db, e);
    // Ya no se le agregan materiales, pero sí su segunda pesada, al precio del día en que llegó.
    await rechaza(agregarMaterial(app, v.op, e.mat["Cartón"], "10", e.mostrador), "RC006");
    const lista = await segundaPesada(app, v.linea, "3400", e.mostrador);
    assert.equal(lista.peso_recibido, "1800.000");
    assert.equal(lista.precio_unitario, "6.8000");
  }));

test("la confirmación ordinaria no termina un vehículo de otro día, ni siquiera en manos de un responsable", () =>
  conApp(async (app, db, e) => {
    const v = await vehiculoDeAyer(app, db, e);
    await segundaPesada(app, v.linea, "3400", e.mostrador);
    const revision = (await cuentaDe(db, v.op)).revision;
    for (const quien of [e.mostrador, e.responsable, v.marco]) {
      await rechaza(confirmarComo(app, v.op, quien, revision), "RC008");
    }
    assert.equal((await cuentaDe(db, v.op)).estado, "borrador");
    // La función interna, que no pregunta por la clave, ya no es de la aplicación.
    await rechaza(app.query("SELECT confirmar_operacion($1, $2, $3)", [v.op, v.marco, revision]), SIN_PERMISO);
  }));

test("lo termina un responsable que teclea su clave: queda a su nombre, al precio de ayer y asentado hoy", () =>
  conApp(async (app, db, e) => {
    const v = await vehiculoDeAyer(app, db, e);
    await segundaPesada(app, v.linea, "3400", e.mostrador);
    const revision = (await cuentaDe(db, v.op)).revision;
    const c = await terminarVehiculo(app, v.op, revision, v.marco, "481516", v.huella);
    assert.equal(c.estado, "confirmada");
    assert.equal(c.confirmada_por, v.marco);
    assert.equal(c.confirmada_en_jornada, v.hoy.id);
    assert.equal(c.total, "12240");
    // Repetir el envío devuelve lo ya hecho, sin otro folio.
    const otraVez = await terminarVehiculo(app, v.op, revision, v.marco, "481516", v.huella);
    assert.equal(otraVez.folio, c.folio);
    assert.equal(await contar(db, "movimiento_inventario"), 1);
  }));

test("con la clave equivocada el vehículo no se termina, la función contesta que no y el intento queda contado", () =>
  conApp(async (app, db, e) => {
    const v = await vehiculoDeAyer(app, db, e);
    await segundaPesada(app, v.linea, "3400", e.mostrador);
    const revision = (await cuentaDe(db, v.op)).revision;
    const r = await terminarVehiculo(app, v.op, revision, v.marco, "000000", v.huella);
    assert.equal(r.id, null);
    assert.equal((await una(db, "SELECT fallos FROM credencial WHERE usuario_id = $1", [v.marco])).fallos, 1);
    assert.equal((await cuentaDe(db, v.op)).estado, "borrador");
    // Desde un equipo que no está dado de alta, tampoco, aunque la clave sea buena.
    assert.equal((await terminarVehiculo(app, v.op, revision, v.marco, "481516", "f".repeat(64))).id, null);
    // Cinco fallos bloquean la clave: después ni la buena termina el vehículo.
    for (let k = 0; k < 4; k++) await terminarVehiculo(app, v.op, revision, v.marco, "000000", v.huella);
    assert.equal((await terminarVehiculo(app, v.op, revision, v.marco, "481516", v.huella)).id, null);
  }));

test("la clave de quien no es responsable no termina el vehículo", () =>
  conApp(async (app, db, e) => {
    const v = await vehiculoDeAyer(app, db, e);
    await segundaPesada(app, v.linea, "3400", e.mostrador);
    const revision = (await cuentaDe(db, v.op)).revision;
    const luisa = await personaConClave(db, "Luisa", "mostrador", "4815");
    await rechaza(terminarVehiculo(app, v.op, revision, luisa, "4815", v.huella), "RC008");
    assert.equal((await cuentaDe(db, v.op)).estado, "borrador");
  }));

test("lo que no procede se rechaza antes de mirar la clave: no gasta un intento", () =>
  conApp(async (app, db, e) => {
    const v = await vehiculoDeAyer(app, db, e);
    const vieja = (await cuentaDe(db, v.op)).revision;
    await segundaPesada(app, v.linea, "3400", e.mostrador);
    const revision = (await cuentaDe(db, v.op)).revision;
    // Con la revisión de antes de la segunda pesada.
    await rechaza(terminarVehiculo(app, v.op, vieja, v.marco, "000000", v.huella), "RC011");
    // Una cuenta de hoy la termina quien atiende, a su nombre.
    const deHoy = (await abrirCuenta(app, "compra", e.mostrador)).id;
    await agregarMaterial(app, deHoy, e.mat["Cartón"], "10", e.mostrador);
    await rechaza(terminarVehiculo(app, deHoy, (await cuentaDe(db, deHoy)).revision, v.marco, "000000", v.huella), "RC005");
    await rechaza(terminarVehiculo(app, randomUUID(), 0, v.marco, "000000", v.huella), "RC005");
    assert.equal((await una(db, "SELECT fallos FROM credencial WHERE usuario_id = $1", [v.marco])).fallos, 0);
    assert.equal(revision > vieja, true);
  }));

// ── quitar, descontar, etiquetar, descartar ────────────────────────────────

test("quitar un material lo saca de la cuenta; repetirlo no falla", () =>
  conApp(async (app, db, e) => {
    const op = (await abrirCuenta(app, "compra", e.mostrador)).id;
    const l = await agregarMaterial(app, op, e.mat["Cartón"], "30", e.mostrador);
    assert.equal((await una(app, "SELECT quitar_material($1, $2) AS quitado", [l.id, e.patio])).quitado, true);
    assert.equal((await una(app, "SELECT quitar_material($1, $2) AS quitado", [l.id, e.patio])).quitado, false);
    assert.equal(await contar(db, "operacion_linea"), 0);
    // La pesada queda consumida como evidencia.
    assert.equal(await contar(db, "captura_usada"), 1);
  }));

test("de una cuenta confirmada no se quita nada", () =>
  conApp(async (app, db, e) => {
    const op = (await abrirCuenta(app, "compra", e.mostrador)).id;
    const l = await agregarMaterial(app, op, e.mat["Cartón"], "30", e.mostrador);
    await confirmarComo(app, op, e.mostrador, (await cuentaDe(db, op)).revision);
    await rechaza(app.query("SELECT quitar_material($1, $2)", [l.id, e.mostrador]), "RC001");
    await rechaza(app.query("SELECT poner_descuento($1, 1, $2)", [l.id, e.mostrador]), "RC001");
    await rechaza(app.query("SELECT etiquetar_cuenta($1, 'otra', $2)", [op, e.mostrador]), "RC001");
    await rechaza(app.query("SELECT descartar_cuenta($1, $2)", [op, e.responsable]), "RC001");
  }));

test("el descuento en kilos baja lo que se paga, no lo que entra al patio", () =>
  conApp(async (app, _db, e) => {
    const op = (await abrirCuenta(app, "compra", e.mostrador)).id;
    const l = await agregarMaterial(app, op, e.mat["Cartón"], "30.2", e.mostrador);
    const con = await una(app, "SELECT * FROM poner_descuento($1, $2, $3)", [l.id, "0.2", e.mostrador]);
    assert.equal(con.peso_recibido, "30.200");
    assert.equal(con.peso_liquidable, "30.000");
    assert.equal(con.importe, "63.00");
    const sin = await una(app, "SELECT * FROM poner_descuento($1, $2, $3)", [l.id, "0", e.mostrador]);
    assert.equal(sin.importe, "63.42");
  }));

test("un descuento negativo, con más de tres decimales o mayor que el peso se rechaza", () =>
  conApp(async (app, db, e) => {
    const op = (await abrirCuenta(app, "compra", e.mostrador)).id;
    const l = await agregarMaterial(app, op, e.mat["Cartón"], "30.2", e.mostrador);
    for (const malo of ["-1", "0.0005", "NaN", "31"]) {
      await rechaza(app.query("SELECT poner_descuento($1, $2, $3)", [l.id, malo, e.mostrador]), "RC004");
    }
    await rechaza(app.query("SELECT poner_descuento($1, NULL, $2)", [l.id, e.mostrador]), "RC004");
    await rechaza(app.query("SELECT poner_descuento($1, 1, $2)", [randomUUID(), e.mostrador]), "RC005");
    assert.equal((await una(db, "SELECT descuento_kg FROM operacion_linea WHERE id = $1", [l.id])).descuento_kg, "0.000");
  }));

test("la etiqueta se pone, se limpia y cuenta como cambio de la cuenta", () =>
  conApp(async (app, db, e) => {
    const op = (await abrirCuenta(app, "compra", e.mostrador)).id;
    const con = await una(app, "SELECT * FROM etiquetar_cuenta($1, $2, $3)", [op, "  Camioneta roja  ", e.patio]);
    assert.equal(con.etiqueta, "Camioneta roja");
    assert.equal(con.revision, 1);
    const sin = await una(app, "SELECT * FROM etiquetar_cuenta($1, $2, $3)", [op, "   ", e.patio]);
    assert.equal(sin.etiqueta, null);
    await rechaza(app.query("SELECT etiquetar_cuenta($1, $2, $3)", [op, "x".repeat(41), e.patio]), "RC005");
    await rechaza(app.query("SELECT etiquetar_cuenta($1, 'x', $2)", [randomUUID(), e.patio]), "RC005");
    assert.equal((await cuentaDe(db, op)).etiqueta, null);
  }));

test("descartar una cuenta con materiales no deja cuenta ni renglones, pero sí rastro", () =>
  conApp(async (app, db, e) => {
    const op = (await abrirCuenta(app, "venta", e.mostrador, randomUUID(), "Don Chuy")).id;
    await db.query("SELECT registrar_apertura($1, 500, 'contado', $2)", [e.mat["Cartón"], e.responsable]);
    await agregarMaterial(app, op, e.mat["Cartón"], "30", e.mostrador);
    await agregarMaterial(app, op, e.mat["Cartón"], "12.5", e.mostrador);
    assert.equal((await una(app, "SELECT descartar_cuenta($1, $2) AS descartada", [op, e.mostrador])).descartada, true);
    assert.equal(await contar(db, "operacion"), 0);
    assert.equal(await contar(db, "operacion_linea"), 0);
    assert.equal(await contar(db, "captura_usada"), 2);
    const rastro = await una(db, "SELECT * FROM bitacora WHERE accion = 'descartar' AND entidad = 'operacion'");
    assert.equal(rastro.usuario_id, e.mostrador);
    assert.equal(rastro.entidad_id, op);
    assert.deepEqual(rastro.detalle, { tipo: "venta", etiqueta: "Don Chuy", materiales: 2, suma: 106.25 });
    assert.equal((await una(app, "SELECT descartar_cuenta($1, $2) AS descartada", [op, e.mostrador])).descartada, false);
  }));

test("descartar una cuenta vacía no deja rastro: no pasó nada", () =>
  conApp(async (app, db, e) => {
    const op = (await abrirCuenta(app, "compra", e.mostrador)).id;
    await app.query("SELECT descartar_cuenta($1, $2)", [op, e.mostrador]);
    assert.equal(await contar(db, "operacion"), 0);
    assert.equal(await contar(db, "bitacora", "accion = 'descartar'"), 0);
  }));

// ── precios ────────────────────────────────────────────────────────────────

/** Una jornada abierta con su lista todavía sin publicar. */
const conListaAbierta = (prueba: (app: pg.Client, db: pg.Client, p: { responsable: string; mostrador: string; lista: string }) => Promise<void>) =>
  conBase(async (db, base) => {
    const responsable = await usuario(db, "Servando", "responsable", true);
    const mostrador = await usuario(db, "Luis", "mostrador");
    const j = await abrirJornada(db, responsable);
    const app = await comoApp(base);
    try {
      await prueba(app, db, { responsable, mostrador, lista: j.lista });
    } finally {
      await app.end();
    }
  });

test("el responsable pone y cambia el precio de un material en la lista de hoy", () =>
  conListaAbierta(async (app, db, p) => {
    const carton = await material(db, "Cartón");
    const puesto = await una(app, "SELECT * FROM fijar_precio($1, $2, $3, $4)", [carton, "2.1", "2.5", p.responsable]);
    assert.equal(puesto.lista_id, p.lista);
    assert.equal(puesto.compra, "2.1000");
    assert.equal(puesto.venta, "2.5000");
    const cambiado = await una(app, "SELECT * FROM fijar_precio($1, $2, $3, $4)", [carton, "2.3", "2.75", p.responsable]);
    assert.equal(cambiado.compra, "2.3000");
    assert.equal(await contar(db, "precio"), 1);
  }));

test("solo el responsable toca los precios", () =>
  conListaAbierta(async (app, db, p) => {
    const carton = await material(db, "Cartón");
    await rechaza(app.query("SELECT fijar_precio($1, 2.1, 2.5, $2)", [carton, p.mostrador]), "RC008");
    await app.query("SELECT fijar_precio($1, 2.1, 2.5, $2)", [carton, p.responsable]);
    await rechaza(app.query("SELECT quitar_precio($1, $2)", [carton, p.mostrador]), "RC008");
    assert.equal(await contar(db, "precio"), 1);
  }));

test("un precio negativo, con más de cuatro decimales o que no es número se rechaza", () =>
  conListaAbierta(async (app, db, p) => {
    const carton = await material(db, "Cartón");
    for (const [compra, venta] of [["-1", "2"], ["2", "-1"], ["2.00001", "3"], ["2", "3.00001"], ["NaN", "3"], ["2", "NaN"]]) {
      await rechaza(app.query("SELECT fijar_precio($1, $2, $3, $4)", [carton, compra, venta, p.responsable]), "RC009");
    }
    await rechaza(app.query("SELECT fijar_precio($1, NULL, 3, $2)", [carton, p.responsable]), "RC009");
    assert.equal(await contar(db, "precio"), 0);
  }));

test("un precio desmedido o infinito se rechaza como regla", () =>
  conListaAbierta(async (app, db, p) => {
    const carton = await material(db, "Cartón");
    for (const [compra, venta] of [["Infinity", "3"], ["3", "Infinity"], ["10000000000", "3"], ["100000", "3"], ["3", "100000"]]) {
      await rechaza(app.query("SELECT fijar_precio($1, $2, $3, $4)", [carton, compra, venta, p.responsable]), "RC009");
    }
    await app.query("SELECT fijar_precio($1, $2, $3, $4)", [carton, "99999.9999", "99999.9999", p.responsable]);
    assert.equal(await contar(db, "precio"), 1);
  }));

test("no se pone precio a un material que no existe o está dado de baja", () =>
  conListaAbierta(async (app, db, p) => {
    const carton = await material(db, "Cartón");
    await db.query("UPDATE material SET activo = false WHERE id = $1", [carton]);
    await rechaza(app.query("SELECT fijar_precio($1, 2.1, 2.5, $2)", [carton, p.responsable]), "RC005");
    await rechaza(app.query("SELECT fijar_precio(999999, 2.1, 2.5, $1)", [p.responsable]), "RC005");
  }));

test("quitar un precio deja al material sin precio; repetirlo no falla", () =>
  conListaAbierta(async (app, db, p) => {
    const carton = await material(db, "Cartón");
    await app.query("SELECT fijar_precio($1, 2.1, 2.5, $2)", [carton, p.responsable]);
    assert.equal((await una(app, "SELECT quitar_precio($1, $2) AS quitado", [carton, p.responsable])).quitado, true);
    assert.equal((await una(app, "SELECT quitar_precio($1, $2) AS quitado", [carton, p.responsable])).quitado, false);
    assert.equal(await contar(db, "precio"), 0);
  }));

test("dos que guardan precios en orden contrario pasan uno tras otro, sin interbloquearse", () =>
  conListaAbierta(async (app, db, p) => {
    const otra = await comoApp((await una(db, "SELECT current_database() AS base")).base);
    try {
      const carton = await material(db, "Cartón");
      const pet = await material(db, "PET");
      const pid = await pidDe(otra);
      await app.query("BEGIN");
      await app.query("SELECT fijar_precio($1, 2.1, 2.5, $2)", [carton, p.responsable]);
      // El otro guarda los mismos dos materiales, empezando por el que este todavía no toca.
      const segundo = desenlace(otra.query("SELECT fijar_precio($1, 7, 8, $3), fijar_precio($2, 2, 3, $3)", [pet, carton, p.responsable]));
      await esperarQueEspere(db, pid);
      await app.query("SELECT fijar_precio($1, 7.5, 8.9, $2)", [pet, p.responsable]);
      await app.query("COMMIT");
      assert.equal(await segundo, "pasó");
      // Quedó lo del que guardó al último, completo.
      assert.deepEqual(
        (await db.query("SELECT compra::text FROM precio ORDER BY material_id")).rows.map((f) => f.compra).sort(),
        ["2.0000", "7.0000"],
      );
    } finally {
      await otra.end();
    }
  }));

test("publicada la lista, sus precios ya no se ponen ni se quitan", () =>
  conApp(async (app, _db, e) => {
    await rechaza(app.query("SELECT fijar_precio($1, 9, 9, $2)", [e.mat["Cartón"], e.responsable]), "RC001");
    await rechaza(app.query("SELECT quitar_precio($1, $2)", [e.mat["Cartón"], e.responsable]), "RC001");
  }));

test("sin jornada abierta no hay lista donde poner precios", () =>
  conBase(async (db, base) => {
    const servando = await usuario(db, "Servando", "responsable", true);
    const app = await comoApp(base);
    try {
      await rechaza(app.query("SELECT fijar_precio($1, 2.1, 2.5, $2)", [await material(db, "Cartón"), servando]), "RC006");
    } finally {
      await app.end();
    }
  }));

// ── el resumen de una cuenta abierta ───────────────────────────────────────

test("una cuenta recién abierta se resume en ceros", () =>
  conApp(async (app, _db, e) => {
    const op = (await abrirCuenta(app, "compra", e.mostrador)).id;
    const r = await resumenDe(app, op);
    assert.deepEqual(
      { materiales: r.materiales, por_pesar: r.por_pesar, suma: r.suma, ajuste: r.ajuste_redondeo, total: r.total },
      { materiales: 0, por_pesar: 0, suma: "0.00", ajuste: "0.00", total: "0" },
    );
  }));

test("el resumen da la suma, el ajuste y el total en pesos cerrados, sin contar lo que falta por pesar", () =>
  conApp(async (app, _db, e) => {
    const op = (await abrirCuenta(app, "compra", e.mostrador)).id;
    await agregarMaterial(app, op, e.mat["Cartón"], "30.2", e.mostrador);        // 63.42
    await agregarMaterial(app, op, e.mat["Aluminio bote"], "4.11", e.mostrador); // 115.08
    await agregarMaterial(app, op, e.mat["Fierro pesado"], "5200", e.mostrador, { bascula: GRANDE });
    const r = await resumenDe(app, op);
    assert.equal(r.materiales, 3);
    assert.equal(r.por_pesar, 1);
    assert.equal(r.suma, "178.50");
    assert.equal(r.ajuste_redondeo, "0.50"); // el medio peso sube
    assert.equal(r.total, "179");
  }));

test("lo que anuncia el resumen es lo que queda al confirmar", () =>
  conApp(async (app, db, e) => {
    for (const kg of ["30.2", "5", "4.762", "0.238", "7.381"]) {
      const op = (await abrirCuenta(app, "compra", e.mostrador)).id;
      await agregarMaterial(app, op, e.mat["Cartón"], kg, e.mostrador);
      await agregarMaterial(app, op, e.mat["Fierro lámina"], kg, e.mostrador);
      const antes = await resumenDe(app, op);
      const c = await confirmarComo(app, op, e.mostrador, (await cuentaDe(db, op)).revision);
      assert.equal(c.suma, antes.suma, `suma con ${kg} kg`);
      assert.equal(c.ajuste_redondeo, antes.ajuste_redondeo, `ajuste con ${kg} kg`);
      assert.equal(c.total, antes.total, `total con ${kg} kg`);
      const despues = await resumenDe(app, op);
      assert.equal(despues.total, c.total);
    }
  }));

// ── quién puede qué ────────────────────────────────────────────────────────

type Entrada = (c: pg.Client, db: pg.Client, e: Escenario, quien: string) => Promise<unknown>;

/** Una cuenta de compra con un material, armada por el mostrador. */
const cuentaLista = async (c: pg.Client, e: Escenario) => {
  const op = (await abrirCuenta(c, "compra", e.mostrador)).id;
  const l = await agregarMaterial(c, op, e.mat["Cartón"], "30", e.mostrador);
  return { op, linea: l.id as string };
};

const BORRADOR: Array<[string, Entrada]> = [
  ["abrir_cuenta", (c, _db, _e, q) => abrirCuenta(c, "compra", q)],
  ["agregar_material", async (c, _db, e, q) => agregarMaterial(c, (await abrirCuenta(c, "compra", e.mostrador)).id, e.mat["Cartón"], "10", q)],
  ["segunda_pesada", async (c, _db, e, q) => {
    const op = (await abrirCuenta(c, "compra", e.mostrador)).id;
    const l = await agregarMaterial(c, op, e.mat["Fierro pesado"], "5200", e.mostrador, { bascula: GRANDE });
    return segundaPesada(c, l.id, "3400", q);
  }],
  ["quitar_material", async (c, _db, e, q) => c.query("SELECT quitar_material($1, $2)", [(await cuentaLista(c, e)).linea, q])],
  ["etiquetar_cuenta", async (c, _db, e, q) => c.query("SELECT etiquetar_cuenta($1, 'x', $2)", [(await cuentaLista(c, e)).op, q])],
  ["poner_recipiente", async (c, _db, e, q) => c.query("SELECT poner_recipiente($1, 0.2, $2)", [(await cuentaLista(c, e)).linea, q])],
  ["descartar_cuenta", async (c, _db, e, q) => c.query("SELECT descartar_cuenta($1, $2)", [(await cuentaLista(c, e)).op, q])],
];
const DE_MOSTRADOR: Array<[string, Entrada]> = [
  ["poner_descuento", async (c, _db, e, q) => c.query("SELECT poner_descuento($1, 1, $2)", [(await cuentaLista(c, e)).linea, q])],
];

for (const [nombre, entrada] of [...BORRADOR, ...DE_MOSTRADOR]) {
  test(`${nombre} rechaza a quien solo consulta, a administración y a quien ya no está`, () =>
    conApp(async (app, db, e) => {
      const tecnico = await usuario(db, "Técnico", "administracion");
      const baja = await usuario(db, "Ya no está", "mostrador");
      await db.query("UPDATE usuario SET activo = false WHERE id = $1", [baja]);
      for (const quien of [e.consulta, tecnico, baja, "999999"]) {
        await rechaza(entrada(app, db, e, quien), "RC008");
      }
    }));
  test(`${nombre} deja pasar al mostrador y al responsable`, () =>
    conApp(async (app, db, e) => {
      await entrada(app, db, e, e.mostrador);
      await entrada(app, db, e, e.responsable);
    }));
}
for (const [nombre, entrada] of BORRADOR) {
  test(`${nombre} deja pasar a patio, que arma cuentas pero no las confirma`, () =>
    conApp(async (app, db, e) => {
      await entrada(app, db, e, e.patio);
    }));
}
for (const [nombre, entrada] of DE_MOSTRADOR) {
  test(`${nombre} no es para patio`, () =>
    conApp(async (app, db, e) => {
      await rechaza(entrada(app, db, e, e.patio), "RC008");
    }));
}

test("la aplicación ya no escribe directo en cuentas, materiales, pesadas ni precios", () =>
  conApp(async (app, db, e) => {
    const { op, linea } = await cuentaLista(app, e);
    const directas: Array<[string, unknown[]]> = [
      ["INSERT INTO operacion (id, sucursal_id, jornada_id, tipo, creada_por) VALUES ($1, 1, $2, 'compra', $3)", [randomUUID(), e.jornada, e.mostrador]],
      ["UPDATE operacion SET etiqueta = 'x' WHERE id = $1", [op]],
      ["DELETE FROM operacion WHERE id = $1", [op]],
      ["INSERT INTO operacion_linea (operacion_id, material_id, instrumento_id) VALUES ($1, $2, 2)", [op, e.mat["Cartón"]]],
      ["INSERT INTO captura_peso (instrumento_id, valor_kg, origen, tomada_por) VALUES (2, 10, 'tecleada', $1)", [e.mostrador]],
      ["INSERT INTO linea_pesada (linea_id, orden, captura_id) VALUES ($1, 2, $2)", [linea, randomUUID()]],
      ["INSERT INTO precio (lista_id, material_id, compra, venta) VALUES ($1, $2, 1, 1)", [e.lista, e.mat["Cartón"]]],
      ["UPDATE precio SET compra = 1", []],
      ["DELETE FROM precio", []],
      ["INSERT INTO material (sucursal_id, familia_id, nombre, nombre_corto) VALUES (1, 5, 'Periódico', 'Periódico')", []],
      ["UPDATE material SET nombre = 'Otro' WHERE id = $1", [e.mat["Cartón"]]],
      ["SELECT quitar_renglon($1)", [linea]],
      ["SELECT fijar_descuento($1, 1)", [linea]],
    ];
    for (const [sql, valores] of directas) {
      await rechaza(app.query(sql, valores), SIN_PERMISO);
    }
    assert.equal(await contar(db, "operacion_linea"), 1);
  }));

// ── el orden de los candados ───────────────────────────────────────────────

test("confirmar espera a quien está agregando un material, y al ver la cuenta cambiada no confirma", () =>
  conApp(async (app, db, e, base) => {
    const otra = await comoApp(base);
    try {
      const { op } = await cuentaLista(app, e);
      const revision = (await cuentaDe(db, op)).revision;
      const pid = await pidDe(otra);
      await app.query("BEGIN");
      await agregarMaterial(app, op, e.mat["PET"], "5", e.mostrador);
      const confirmacion = desenlace(confirmarComo(otra, op, e.mostrador, revision));
      await esperarQueEspere(db, pid);
      await app.query("COMMIT");
      assert.equal(await confirmacion, "RC011");
      assert.equal((await cuentaDe(db, op)).estado, "borrador");
    } finally {
      await otra.end();
    }
  }));

test("quitar un material y confirmar la misma cuenta no se bloquean entre sí", () =>
  conApp(async (app, db, e, base) => {
    const otra = await comoApp(base);
    try {
      const { op, linea } = await cuentaLista(app, e);
      await agregarMaterial(app, op, e.mat["PET"], "5", e.mostrador);
      const revision = (await cuentaDe(db, op)).revision;
      const pid = await pidDe(otra);
      await app.query("BEGIN");
      await confirmarComo(app, op, e.mostrador, revision);
      const quitar = desenlace(otra.query("SELECT quitar_material($1, $2)", [linea, e.mostrador]));
      await esperarQueEspere(db, pid);
      await app.query("COMMIT");
      assert.equal(await quitar, "RC001");
      assert.equal(await contar(db, "operacion_linea", "operacion_id = $1", [op]), 2);
    } finally {
      await otra.end();
    }
  }));
