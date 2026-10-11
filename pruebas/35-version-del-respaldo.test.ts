// De un respaldo, qué versión del sistema lo tomó: lo dice su manifiesto. El día que se pierda la
// máquina, con eso se sabe en qué commit poner la carpeta para volver a armar la instalación; las
// imágenes se construyen ahí, de ese commit, y del almacenamiento no se baja nada que se ejecute.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { conCubo } from "./almacen.ts";
import { destinoRclone, nombreDeManifiesto, nombreDeObjeto } from "../operacion/destino.ts";
import { versionDe } from "../operacion/version-del-respaldo.ts";

const RAIZ = fileURLToPath(new URL("..", import.meta.url));
const PUB = "20261006T211000Z-fedcba987654-000002";

function orden(args: string[], entorno: Record<string, string>): Promise<{ codigo: number | null; salida: string; queja: string }> {
  return new Promise((listo) => {
    const hijo = spawn("node", ["operacion/version-del-respaldo.ts", ...args], { cwd: RAIZ, env: { PATH: process.env.PATH, MODO: "desarrollo", ...entorno } });
    let salida = "";
    let queja = "";
    hijo.stdout.on("data", (d) => { salida += d; });
    hijo.stderr.on("data", (d) => { queja += d; });
    hijo.on("close", (codigo) => listo({ codigo, salida: salida.trim(), queja }));
    hijo.stdin.end();
  });
}

test("de un respaldo se sabe qué publicación corría cuando se tomó, y de qué commit es; con la credencial de recuperación, desde otra máquina", () =>
  conCubo(async (cubo) => {
    const delDueno = { ...cubo.entorno(cubo.recuperacion), RESPALDO_DESTINO: cubo.destino };
    const destino = destinoRclone(cubo.destino, cubo.entorno(cubo.recuperacion));

    // Sin respaldos no hay de dónde instalar.
    const sinNinguno = await orden([], delDueno);
    assert.equal(sinNinguno.codigo, 1);
    assert.match(sinNinguno.queja, /No hay ningún respaldo/);

    // Respaldos puestos a mano: uno de antes de que se publicara así, uno más nuevo que dice su publicación, y uno que dice algo que no lo es.
    const respaldo = async (momento: string, corrida: string, publicacion?: string): Promise<string> => {
      const objeto = nombreDeObjeto(new Date(momento), corrida);
      const cifrado = randomBytes(2000);
      await cubo.poner(objeto, cifrado);
      await cubo.poner(nombreDeManifiesto(objeto), Buffer.from(JSON.stringify({
        formato: 1, corrida, instantanea: momento, objeto, bytes: cifrado.length, sha256: "a".repeat(64), pgDump: "pg_dump (PostgreSQL) 17.6",
        llavePublica: "age1" + "q".repeat(58), esquema: "0026_mantenimiento.sql", ...(publicacion ? { publicacion } : {}),
      })));
      return objeto;
    };
    const deAntes = await respaldo("2026-10-06T12:00:00.000Z", "11111111-1111-4111-8111-111111111111");
    const elUltimo = await respaldo("2026-10-06T13:00:00.000Z", "22222222-2222-4222-8222-222222222222", PUB);

    assert.deepEqual(await versionDe(destino), { objeto: elUltimo, publicacion: PUB, commit: "fedcba987654" });
    assert.equal((await orden([], delDueno)).salida, `${elUltimo} ${PUB} fedcba987654`);
    assert.equal((await orden([elUltimo], delDueno)).salida, `${elUltimo} ${PUB} fedcba987654`);
    const sinPublicacion = await orden([deAntes], delDueno);
    assert.equal(sinPublicacion.codigo, 1);
    assert.match(sinPublicacion.queja, /no dice qué publicación corría/);
    const noHay = await orden([nombreDeObjeto(new Date("2026-10-06T14:00:00.000Z"), "33333333-3333-4333-8333-333333333333")], delDueno);
    assert.equal(noHay.codigo, 1);
    assert.match(noHay.queja, /No hay un respaldo con ese nombre/);

    // Si hay uno más nuevo con el manifiesto dañado, «el último» no baja en silencio a uno más viejo: se pide por su nombre.
    const danado = nombreDeObjeto(new Date("2026-10-06T15:00:00.000Z"), "44444444-4444-4444-8444-444444444444");
    await cubo.poner(danado, randomBytes(2000));
    await cubo.poner(nombreDeManifiesto(danado), Buffer.from("{ dañado"));
    const conUnoDanado = await orden([], delDueno);
    assert.equal(conUnoDanado.codigo, 1);
    assert.match(conUnoDanado.queja, /manifiesto dañado.*pídelo por su nombre/s);
    assert.equal((await orden([elUltimo], delDueno)).salida, `${elUltimo} ${PUB} fedcba987654`);

    assert.equal((await orden([elUltimo, "de más"], delDueno)).codigo, 2);
    assert.match((await orden([], { PATH: process.env.PATH! })).queja, /Falta RESPALDO_DESTINO/);
  }));

test("un respaldo que dice una publicación que no lo es no sirve para saber en qué commit instalar", () =>
  conCubo(async (cubo) => {
    const destino = destinoRclone(cubo.destino, cubo.entorno(cubo.recuperacion));
    const objeto = nombreDeObjeto(new Date("2026-10-06T16:00:00.000Z"), "55555555-5555-4555-8555-555555555555");
    const cifrado = randomBytes(2000);
    await cubo.poner(objeto, cifrado);
    const manifiesto = (publicacion: string) => Buffer.from(JSON.stringify({
      formato: 1, corrida: "55555555-5555-4555-8555-555555555555", instantanea: "2026-10-06T16:00:00.000Z", objeto, bytes: cifrado.length, sha256: "a".repeat(64),
      pgDump: "pg_dump (PostgreSQL) 17.6", llavePublica: "age1" + "q".repeat(58), esquema: "0026_mantenimiento.sql", publicacion,
    }));
    await cubo.poner(nombreDeManifiesto(objeto), manifiesto("la-de-ayer; rm -rf /"));
    // Lo que diga el manifiesto va a dar a un guion: tiene que ser el identificador de una publicación, y nada más.
    await assert.rejects(versionDe(destino, objeto), /dice algo que no puede ser/);
  }));
