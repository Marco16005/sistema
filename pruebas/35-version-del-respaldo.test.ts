// De un respaldo, qué versión del sistema lo tomó: lo dice su manifiesto. El día que se pierda la
// máquina, con eso se sabe en qué commit poner la carpeta para volver a armar la instalación; las
// imágenes se construyen ahí, de ese commit, y del almacenamiento no se baja nada que se ejecute.
// Lo que dice el manifiesto solo se cree con el sello de la llave del dueño, que entra por la entrada estándar.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { conCubo } from "./almacen.ts";
import { llaves } from "./patio.ts";
import { claveDeSello, destinoRclone, nombreDeManifiesto, nombreDeObjeto, selloDe } from "../operacion/destino.ts";
import type { Manifiesto } from "../operacion/destino.ts";
import { opcionesDeVersion, versionDe } from "../operacion/version-del-respaldo.ts";

const RAIZ = fileURLToPath(new URL("..", import.meta.url));
const PUB = "20261006T211000Z-fedcba987654-000002";

/** Un manifiesto puesto a mano, sellado con la clave que sale de esa llave. */
const sellado = (dicho: Omit<Manifiesto, "sello">, llavePrivada: string): Buffer =>
  Buffer.from(JSON.stringify({ ...dicho, sello: selloDe(dicho, claveDeSello(llavePrivada)) }));

/** El programa, con la llave privada por su entrada estándar (nada, si no se le da). */
function orden(args: string[], entorno: Record<string, string>, llave = ""): Promise<{ codigo: number | null; salida: string; queja: string }> {
  return new Promise((listo) => {
    const hijo = spawn("node", ["operacion/version-del-respaldo.ts", ...args], { cwd: RAIZ, env: { PATH: process.env.PATH, MODO: "desarrollo", ...entorno } });
    let salida = "";
    let queja = "";
    hijo.stdout.on("data", (d) => { salida += d; });
    hijo.stderr.on("data", (d) => { queja += d; });
    hijo.on("close", (codigo) => listo({ codigo, salida: salida.trim(), queja }));
    hijo.stdin.end(llave);
  });
}

test("de un respaldo se sabe qué publicación corría cuando se tomó, y de qué commit es; con la credencial de recuperación, desde otra máquina", () =>
  conCubo(async (cubo) => {
    const llave = await llaves();
    const delDueno = { ...cubo.entorno(cubo.recuperacion), RESPALDO_DESTINO: cubo.destino };
    const destino = destinoRclone(cubo.destino, cubo.entorno(cubo.recuperacion), { sello: claveDeSello(llave.privada) });
    const laOrden = orden;
    // De aquí en adelante, la orden va siempre con la llave del dueño.
    const orden_ = (args: string[], entorno: Record<string, string>) => laOrden(args, entorno, llave.privada);

    // Sin respaldos no hay de dónde instalar.
    const sinNinguno = await orden_([], delDueno);
    assert.equal(sinNinguno.codigo, 1);
    assert.match(sinNinguno.queja, /No hay ningún respaldo/);

    // Respaldos puestos a mano: uno de antes de que se publicara así, uno más nuevo que dice su publicación, y uno que dice algo que no lo es.
    const respaldo = async (momento: string, corrida: string, publicacion?: string): Promise<string> => {
      const objeto = nombreDeObjeto(new Date(momento), corrida);
      const cifrado = randomBytes(2000);
      await cubo.poner(objeto, cifrado);
      await cubo.poner(nombreDeManifiesto(objeto), sellado({
        formato: 1, corrida, instantanea: momento, objeto, bytes: cifrado.length, sha256: "a".repeat(64), pgDump: "pg_dump (PostgreSQL) 17.6",
        llavePublica: llave.publica, esquema: "0026_mantenimiento.sql", ...(publicacion ? { publicacion } : {}),
      }, llave.privada));
      return objeto;
    };
    const deAntes = await respaldo("2026-10-06T12:00:00.000Z", "11111111-1111-4111-8111-111111111111");
    const elUltimo = await respaldo("2026-10-06T13:00:00.000Z", "22222222-2222-4222-8222-222222222222", PUB);

    assert.deepEqual(await versionDe(destino, llave.publica), { objeto: elUltimo, publicacion: PUB, commit: "fedcba987654" });
    assert.equal((await orden_([], delDueno)).salida, `${elUltimo} ${PUB} fedcba987654`);
    assert.equal((await orden_([elUltimo], delDueno)).salida, `${elUltimo} ${PUB} fedcba987654`);
    const sinPublicacion = await orden_([deAntes], delDueno);
    assert.equal(sinPublicacion.codigo, 1);
    assert.match(sinPublicacion.queja, /no dice qué publicación corría/);
    const noHay = await orden_([nombreDeObjeto(new Date("2026-10-06T14:00:00.000Z"), "33333333-3333-4333-8333-333333333333")], delDueno);
    assert.equal(noHay.codigo, 1);
    assert.match(noHay.queja, /No hay un respaldo con ese nombre/);

    // Si hay uno más nuevo con el manifiesto dañado, «el último» no baja en silencio a uno más viejo: se pide por su nombre.
    const danado = nombreDeObjeto(new Date("2026-10-06T15:00:00.000Z"), "44444444-4444-4444-8444-444444444444");
    await cubo.poner(danado, randomBytes(2000));
    await cubo.poner(nombreDeManifiesto(danado), Buffer.from("{ dañado"));
    const conUnoDanado = await orden_([], delDueno);
    assert.equal(conUnoDanado.codigo, 1);
    assert.match(conUnoDanado.queja, /manifiesto dañado.*pídelo por su nombre/s);
    assert.equal((await orden_([elUltimo], delDueno)).salida, `${elUltimo} ${PUB} fedcba987654`);

    assert.equal((await orden_([elUltimo, "de más"], delDueno)).codigo, 2);
    assert.match((await orden_([], { PATH: process.env.PATH! })).queja, /Falta RESPALDO_DESTINO/);

    // El sello: sin la llave no se cree nada de lo que hay; con otra llave, tampoco; y un manifiesto
    // al que alguien le cambió la publicación después de sellado ya no acredita su respaldo.
    const sinLlave = await laOrden([elUltimo], delDueno);
    assert.equal(sinLlave.codigo, 1);
    assert.match(sinLlave.queja, /llave privada de age/);
    const conOtra = await laOrden([elUltimo], delDueno, (await llaves()).privada);
    assert.equal(conOtra.codigo, 1);
    assert.match(conOtra.queja, /no lleva el sello de este negocio/);
    assert.equal(conOtra.salida, "");
    const cambiado = await respaldo("2026-10-06T17:00:00.000Z", "66666666-6666-4666-8666-666666666666", PUB);
    const suyo = JSON.parse((await cubo.leer(nombreDeManifiesto(cambiado))).toString()) as Manifiesto;
    await cubo.poner(nombreDeManifiesto(cambiado), Buffer.from(JSON.stringify({ ...suyo, publicacion: "20261006T211000Z-aaaaaaaaaaaa-000009" })));
    const conElCambio = await orden_([cambiado], delDueno);
    assert.equal(conElCambio.codigo, 1);
    assert.match(conElCambio.queja, /no lleva el sello de este negocio/);
    assert.equal(conElCambio.salida, "", "se dijo un commit que nadie selló");
  }));

test("si el servidor tiene el sello de la llave del dueño y la pública de otra, la comprobación desde fuera lo dice: esos respaldos no se abren con su llave", () =>
  conCubo(async (cubo) => {
    // La revisión de Codex del 21 de octubre (H32-2): el sello solo dice que el manifiesto es auténtico; la
    // pública con que se cifró también tiene que ser la de esa llave.
    const delDueno = await llaves();
    const otra = await llaves();
    const entorno = { ...cubo.entorno(cubo.recuperacion), RESPALDO_DESTINO: cubo.destino };
    const objeto = nombreDeObjeto(new Date("2026-10-06T18:00:00.000Z"), "77777777-7777-4777-8777-777777777777");
    const cifrado = randomBytes(2000);
    await cubo.poner(objeto, cifrado);
    await cubo.poner(nombreDeManifiesto(objeto), sellado({
      formato: 1, corrida: "77777777-7777-4777-8777-777777777777", instantanea: "2026-10-06T18:00:00.000Z", objeto, bytes: cifrado.length,
      sha256: "a".repeat(64), pgDump: "pg_dump (PostgreSQL) 17.6", llavePublica: otra.publica, esquema: "0026_mantenimiento.sql", publicacion: PUB,
    }, delDueno.privada));
    const destino = destinoRclone(cubo.destino, cubo.entorno(cubo.recuperacion), { sello: claveDeSello(delDueno.privada) });
    await assert.rejects(versionDe(destino, delDueno.publica), /se cifró para otra llave/);
    const r = await orden([], entorno, delDueno.privada);
    assert.equal(r.codigo, 1);
    assert.match(r.queja, /se cifró para otra llave/);
    assert.equal(r.salida, "");
  }));

test("un respaldo que dice una publicación que no lo es no sirve para saber en qué commit instalar", () =>
  conCubo(async (cubo) => {
    const llave = await llaves();
    const destino = destinoRclone(cubo.destino, cubo.entorno(cubo.recuperacion), { sello: claveDeSello(llave.privada) });
    const objeto = nombreDeObjeto(new Date("2026-10-06T16:00:00.000Z"), "55555555-5555-4555-8555-555555555555");
    const cifrado = randomBytes(2000);
    await cubo.poner(objeto, cifrado);
    // Aunque lo selle quien tiene la clave: lo que no es una publicación no pasa.
    const manifiesto = (publicacion: string) => sellado({
      formato: 1, corrida: "55555555-5555-4555-8555-555555555555", instantanea: "2026-10-06T16:00:00.000Z", objeto, bytes: cifrado.length, sha256: "a".repeat(64),
      pgDump: "pg_dump (PostgreSQL) 17.6", llavePublica: llave.publica, esquema: "0026_mantenimiento.sql", publicacion,
    }, llave.privada);
    await cubo.poner(nombreDeManifiesto(objeto), manifiesto("la-de-ayer; rm -rf /"));
    // Lo que diga el manifiesto va a dar a un guion: tiene que ser el identificador de una publicación, y nada más.
    await assert.rejects(versionDe(destino, llave.publica, objeto), /dice algo que no puede ser/);
  }));


test("version-del-respaldo entiende diario y momento en cualquier orden y rechaza opciones ambiguas", async () => {
  const momento = "2026-11-01T06:00:00-06:00";
  assert.deepEqual(opcionesDeVersion(["--diario", `--como-estaba=${momento}`, "respaldo"]), {
    diario: true, objeto: "respaldo", comoEstaba: new Date("2026-11-01T12:00:00Z"),
  });
  assert.deepEqual(opcionesDeVersion([]), { diario: false });
  for (const args of [
    ["--diario", "--diario"], ["--diario=x"], ["--remoto"], ["--desconocida"], ["uno", "dos"],
    ["--como-estaba="], ["--como-estaba=ayer"], ["--como-estaba=2026-11-01"],
    ["--como-estaba=2026-11-01T12:00:00"], ["--como-estaba=2026-13-01T12:00:00Z"],
    [`--como-estaba=${momento}`, `--como-estaba=${momento}`],
  ]) {
    const fin = await orden(args, {});
    assert.equal(fin.codigo, 2, args.join(" "));
    assert.match(fin.queja, /Uso:.*\[--diario\].*\[--como-estaba=<momento>\]/);
    assert.match(fin.queja, /No entiendo esa fecha|Opción desconocida, repetida o argumento de más/);
    assert.equal(fin.salida, "");
  }
  const falta = await orden(["--diario"], { RESPALDO_DESTINO: "prueba:horario/feruga" });
  assert.equal(falta.codigo, 1);
  assert.match(falta.queja, /Falta RESPALDO_DESTINO_DIARIO/);
});

test("el diario con la llave anterior se identifica por nombre o como último; el momento lee la versión anterior del manifiesto pisado", () =>
  conCubo(async (cubo) => {
    const anterior = await llaves();
    const nueva = await llaves();
    const credencial = await cubo.credencial({ "*": ["s3:GetObject", "s3:GetObjectVersion"] }, ["s3:ListBucket", "s3:ListBucketVersions"]);
    const entorno = {
      ...cubo.entorno(credencial), RESPALDO_DESTINO_DIARIO: cubo.destino,
      RESPALDO_DESTINO: `${cubo.destino}/horario-vacio`, RESPALDO_LLAVE_PUBLICA: nueva.publica,
      RESPALDO_SELLO: claveDeSello(nueva.privada),
      RESPALDO_SELLOS_ANTERIORES: `${claveDeSello(anterior.privada)}@2026-11-01T12:00:00Z`,
    };
    const corrida = "88888888-8888-4888-8888-888888888888";
    const instante = "2026-10-06T18:00:00.000Z";
    const objeto = nombreDeObjeto(new Date(instante), corrida);
    const dicho: Omit<Manifiesto, "sello"> = {
      formato: 1, corrida, instantanea: instante, objeto, bytes: 2000, sha256: "a".repeat(64),
      pgDump: "pg_dump (PostgreSQL) 17.6", llavePublica: anterior.publica, esquema: "0026_mantenimiento.sql", publicacion: PUB,
    };
    await cubo.poner(objeto, randomBytes(2000));
    await cubo.poner(nombreDeManifiesto(objeto), sellado(dicho, anterior.privada));
    const esperado = `${objeto} ${PUB} fedcba987654`;
    for (const args of [["--diario"], [objeto, "--diario"]]) {
      const fin = await orden(args, entorno, anterior.privada);
      assert.equal(fin.codigo, 0, fin.queja);
      assert.equal(fin.salida, esperado);
    }
    assert.match((await orden([], entorno, anterior.privada)).queja, /No hay ningún respaldo/);
    assert.equal((await orden(["--diario", objeto], entorno, nueva.privada)).codigo, 1);
    const momento = new Date().toISOString();
    // S3 distingue las versiones por su hora de escritura, no por la fecha del respaldo.
    await new Promise((r) => setTimeout(r, 1100));
    const otraPublicacion = "20261006T221000Z-aaaaaaaaaaaa-000003";
    await cubo.poner(nombreDeManifiesto(objeto), sellado({ ...dicho, publicacion: otraPublicacion }, anterior.privada));
    assert.equal((await orden([objeto, "--diario"], entorno, anterior.privada)).salida, `${objeto} ${otraPublicacion} aaaaaaaaaaaa`);
    for (const args of [["--diario", `--como-estaba=${momento}`], [objeto, `--como-estaba=${momento}`, "--diario"]]) {
      const fin = await orden(args, entorno, anterior.privada);
      assert.equal(fin.codigo, 0, fin.queja);
      assert.equal(fin.salida, esperado);
    }
    // La misma lectura histórica también funciona en el depósito horario.
    const horario = await orden([`--como-estaba=${momento}`, objeto], { ...entorno, RESPALDO_DESTINO: cubo.destino }, anterior.privada);
    assert.equal(horario.codigo, 0, horario.queja);
    assert.equal(horario.salida, esperado);
    await cubo.poner(nombreDeManifiesto(objeto), Buffer.from("manifiesto pisado"));
    const roto = await orden([objeto, "--diario"], entorno, anterior.privada);
    assert.equal(roto.codigo, 1);
    assert.equal(roto.salida, "");
    assert.equal((await orden([objeto, "--diario", `--como-estaba=${momento}`], entorno, anterior.privada)).salida, esperado);
  }, { remoto: "diario", retencion: "365d" }));
