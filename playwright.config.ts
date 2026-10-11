import { defineConfig } from "@playwright/test";

const BASE = process.env.BASE_URL ?? "http://web_recorrido:3000";

// Los recorridos comparten una sola base, así que van de uno en uno.
export default defineConfig({
  testDir: "recorrido",
  // El recorrido de la operación va por HTTPS, detrás del proxy, y lo corre el ensayo (operacion/ensayo.sh).
  testIgnore: "operacion.spec.ts",
  workers: 1,
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  timeout: 60_000,
  reporter: [["list"]],
  outputDir: "/tmp/recorrido",
  use: {
    baseURL: BASE,
    // En operación la aplicación va por HTTPS. Aquí va por HTTP entre contenedores, y el navegador
    // le negaría lo que reserva a los orígenes seguros (los candados entre pestañas, por ejemplo):
    // se le dice que trate este origen como seguro, para probar lo que de verdad va a correr. La
    // bandera solo la respeta el Chromium completo, no el reducido que Playwright usa por omisión.
    channel: "chromium",
    launchOptions: { args: [`--unsafely-treat-insecure-origin-as-secure=${new URL(BASE).origin}`] },
    locale: "es-MX",
    timezoneId: "America/Mexico_City",
    trace: "retain-on-failure",
  },
});
