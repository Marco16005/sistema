// Los avisos que salen del sistema (con el servidor): el aviso del cajón —un corte que no cuadró, un
// cajón que se abrió con otra cantidad que la que se dejó— por Telegram y por correo; y el latido, que
// le dice a un vigilante de fuera que el sitio contesta. Se prueban contra un Telegram y un servidor
// de correo de mentira, en esta máquina.
import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { createServer as servidorTcp } from "node:net";
import { test } from "node:test";
import { avisarPendientes, canalTelegram, latir, textoDeAviso } from "../operacion/avisos.ts";
import type { Canal } from "../operacion/avisos.ts";
import { enviarCorreo } from "../operacion/correo.ts";
import { faltasDelEntorno } from "../src/servidor/entorno.ts";
import { conBase, escenario, una } from "./apoyo.ts";

/** Un canal que anota lo que se le manda, y que falla las veces que se le diga. */
function canalFalso(fallas = 0): Canal & { mandados: string[] } {
  const mandados: string[] = [];
  let quedan = fallas;
  return {
    nombre: "de prueba", mandados,
    enviar: async (texto) => {
      if (quedan > 0) { quedan -= 1; throw new Error("no contestó"); }
      mandados.push(texto);
    },
  };
}

test("el texto de cada aviso dice qué pasó, de qué día, cuánto y quién, en llano", () => {
  const base = { negocio: "Recicladora del Norte", fecha: "2026-10-21", quien: "Rosa", hora: "19:05" };
  assert.equal(textoDeAviso({ ...base, clase: "corte", diferencia: "-50.00" }),
    "Recicladora del Norte · El corte del miércoles 21 de octubre no cuadró: faltaron $50.00. Lo firmó Rosa a las 19:05.");
  assert.equal(textoDeAviso({ ...base, clase: "corte", diferencia: "1250.50" }),
    "Recicladora del Norte · El corte del miércoles 21 de octubre no cuadró: sobraron $1,250.50. Lo firmó Rosa a las 19:05.");
  assert.equal(textoDeAviso({ ...base, clase: "apertura", diferencia: "-200.00", quien: "Luis", hora: "08:02" }),
    "Recicladora del Norte · El cajón del miércoles 21 de octubre se abrió con $200.00 de menos de lo que se dejó en el último corte. Lo contó Luis a las 08:02.");
  assert.equal(textoDeAviso({ ...base, clase: "apertura", diferencia: "30.00", quien: "Luis", hora: "08:02" }),
    "Recicladora del Norte · El cajón del miércoles 21 de octubre se abrió con $30.00 de más de lo que se dejó en el último corte. Lo contó Luis a las 08:02.");
});

test("un aviso sin ver sale por cada canal una sola vez y queda dicho que salió; uno ya visto en la pantalla no sale", () =>
  conBase(async (db) => {
    const e = await escenario(db);
    const nuevo = (diferencia: number) => una(db, "INSERT INTO aviso (clase, jornada_id, diferencia, creado_por) VALUES ('corte', $1, $2, $3) RETURNING id",
      [e.jornada, diferencia, e.responsable]);
    const uno = await nuevo(-50);
    const visto = await nuevo(20);
    await db.query("UPDATE aviso SET visto_por = $2, visto_en = now() WHERE id = $1", [visto.id, e.responsable]);
    const [a, b] = [canalFalso(), canalFalso()];
    assert.deepEqual(await avisarPendientes(db, [a, b], "Recicladora"), { enviados: 1, pendientes: 0 });
    assert.equal(a.mandados.length, 1);
    assert.deepEqual(b.mandados, a.mandados);
    assert.match(a.mandados[0]!, /^Recicladora · El corte del .* no cuadró: faltaron \$50\.00\. Lo firmó /);
    assert.ok((await una(db, "SELECT enviado_en FROM aviso WHERE id = $1", [uno.id])).enviado_en);
    assert.equal((await una(db, "SELECT enviado_en FROM aviso WHERE id = $1", [visto.id])).enviado_en, null);
    // La vez siguiente ya no sale.
    assert.deepEqual(await avisarPendientes(db, [a, b], "Recicladora"), { enviados: 0, pendientes: 0 });
    assert.equal(a.mandados.length, 1);
  }));

test("si un canal falla, el aviso no se da por enviado: se intenta otra vez —mejor dos avisos que ninguno—", () =>
  conBase(async (db) => {
    const e = await escenario(db);
    await db.query("INSERT INTO aviso (clase, jornada_id, diferencia, creado_por) VALUES ('apertura', $1, -100, $2)", [e.jornada, e.responsable]);
    const [bien, falla] = [canalFalso(), canalFalso(1)];
    const dicho: string[] = [];
    assert.deepEqual(await avisarPendientes(db, [bien, falla], "Recicladora", (l) => dicho.push(l)), { enviados: 0, pendientes: 1 });
    assert.match(dicho.join("\n"), /no salió por de prueba: no contestó/);
    assert.equal((await una(db, "SELECT count(*)::int AS n FROM aviso WHERE enviado_en IS NULL")).n, 1);
    assert.deepEqual(await avisarPendientes(db, [bien, falla], "Recicladora"), { enviados: 1, pendientes: 0 });
    assert.equal(bien.mandados.length, 2);
    assert.equal(falla.mandados.length, 1);
  }));

test("por Telegram: el mensaje va al chat dicho, y si Telegram lo rechaza se dice sin enseñar la clave del bot", async () => {
  const pedidos: Array<{ camino: string; cuerpo: Record<string, unknown> }> = [];
  let contesta = 200;
  const servidor = createServer((pide, responde) => {
    let cuerpo = "";
    pide.on("data", (t) => { cuerpo += t; });
    pide.on("end", () => {
      pedidos.push({ camino: pide.url ?? "", cuerpo: JSON.parse(cuerpo) });
      responde.writeHead(contesta, { "content-type": "application/json" }).end(JSON.stringify({ ok: contesta === 200 }));
    });
  });
  servidor.listen(0, "127.0.0.1");
  await once(servidor, "listening");
  const base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
  const TOKEN = "123456:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij";
  try {
    const canal = canalTelegram(TOKEN, "-100200300", { base });
    await canal.enviar("El corte no cuadró");
    assert.deepEqual(pedidos, [{ camino: `/bot${TOKEN}/sendMessage`, cuerpo: { chat_id: "-100200300", text: "El corte no cuadró", disable_web_page_preview: true } }]);
    contesta = 401;
    await assert.rejects(canal.enviar("otro"), (e: Error) => /Telegram contestó 401/.test(e.message) && !e.message.includes(TOKEN));
  } finally {
    servidor.close();
  }
});

/** Un servidor de correo de mentira: contesta lo justo, y anota lo que le dicen. */
async function servidorDeCorreo(o: { rechazarRcpt?: boolean } = {}) {
  const dicho: string[] = [];
  const mensajes: string[] = [];
  const servidor = servidorTcp((s) => {
    s.setEncoding("utf8");
    let pendiente = "";
    let enDatos = false;
    let datos = "";
    s.write("220 correo.prueba listo\r\n");
    s.on("data", (trozo: string) => {
      pendiente += trozo;
      let k: number;
      while ((k = pendiente.indexOf("\r\n")) >= 0) {
        const linea = pendiente.slice(0, k);
        pendiente = pendiente.slice(k + 2);
        if (enDatos) {
          if (linea === ".") { enDatos = false; mensajes.push(datos); datos = ""; s.write("250 2.0.0 recibido\r\n"); } else datos += linea + "\r\n";
          continue;
        }
        dicho.push(linea);
        if (/^EHLO /.test(linea)) s.write("250-correo.prueba\r\n250-AUTH PLAIN LOGIN\r\n250 8BITMIME\r\n");
        else if (/^AUTH PLAIN /.test(linea)) s.write("235 2.7.0 adentro\r\n");
        else if (/^MAIL FROM:/.test(linea)) s.write("250 2.1.0 bien\r\n");
        else if (/^RCPT TO:/.test(linea)) s.write(o.rechazarRcpt ? "550 5.1.1 no existe\r\n" : "250 2.1.5 bien\r\n");
        else if (linea === "DATA") { enDatos = true; s.write("354 adelante\r\n"); }
        else if (linea === "QUIT") { s.write("221 adiós\r\n"); s.end(); }
        else s.write("500 no entiendo\r\n");
      }
    });
  });
  servidor.listen(0, "127.0.0.1");
  await once(servidor, "listening");
  return { dicho, mensajes, puerto: (servidor.address() as AddressInfo).port, cerrar: () => servidor.close() };
}

test("por correo: entra con su usuario, manda a cada destinatario, con el asunto y el texto en UTF-8; y si lo rechaza, lo dice sin la contraseña", async () => {
  const s = await servidorDeCorreo();
  try {
    await enviarCorreo({
      url: `smtp://avisos%40patio.mx:una%20clave@127.0.0.1:${s.puerto}`, de: "avisos@patio.mx", para: ["dueno@patio.mx", "soporte@patio.mx"],
      asunto: "Aviso del cajón", texto: "El corte del miércoles no cuadró: faltaron $50.00.", sinCifrar: true,
    });
    assert.equal(s.dicho[0], "EHLO feruga");
    assert.equal(s.dicho[1], `AUTH PLAIN ${Buffer.from("\0avisos@patio.mx\0una clave").toString("base64")}`);
    assert.deepEqual(s.dicho.slice(2, 5), ["MAIL FROM:<avisos@patio.mx>", "RCPT TO:<dueno@patio.mx>", "RCPT TO:<soporte@patio.mx>"]);
    const m = s.mensajes[0]!;
    assert.match(m, /^From: avisos@patio\.mx\r\n/m);
    assert.match(m, /^To: dueno@patio\.mx, soporte@patio\.mx\r\n/m);
    assert.match(m, new RegExp(`^Subject: =\\?UTF-8\\?B\\?${Buffer.from("Aviso del cajón").toString("base64").replace(/[+/=]/g, (c) => `\\${c}`)}\\?=\r\n`, "m"));
    const cuerpo = m.split("\r\n\r\n").slice(1).join("").replace(/\r\n/g, "");
    assert.equal(Buffer.from(cuerpo, "base64").toString("utf8"), "El corte del miércoles no cuadró: faltaron $50.00.");
  } finally {
    s.cerrar();
  }
  const r = await servidorDeCorreo({ rechazarRcpt: true });
  try {
    await assert.rejects(enviarCorreo({ url: `smtp://avisos%40patio.mx:secreta@127.0.0.1:${r.puerto}`, de: "a@b.mx", para: ["c@d.mx"], asunto: "x", texto: "y", sinCifrar: true }),
      (e: Error) => /550/.test(e.message) && !e.message.includes("secreta"));
  } finally {
    r.cerrar();
  }
  // Sin cifrar no se manda: si el servidor no ofrece cifrar la conexión, no se entra; la contraseña viajaría a la vista.
  const sin = await servidorDeCorreo();
  try {
    await assert.rejects(enviarCorreo({ url: `smtp://u:secreta@127.0.0.1:${sin.puerto}`, de: "a@b.mx", para: ["c@d.mx"], asunto: "x", texto: "y" }),
      /no se manda nada sin cifrar/);
    assert.ok(!sin.dicho.some((l) => l.startsWith("AUTH")), "mandó la contraseña sin cifrar");
  } finally {
    sin.cerrar();
  }
  await assert.rejects(enviarCorreo({ url: "smtp://u:c@smtp.patio.mx:25", de: "a@b.mx", para: ["c@d.mx"], asunto: "x", texto: "y", sinCifrar: true }), /esta misma máquina/);
});

test("el latido le dice al vigilante que el sitio contesta, y que no, con por qué", async () => {
  const dicho: string[] = [];
  const vigia = { inicio: async () => {}, bien: async () => { dicho.push("bien"); }, fallo: async (_c: string, que: string) => { dicho.push(`falló: ${que}`); } };
  await latir(async () => ({ abierta: true }), vigia);
  await latir(async () => { throw new Error("el sitio no contestó a tiempo"); }, vigia);
  assert.deepEqual(dicho, ["bien", "falló: el sitio no contestó a tiempo"]);
});

test("en el entorno, lo de los avisos de fuera va completo o no va", () => {
  // En operación (en desarrollo no se exige nada). Lo demás que falte del respaldo no importa aquí.
  const faltas = (env: Record<string, string>) => faltasDelEntorno(env, ["respaldo"]).join("\n");
  assert.match(faltas({ AVISOS_TELEGRAM_TOKEN: "123456:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij" }), /AVISOS_TELEGRAM_CHAT/);
  assert.match(faltas({ AVISOS_TELEGRAM_CHAT: "-100200300" }), /AVISOS_TELEGRAM_TOKEN/);
  assert.match(faltas({ AVISOS_TELEGRAM_TOKEN: "no es un token", AVISOS_TELEGRAM_CHAT: "-1" }), /AVISOS_TELEGRAM_TOKEN no tiene su forma/);
  assert.match(faltas({ AVISOS_CORREO_SMTP: "smtps://u:c@smtp.patio.mx:465" }), /AVISOS_CORREO_DE/);
  assert.match(faltas({ AVISOS_CORREO_SMTP: "http://smtp.patio.mx", AVISOS_CORREO_DE: "a@patio.mx", AVISOS_CORREO_PARA: "b@patio.mx" }), /AVISOS_CORREO_SMTP/);
  assert.match(faltas({ AVISOS_CORREO_SMTP: "smtps://u:c@smtp.patio.mx:465", AVISOS_CORREO_DE: "a@patio.mx", AVISOS_CORREO_PARA: "no es correo" }), /AVISOS_CORREO_PARA/);
  assert.match(faltas({ LATIDO_VIGIA_URL: "https://u:c@hc-ping.com/abc" }), /LATIDO_VIGIA_URL/);
  assert.doesNotMatch(faltas({
    AVISOS_TELEGRAM_TOKEN: "123456:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij", AVISOS_TELEGRAM_CHAT: "-100200300",
    AVISOS_CORREO_SMTP: "smtps://u:c@smtp.patio.mx:465", AVISOS_CORREO_DE: "a@patio.mx", AVISOS_CORREO_PARA: "b@patio.mx, c@patio.mx",
    LATIDO_VIGIA_URL: "https://hc-ping.com/abc",
  }), /AVISOS|LATIDO/);
});
