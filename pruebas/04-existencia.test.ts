import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CHICA_2, GRANDE, asentar, columnasDeExistencia, compraDe, conBase, conectar, confirmar, cuenta, desenlace, escenario,
  esperarQueEspere, existencia, pesada, pidDe, rechaza, renglon, renglonSinPeso, revisionDe, una,
} from "./apoyo.ts";

const movimientos = async (db: import("pg").Client) => (await una(db, "SELECT count(*)::int AS n FROM movimiento_inventario")).n;

// ── la existencia se calcula, no se guarda ─────────────────────────────────

test("ninguna tabla guarda la existencia en una columna", () =>
  conBase(async (db) => {
    assert.deepEqual(await columnasDeExistencia(db), []);
  }));

test("si alguien agregara una columna de existencia, la prueba anterior la encuentra", () =>
  conBase(async (db) => {
    await db.query("ALTER TABLE material ADD COLUMN existencia_kg numeric");
    assert.deepEqual(await columnasDeExistencia(db), ["material.existencia_kg"]);
  }));

test("un material sin movimientos tiene existencia cero", () =>
  conBase(async (db) => {
    const e = await escenario(db);
    assert.equal(await existencia(db, e.mat["Cartón"]), 0);
  }));

test("confirmar una compra sube la existencia lo que se recibió", () =>
  conBase(async (db) => {
    const e = await escenario(db);
    await compraDe(db, e, e.mat["Aluminio bote"], 12.35);
    assert.equal(await existencia(db, e.mat["Aluminio bote"]), 12.35);
  }));

test("mientras la cuenta está abierta la existencia no se mueve", () =>
  conBase(async (db) => {
    const e = await escenario(db);
    await renglon(db, e, await cuenta(db, e, "compra"), e.mat["Aluminio bote"], 12.35);
    assert.equal(await existencia(db, e.mat["Aluminio bote"]), 0);
  }));

test("treinta compras suben la existencia exactamente la suma de lo recibido", () =>
  conBase(async (db) => {
    const e = await escenario(db);
    let gramos = 0;
    for (let k = 1; k <= 30; k++) {
      const g = 1000 + k * 337;                       // 1.337 kg, 1.674 kg, …
      gramos += g;
      await compraDe(db, e, e.mat["Aluminio bote"], g / 1000);
    }
    const f = await una(db, "SELECT kg FROM existencia WHERE material_id = $1", [e.mat["Aluminio bote"]]);
    assert.equal(f.kg, (gramos / 1000).toFixed(3));
  }));

test("al inventario entra el peso recibido, no el que se paga", () =>
  conBase(async (db) => {
    const e = await escenario(db);
    const op = await cuenta(db, e, "compra");
    const linea = await renglon(db, e, op, e.mat["Cartón"], 100);
    await db.query("UPDATE operacion_linea SET descuento_kg = 3 WHERE id = $1", [linea]);
    const confirmada = await confirmar(db, op, e.mostrador);
    assert.equal(await existencia(db, e.mat["Cartón"]), 100);
    assert.equal(confirmada.suma, "203.70");
  }));

test("confirmar una venta baja la existencia y no toca la de otros materiales", () =>
  conBase(async (db) => {
    const e = await escenario(db);
    await compraDe(db, e, e.mat["Cartón"], 100);
    await compraDe(db, e, e.mat["PET"], 50);
    const venta = await cuenta(db, e, "venta");
    await renglon(db, e, venta, e.mat["Cartón"], 40);
    await confirmar(db, venta, e.mostrador);
    assert.equal(await existencia(db, e.mat["Cartón"]), 60);
    assert.equal(await existencia(db, e.mat["PET"]), 50);
  }));

test("cada renglón confirmado deja exactamente un movimiento", () =>
  conBase(async (db) => {
    const e = await escenario(db);
    const op = await cuenta(db, e, "compra");
    await renglon(db, e, op, e.mat["Cartón"], 10);
    await renglon(db, e, op, e.mat["PET"], 5);
    await renglon(db, e, op, e.mat["Cartón"], 7);
    await confirmar(db, op, e.mostrador);
    assert.equal(await movimientos(db), 3);
    assert.equal(await existencia(db, e.mat["Cartón"]), 17);
  }));

// ── no se vende lo que no hay ──────────────────────────────────────────────

test("diez ventas que rebasan la existencia se rechazan y no escriben nada", () =>
  conBase(async (db) => {
    const e = await escenario(db);
    await compraDe(db, e, e.mat["Cartón"], 100);
    const antes = await movimientos(db);
    for (let k = 1; k <= 10; k++) {
      const venta = await cuenta(db, e, "venta");
      await renglon(db, e, venta, e.mat["Cartón"], 100 + k * 0.001);   // de 100.001 kg en adelante
      await rechaza(confirmar(db, venta, e.mostrador), "RC002");
      assert.equal((await una(db, "SELECT estado, folio FROM operacion WHERE id = $1", [venta])).estado, "borrador");
    }
    assert.equal(await movimientos(db), antes);
    assert.equal(await existencia(db, e.mat["Cartón"]), 100);
  }));

test("vender exactamente lo que hay deja la existencia en cero", () =>
  conBase(async (db) => {
    const e = await escenario(db);
    await compraDe(db, e, e.mat["Cartón"], 100);
    const venta = await cuenta(db, e, "venta");
    await renglon(db, e, venta, e.mat["Cartón"], 100);
    await confirmar(db, venta, e.mostrador);
    assert.equal(await existencia(db, e.mat["Cartón"]), 0);
  }));

test("dos renglones del mismo material se validan contra lo que hay en total", () =>
  conBase(async (db) => {
    const e = await escenario(db);
    await compraDe(db, e, e.mat["Cartón"], 100);
    const venta = await cuenta(db, e, "venta");
    await renglon(db, e, venta, e.mat["Cartón"], 60);
    await renglon(db, e, venta, e.mat["Cartón"], 60);
    await rechaza(confirmar(db, venta, e.mostrador), "RC002");
    assert.equal(await existencia(db, e.mat["Cartón"]), 100, "una venta rechazada no se queda a medias");
  }));

test("si una venta trae un material que no alcanza, no se lleva tampoco los que sí", () =>
  conBase(async (db) => {
    const e = await escenario(db);
    await compraDe(db, e, e.mat["Cartón"], 100);
    await compraDe(db, e, e.mat["PET"], 5);
    const venta = await cuenta(db, e, "venta");
    await renglon(db, e, venta, e.mat["Cartón"], 10);
    await renglon(db, e, venta, e.mat["PET"], 6);
    await rechaza(confirmar(db, venta, e.mostrador), "RC002");
    assert.equal(await existencia(db, e.mat["Cartón"]), 100);
  }));

test("dos ventas confirmadas al mismo tiempo no dejan la existencia en negativo", () =>
  conBase(async (db, base) => {
    const e = await escenario(db);
    await compraDe(db, e, e.mat["Cartón"], 100);
    const una60 = await cuenta(db, e, "venta");
    await renglon(db, e, una60, e.mat["Cartón"], 60);
    const otra60 = await cuenta(db, e, "venta");
    await renglon(db, e, otra60, e.mat["Cartón"], 60);

    const otraCaja = await conectar(base);
    try {
      const pid = await pidDe(otraCaja);
      await db.query("BEGIN");
      await confirmar(db, una60, e.mostrador);                      // todavía sin terminar la transacción
      const segunda = desenlace(otraCaja.query("SELECT * FROM confirmar_operacion($1, $2, (SELECT revision FROM operacion WHERE id = $1))", [otra60, e.mostrador]));
      await esperarQueEspere(db, pid);            // la segunda queda detenida en el candado
      await db.query("COMMIT");
      assert.equal(await segunda, "RC002");
    } finally {
      await otraCaja.end();
    }
    assert.equal(await existencia(db, e.mat["Cartón"]), 40);
  }));

test("en cualquier momento la existencia es lo que entró menos lo que salió, y nunca es negativa", () =>
  conBase(async (db) => {
    const e = await escenario(db);
    const m = e.mat["Fierro lámina"];
    let gramos = 0;
    let semilla = 7;
    const azar = (n: number) => (semilla = (semilla * 1103515245 + 12345) % 2147483648) % n;
    for (let k = 0; k < 40; k++) {
      const g = 500 + azar(40000);
      const vender = azar(3) === 0 && gramos > 0;
      const op = await cuenta(db, e, vender ? "venta" : "compra");
      await renglon(db, e, op, m, g / 1000);
      if (vender && g > gramos) {
        await rechaza(confirmar(db, op, e.mostrador), "RC002");
      } else {
        await confirmar(db, op, e.mostrador);
        gramos += vender ? -g : g;
      }
      const f = await una(db, "SELECT kg FROM existencia WHERE material_id = $1", [m]);
      assert.equal(f.kg, (gramos / 1000).toFixed(3), `tras la operación ${k + 1}`);
      assert.ok(gramos >= 0);
    }
  }));

// ── el dinero: centavos por renglón, pesos cerrados al pagar ───────────────

const REDONDEOS: Array<[string, string, number, string, string, string]> = [
  // material, descripción, kilos, suma, total, ajuste
  ["Fierro pesado", "10.20 se paga 10", 1.5, "10.20", "10", "-0.20"],
  ["Cartón", "10.90 se paga 11", 5.19, "10.90", "11", "0.10"],
  ["Cartón", "10.30 se paga 10", 4.905, "10.30", "10", "-0.30"],
  ["Cartón", "el medio peso exacto, 10.50, se paga 11", 5, "10.50", "11", "0.50"],
];
for (const [nombre, descripcion, kilos, suma, total, ajuste] of REDONDEOS) {
  test(`pesos cerrados: ${descripcion}`, () =>
    conBase(async (db) => {
      const e = await escenario(db);
      const op = await cuenta(db, e, "compra");
      await renglon(db, e, op, e.mat[nombre], kilos);
      const c = await confirmar(db, op, e.mostrador);
      assert.equal(c.suma, suma);
      assert.equal(c.total, total);
      assert.equal(c.ajuste_redondeo, ajuste);
    }));
}

test("el total guardado es la suma de los importes de cada renglón, y el ajuste explica la diferencia", () =>
  conBase(async (db) => {
    const e = await escenario(db);
    const op = await cuenta(db, e, "compra");
    await renglon(db, e, op, e.mat["Aluminio bote"], 12.35);     // 345.80
    await renglon(db, e, op, e.mat["Cartón"], 30.2);              //  63.42
    await renglon(db, e, op, e.mat["Fierro lámina"], 1.005);      //   6.23
    const c = await confirmar(db, op, e.mostrador);
    const renglones = await una(db, "SELECT sum(importe) AS suma FROM operacion_linea WHERE operacion_id = $1", [op]);
    assert.equal(c.suma, "415.45");
    assert.equal(c.suma, renglones.suma);
    assert.equal(c.total, "415");
    assert.equal(c.ajuste_redondeo, "-0.45");
  }));

// ── confirmar ──────────────────────────────────────────────────────────────

test("confirmar asigna folios consecutivos de una sola serie", () =>
  conBase(async (db) => {
    const e = await escenario(db);
    const a = await una(db, "SELECT folio FROM operacion WHERE id = $1", [await compraDe(db, e, e.mat["Cartón"], 10)]);
    const b = await una(db, "SELECT folio FROM operacion WHERE id = $1", [await compraDe(db, e, e.mat["Cartón"], 10)]);
    assert.equal(BigInt(b.folio), BigInt(a.folio) + 1n);
  }));

test("confirmar dos veces devuelve la misma operación y no duplica movimientos", () =>
  conBase(async (db) => {
    const e = await escenario(db);
    const op = await cuenta(db, e, "compra");
    await renglon(db, e, op, e.mat["Cartón"], 10);
    const primera = await confirmar(db, op, e.mostrador);
    const segunda = await confirmar(db, op, e.mostrador);
    assert.equal(segunda.folio, primera.folio);
    assert.equal(await movimientos(db), 1);
    assert.equal(await existencia(db, e.mat["Cartón"]), 10);
  }));

test("no se confirma una cuenta sin materiales", () =>
  conBase(async (db) => {
    const e = await escenario(db);
    await rechaza(confirmar(db, await cuenta(db, e, "compra"), e.mostrador), "RC005");
  }));

test("no se confirma una cuenta con un vehículo que todavía no se pesa por segunda vez", () =>
  conBase(async (db) => {
    const e = await escenario(db);
    const op = await cuenta(db, e, "compra");
    await renglon(db, e, op, e.mat["Cartón"], 10);
    const camioneta = await renglonSinPeso(db, op, e.mat["Fierro pesado"], GRANDE);
    await asentar(db, camioneta, await pesada(db, e, GRANDE, 2860), 1);
    await rechaza(confirmar(db, op, e.mostrador), "RC005");
    assert.equal(await movimientos(db), 0);
  }));

test("quien captura en patio no confirma una cuenta", () =>
  conBase(async (db) => {
    const e = await escenario(db);
    const op = await cuenta(db, e, "compra");
    await renglon(db, e, op, e.mat["Cartón"], 10);
    await rechaza(confirmar(db, op, e.patio), "RC008");
  }));

test("no se confirma una cuenta en una jornada que ya se cerró", () =>
  conBase(async (db) => {
    const e = await escenario(db);
    const op = await cuenta(db, e, "compra");
    await renglon(db, e, op, e.mat["Cartón"], 10);
    await db.query("UPDATE jornada SET cerrada_en = now(), cerrada_por = $1, cierres = cierres + 1 WHERE id = $2", [e.responsable, e.jornada]);
    await rechaza(confirmar(db, op, e.mostrador), "RC006");
  }));

test("confirmar deja rastro en la bitácora con el folio y el total", () =>
  conBase(async (db) => {
    const e = await escenario(db);
    const op = await compraDe(db, e, e.mat["Cartón"], 10);
    const f = await una(db, "SELECT detalle, usuario_id FROM bitacora WHERE accion = 'confirmar' AND entidad_id = $1", [op]);
    assert.equal(f.usuario_id, e.mostrador);
    assert.equal(f.detalle.total, 21);
  }));

// ── lo confirmado no se toca ───────────────────────────────────────────────

test("a una operación confirmada no se le agrega un renglón", () =>
  conBase(async (db) => {
    const e = await escenario(db);
    const op = await compraDe(db, e, e.mat["Cartón"], 10);
    await rechaza(renglonSinPeso(db, op, e.mat["PET"], CHICA_2), "RC001");
  }));

test("a una operación confirmada no se le quita un renglón", () =>
  conBase(async (db) => {
    const e = await escenario(db);
    const op = await compraDe(db, e, e.mat["Cartón"], 10);
    await rechaza(db.query("DELETE FROM operacion_linea WHERE operacion_id = $1", [op]), "RC001");
  }));

test("a una operación confirmada no se le cambia el descuento", () =>
  conBase(async (db) => {
    const e = await escenario(db);
    const op = await compraDe(db, e, e.mat["Cartón"], 10);
    await rechaza(db.query("UPDATE operacion_linea SET descuento_kg = 1 WHERE operacion_id = $1", [op]), "RC001");
  }));

test("una operación confirmada no se borra", () =>
  conBase(async (db) => {
    const e = await escenario(db);
    const op = await compraDe(db, e, e.mat["Cartón"], 10);
    await rechaza(db.query("DELETE FROM operacion WHERE id = $1", [op]), "RC001");
  }));

test("a una operación confirmada no se le cambia el total", () =>
  conBase(async (db) => {
    const e = await escenario(db);
    const op = await compraDe(db, e, e.mat["Cartón"], 10);
    await rechaza(db.query("UPDATE operacion SET total = 500, suma = 500, ajuste_redondeo = 0 WHERE id = $1", [op]), "RC001");
  }));

test("de una operación confirmada sí puede cambiar el estado de pago", () =>
  conBase(async (db) => {
    const e = await escenario(db);
    const op = await compraDe(db, e, e.mat["Cartón"], 10);
    await db.query("UPDATE operacion SET estado_pago = 'liquidada' WHERE id = $1", [op]);
    assert.equal((await una(db, "SELECT estado_pago FROM operacion WHERE id = $1", [op])).estado_pago, "liquidada");
  }));

test("diez movimientos de inventario: ninguno se deja modificar ni borrar", () =>
  conBase(async (db) => {
    const e = await escenario(db);
    for (let k = 0; k < 10; k++) await compraDe(db, e, e.mat["Cartón"], 10 + k);
    const ids = (await db.query("SELECT id FROM movimiento_inventario ORDER BY id")).rows.map((f) => f.id);
    assert.equal(ids.length, 10);
    for (const id of ids) {
      await rechaza(db.query("UPDATE movimiento_inventario SET cantidad_kg = 1 WHERE id = $1", [id]), "RC001");
      await rechaza(db.query("DELETE FROM movimiento_inventario WHERE id = $1", [id]), "RC001");
    }
    assert.equal(await existencia(db, e.mat["Cartón"]), 145);
  }));

test("el libro de inventario no se vacía de un golpe", () =>
  conBase(async (db) => {
    const e = await escenario(db);
    await compraDe(db, e, e.mat["Cartón"], 10);
    await rechaza(db.query("TRUNCATE movimiento_inventario CASCADE"), "RC001");
  }));

// ── tras la revisión de Codex ──────────────────────────────────────────────

test("el libro de inventario solo acepta el aislamiento en que su candado sirve", () =>
  conBase(async (db) => {
    const e = await escenario(db);
    const op = await cuenta(db, e, "compra");
    await renglon(db, e, op, e.mat["Cartón"], 10);
    await db.query("BEGIN ISOLATION LEVEL REPEATABLE READ");
    await rechaza(confirmar(db, op, e.mostrador), "RC010");
    await db.query("ROLLBACK");
    assert.equal(await movimientos(db), 0);
  }));

test("dos cajas confirmando la misma cuenta dejan un solo folio y un solo juego de movimientos", () =>
  conBase(async (db, base) => {
    const e = await escenario(db);
    const op = await cuenta(db, e, "compra");
    await renglon(db, e, op, e.mat["Cartón"], 10);
    await renglon(db, e, op, e.mat["PET"], 5);
    const otra = await conectar(base);
    try {
      const pid = await pidDe(otra);
      await db.query("BEGIN");
      const primera = await confirmar(db, op, e.mostrador);
      const segunda = otra.query("SELECT * FROM confirmar_operacion($1, $2, (SELECT revision FROM operacion WHERE id = $1))", [op, e.mostrador]);
      await esperarQueEspere(db, pid);
      await db.query("COMMIT");
      assert.equal((await segunda).rows[0].folio, primera.folio);
    } finally {
      await otra.end();
    }
    assert.equal(await movimientos(db), 2);
  }));

test("si alguien agrega un material mientras la cuenta se confirma, el agregado se rechaza", () =>
  conBase(async (db, base) => {
    const e = await escenario(db);
    const op = await cuenta(db, e, "compra");
    await renglon(db, e, op, e.mat["Cartón"], 10);
    const otra = await conectar(base);
    try {
      const pid = await pidDe(otra);
      await db.query("BEGIN");
      await confirmar(db, op, e.mostrador);
      const agregado = desenlace(
        otra.query("INSERT INTO operacion_linea (operacion_id, material_id, instrumento_id) VALUES ($1, $2, $3)", [
          op, e.mat["PET"], CHICA_2,
        ]),
      );
      await esperarQueEspere(db, pid);
      await db.query("COMMIT");
      assert.equal(await agregado, "RC001");
    } finally {
      await otra.end();
    }
    assert.equal((await una(db, "SELECT count(*)::int AS n FROM operacion_linea WHERE operacion_id = $1", [op])).n, 1);
  }));

test("si alguien quita un material mientras la cuenta se confirma, el retiro se rechaza", () =>
  conBase(async (db, base) => {
    const e = await escenario(db);
    const op = await cuenta(db, e, "compra");
    const linea = await renglon(db, e, op, e.mat["Cartón"], 10);
    const otra = await conectar(base);
    try {
      const pid = await pidDe(otra);
      await db.query("BEGIN");
      await confirmar(db, op, e.mostrador);
      const retiro = desenlace(otra.query("DELETE FROM operacion_linea WHERE id = $1", [linea]));
      await esperarQueEspere(db, pid);
      await db.query("COMMIT");
      assert.equal(await retiro, "RC001");
    } finally {
      await otra.end();
    }
  }));

test("quitar un material mientras la cuenta se confirma espera a la confirmación y se rechaza, sin interbloqueo", () =>
  conBase(async (db, base) => {
    const e = await escenario(db);
    const op = await cuenta(db, e, "compra");
    const linea = await renglon(db, e, op, e.mat["Cartón"], 10);
    const otra = await conectar(base);
    try {
      const pid = await pidDe(otra);
      await db.query("BEGIN");
      await confirmar(db, op, e.mostrador);
      const retiro = desenlace(otra.query("SELECT quitar_renglon($1)", [linea]));
      await esperarQueEspere(db, pid);
      await db.query("COMMIT");
      assert.equal(await retiro, "RC001");
    } finally {
      await otra.end();
    }
  }));

test("poner un descuento mientras se asienta una pesada del mismo renglón espera su turno, sin interbloqueo", () =>
  conBase(async (db, base) => {
    const e = await escenario(db);
    const op = await cuenta(db, e, "compra");
    const linea = await renglon(db, e, op, e.mat["Cartón"], 10);
    const camioneta = await renglonSinPeso(db, op, e.mat["Fierro pesado"], GRANDE);
    const captura = await pesada(db, e, GRANDE, 2860);
    const otra = await conectar(base);
    try {
      const pid = await pidDe(otra);
      await db.query("BEGIN");
      await asentar(db, camioneta, captura, 1);                       // la cuenta queda tomada por esta sesión
      const descuento = desenlace(otra.query("SELECT fijar_descuento($1, 1)", [linea]));
      await esperarQueEspere(db, pid);
      await db.query("COMMIT");
      assert.equal(await descuento, "pasó");
    } finally {
      await otra.end();
    }
    assert.equal((await una(db, "SELECT descuento_kg FROM operacion_linea WHERE id = $1", [linea])).descuento_kg, "1.000");
  }));

test("quitar un renglón por su función lo quita y sube la revisión de la cuenta", () =>
  conBase(async (db) => {
    const e = await escenario(db);
    const op = await cuenta(db, e, "compra");
    const linea = await renglon(db, e, op, e.mat["Cartón"], 10);
    const antes = await revisionDe(db, op);
    await db.query("SELECT quitar_renglon($1)", [linea]);
    assert.equal((await una(db, "SELECT count(*)::int AS n FROM operacion_linea WHERE operacion_id = $1", [op])).n, 0);
    assert.ok((await revisionDe(db, op)) > antes);
  }));

test("cambiar la etiqueta de la cuenta también sube su revisión", () =>
  conBase(async (db) => {
    const e = await escenario(db);
    const op = await cuenta(db, e, "compra");
    await renglon(db, e, op, e.mat["Cartón"], 10);
    const vista = await revisionDe(db, op);
    await db.query("UPDATE operacion SET etiqueta = 'Otro cliente' WHERE id = $1", [op]);
    assert.ok((await revisionDe(db, op)) > vista);
    await rechaza(db.query("SELECT confirmar_operacion($1, $2, $3)", [op, e.mostrador, vista]), "RC011");
  }));

test("dos cuentas con los mismos materiales en orden inverso se confirman a la vez sin estorbarse", () =>
  conBase(async (db, base) => {
    const e = await escenario(db);
    const a = await cuenta(db, e, "compra");
    await renglon(db, e, a, e.mat["Cobre de primera"], 4);
    await renglon(db, e, a, e.mat["Aluminio bote"], 6);
    const b = await cuenta(db, e, "compra");
    await renglon(db, e, b, e.mat["Aluminio bote"], 3);
    await renglon(db, e, b, e.mat["Cobre de primera"], 2);
    const otra = await conectar(base);
    try {
      const pid = await pidDe(otra);
      const fin = await Promise.all([
        desenlace(db.query("SELECT confirmar_operacion($1, $2, (SELECT revision FROM operacion WHERE id = $1))", [a, e.mostrador])),
        desenlace(otra.query("SELECT confirmar_operacion($1, $2, (SELECT revision FROM operacion WHERE id = $1))", [b, e.mostrador])),
      ]);
      assert.deepEqual(fin, ["pasó", "pasó"]);
    } finally {
      await otra.end();
    }
    assert.equal(await existencia(db, e.mat["Cobre de primera"]), 6);
    assert.equal(await existencia(db, e.mat["Aluminio bote"]), 9);
  }));

test("no existe movimiento sin material", () =>
  conBase(async (db) => {
    const e = await escenario(db);
    const alta = (materialId: number | null) =>
      db.query(
        `INSERT INTO movimiento_inventario (sucursal_id, material_id, tipo, cantidad_kg, jornada_id, motivo, autorizado_por, creado_por)
         VALUES (1, $1, 'ajuste', 5, $2, 'prueba', $3, $3)`,
        [materialId, e.jornada, e.responsable],
      );
    await rechaza(alta(null), "23502");
    await rechaza(alta(987654), "23503");
  }));

test("un material con movimientos no se borra del catálogo", () =>
  conBase(async (db) => {
    const e = await escenario(db);
    await compraDe(db, e, e.mat["PET"], 5);
    await rechaza(db.query("DELETE FROM material WHERE id = $1", [e.mat["PET"]]), "23503");
  }));

test("dos renglones de 1 kg a $0.3350 guardan 0.34 + 0.34 = 0.68, y se paga 1 con ajuste de 0.32", () =>
  conBase(async (db) => {
    const e = await escenario(db, { "Cartón": [0.335, 0.4] });
    const op = await cuenta(db, e, "compra");
    await renglon(db, e, op, e.mat["Cartón"], 1);
    await renglon(db, e, op, e.mat["Cartón"], 1);
    const c = await confirmar(db, op, e.mostrador);
    assert.equal(c.suma, "0.68");
    assert.equal(c.total, "1");
    assert.equal(c.ajuste_redondeo, "0.32");
  }));

test("si la cuenta ya no es la que el operador vio, no se confirma", () =>
  conBase(async (db) => {
    const e = await escenario(db);
    const op = await cuenta(db, e, "compra");
    await renglon(db, e, op, e.mat["Cartón"], 10);
    const vista = await revisionDe(db, op);                        // lo que el operador tenía en pantalla
    await renglon(db, e, op, e.mat["PET"], 5);                     // y mientras tanto alguien agregó otro material
    await rechaza(db.query("SELECT confirmar_operacion($1, $2, $3)", [op, e.mostrador, vista]), "RC011");
    assert.equal(await movimientos(db), 0);
  }));

test("cambiar un material por otro que suma lo mismo también se nota", () =>
  conBase(async (db) => {
    const e = await escenario(db);
    const op = await cuenta(db, e, "compra");
    const carton = await renglon(db, e, op, e.mat["Cartón"], 10);  // 10 kg × $2.10 = $21.00
    const vista = await revisionDe(db, op);
    await db.query("DELETE FROM operacion_linea WHERE id = $1", [carton]);
    await renglon(db, e, op, e.mat["PET"], 2.8);                   // 2.8 kg × $7.50 = $21.00: mismo número de renglones, misma suma
    await rechaza(db.query("SELECT confirmar_operacion($1, $2, $3)", [op, e.mostrador, vista]), "RC011");
    assert.equal(await movimientos(db), 0);
  }));

test("cada cambio a la cuenta sube su revisión", () =>
  conBase(async (db) => {
    const e = await escenario(db);
    const op = await cuenta(db, e, "compra");
    const pasos: number[] = [await revisionDe(db, op)];
    const linea = await renglonSinPeso(db, op, e.mat["Fierro pesado"], GRANDE);
    pasos.push(await revisionDe(db, op));
    await asentar(db, linea, await pesada(db, e, GRANDE, 2860), 1);
    pasos.push(await revisionDe(db, op));
    await asentar(db, linea, await pesada(db, e, GRANDE, 1940), 2);
    pasos.push(await revisionDe(db, op));
    await db.query("UPDATE operacion_linea SET descuento_kg = 5 WHERE id = $1", [linea]);
    pasos.push(await revisionDe(db, op));
    await db.query("DELETE FROM operacion_linea WHERE id = $1", [linea]);
    pasos.push(await revisionDe(db, op));
    for (let k = 1; k < pasos.length; k++) assert.ok(pasos[k] > pasos[k - 1], `el paso ${k} no subió la revisión: ${pasos}`);
  }));

test("confirmar la revisión que se vio pasa, y repetirlo devuelve lo mismo", () =>
  conBase(async (db) => {
    const e = await escenario(db);
    const op = await cuenta(db, e, "compra");
    await renglon(db, e, op, e.mat["Cartón"], 10);
    const vista = await revisionDe(db, op);
    const primera = await una(db, "SELECT * FROM confirmar_operacion($1, $2, $3)", [op, e.mostrador, vista]);
    const segunda = await una(db, "SELECT * FROM confirmar_operacion($1, $2, $3)", [op, e.mostrador, vista]);
    assert.equal(segunda.folio, primera.folio);
    assert.equal(await movimientos(db), 1);
  }));

test("un reintento que dice haber visto otra revisión no se da por bueno", () =>
  conBase(async (db) => {
    const e = await escenario(db);
    const op = await compraDe(db, e, e.mat["Cartón"], 10);
    const real = await revisionDe(db, op);
    await rechaza(db.query("SELECT confirmar_operacion($1, $2, $3)", [op, e.mostrador, real + 5]), "RC011");
  }));

test("la revisión de una cuenta confirmada ya no cambia", () =>
  conBase(async (db) => {
    const e = await escenario(db);
    const op = await compraDe(db, e, e.mat["Cartón"], 10);
    await rechaza(db.query("UPDATE operacion SET revision = revision + 1 WHERE id = $1", [op]), "RC001");
  }));

test("lo apartado en ventas abiertas baja lo disponible, no la existencia", () =>
  conBase(async (db) => {
    const e = await escenario(db);
    await compraDe(db, e, e.mat["Cartón"], 100);
    const venta = await cuenta(db, e, "venta");
    await renglon(db, e, venta, e.mat["Cartón"], 60);
    const f = await una(db, "SELECT kg, apartado_kg, disponible_kg FROM disponible WHERE material_id = $1", [e.mat["Cartón"]]);
    assert.deepEqual(f, { kg: "100.000", apartado_kg: "60.000", disponible_kg: "40.000" });
    await db.query("DELETE FROM operacion WHERE id = $1", [venta]);
    const libre = await una(db, "SELECT disponible_kg FROM disponible WHERE material_id = $1", [e.mat["Cartón"]]);
    assert.equal(libre.disponible_kg, "100.000");
  }));

test("cambiar el estado de pago junto con otra cosa se rechaza", () =>
  conBase(async (db) => {
    const e = await escenario(db);
    const op = await compraDe(db, e, e.mat["Cartón"], 10);
    await rechaza(db.query("UPDATE operacion SET estado_pago = 'liquidada', etiqueta = 'otra' WHERE id = $1", [op]), "RC001");
  }));
