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

// Todo menos la API, que tiene la suya, fija (next.config.ts), y lo construido (_next/static/), que
// no es una página. Exactamente esas carpetas: lo que solo empieza igual («/apicualquiera») es una
// página que no existe, y sale como HTML. Y sin excepción para lo pedido por adelantado: con esas
// cabeceras Next también arma la página entera (verificación de Codex del 5 de noviembre, R41-01).
export const config = {
  matcher: ["/((?!api(?:/|$)|_next/static/).*)"],
};
