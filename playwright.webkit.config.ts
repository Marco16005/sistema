// Los recorridos, otra vez, en WebKit: es el motor de Safari y de todo navegador en iOS, y Chromium
// no lo sustituye. Corren contra la misma aplicación de los recorridos, pero por HTTPS de verdad
// (ver proxy_webkit en docker-compose.yml): los candados entre pestañas piden origen seguro.
//   docker compose --profile webkit run --rm recorrido_webkit
import { defineConfig } from "@playwright/test";

const BASE = process.env.BASE_URL ?? "https://recorrido.test";

export default defineConfig({
  testDir: "recorrido",
  // Todos los recorridos, menos dos: el de operación tiene su propia pila, y el del papel cuenta las
  // hojas de un PDF, que solo Chromium sabe producir.
  testIgnore: ["operacion.spec.ts", "papel.spec.ts"],
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  reporter: [["list"]],
  outputDir: "/tmp/recorrido-webkit",
  use: {
    baseURL: BASE,
    browserName: "webkit",
    locale: "es-MX",
    timezoneId: "America/Mexico_City",
    trace: "retain-on-failure",
  },
});
