// La política de contenido de las páginas (Content-Security-Policy): qué le permite el navegador a
// una página del sitio. La pone src/proxy.ts en cada respuesta, con un nonce nuevo; Next lo encuentra
// en la petición y se lo pone a sus propios scripts. Revisión de seguridad de Codex del 5 de
// noviembre, R40-02: antes solo negaba los marcos.

/** 16 bytes al azar, en base64: lo que un script necesita llevar para correr en esa respuesta. */
export function nonceNuevo(): string {
  return btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))));
}

/**
 * La política de una página. Todo es del mismo sitio: la aplicación no carga nada de fuera (ni la
 * letra del comprobante, que se descarga al construir).
 * - Scripts: los que llevan el nonce de esta respuesta, y los que esos carguen («strict-dynamic»).
 *   Un texto que alguien lograra colar como HTML no correría: no sabe el nonce. Sin eval.
 * - Estilos: también en línea, porque las pantallas usan el atributo style y un atributo no puede
 *   llevar nonce. Un estilo colado no ejecuta nada.
 * - Sin objetos incrustados, sin <base> que cambie a dónde apuntan las ligas, formularios solo al
 *   mismo sitio, y en ningún marco (ver next.config.ts).
 * Sin «upgrade-insecure-requests»: la demostración local va por HTTP, y en operación HSTS ya obliga HTTPS.
 */
export function politicaDePagina(nonce: string): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}
