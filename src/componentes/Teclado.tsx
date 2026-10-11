"use client";
// El teclado en pantalla, para dedo y para guante. También escucha el teclado físico del equipo.
import { useEffect } from "react";

// Cómo llegó el foco a donde está: caminando con Tab, o con el dedo o el ratón. Se anota para toda
// la página, porque este teclado escucha las teclas desde la ventana, tenga el foco quien lo tenga.
let caminando = false;
if (typeof window !== "undefined") {
  window.addEventListener("keydown", (e) => { if (e.key === "Tab") caminando = true; }, true);
  window.addEventListener("pointerdown", () => { caminando = false; }, true);
}
/** Lo que, con el foco encima, hace algo suyo al dar Enter. */
const CON_ENTER_PROPIO = 'button, a[href], select, summary, [role="switch"], [role="button"], [role="link"]';

interface Props {
  valor: string;
  alCambiar: (valor: string) => void;
  /** Cuántos decimales admite; cero para una clave. */
  decimales: number;
  /** Largo máximo de la parte entera, o de la clave. */
  enteros: number;
  alTerminar?: () => void;
}

export function Teclado({ valor, alCambiar, decimales, enteros, alTerminar }: Props) {
  const teclear = (tecla: string): void => {
    if (tecla === "borrar") return alCambiar(valor.slice(0, -1));
    if (tecla === ".") {
      if (decimales === 0 || valor.includes(".")) return;
      return alCambiar(valor === "" ? "0." : valor + ".");
    }
    const [entero = "", decimal] = valor.split(".");
    if (decimal === undefined ? entero.length >= enteros : decimal.length >= decimales) return;
    alCambiar(valor + tecla);
  };

  useEffect(() => {
    const alPulsar = (e: KeyboardEvent): void => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const dentroDeUnCampo = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;
      if (dentroDeUnCampo) return;
      if (/^[0-9]$/.test(e.key)) teclear(e.key);
      else if (e.key === "." || e.key === ",") teclear(".");
      else if (e.key === "Backspace") teclear("borrar");
      else if (e.key === "Enter" && alTerminar) {
        // Enter sobre un control al que se llegó caminando con Tab es de ese control —un enlace de la
        // barra, el interruptor de contraste, «No soy yo»—: ahí no termina lo que se teclea. Con el
        // foco donde lo dejó un toque, sí: quien toca el material y teclea el peso en el teclado del
        // equipo no tiene por qué saber dónde quedó el foco. Las teclas de este teclado no cuentan.
        const destino = e.target instanceof Element ? e.target : null;
        if (caminando && destino?.closest(CON_ENTER_PROPIO) && !destino.closest(".teclado")) return;
        alTerminar();
      } else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", alPulsar);
    return () => window.removeEventListener("keydown", alPulsar);
  });

  return (
    <div className="teclado">
      {["7", "8", "9", "4", "5", "6", "1", "2", "3"].map((t) => (
        <button key={t} type="button" onClick={() => teclear(t)}>{t}</button>
      ))}
      {decimales > 0
        ? <button type="button" aria-label="Punto decimal" onClick={() => teclear(".")}>.</button>
        : <span />}
      <button type="button" onClick={() => teclear("0")}>0</button>
      <button type="button" className="aux" onClick={() => teclear("borrar")}>Borrar</button>
    </div>
  );
}

/**
 * El visor: lo que se va tecleando, como lo marcaría la báscula. Es de peso, salvo que se le diga
 * otra unidad y otra leyenda (la diferencia de un precio especial, en pesos).
 */
export function Visor({ nombre, nota, valor, unidad = "kg", leyenda }: { nombre: string; nota?: string; valor: string; unidad?: string; leyenda?: string }) {
  const mostrado = (valor || "0").padStart(5, " ");
  return (
    <div className="visor">
      <span className="quien">
        <b>{nombre}</b>
        {nota ? <small>{nota}</small> : null}
      </span>
      <span className="digits" role="status" aria-label={leyenda ?? `Peso tecleado: ${valor || "nada"} kilos`}>
        <span className="ghost" aria-hidden="true">{mostrado.replace(/[^.]/g, "8")}</span>
        <span className="live">{mostrado}</span>
        <span className="unit">{unidad}</span>
      </span>
    </div>
  );
}
