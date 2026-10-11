import { defineConfig } from "@playwright/test";

// El recorrido de la operación: por HTTPS, detrás del proxy, con el certificado validado. Aquí no
// hay bandera de origen seguro ni se ignoran errores de certificado: si el navegador no da el
// sitio por bueno, el recorrido falla. Lo corre el ensayo (operacion/ensayo.sh).
export default defineConfig({
  testDir: "recorrido",
  testMatch: "operacion.spec.ts",
  workers: 1,
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  timeout: 60_000,
  reporter: [["list"]],
  outputDir: "/tmp/recorrido",
  use: {
    baseURL: `https://${process.env.DOMINIO}`,
    channel: "chromium",
    locale: "es-MX",
    timezoneId: "America/Mexico_City",
    trace: "retain-on-failure",
  },
});
