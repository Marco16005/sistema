import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
const RAIZ = "/tmp/feruga-codex-qa14";
test("en operación cada servicio tiene tope de memoria, de CPU y de procesos, sin intercambio aparte: en un servidor compartido no deja sin memoria a la otra aplicación", async () => {
  // Lo señaló Docker Bench en el servidor, el 10 de noviembre: ahí vive también Recycling, que sí
  // tiene topes; si algo de feruga se desbocara, sin tope podía dejarla sin memoria.
  const operacion = await readFile(join(RAIZ, "docker-compose.operacion.yml"), "utf8");
  const bloque = (nombre: string): string => {
    const desde = operacion.search(new RegExp(`^(  ${nombre}:|x-${nombre}: &${nombre})$`, "m"));
    assert.notEqual(desde, -1, `no está ${nombre}`);
    const resto = operacion.slice(desde + 1);
    const hasta = resto.search(/^(  [a-z_-]+:|[a-z]+:)$/m);
    return hasta === -1 ? resto : resto.slice(0, hasta);
  };
  const megas = (valor: string): number => Number(valor.slice(0, -1)) * (valor.endsWith("g") ? 1024 : 1);
  // Con las claves del servicio, no con «deploy»: al guardar la configuración, Compose le agrega a
  // cada «deploy» un «placement» vacío, y en el servidor cada orden avisaba que eso es de Swarm.
  const topes = (texto: string, quien: string) => {
    const m = /^\s+mem_limit: (\d+[mg])\n\s+memswap_limit: (\d+[mg])\n\s+cpus: "(\d+(?:\.\d+)?)"\n\s+pids_limit: (\d+)$/m.exec(texto);
    assert.ok(m, `${quien} no tiene sus topes (memoria, intercambio, CPU y procesos)`);
    // Sin memoria de intercambio aparte: por omisión Docker deja usar otro tanto en disco, y eso no
    // estaría en la cuenta (Codex, R44-02).
    assert.equal(m[2], m[1], `${quien}: la memoria de intercambio no es igual a su tope de memoria`);
    return { memoria: megas(m[1]!), cpus: Number(m[3]), procesos: Number(m[4]) };
  };
  // El respaldo y la comprobación comparten el suyo: la comprobación también restaura (volver, instalar desde un respaldo).
  const compartido = operacion.slice(operacion.indexOf("x-respaldo: &respaldo"), operacion.indexOf("\nservices:"));
  const todos = { respaldo: topes(compartido, "el respaldo y la comprobación"), ...Object.fromEntries(["db", "migracion", "consola", "web", "proxy"].map((s) => [s, topes(bloque(s), s)])) };
  for (const servicio of ["comprobacion", "respaldo"]) assert.doesNotMatch(bloque(servicio).replace(/^[^\n]*\n/, ""), /mem_limit|memswap_limit|cpus:|pids_limit/, `${servicio} cambia los topes del bloque compartido`);
  assert.doesNotMatch(operacion, /^\s+deploy:/m, "algún servicio usa «deploy», y la configuración guardada avisaría que es de Swarm");
  // La base se apaga limpia antes de que se la corte: al cambiar su servidor se recrea su contenedor.
  assert.match(bloque("db"), /^    stop_grace_period: 2m$/m, "la base no tiene plazo para apagarse limpia");
  for (const [quien, t] of Object.entries(todos)) {
    assert.ok(t.memoria >= 256 && t.memoria <= 1024, `${quien}: ${t.memoria} MB`);
    // Ninguno, él solo, puede tomar los dos procesadores del servidor. Juntos sí pueden ocuparlos: un
    // tope no es una reserva (Codex, R44-01). Lo que protege a la otra aplicación es la memoria.
    assert.ok(t.cpus > 0 && t.cpus < 2, `${quien}: ${t.cpus} CPU`);
    assert.ok(t.procesos >= 64 && t.procesos <= 512, `${quien}: ${t.procesos} procesos`);
  }
  // Todo a la vez, en el peor caso, cabe con holgura en lo que tiene el servidor (unos 7.7 GB) junto a la otra.
  const suma = Object.values(todos).reduce((s, t) => s + t.memoria, 0) + todos.respaldo.memoria; // la comprobación, aparte
  assert.ok(suma <= 4.5 * 1024, `los topes suman ${suma} MB`);
});
