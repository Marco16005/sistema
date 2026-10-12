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

export interface Escalon {
  /** En qué día del periodo empieza a valer: 0 es el primero. */
  dia: number;
  /** Lo que vale desde ese día; nada si desde ese día no tiene precio. */
  valor: number | null;
}

/**
 * Un precio a lo largo del periodo, como escalones: vale lo mismo hasta el día en que cambia, y
 * donde no hubo precio no hay línea. La escala va del valor más bajo al más alto, no desde cero:
 * un precio se mueve por centavos y desde cero no se vería; por eso quien la usa escribe los dos
 * extremos junto al dibujo.
 */
export function Escalones({ series, dias, chica = false }: { series: Array<{ clase: string; escalones: Escalon[] }>; dias: number; chica?: boolean }) {
  const valores = series.flatMap((s) => s.escalones.flatMap((e) => (e.valor === null ? [] : [e.valor])));
  const [bajo, alto] = [Math.min(...valores), Math.max(...valores)];
  const y = (v: number): number => (alto === bajo ? 50 : 100 - ((v - bajo) / (alto - bajo)) * 100);
  const x = (dia: number): number => (Math.min(Math.max(dia, 0), dias) / dias) * 100;
  const trazo = (escalones: Escalon[]): string => {
    let d = "";
    let antes: number | null = null;
    escalones.forEach((e, k) => {
      if (e.valor !== null) {
        d += antes === null ? `M${x(e.dia)} ${y(e.valor)}` : `V${y(e.valor)}`;
        d += `H${x(escalones[k + 1]?.dia ?? dias)}`;
      }
      antes = e.valor;
    });
    return d;
  };
  return (
    <svg className={chica ? "escalones chica" : "escalones"} viewBox="0 -8 100 116" preserveAspectRatio="none" aria-hidden="true" focusable="false">
      {valores.length === 0 ? null : series.map((s) => <path key={s.clase} className={s.clase} d={trazo(s.escalones)} />)}
    </svg>
  );
}
