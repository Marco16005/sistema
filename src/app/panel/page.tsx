"use client";
// El panel: cómo va el negocio en los últimos días, o de tal día a tal día, para quien lo dirige.
// Solo lee. Lo que muestra llega sumado del servidor (src/servidor/dominio/panel.ts), con la misma
// regla del cierre, y aquí se le da formato y se dibuja: cada día del panel dice lo mismo que el
// cierre de ese día.
import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { pedir } from "../../componentes/cliente.ts";
import { diaCorto, fechaCorta, kilosCortos, pesos, pesosCerrados, precio } from "../../componentes/formato.ts";
import { Barras, Tira } from "../../componentes/panel/Graficas.tsx";
import { Imprimir } from "../../componentes/panel/Imprimir.tsx";
import { Secciones, SoloQuienDirige } from "../../componentes/panel/Secciones.tsx";
import type { Panel, Periodo, PersonaDelPanel, Tramo } from "../../componentes/panel/tipos.ts";
import { DIRIGEN, useSesion } from "../../componentes/Sesion.tsx";

/** Cada periodo de un toque: cómo se llama en su botón y cómo se nombra el anterior, con el que se compara. */
const PERIODOS: Array<{ dias: Periodo; nombre: string; anterior: string }> = [
  { dias: 7, nombre: "7 días", anterior: "los 7 días anteriores" },
  { dias: 30, nombre: "30 días", anterior: "los 30 días anteriores" },
  { dias: 91, nombre: "3 meses", anterior: "los 3 meses anteriores" },
];
/** Lo más largo que se puede pedir de tal día a tal día: un año y un día. */
const TOPE = 366;
const DIAS_DE_LA_SEMANA = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"];
const PASOS: Record<Panel["paso"], { cada: string; columna: string }> = {
  dia: { cada: "Por día", columna: "Día" }, semana: { cada: "Por semana", columna: "Semana" }, "cuatro-semanas": { cada: "Cada cuatro semanas", columna: "Cuatro semanas" },
};
/** Cuántos renglones de una lista se ven sin pedir más. */
const A_LA_VISTA = 6;
/** Cada cuánto se vuelve a preguntar mientras la pantalla está a la vista. */
const CADA = 60_000;

const cuantas = (n: number, una: string, varias: string): string => `${n.toLocaleString("es-MX")} ${n === 1 ? una : varias}`;
/** Kilos para leerse de un vistazo: de cien para arriba, sin gramos. Los exactos están en el cierre de cada día. */
const kg = (t: string): string => `${Number(t) >= 100 ? Math.round(Number(t)).toLocaleString("es-MX") : kilosCortos(t)} kg`;
/** Una diferencia en pesos cerrados, con el signo a la vista cuando es negativa: «−$57». */
const conSigno = (t: string): string => (Number(t) < 0 ? "−" : "") + pesosCerrados(String(Math.abs(Number(t))));
const delTramo = (t: Tramo, paso: Panel["paso"]): string => (paso === "dia" ? fechaCorta(t.desde) : `${diaCorto(t.desde)} – ${diaCorto(t.hasta)}`);
/** Un promedio se lee redondo: kilos con un decimal cuando mucho. */
const kgRedondos = (t: string): string => `${Number(t).toLocaleString("es-MX", { maximumFractionDigits: 1 })} kg`;
const primeroDelMes = (f: string): string => `${f.slice(0, 8)}01`;
const diasEntre = (desde: string, hasta: string): number => Math.round((Date.parse(`${hasta}T00:00:00Z`) - Date.parse(`${desde}T00:00:00Z`)) / 86_400_000) + 1;
/** Por qué ese periodo no se puede pedir; nada si sí se puede. */
function loQueFalta(desde: string, hasta: string): string {
  if (!desde || !hasta) return "Falta decir de qué día a qué día.";
  if (desde > hasta) return "El primer día no puede ser posterior al último.";
  if (diasEntre(desde, hasta) > TOPE) return "En el resumen cabe hasta un año. Elige un periodo más corto.";
  return "";
}
/** Lo que cobró una persona, en un renglón. */
const loQueCobro = (p: PersonaDelPanel): string => [
  p.compras > 0 ? `${cuantas(p.compras, "compra", "compras")} por ${pesosCerrados(p.pagado)}` : "",
  p.ventas > 0 ? `${cuantas(p.ventas, "venta", "ventas")} por ${pesosCerrados(p.cobrado)}` : "",
  `${kg(p.kg)} pesados`,
].filter(Boolean).join(" · ");
/** Lo que conviene vigilar de una persona; nada si no hay nada. */
function loQueVigilar(p: PersonaDelPanel): string {
  const t = [
    Number(p.descuentoKg) > 0 ? `descontó ${kg(p.descuentoKg)}` : "",
    Number(p.recipienteKg) > 0 ? `${kg(p.recipienteKg)} de recipientes` : "",
    p.descartadas > 0 ? `descartó ${cuantas(p.descartadas, "cuenta", "cuentas")}` : "",
    p.correcciones > 0 ? `corrigió ${cuantas(p.correcciones, "movimiento", "movimientos")}` : "",
    p.reimpresiones > 0 ? `reimprimió ${cuantas(p.reimpresiones, "comprobante", "comprobantes")}` : "",
  ].filter(Boolean).join(" · ");
  return t.slice(0, 1).toUpperCase() + t.slice(1);
}

function Cambio({ valor, anterior }: { valor: string | null; anterior: string }) {
  if (valor === null) return <small>Sin nada antes con qué comparar</small>;
  const n = Number(valor);
  if (n === 0) return <small>Igual que {anterior}</small>;
  return <small>{n > 0 ? "▲" : "▼"} {Math.abs(n).toLocaleString("es-MX", { maximumFractionDigits: 1 })} % {n > 0 ? "más" : "menos"} que {anterior}</small>;
}

/** Una lista que enseña lo primero y deja pedir lo demás. */
function Lista<T>({ filas, que, children }: { filas: T[]; que: string; children: (fila: T) => ReactNode }) {
  const [todo, setTodo] = useState(false);
  return (
    <>
      {(todo ? filas : filas.slice(0, A_LA_VISTA)).map(children)}
      {filas.length > A_LA_VISTA ? (
        <button className="btn ghostbtn chico" type="button" aria-expanded={todo} onClick={() => setTodo(!todo)}>
          {todo ? "Ver menos" : `Ver los ${filas.length} ${que}`}
        </button>
      ) : null}
    </>
  );
}

export default function PantallaDelPanel() {
  const { persona, dia } = useSesion();
  // El periodo: uno de los de un toque o, sin ninguno, de tal día a tal día.
  const [dias, setDias] = useState<Periodo | null>(7);
  const [desde, setDesde] = useState(primeroDelMes(dia.hoy));
  const [hasta, setHasta] = useState(dia.hoy);
  const [panel, setPanel] = useState<Panel | null>(null);
  /** De qué pedido es el panel que está a la vista. */
  const [visto, setVisto] = useState("");
  const [aviso, setAviso] = useState("");
  const [enKilos, setEnKilos] = useState(false);
  const dirige = DIRIGEN.includes(persona.rol);
  const falta = dias === null ? loQueFalta(desde, hasta) : "";
  /** Lo que se pide; nada mientras al periodo elegido le falte algo. */
  const pedido = dias !== null ? `dias=${dias}` : falta ? "" : `desde=${desde}&hasta=${hasta}`;

  /** Cuál fue la última petición: una respuesta que llega después de haber pedido otra cosa ya no se pinta. */
  const ultima = useRef(0);
  const cargar = useCallback(() => {
    if (!dirige || !pedido) return;
    const esta = ++ultima.current;
    pedir<{ panel: Panel }>("GET", `/api/panel?${pedido}`)
      .then((r) => { if (esta === ultima.current) { setPanel(r.panel); setVisto(pedido); setAviso(""); } })
      .catch((e: Error) => { if (esta === ultima.current) setAviso(e.message); });
  }, [dirige, pedido]);

  // Al llegar, al cambiar de periodo, al volver a la pestaña y cada minuto mientras está a la vista:
  // un panel que se deja abierto en la oficina no se queda en lo de la mañana.
  useEffect(() => {
    cargar();
    const alVolver = (): void => { if (document.visibilityState === "visible") cargar(); };
    const reloj = setInterval(alVolver, CADA);
    document.addEventListener("visibilitychange", alVolver);
    return () => { clearInterval(reloj); document.removeEventListener("visibilitychange", alVolver); };
  }, [cargar]);

  if (!dirige) return <SoloQuienDirige />;

  const elegir = (
    <>
      <div className="chips" role="group" aria-label="Periodo">
        {PERIODOS.map((p) => (
          <button key={p.dias} type="button" className="chip" aria-pressed={p.dias === dias} onClick={() => setDias(p.dias)}>{p.nombre}</button>
        ))}
        <button type="button" className="chip" aria-pressed={dias === null} onClick={() => setDias(null)}>Otro periodo</button>
      </div>
      {dias === null ? (
        <>
          <div className="filtros">
            <label>
              <span className="lbl">Desde</span>
              <input className="campo" type="date" value={desde} max={dia.hoy} onChange={(e) => setDesde(e.target.value)} />
            </label>
            <label>
              <span className="lbl">Hasta</span>
              <input className="campo" type="date" value={hasta} max={dia.hoy} onChange={(e) => setHasta(e.target.value)} />
            </label>
          </div>
          {falta ? <p className="note" role="status">{falta}</p> : null}
        </>
      ) : null}
    </>
  );
  // Mientras llega otro periodo se queda a la vista el anterior, con su propio rótulo: no se mezclan.
  if (!panel) {
    return (
      <div className="panel">
        <Secciones />
      <div className="top"><h2>Resumen</h2></div>
        {elegir}
        {aviso ? <div className="flag" role="alert">{aviso}</div> : <p className="cargando">Un momento…</p>}
      </div>
    );
  }

  const t = panel.totales;
  // Con qué se compara: el periodo de antes, del mismo largo.
  const anterior = PERIODOS.find((p) => `dias=${p.dias}` === visto)?.anterior ?? (panel.dias === 1 ? "el día anterior" : `los ${panel.dias} días anteriores`);
  const vacio = t.cuentas === 0;
  const fuerte = panel.semana.reduce<Panel["semana"][number] | null>((mas, d) => (Number(d.porDia) > Number(mas?.porDia ?? 0) ? d : mas), null);
  const mayorKg = Math.max(0, ...panel.materiales.flatMap((m) => [Number(m.kgComprado), Number(m.kgVendido)]));
  const mayorValor = Math.max(0, ...panel.inventario.materiales.map((m) => Number(m.valor ?? 0)));
  // De la primera hora con cuentas a la última, sin saltarse las de en medio.
  const horas = panel.horas.length === 0 ? [] : Array.from(
    { length: panel.horas.at(-1)!.hora - panel.horas[0]!.hora + 1 },
    (_, k) => { const hora = panel.horas[0]!.hora + k; return { hora, cuentas: panel.horas.find((h) => h.hora === hora)?.cuentas ?? 0 }; },
  );
  const c = panel.control;

  return (
    <div className="panel imprimible">
      <Secciones />
      <div className="top"><h2>Resumen</h2><Imprimir /></div>
      {elegir}
      {aviso ? <div className="flag" role="alert">{aviso}</div> : null}
      <p className="note periodo" role="status">
        Del {fechaCorta(panel.desde)} al {fechaCorta(panel.hasta)}{pedido && visto !== pedido ? " · cargando el otro periodo…" : ""}
      </p>

      <div className="indicadores">
        <div className="indicador">
          <p className="lbl">Compras</p>
          <b className="cifra">{pesosCerrados(t.pagado)}</b>
          <small>{cuantas(t.compras, "cuenta", "cuentas")} · {kg(t.kgComprado)}</small>
          {panel.promedio.pagado !== null ? <small>En promedio, {pesosCerrados(panel.promedio.pagado)} y {kgRedondos(panel.promedio.kgComprado!)} por cuenta</small> : null}
          <Cambio valor={panel.cambio.pagado} anterior={anterior} />
        </div>
        <div className="indicador">
          <p className="lbl">Ventas</p>
          <b className="cifra">{pesosCerrados(t.cobrado)}</b>
          <small>{cuantas(t.ventas, "cuenta", "cuentas")} · {kg(t.kgVendido)}</small>
          {panel.promedio.cobrado !== null ? <small>En promedio, {pesosCerrados(panel.promedio.cobrado)} y {kgRedondos(panel.promedio.kgVendido!)} por cuenta</small> : null}
          <Cambio valor={panel.cambio.cobrado} anterior={anterior} />
        </div>
        <div className="indicador">
          <p className="lbl">Ventas menos compras</p>
          <b className="cifra">{conSigno(t.diferencia)}</b>
          <small>No es la ganancia: falta lo que costó lo que se vendió.</small>
        </div>
        <div className="indicador">
          <p className="lbl">Cuentas terminadas</p>
          <b className="cifra">{t.cuentas.toLocaleString("es-MX")}</b>
          <Cambio valor={panel.cambio.cuentas} anterior={anterior} />
        </div>
      </div>

      <div className="card">
        <header><h2>Compras y ventas</h2><small>{PASOS[panel.paso].cada}</small></header>
        <div className="pad">
          <div className="chips" role="group" aria-label="Qué se mide">
            <button type="button" className="chip" aria-pressed={!enKilos} onClick={() => setEnKilos(false)}>En dinero</button>
            <button type="button" className="chip" aria-pressed={enKilos} onClick={() => setEnKilos(true)}>En kilos</button>
          </div>
          {vacio ? <p className="empty">No se terminó ninguna cuenta en este periodo.</p> : (
            <>
              <Barras
                clases={["compra", "venta"]}
                tope={(mayor) => (enKilos ? kg(String(mayor)) : pesosCerrados(String(mayor)))}
                columnas={panel.serie.map((s) => ({
                  clave: s.desde, rotulo: diaCorto(s.desde),
                  valores: enKilos ? [Number(s.kgComprado), Number(s.kgVendido)] : [Number(s.pagado), Number(s.cobrado)],
                }))}
              />
              <p className="leyenda"><span><i className="barrita compra" />Compras</span><span><i className="barrita venta" />Ventas</span></p>
              <details className="numeros">
                <summary>Ver los números</summary>
                <div className="scroll">
                  <table>
                    <thead><tr><th>{PASOS[panel.paso].columna}</th><th>Compras</th><th>Ventas</th><th>Entró</th><th>Salió</th><th>Cuentas</th></tr></thead>
                    <tbody>
                      {panel.serie.map((s) => (
                        <tr key={s.desde}>
                          <td>{delTramo(s, panel.paso)}</td>
                          <td className="mn">{pesosCerrados(s.pagado)}</td><td className="mn">{pesosCerrados(s.cobrado)}</td>
                          <td className="mn">{kg(s.kgComprado)}</td><td className="mn">{kg(s.kgVendido)}</td>
                          <td className="mn">{s.cuentas}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            </>
          )}
          <p className="note">Es lo que suman los comprobantes de cada día, igual que en su cierre. El dinero del cajón se lleva aparte.</p>
        </div>
      </div>

      <div className="a-dos">
        <div className="card">
          <header><h2>Lo que más se movió</h2><small>{cuantas(panel.materiales.length, "material", "materiales")}</small></header>
          <div className="pad">
            {panel.materiales.length === 0 ? <p className="empty">Nada se movió en este periodo.</p> : (
              <Lista filas={panel.materiales} que="materiales">
                {(m) => (
                  <div className="mov" key={m.nombre}>
                    <b>{m.nombre}</b>
                    <Tira parte={Number(m.kgComprado)} de={mayorKg} clase="compra" />
                    <small>Entró {kg(m.kgComprado)} · {pesos(m.importeComprado)}</small>
                    <Tira parte={Number(m.kgVendido)} de={mayorKg} clase="venta" />
                    <small>Salió {kg(m.kgVendido)} · {pesos(m.importeVendido)}</small>
                  </div>
                )}
              </Lista>
            )}
          </div>
        </div>

        <div className="card">
          <header><h2>Lo que hay en el patio</h2><small>Ahora</small></header>
          <div className="pad">
            {panel.inventario.materiales.length === 0 ? <p className="empty">No hay existencia registrada.</p> : (
              <>
                <div className="tot big primero"><span>Vale, a precio de compra</span><span className="n">{pesos(panel.inventario.valor)}</span></div>
                <Lista filas={panel.inventario.materiales} que="materiales">
                  {(m) => (
                    <div className="mov" key={m.nombre}>
                      <div className="tot"><b>{m.nombre}</b><span className="n">{m.valor === null ? "Sin precio" : pesos(m.valor)}</span></div>
                      <Tira parte={Number(m.valor ?? 0)} de={mayorValor} clase="neutra" />
                      <small>{kg(m.kg)}{m.precio === null ? "" : ` × ${precio(m.precio)}`}</small>
                    </div>
                  )}
                </Lista>
                <p className="note">
                  {panel.inventario.listaDel
                    ? `Es lo que costaría volver a comprarlo con la lista del ${fechaCorta(panel.inventario.listaDel)}, no lo que costó.`
                    : "Todavía no hay una lista de precios publicada: no se puede decir cuánto vale."}
                  {panel.inventario.sinPrecio > 0 ? ` ${cuantas(panel.inventario.sinPrecio, "material no tiene", "materiales no tienen")} precio en esa lista y no se cuentan.` : ""}
                </p>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="a-dos">
        <div className="card">
          <header><h2>A qué hora se atiende</h2><small>Cuentas terminadas por hora</small></header>
          <div className="pad">
            {horas.length === 0 ? <p className="empty">No se terminó ninguna cuenta en este periodo.</p> : (
              <>
                <Barras
                  clases={["neutra"]} tope={(mayor) => cuantas(mayor, "cuenta", "cuentas")}
                  columnas={horas.map((h) => ({ clave: String(h.hora), rotulo: `${h.hora} h`, valores: [h.cuentas] }))}
                />
                <ul className="oculto">
                  {horas.map((h) => <li key={h.hora}>A las {h.hora} horas, {cuantas(h.cuentas, "cuenta", "cuentas")}</li>)}
                </ul>
              </>
            )}
          </div>
        </div>

        <div className="card">
          <header><h2>Qué día de la semana</h2><small>Cuentas por día, en promedio</small></header>
          <div className="pad">
            {fuerte === null ? <p className="empty">No se terminó ninguna cuenta en este periodo.</p> : (
              <>
                <Barras
                  clases={["neutra"]} tope={(mayor) => `${mayor.toLocaleString("es-MX")} por día`}
                  columnas={panel.semana.map((d) => ({ clave: String(d.dia), rotulo: DIAS_DE_LA_SEMANA[d.dia - 1]!.slice(0, 3), valores: [Number(d.porDia)] }))}
                />
                <ul className="oculto">
                  {panel.semana.map((d) => <li key={d.dia}>Los {DIAS_DE_LA_SEMANA[d.dia - 1]}, {Number(d.porDia).toLocaleString("es-MX")} por día: {cuantas(d.cuentas, "cuenta", "cuentas")} en {cuantas(d.dias, "día", "días")}</li>)}
                </ul>
                <p className="note">El más fuerte es el {DIAS_DE_LA_SEMANA[fuerte.dia - 1]}: {Number(fuerte.porDia).toLocaleString("es-MX")} {Number(fuerte.porDia) === 1 ? "cuenta" : "cuentas"} por día. Cada día de la semana se promedia entre las veces que cae en el periodo.</p>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="card">
        <header><h2>Quién atendió</h2><small>Lo que cobró cada quien, y lo que conviene vigilar</small></header>
        <div className="pad">
          {panel.personas.length === 0 ? <p className="empty">Nadie terminó cuentas en este periodo.</p> : null}
          {panel.personas.map((p) => (
            <div className="mov" key={p.nombre}>
              <div className="tot"><b>{p.nombre}</b><span className="n">{cuantas(p.cuentas, "cuenta", "cuentas")}</span></div>
              {p.cuentas > 0 ? <small>{loQueCobro(p)}</small> : null}
              {loQueVigilar(p) ? <small>{loQueVigilar(p)}</small> : null}
            </div>
          ))}
          {panel.personas.length > 0 ? <p className="note">Los kilos descontados y los de recipientes son de las cuentas que cobró. Lo descartado, lo corregido y lo reimpreso salen de la bitácora, en el día en que pasó cada cosa.</p> : null}
        </div>
      </div>

      <div className="card">
        <header><h2>Para vigilar</h2><small>Lo que se salió de lo normal</small></header>
        <div className="pad">
          <div className="tot"><span>Material dado de baja</span><span className="n">{c.mermas === 0 ? "Nada" : `${cuantas(c.mermas, "vez", "veces")} · ${kg(c.mermaKg)}`}</span></div>
          <div className="tot">
            <span>Ajustes de inventario</span>
            <span className="n">{c.ajustes === 0 ? "Ninguno" : `${c.ajustes} · entraron ${kg(c.ajusteEntroKg)}, salieron ${kg(c.ajusteSalioKg)}`}</span>
          </div>
          <div className="tot"><span>Precios especiales</span><span className="n">{c.preciosEspeciales === 0 ? "Ninguno" : cuantas(c.preciosEspeciales, "material", "materiales")}</span></div>
          {c.preciosEspeciales > 0 && Number(c.diferenciaEnCompras) !== 0 ? (
            <div className="tot adj"><span>En compras se pagó de {Number(c.diferenciaEnCompras) > 0 ? "más" : "menos"}</span><span className="n">{pesos(String(Math.abs(Number(c.diferenciaEnCompras)).toFixed(2)))}</span></div>
          ) : null}
          {c.preciosEspeciales > 0 && Number(c.diferenciaEnVentas) !== 0 ? (
            <div className="tot adj"><span>En ventas se cobró de {Number(c.diferenciaEnVentas) > 0 ? "más" : "menos"}</span><span className="n">{pesos(String(Math.abs(Number(c.diferenciaEnVentas)).toFixed(2)))}</span></div>
          ) : null}
          <div className="tot"><span>Kilos descontados en el mostrador</span><span className="n">{c.descuentos === 0 ? "Ninguno" : `en ${cuantas(c.descuentos, "renglón", "renglones")}`}</span></div>
          {Number(c.descuentoEnComprasKg) > 0 ? <div className="tot adj"><span>En compras, se pesaron y no se pagaron</span><span className="n">{kg(c.descuentoEnComprasKg)}</span></div> : null}
          {Number(c.descuentoEnVentasKg) > 0 ? <div className="tot adj"><span>En ventas, se pesaron y no se cobraron</span><span className="n">{kg(c.descuentoEnVentasKg)}</span></div> : null}
          {c.descontados.slice(0, 3).map((d) => (
            <div className="tot adj" key={d.nombre}><span>De {d.nombre}</span><span className="n">{kg(d.kg)}</span></div>
          ))}
          <div className="tot"><span>Recipientes descontados al pesar</span><span className="n">{c.recipientes === 0 ? "Ninguno" : `en ${cuantas(c.recipientes, "renglón", "renglones")}`}</span></div>
          {Number(c.recipienteEnComprasKg) > 0 ? <div className="tot adj"><span>En compras, pesaban</span><span className="n">{kg(c.recipienteEnComprasKg)}</span></div> : null}
          {Number(c.recipienteEnVentasKg) > 0 ? <div className="tot adj"><span>En ventas, pesaban</span><span className="n">{kg(c.recipienteEnVentasKg)}</span></div> : null}
          <div className="tot"><span>Veces que se reabrió un día</span><span className="n">{c.reaperturas === 0 ? "Ninguna" : c.reaperturas}</span></div>
          <p className="note">Los ajustes son lo que cambió un conteo o una corrección. Si alguno de estos crece de un periodo a otro, conviene preguntar por qué.</p>
        </div>
      </div>
    </div>
  );
}
