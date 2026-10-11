// El interruptor: algo que está encendido o apagado, y se cambia con un toque. Se toca entero —el
// dibujo, el rótulo y la palanca— y mide lo que todo lo que se toca.
//
// Dice la verdad: lo que muestra es lo que su dueño le dice, y mientras su dueño está ocupado
// guardando el cambio no admite otro toque.
import type { ReactNode } from "react";

interface Props {
  rotulo: string;
  encendido: boolean;
  /** Se está guardando el cambio: no admite otro toque hasta que termine. */
  ocupado?: boolean;
  alCambiar: () => void;
  /** Un dibujo que lo acompaña; en pantallas angostas puede quedarse solo, sin el rótulo a la vista. */
  dibujo?: ReactNode;
}

export function Interruptor({ rotulo, encendido, ocupado = false, alCambiar, dibujo }: Props) {
  return (
    <button className="interruptor" type="button" role="switch" aria-checked={encendido} disabled={ocupado} onClick={alCambiar}>
      {dibujo}
      <span>{rotulo}</span>
      <i aria-hidden="true" />
    </button>
  );
}
