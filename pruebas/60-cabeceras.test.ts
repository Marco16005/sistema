// Las cabeceras con que el sitio le dice al navegador qué no permitir. Las pidió la revisión de
// seguridad de Codex del 5 de noviembre (encargo 40): R40-02 (una política de contenido que solo
// negaba los marcos), R40-03 (sin «nosniff») y R40-04 (respuestas privadas sin política de caché).
// Aquí, lo que dicen; que el navegador las reciba y que con ellas todo funcione, en los recorridos
// (recorrido/cabeceras.spec.ts) y en el ensayo de operación (recorrido/operacion.spec.ts).
import assert from "node:assert/strict";
import { test } from "node:test";
import { nonceNuevo, politicaDePagina } from "../src/servidor/cabeceras.ts";

/** «a b; c d e» → { a: [b], c: [d, e] } */
const directivas = (politica: string): Map<string, string[]> =>
  new Map(
    politica
      .split(";")
      .map((d) => d.trim())
      .filter(Boolean)
      .map((d) => {
        const [nombre, ...valores] = d.split(/\s+/);
        return [nombre!, valores];
      }),
  );

test("en las páginas solo corren los scripts de la aplicación: ninguno escrito en la página sin el nonce de esa respuesta, ni de otro sitio", () => {
  const politica = politicaDePagina("NONCE");
  const d = directivas(politica);
  assert.deepEqual(d.get("default-src"), ["'self'"]);
  // Con el nonce y «strict-dynamic», lo que Next pone en la página corre, y lo que alguien lograra
  // colar como texto no: ni en línea sin el nonce, ni eval.
  assert.deepEqual(d.get("script-src"), ["'self'", "'nonce-NONCE'", "'strict-dynamic'"]);
  // Los estilos sí en línea: las pantallas usan el atributo style, que no puede llevar nonce.
  assert.deepEqual(d.get("style-src"), ["'self'", "'unsafe-inline'"]);
  assert.deepEqual(d.get("img-src"), ["'self'", "data:", "blob:"]);
  assert.deepEqual(d.get("font-src"), ["'self'"]);
  assert.deepEqual(d.get("object-src"), ["'none'"]);
  assert.deepEqual(d.get("base-uri"), ["'none'"]);
  assert.deepEqual(d.get("form-action"), ["'self'"]);
  assert.deepEqual(d.get("frame-ancestors"), ["'none'"]);
  // Nada de otro sitio, en ninguna directiva.
  for (const [nombre, valores] of d) assert.ok(!valores.some((v) => /^(https?:|\*)/.test(v)), `${nombre} permite otro sitio`);
  // Una sola línea: va tal cual en una cabecera.
  assert.doesNotMatch(politica, /[\r\n]/);
});

test("cada respuesta lleva un nonce nuevo: 16 bytes al azar", () => {
  const vistos = new Set(Array.from({ length: 200 }, () => nonceNuevo()));
  assert.equal(vistos.size, 200);
  for (const nonce of vistos) assert.match(nonce, /^[A-Za-z0-9+/]{22}==$/);
});

test("todo lo que sirve la aplicación: sin adivinar su tipo y sin mostrarse en un marco; lo de la API, además, sin guardarse en ningún caché", async () => {
  // Se carga sin sus tipos: los de Next cambian los globales de Node para todas las pruebas.
  const config: { headers(): Promise<Array<{ source: string; headers: Array<{ key: string; value: string }> }>> } = (
    await import(String(new URL("../next.config.ts", import.meta.url)))
  ).default;
  const reglas = await config.headers();
  const de = (fuente: string) => Object.fromEntries((reglas.find((r) => r.source === fuente)?.headers ?? []).map((h) => [h.key, h.value]));
  assert.deepEqual(de("/:camino*"), { "X-Content-Type-Options": "nosniff", "X-Frame-Options": "DENY" });
  // La API devuelve datos, nunca una página: ni un script, ni un marco, ni que nadie la guarde. Lo
  // que no cae en default-src se dice aparte (ZAP, en la verificación de Codex del 5 de noviembre).
  assert.deepEqual(de("/api/:camino*"), {
    "Cache-Control": "private, no-store",
    "Content-Security-Policy": "default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  });
  // La política de las páginas la pone src/proxy.ts, con su nonce: aquí no va otra que se le sume.
  assert.equal(reglas.length, 2);
});
