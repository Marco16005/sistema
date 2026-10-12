// Las gráficas del panel. Son dibujos hechos con cajas, sin ninguna biblioteca: toman los colores
// de la interfaz, así que se leen en claro, en oscuro y con más contraste. Un dibujo no se le lee a
// quien no ve la pantalla: por eso cada gráfica va oculta para el lector, y sus números, en una
// tabla o una lista junto a ella.

export interface Columna {
  clave: string;
  /** Lo que va al pie. No cabe en todas las columnas: se pone cada tantas, contando desde la última. */
  rotulo: string;
  /** Una barra por valor, en el orden de `clases`. */
  valores: number[];
}

/** Barras verticales, a la escala del valor más grande, que se escribe arriba. */
export function Barras({ columnas, clases, tope }: { columnas: Columna[]; clases: string[]; tope: (mayor: number) => string }) {
  const mayor = Math.max(0, ...columnas.flatMap((c) => c.valores));
  const cada = columnas.length <= 8 ? 1 : columnas.length <= 14 ? 3 : 7;
  return (
    <div className="grafica" aria-hidden="true">
      <small className="tope">{mayor > 0 ? tope(mayor) : " "}</small>
      <div className="columnas">
        {columnas.map((c, k) => (
          <div className="col" key={c.clave}>
            <div className="par">
              {c.valores.map((v, n) => (
                // Lo que no es cero se tiene que ver, aunque al lado haya un día cien veces mayor.
                <i key={clases[n]} className={`barrita ${clases[n]}`} style={{ height: v > 0 ? `max(3px, ${(v / mayor) * 100}%)` : 0 }} />
              ))}
            </div>
            <small><span>{(columnas.length - 1 - k) % cada === 0 ? c.rotulo : ""}</span></small>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Una tira que se llena en proporción: qué tanto es esto, del mayor de la lista. */
export function Tira({ parte, de, clase }: { parte: number; de: number; clase: string }) {
  const ancho = de > 0 && parte > 0 ? Math.max(1.5, (parte / de) * 100) : 0;
  return <span className="tira" aria-hidden="true"><i className={clase} style={{ width: `${ancho}%` }} /></span>;
}
