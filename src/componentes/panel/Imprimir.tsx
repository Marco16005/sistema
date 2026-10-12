"use client";
// Manda al papel la pantalla del panel que se está viendo, en una hoja normal: sale ella sola, sin
// la barra ni lo que se toca (ver «.imprimible» en src/estilo/panel.css). El comprobante no pasa
// por aquí: tiene su papel angosto y su registro de impresiones.

export function Imprimir() {
  return <button className="btn ghostbtn chico imprimir" type="button" onClick={() => window.print()}>Imprimir</button>;
}
