import type { NextConfig } from "next";

const config: NextConfig = {
  // La imagen final lleva solo lo construido y lo que necesita para correr.
  output: "standalone",
  serverExternalPackages: ["pg"],
  poweredByHeader: false,
  // La aplicación no se muestra dentro de un marco, ni de su mismo origen: un marco comparte lo
  // guardado con su página y le pisaría lo que tiene a medias (ver src/componentes/pestana.ts).
  async headers() {
    return [
      {
        source: "/:camino*",
        headers: [
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
          { key: "X-Frame-Options", value: "DENY" },
        ],
      },
    ];
  },
};

export default config;
