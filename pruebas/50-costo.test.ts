// El costo del patio: importes exactos, libro inmutable, historia y espera real entre sesiones.
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { test } from "node:test";
import type pg from "pg";
import {
  abrirJornada, cerrarSinCorte, comoApp, compraDe, conBase, conBaseVacia, conectar, confirmar,
  cuenta, desenlace, escenario, esperarQueEspere, material, pidDe, rechaza, renglon, una,
} from "./apoyo.ts";
import type { Escenario } from "./apoyo.ts";

const carpeta = new URL("../db/migraciones/", import.meta.url);
const saldo = (db: pg.Client, mat: number) => una(db, "SELECT kg, valor FROM costo_material WHERE material_id=$1", [mat]);
const costos = async (db: pg.Client, mat: number) => (await db.query(
  "SELECT costo FROM movimiento_inventario WHERE material_id=$1 ORDER BY id", [mat],
)).rows.map((r) => r.costo);
async function cuadra(db: pg.Client) {
  assert.deepEqual((await db.query(`SELECT m.id FROM material m
    LEFT JOIN costo_material c ON c.material_id=m.id
    LEFT JOIN (SELECT material_id, sum(cantidad_kg) kg, sum(costo) valor FROM movimiento_inventario GROUP BY material_id) l ON l.material_id=m.id
    WHERE coalesce(c.kg,0) <> coalesce(l.kg,0) OR coalesce(c.valor,0) <> coalesce(l.valor,0)
       OR (c.kg=0 AND c.valor<>0) OR EXISTS (SELECT 1 FROM movimiento_inventario WHERE costo IS NULL)`)).rows, []);
}
async function dia(db: pg.Client, e: Escenario, fecha: string, precios: Record<string, [number, number]>) {
  await cerrarSinCorte(db, e.jornada, 0, e.mostrador);
  const j = await abrirJornada(db, e.responsable, fecha);
  e.jornada = j.id; e.lista = j.lista;
  for (const [nombre, [compra, venta]] of Object.entries(precios)) {
    const mat = await material(db, nombre);
    e.mat[nombre] = mat;
    await db.query(`INSERT INTO precio(lista_id,material_id,compra,venta) VALUES($1,$2,$3,$4)
      ON CONFLICT(lista_id,material_id) DO UPDATE SET compra=excluded.compra,venta=excluded.venta`, [j.lista,mat,compra,venta]);
  }
  await db.query("SELECT publicar_lista($1,$2)", [j.lista,e.responsable]);
}
async function venta(db: pg.Client, e: Escenario, mat: number, kg: number) {
  const op = await cuenta(db,e,"venta");
  const linea = await renglon(db,e,op,mat,kg);
  await confirmar(db,op,e.mostrador);
  return linea;
}
const merma = (db: pg.Client,e: Escenario,mat: number,kg: number) =>
  db.query("SELECT registrar_merma($1,$2,'Mojado',$3)",[mat,kg,e.mostrador]);
const conteo = (db: pg.Client,e: Escenario,mat: number,kg: number) =>
  db.query("SELECT registrar_conteo($1,$2,$3,$4)",[mat,kg,e.responsable,e.mostrador]);
const separar = (db: pg.Client,e: Escenario,origen: number,kg: number,productos: Array<{material: number; kg: number}>) =>
  una(db,"SELECT * FROM registrar_transformacion($1,$2,$3::jsonb,'Separar y tirar basura',$4)",[origen,kg,JSON.stringify(productos),e.mostrador]);

test("dos compras ponderan por kilos: venta a promedio y ganancia por importe", () => conBase(async db => {
  const e = await escenario(db,{"Cartón":[2,6]}); const mat=e.mat["Cartón"]!;
  await compraDe(db,e,mat,10);
  await dia(db,e,"2026-10-02",{"Cartón":[4,6]});
  await compraDe(db,e,mat,30);
  assert.deepEqual(await saldo(db,mat),{kg:"40.000",valor:"140.00"});
  const l=await venta(db,e,mat,10);
  assert.deepEqual(await una(db,`SELECT m.costo, (l.importe+m.costo)::numeric(16,2) AS ganancia
    FROM movimiento_inventario m JOIN operacion_linea l ON l.id=m.linea_id WHERE l.id=$1`,[l]),{costo:"-35.00",ganancia:"25.00"});
  assert.deepEqual(await costos(db,mat),["20.00","120.00","-35.00"]);
  await cuadra(db);
}));

test("compra toma el importe descontado con centavos, no los pesos cerrados", () => conBase(async db => {
  const e=await escenario(db,{"Cartón":[2.13,3]}); const mat=e.mat["Cartón"]!;
  const op=await cuenta(db,e,"compra"); const l=await renglon(db,e,op,mat,10);
  await db.query("SELECT poner_descuento($1,1,$2)",[l,e.mostrador]);
  const c=await confirmar(db,op,e.mostrador);
  assert.equal(c.total,"19");
  assert.deepEqual(await saldo(db,mat),{kg:"10.000",valor:"19.17"});
  await cuadra(db);
}));

test("venta de todo agota hasta el último centavo; merma es pérdida a promedio", () => conBase(async db => {
  const e=await escenario(db,{"Cartón":[0.3333,1]}); const mat=e.mat["Cartón"]!;
  await compraDe(db,e,mat,3);
  await merma(db,e,mat,1);
  await venta(db,e,mat,1);
  await venta(db,e,mat,1);
  assert.deepEqual(await costos(db,mat),["1.00","-0.33","-0.34","-0.33"]);
  assert.deepEqual(await saldo(db,mat),{kg:"0.000",valor:"0.00"});
  await cuadra(db);
}));

test("conteos suman y restan al promedio; sin existencia usan lista o cero", () => conBase(async db => {
  const e=await escenario(db,{"Cartón":[2,6]}); const mat=e.mat["Cartón"]!;
  await compraDe(db,e,mat,10);
  await dia(db,e,"2026-10-02",{"Cartón":[4,6]});
  await conteo(db,e,mat,15); await conteo(db,e,mat,5); await conteo(db,e,mat,0); await conteo(db,e,mat,3);
  assert.deepEqual(await costos(db,mat),["20.00","10.00","-20.00","-10.00","12.00"]);
  const sin=await material(db,"Magnesio"); await conteo(db,e,sin,2); await conteo(db,e,sin,0);
  assert.deepEqual(await costos(db,sin),["0.00","0.00"]);
  await cuadra(db);
}));

test("ajuste sin existencia usa última publicada cuando la lista del día sigue borrador", () => conBase(async db => {
  const e=await escenario(db,{"Cartón":[2,6]}); const mat=e.mat["Cartón"]!;
  await cerrarSinCorte(db,e.jornada,0,e.mostrador);
  e.jornada=(await abrirJornada(db,e.responsable,"2026-10-02")).id;
  await conteo(db,e,mat,3);
  assert.deepEqual(await saldo(db,mat),{kg:"3.000",valor:"6.00"}); await cuadra(db);
}));

test("apertura usa primera lista con precio para ese material; sin precio cuesta cero", () => conBase(async db => {
  const e=await escenario(db,{"Cartón":[2,6]});
  await dia(db,e,"2026-10-02",{"Cartón":[9,10],"PET":[7,8]});
  for(const nombre of ["Cartón","PET","Magnesio"]) {
    const mat=await material(db,nombre);
    await db.query("SELECT registrar_apertura($1,3,'contado',$2)",[mat,e.responsable]);
    assert.deepEqual(await costos(db,mat),[nombre==="Cartón"?"6.00":nombre==="PET"?"21.00":"0.00"]);
  }
  await cuadra(db);
}));

for(const conPrecios of [true,false]) test(`separación con basura reparte ${conPrecios?"por valor de compra":"por kilos sin precios"} y conserva centavos`, () => conBase(async db => {
  const e=await escenario(db,conPrecios?{"Cartón":[0.3333,1],"PET":[2,3],"Magnesio":[1,4]}:{"Cartón":[0.3333,1]});
  const origen=e.mat["Cartón"]!; const a=await material(db,"PET"); const b=await material(db,"Magnesio");
  await compraDe(db,e,origen,3);
  const t=await separar(db,e,origen,3,[{material:a,kg:1},{material:b,kg:conPrecios?1:1.5}]);
  assert.equal(t.merma_kg,conPrecios?"1.000":"0.500");
  assert.deepEqual(await costos(db,origen),["1.00","-1.00"]);
  // Con precios pesan igual: PET recibe 2/3. Sin precios pesan 1 y 1.5 kg: reciben 40% y 60%.
  assert.deepEqual(await saldo(db,a),{kg:"1.000",valor:conPrecios?"0.67":"0.40"});
  assert.deepEqual(await saldo(db,b),{kg:conPrecios?"1.000":"1.500",valor:conPrecios?"0.33":"0.60"});
  assert.equal((await una(db,"SELECT sum(costo)::numeric(16,2) AS n FROM movimiento_inventario WHERE transformacion_id=$1",[t.id])).n,"0.00");
  await cuadra(db);
}));

test("separación: precio ausente recibe cero si otro producto tiene valor y conserva su existencia previa", () => conBase(async db => {
  const e=await escenario(db,{"Cartón":[2,6],"PET":[7,8]});
  const a=await material(db,"PET"); const b=await material(db,"Magnesio");
  await compraDe(db,e,e.mat["Cartón"]!,10); await compraDe(db,e,a,2);
  await separar(db,e,e.mat["Cartón"]!,10,[{material:a,kg:3},{material:b,kg:5}]);
  assert.deepEqual(await saldo(db,a),{kg:"5.000",valor:"34.00"});
  assert.deepEqual(await saldo(db,b),{kg:"5.000",valor:"0.00"}); await cuadra(db);
}));

async function historia(db: pg.Client) {
  const e=await escenario(db,{"Cartón":[2,6],"PET":[3,5],"Magnesio":[1,4]});
  const m=e.mat["Cartón"]!;
  await db.query("SELECT registrar_apertura($1,3,'estimado',$2)",[m,e.responsable]);
  await compraDe(db,e,m,7);
  await dia(db,e,"2026-10-02",{"Cartón":[4,6]}); await compraDe(db,e,m,10);
  await venta(db,e,m,3); await merma(db,e,m,2); await conteo(db,e,m,18); await conteo(db,e,m,15);
  await separar(db,e,m,10,[{material:e.mat["PET"]!,kg:4},{material:e.mat["Magnesio"]!,kg:5}]);
  await venta(db,e,m,5);
  await dia(db,e,"2026-10-03",{"Cartón":[9,10],"PET":[100,120],"Magnesio":[50,60]});
}
async function foto(db: pg.Client) {
  await cuadra(db);
  return {
    libro:(await db.query("SELECT material_id,tipo,cantidad_kg,costo FROM movimiento_inventario ORDER BY id")).rows,
    patio:(await db.query("SELECT * FROM costo_material WHERE kg<>0 OR valor<>0 ORDER BY material_id")).rows,
  };
}

test("0039 migra historia real de 0038 en orden de id y equivale al asiento uno por uno", async () => {
  let esperado: Awaited<ReturnType<typeof foto>>;
  await conBase(async db => { await historia(db); esperado=await foto(db); });
  await conBaseVacia(async base => {
    const db=await conectar(base);
    try {
      // Se ejecutan los mismos SQL anteriores sin crear archivos ni cambiar la plantilla de QA.
      for(const archivo of (await readdir(carpeta)).filter(a=>a.endsWith(".sql")&&a<"0039").sort()) {
        await db.query("BEGIN");
        try { await db.query(await readFile(new URL(archivo,carpeta),"utf8")); await db.query("COMMIT"); }
        catch(err) { await db.query("ROLLBACK"); throw err; }
      }
      await historia(db);
      const antes=(await db.query("SELECT id,creado_en,efectivo_en FROM movimiento_inventario ORDER BY id")).rows;
      await db.query("BEGIN");
      await db.query(await readFile(new URL("0039_el_costo.sql",carpeta),"utf8")); await db.query("COMMIT");
      assert.deepEqual(await foto(db),esperado!);
      assert.deepEqual((await db.query("SELECT id,creado_en,efectivo_en FROM movimiento_inventario ORDER BY id")).rows,antes);
      await rechaza(db.query("UPDATE movimiento_inventario SET costo=0"),"RC001");
    } finally { await db.end(); }
  });
});

test("concurrencia: la salida espera una compra sin confirmar y toma el nuevo promedio", () => conBase(async (db,base) => {
  const e=await escenario(db,{"Cartón":[2,6]}); const mat=e.mat["Cartón"]!;
  await compraDe(db,e,mat,10); await dia(db,e,"2026-10-02",{"Cartón":[4,6]});
  const op=await cuenta(db,e,"compra"); await renglon(db,e,op,mat,10);
  const a=await conectar(base); const b=await conectar(base);
  let pendiente: Promise<string>|undefined;
  try {
    await a.query("BEGIN"); await confirmar(a,op,e.mostrador);
    const pid=await pidDe(b);
    pendiente=desenlace(merma(b,e,mat,10));
    await esperarQueEspere(db,pid);
    assert.deepEqual(await saldo(db,mat),{kg:"10.000",valor:"20.00"});
    await a.query("COMMIT"); assert.equal(await pendiente,"pasó");
    assert.deepEqual(await costos(db,mat),["20.00","40.00","-30.00"]);
    assert.deepEqual(await saldo(db,mat),{kg:"10.000",valor:"30.00"}); await cuadra(db);
  } finally { await a.query("ROLLBACK"); await pendiente; await a.end(); await b.end(); }
}));

test("aplicación lee costo y saldo, no los escribe; un fallo revierte también la valuación", () => conBase(async (db,base) => {
  const e=await escenario(db); const mat=e.mat["Cartón"]!; await compraDe(db,e,mat,10);
  const app=await comoApp(base);
  try {
    assert.deepEqual(await saldo(app,mat),{kg:"10.000",valor:"21.00"});
    assert.deepEqual(await costos(app,mat),["21.00"]);
    for(const sql of ["INSERT INTO costo_material(material_id,kg,valor) VALUES(999,1,1)","UPDATE costo_material SET valor=0",
      "DELETE FROM costo_material","TRUNCATE costo_material","UPDATE movimiento_inventario SET costo=0"])
      await rechaza(app.query(sql),"42501");
    await rechaza(db.query("UPDATE movimiento_inventario SET costo=0"),"RC001");
    const antes=await foto(db);
    await rechaza(merma(db,e,mat,11),"RC002");
    await db.query("BEGIN"); await merma(db,e,mat,1); await db.query("ROLLBACK");
    assert.deepEqual(await foto(db),antes);
  } finally { await app.end(); }
}));


test("separación deja el centavo del redondeo en el último producto y usa precios del día", () => conBase(async db => {
  const e=await escenario(db,{"Cartón":[0.0033,1],"PET":[1,50],"Magnesio":[1,2]});
  const mat=e.mat["Cartón"]!;
  await compraDe(db,e,mat,3); // Un centavo por todo el lote.
  await dia(db,e,"2026-10-02",{"PET":[2,50],"Magnesio":[2,2]});
  const productos=[{material:e.mat["PET"]!,kg:1},{material:e.mat["Magnesio"]!,kg:1}].sort((a,b)=>a.material-b.material);
  await separar(db,e,mat,3,productos);
  assert.deepEqual(await costos(db,productos[0]!.material),["0.01"]);
  assert.deepEqual(await costos(db,productos[1]!.material),["0.00"]);
  await cuadra(db);
}));

test("el id definitivo sigue el asiento aunque otra conexión ya haya reservado su identity", () => conBase(async (db,base) => {
  const e=await escenario(db,{"Cartón":[2,6]}); const mat=e.mat["Cartón"]!;
  await compraDe(db,e,mat,10); await dia(db,e,"2026-10-02",{"Cartón":[4,6]});
  const primera=await cuenta(db,e,"compra"); await renglon(db,e,primera,mat,10);
  const segunda=await cuenta(db,e,"compra"); await renglon(db,e,segunda,mat,10);
  const a=await conectar(base); const b=await conectar(base); let pendiente: Promise<string>|undefined;
  try {
    await a.query("BEGIN"); await confirmar(a,primera,e.mostrador);
    const pid=await pidDe(b); pendiente=desenlace(merma(b,e,mat,10));
    await esperarQueEspere(db,pid);
    // La misma transacción conserva el patio: esta compra se asienta antes que la merma en espera.
    await confirmar(a,segunda,e.mostrador);
    await a.query("COMMIT"); assert.equal(await pendiente,"pasó");
    assert.deepEqual(await costos(db,mat),["20.00","40.00","40.00","-33.33"]);
    assert.deepEqual(await saldo(db,mat),{kg:"20.000",valor:"66.67"}); await cuadra(db);
  } finally { await a.query("ROLLBACK"); await pendiente; await a.end(); await b.end(); }
}));
