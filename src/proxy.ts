// Antes de cada página: su política de contenido, con un nonce nuevo (src/servidor/cabeceras.ts).
// Va en la petición, para que Next le ponga ese nonce a sus scripts al armar la página, y en la
// respuesta, para que el navegador la cumpla. (Next 16.4 además copia a la petición lo que el proxy
// pone en la respuesta, así que con la segunda sola también funciona hoy; la primera es la forma que
// documenta su guía, y así no depende de ese detalle. Lo que se prueba es el efecto: que los scripts
// lleven el nonce de la cabecera, en recorrido/cabeceras.spec.ts.) Las páginas se arman en cada
// petición (el armazón lee la galleta del contraste): ninguna sale hecha de antes, sin nonce.
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { nonceNuevo, politicaDePagina } from "./servidor/cabeceras.ts";

export function proxy(peticion: NextRequest) {
  const politica = politicaDePagina(nonceNuevo());
  const cabeceras = new Headers(peticion.headers);
  cabeceras.set("Content-Security-Policy", politica);
  const respuesta = NextResponse.next({ request: { headers: cabeceras } });
  respuesta.headers.set("Content-Security-Policy", politica);
  return respuesta;
}

// Solo las páginas. La API tiene la suya, fija (next.config.ts); lo construido (_next/static) no
// es una página; y lo que Next pide por adelantado para navegar no se muestra solo.
export const config = {
  matcher: [
    {
      source: "/((?!api|_next/static|_next/image|favicon.ico).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
