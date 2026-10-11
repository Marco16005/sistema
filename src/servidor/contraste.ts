// «Más contraste, para el sol». Lo elige quien usa la pantalla y se recuerda por equipo: en una
// galleta propia, aparte de la de la sesión, que pone el servidor. Así sobrevive a salir, a cerrar
// el navegador y a reiniciar, y la página llega ya con el contraste puesto, sin parpadeo.
//
// No da ningún privilegio ni toca la base: solo dice cómo se ve la pantalla en ese equipo.

export type Contraste = "alto" | "normal";

export const GALLETA_DE_CONTRASTE = "contraste";

/** Lo más que un navegador conserva una galleta. Se renueva cada vez que se elige. */
const CUATROCIENTOS_DIAS = 60 * 60 * 24 * 400;

/** Lo que la galleta dice, leído con cuidado: una de las dos palabras, o nada (y entonces manda el equipo). */
export function contrasteElegido(valor: string | undefined): Contraste | null {
  return valor === "alto" || valor === "normal" ? valor : null;
}

/** El encabezado Set-Cookie que deja a este equipo con ese contraste. */
export function galletaDeContraste(valor: Contraste): string {
  const segura = process.env.COOKIE_SEGURA === "1" ? "; Secure" : "";
  return `${GALLETA_DE_CONTRASTE}=${valor}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${CUATROCIENTOS_DIAS}${segura}`;
}
