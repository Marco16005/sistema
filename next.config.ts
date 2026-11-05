import type { NextConfig } from "next";

const config: NextConfig = {
  // La imagen final lleva solo lo construido y lo que necesita para correr.
  output: "standalone",
  serverExternalPackages: ["pg"],
  poweredByHeader: false,
  // Revisión de seguridad de Codex del 5 de noviembre (R40-02, R40-03, R40-04).
  async headers() {
    return [
      {
        source: "/:camino*",
        headers: [
          // El navegador toma cada respuesta por el tipo que dice, sin adivinarlo por su contenido.
          { key: "X-Content-Type-Options", value: "nosniff" },
          // La aplicación no se muestra dentro de un marco, ni de su mismo origen: un marco comparte lo
          // guardado con su página y le pisaría lo que tiene a medias (ver src/componentes/pestana.ts).
          // Lo dicen también las políticas de contenido (aquí abajo, y la de las páginas en src/proxy.ts).
          { key: "X-Frame-Options", value: "DENY" },
        ],
      },
      {
        // La API devuelve datos de quien tiene sesión: nadie los guarda (ni el navegador, ni un caché
        // de por medio), y no son una página: ni scripts, ni marcos.
        source: "/api/:camino*",
        headers: [
          { key: "Cache-Control", value: "private, no-store" },
          { key: "Content-Security-Policy", value: "default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'" },
        ],
      },
    ];
  },
};

export default config;
