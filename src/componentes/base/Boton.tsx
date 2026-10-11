// El botón: lo que se toca para hacer algo. Mide lo que todo lo que se toca (60 px) y ocupa el
// ancho de donde está, salvo el corto.
//
// Es un botón de verdad: si se deshabilita, queda deshabilitado; y no envía un formulario por
// accidente —es de tipo «button» mientras no se le diga «submit»—.
import type { ButtonHTMLAttributes } from "react";

/**
 * - lleno: lo que sigue, lo principal de la pantalla. Uno por pantalla, de preferencia.
 * - tinte: lo que también se puede hacer, sin competir con lo principal.
 * - gris: lo que regresa, o deja las cosas como están.
 * - peligro: lo que no tiene vuelta.
 * - linea: cuando va sobre algo que ya tiene color.
 */
export type ClaseDeBoton = "lleno" | "tinte" | "gris" | "peligro" | "linea";

/** Las clases de un botón. Sirven también para lo que se ve como botón sin serlo: un enlace que lleva a otra pantalla. */
export function claseDeBoton(clase: ClaseDeBoton = "lleno", corto = false, mas = ""): string {
  return ["boton", clase === "lleno" ? "" : clase, corto ? "corto" : "", mas].filter(Boolean).join(" ");
}

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  clase?: ClaseDeBoton;
  /** Del ancho de su texto, no del de donde está. */
  corto?: boolean;
}

export function Boton({ clase = "lleno", corto = false, className, type = "button", ...resto }: Props) {
  return <button {...resto} type={type} className={claseDeBoton(clase, corto, className)} />;
}
