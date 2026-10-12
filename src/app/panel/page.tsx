"use client";
// El panel: cómo va el negocio en los últimos días, para quien lo dirige. Solo lee. Lo que muestra
// llega sumado del servidor (src/servidor/dominio/panel.ts), con la misma regla del cierre, y aquí
// se le da formato y se dibuja: cada día del panel dice lo mismo que el cierre de ese día.
import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { pedir } from "../../componentes/cliente.ts";
import { diaCorto, fechaCorta, kilosCortos, pesos, pesosCerrados, precio } from "../../componentes/formato.ts";
import { Barras, Tira } from "../../componentes/panel/Graficas.tsx";
import { Secciones, SoloQuienDirige } from "../../componentes/panel/Secciones.tsx";
import type { Panel, Periodo, Tramo } from "../../componentes/panel/tipos.ts";
import { DIRIGEN, useSesion } from "../../componentes/Sesion.tsx";

/** Cada periodo: cómo se llama en su botón y cómo se nombra el anterior, con el que se compara. */
const PERIODOS: Array<{ dias: Periodo; nombre: string; anterior: string }> = [
  { dias: 7, nombre: "7 días", anterior: "los 7 días anteriores" },
  { dias: 30, nombre: "30 días", anterior: "los 30 días anteriores" },
  { dias: 91, nombre: "3 meses", anterior: "los 3 meses anteriores" },
];
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
  const { persona } = useSesion();
  const [dias, setDias] = useState<Periodo>(7);
  const [panel, setPanel] = useState<Panel | null>(null);
  const [aviso, setAviso] = useState("");
  const [enKilos, setEnKilos] = useState(false);
  const dirige = DIRIGEN.includes(persona.rol);

  /** Cuál fue la última petición: una respuesta que llega después de haber pedido otra cosa ya no se pinta. */
  const ultima = useRef(0);
  const cargar = useCallback(() => {
    if (!dirige) return;
    const esta = ++ultima.current;
    pedir<{ panel: Panel }>("GET", `/api/panel?dias=${dias}`)
      .then((r) => { if (esta === ultima.current) { setPanel(r.panel); setAviso(""); } })
      .catch((e: Error) => { if (esta === ultima.current) setAviso(e.message); });
  }, [dias, dirige]);

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

  const periodo = PERIODOS.find((p) => p.dias === dias)!;
  const elegir = (
    <div className="chips" role="group" aria-label="Periodo">
      {PERIODOS.map((p) => (
        <button key={p.dias} type="button" className="chip" aria-pressed={p.dias === dias} onClick={() => setDias(p.dias)}>{p.nombre}</button>
      ))}
    </div>
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
  const visto = PERIODOS.find((p) => p.dias === panel.dias)!;
  const vacio = t.cuentas === 0;
  const mayorKg = Math.max(0, ...panel.materiales.flatMap((m) => [Number(m.kgComprado), Number(m.kgVendido)]));
  const mayorValor = Math.max(0, ...panel.inventario.materiales.map((m) => Number(m.valor ?? 0)));
  // De la primera hora con cuentas a la última, sin saltarse las de en medio.
  const horas = panel.horas.length === 0 ? [] : Array.from(
    { length: panel.horas.at(-1)!.hora - panel.horas[0]!.hora + 1 },
    (_, k) => { const hora = panel.horas[0]!.hora + k; return { hora, cuentas: panel.horas.find((h) => h.hora === hora)?.cuentas ?? 0 }; },
  );
  const c = panel.control;

  return (
    <div className="panel">
      <Secciones />
      <div className="top"><h2>Resumen</h2></div>
      {elegir}
      {aviso ? <div className="flag" role="alert">{aviso}</div> : null}
      <p className="note periodo" role="status">
        Del {fechaCorta(panel.desde)} al {fechaCorta(panel.hasta)}{panel.dias !== periodo.dias ? " · cargando el otro periodo…" : ""}
      </p>

      <div className="indicadores">
        <div className="indicador">
          <p className="lbl">Compras</p>
          <b className="cifra">{pesosCerrados(t.pagado)}</b>
          <small>{cuantas(t.compras, "cuenta", "cuentas")} · {kg(t.kgComprado)}</small>
          <Cambio valor={panel.cambio.pagado} anterior={visto.anterior} />
        </div>
        <div className="indicador">
          <p className="lbl">Ventas</p>
          <b className="cifra">{pesosCerrados(t.cobrado)}</b>
          <small>{cuantas(t.ventas, "cuenta", "cuentas")} · {kg(t.kgVendido)}</small>
          <Cambio valor={panel.cambio.cobrado} anterior={visto.anterior} />
        </div>
        <div className="indicador">
          <p className="lbl">Ventas menos compras</p>
          <b className="cifra">{conSigno(t.diferencia)}</b>
          <small>No es la ganancia: falta lo que costó lo que se vendió.</small>
        </div>
        <div className="indicador">
          <p className="lbl">Cuentas terminadas</p>
          <b className="cifra">{t.cuentas.toLocaleString("es-MX")}</b>
          <Cambio valor={panel.cambio.cuentas} anterior={visto.anterior} />
        </div>
      </div>

      <div className="card">
        <header><h2>Compras y ventas</h2><small>{panel.paso === "dia" ? "Por día" : "Por semana"}</small></header>
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
                    <thead><tr><th>{panel.paso === "dia" ? "Día" : "Semana"}</th><th>Compras</th><th>Ventas</th><th>Entró</th><th>Salió</th><th>Cuentas</th></tr></thead>
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
          <header><h2>Quién atendió</h2><small>Cuentas que terminó cada quien</small></header>
          <div className="pad">
            {panel.personas.length === 0 ? <p className="empty">Nadie terminó cuentas en este periodo.</p> : null}
            {panel.personas.map((p) => (
              <div className="tot" key={p.nombre}><span>{p.nombre}</span><span className="n">{cuantas(p.cuentas, "cuenta", "cuentas")}</span></div>
            ))}
          </div>
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
          <div className="tot"><span>Veces que se reabrió un día</span><span className="n">{c.reaperturas === 0 ? "Ninguna" : c.reaperturas}</span></div>
          <p className="note">Los ajustes son lo que cambió un conteo o una corrección. Si alguno de estos crece de un periodo a otro, conviene preguntar por qué.</p>
        </div>
      </div>
    </div>
  );
}
