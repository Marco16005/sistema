"use client";
// Los materiales, para quien dirige: qué se está quedando en el patio —cuánto hay de cada uno,
// cuánto lleva sin salir y para cuántos días alcanza— y, al tocar uno, su ficha: lo que entró y
// salió, a cuánto el kilo, su precio junto a sus kilos, cuánto ha habido y lo que se le perdió.
// Todo llega hecho del servidor (src/servidor/dominio/materiales-del-panel.ts); aquí se dibuja.
import { useCallback, useEffect, useRef, useState } from "react";
import { pedir } from "../../../componentes/cliente.ts";
import { diaCorto, fechaCorta, kilosCortos, pesos, precio } from "../../../componentes/formato.ts";
import { Barras, Escalones, escalonesDePrecio } from "../../../componentes/panel/Graficas.tsx";
import { Imprimir } from "../../../componentes/panel/Imprimir.tsx";
import { Secciones, SoloQuienDirige } from "../../../componentes/panel/Secciones.tsx";
import type { FichaDeMaterial, MaterialDelPatio, Patio, PeriodoDeMaterial, TramoDeMaterial } from "../../../componentes/panel/tipos.ts";
import { DIRIGEN, useSesion } from "../../../componentes/Sesion.tsx";

const PERIODOS: Array<{ dias: PeriodoDeMaterial; nombre: string }> = [{ dias: 30, nombre: "30 días" }, { dias: 91, nombre: "3 meses" }];
type Cual = "compra" | "venta";

const cuantas = (n: number, una: string, varias: string): string => `${n.toLocaleString("es-MX")} ${n === 1 ? una : varias}`;
/** Kilos para leerse de un vistazo: de cien para arriba, sin gramos. */
const kg = (t: string): string => `${Math.abs(Number(t)) >= 100 ? Math.round(Number(t)).toLocaleString("es-MX") : kilosCortos(t)} kg`;
/** Cuánto lleva sin salir, dicho en llano. Lo que nunca ha salido cuenta desde el día en que llegó. */
function salio(m: MaterialDelPatio): string {
  const d = m.diasSinSalir;
  if (d === null) return "No ha tenido movimiento";
  if (m.ultimaSalida === null) return d === 0 ? "Llegó hoy y no ha salido" : d === 1 ? "Llegó ayer y no ha salido" : `No ha salido desde que llegó, hace ${d.toLocaleString("es-MX")} días`;
  return d === 0 ? "Salió hoy" : d === 1 ? "Salió ayer" : `Lleva ${d.toLocaleString("es-MX")} días sin salir`;
}
/** Lo más que el servidor dice que alcanza: de ahí en adelante es «diez años o más». */
const DIEZ_ANOS = 3650;
/** Para cuánto alcanza lo que hay; nada que decir si no hay existencia. */
const alcanza = (m: MaterialDelPatio): string =>
  m.alcanzaPara === null ? (Number(m.kg) > 0 ? "Sin salidas en cuatro semanas" : "")
    : m.alcanzaPara >= DIEZ_ANOS ? "Alcanza para más de diez años" : `Alcanza para ${cuantas(m.alcanzaPara, "día", "días")}`;
const delTramo = (t: TramoDeMaterial, paso: FichaDeMaterial["paso"]): string => (paso === "dia" ? fechaCorta(t.desde) : `${diaCorto(t.desde)} – ${diaCorto(t.hasta)}`);

function Renglon({ m, alTocar }: { m: MaterialDelPatio; alTocar: () => void }) {
  const para = alcanza(m);
  return (
    <button className="exrow" type="button" onClick={alTocar}>
      <span className="rn">
        <b>{m.nombre}</b>
        <small>{Number(m.kg) > 0 || m.ultimaSalida === null ? salio(m) : `Salió por última vez el ${fechaCorta(m.ultimaSalida)}`}{m.activo ? "" : " · dado de baja"}</small>
        {para ? <small>{para}</small> : null}
      </span>
      <span className="ri">{kg(m.kg)}</span>
    </button>
  );
}

function Grupo({ titulo, dice, materiales, alTocar }: { titulo: string; dice: string; materiales: MaterialDelPatio[]; alTocar: (m: MaterialDelPatio) => void }) {
  if (materiales.length === 0) return null;
  return (
    <div className="card">
      <header><h2>{titulo}</h2><small>{dice}</small></header>
      <div className="pad">
        {materiales.map((m) => <Renglon key={m.id} m={m} alTocar={() => alTocar(m)} />)}
      </div>
    </div>
  );
}

function LaFicha({ f }: { f: FichaDeMaterial }) {
  const [cual, setCual] = useState<Cual>("compra");
  const [t, m, c] = [f.totales, f.material, f.control];
  const paso = f.paso === "dia" ? 1 : 7;
  const cada = f.paso === "dia" ? "día" : "semana";
  const sinMovimiento = t.compras === 0 && t.ventas === 0;
  const delPrecio = f.precios ? escalonesDePrecio(f.precios, f.desde, cual) : [];
  const precios = delPrecio.flatMap((e) => (e.valor === null ? [] : [e.valor]));
  const habia = f.serie.map((s) => Number(s.kgAlFinal));
  const diferencia = t.diferenciaPorKilo === null ? null : Number(t.diferenciaPorKilo);
  const para = alcanza(m);

  const porKilo = (titulo: string, valor: string | null, cuentas: number, kilos: string, importe: string, sinNada: string) => (
    <div className="indicador">
      <p className="lbl">{titulo}</p>
      <b className="cifra">{valor === null ? "Nada" : pesos(valor)}</b>
      <small>{cuentas === 0 ? sinNada : `${kg(kilos)} en ${cuantas(cuentas, "cuenta", "cuentas")} · ${pesos(importe)}`}</small>
    </div>
  );

  return (
    <>
      <div className="indicadores">
        {porKilo("Se pagó, por kilo", t.porKiloComprado, t.compras, t.kgComprado, t.importeComprado, "No se compró en este periodo")}
        {porKilo("Se cobró, por kilo", t.porKiloVendido, t.ventas, t.kgVendido, t.importeVendido, "No se vendió en este periodo")}
        <div className="indicador">
          <p className="lbl">Diferencia por kilo</p>
          <b className="cifra">{diferencia === null ? "—" : (diferencia < 0 ? "−" : "") + pesos(String(Math.abs(diferencia)))}</b>
          <small>{diferencia === null ? "Hace falta haberlo comprado y vendido en el periodo." : "No es la ganancia: lo que se vendió pudo comprarse antes, a otro precio."}</small>
        </div>
        <div className="indicador">
          <p className="lbl">En el patio</p>
          <b className="cifra">{kg(m.kg)}</b>
          <small>{salio(m)}{para ? ` · ${para.toLowerCase()}` : ""}</small>
          {m.valor !== null && Number(m.kg) > 0 ? <small>Vale {pesos(m.valor)} a precio de compra</small> : null}
        </div>
      </div>

      <div className="card">
        <header><h2>Lo que entró y lo que salió</h2><small>Kilos por {cada}</small></header>
        <div className="pad">
          {sinMovimiento ? <p className="empty">No se compró ni se vendió en este periodo.</p> : (
            <>
              <Barras
                clases={["compra", "venta"]} tope={(mayor) => kg(String(mayor))}
                columnas={f.serie.map((s) => ({ clave: s.desde, rotulo: diaCorto(s.desde), valores: [Number(s.kgComprado), Number(s.kgVendido)] }))}
              />
              <p className="leyenda"><span><i className="barrita compra" />Entró</span><span><i className="barrita venta" />Salió</span></p>
            </>
          )}
          <details className="numeros">
            <summary>Ver los números</summary>
            <div className="scroll">
              <table>
                <thead><tr><th>{f.paso === "dia" ? "Día" : "Semana"}</th><th>Entró</th><th>Se pagó</th><th>Salió</th><th>Se cobró</th><th>Había al final</th></tr></thead>
                <tbody>
                  {f.serie.map((s) => (
                    <tr key={s.desde}>
                      <td>{delTramo(s, f.paso)}</td>
                      <td className="mn">{kg(s.kgComprado)}</td><td className="mn">{pesos(s.importeComprado)}</td>
                      <td className="mn">{kg(s.kgVendido)}</td><td className="mn">{pesos(s.importeVendido)}</td>
                      <td className="mn">{kg(s.kgAlFinal)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
          <p className="note">Es lo que dicen los comprobantes de cada día, igual que en su cierre. Entró y salió son los kilos pesados; lo que se pagó y se cobró ya lleva sus descuentos.</p>
        </div>
      </div>

      <div className="a-dos">
        <div className="card">
          <header><h2>El precio y los kilos</h2><small>{cual === "compra" ? "¿Entra más cuando se paga más?" : "¿Sale más cuando se cobra menos?"}</small></header>
          <div className="pad">
            <div className="chips" role="group" aria-label="Qué precio">
              <button type="button" className="chip" aria-pressed={cual === "compra"} onClick={() => setCual("compra")}>Compra</button>
              <button type="button" className="chip" aria-pressed={cual === "venta"} onClick={() => setCual("venta")}>Venta</button>
            </div>
            {precios.length === 0 ? <p className="empty">Este material no tuvo precio en el periodo.</p> : (
              <div className="precio-y-kilos">
                <div className="grafica" aria-hidden="true">
                  <small className="tope">{precio(String(Math.max(...precios)))} por kilo</small>
                  <Escalones dias={f.dias} series={[{ clase: cual, escalones: delPrecio }]} />
                  <small className="tope">{precio(String(Math.min(...precios)))}</small>
                </div>
                <Barras
                  clases={[cual]} tope={(mayor) => kg(String(mayor))}
                  columnas={f.serie.map((s) => ({ clave: s.desde, rotulo: diaCorto(s.desde), valores: [Number(cual === "compra" ? s.kgComprado : s.kgVendido)] }))}
                />
                <ul className="oculto">
                  {f.precios!.alEmpezar ? <li>Al empezar el periodo, a {precio(f.precios!.alEmpezar[cual])} por kilo</li> : null}
                  {f.precios!.cambios.map((p) => <li key={p.fecha}>Desde el {fechaCorta(p.fecha)}, {p[cual] === null ? "sin precio" : `a ${precio(p[cual]!)} por kilo`}</li>)}
                </ul>
              </div>
            )}
            <p className="note">
              Arriba, el precio de {cual} de la lista; abajo, los kilos que {cual === "compra" ? "entraron" : "salieron"} cada {cada}.
              La escala del precio va del más bajo al más alto del periodo, no desde cero: así se ven los centavos.
            </p>
          </div>
        </div>

        <div className="card">
          <header><h2>Lo que ha habido en el patio</h2><small>Al terminar cada {cada}</small></header>
          <div className="pad">
            <div className="grafica" aria-hidden="true">
              <small className="tope">{kg(String(Math.max(...habia)))}</small>
              <Escalones dias={f.dias} series={[{ clase: "neutra", escalones: f.serie.map((s, k) => ({ dia: k * paso, valor: Number(s.kgAlFinal) })) }]} />
              <small className="tope">{kg(String(Math.min(...habia)))}</small>
              <div className="eje"><small>{diaCorto(f.desde)}</small><small>{diaCorto(f.hasta)}</small></div>
            </div>
            <p className="note">
              Empezó el periodo con {kg(f.kgAlEmpezar)} y hoy hay {kg(m.kg)}. Es lo que dice el libro: sube con lo comprado y baja con lo
              vendido, lo dado de baja y lo separado, y lo mueve lo que ajusta un conteo. La escala va de lo menos a lo más que hubo, no desde cero.
            </p>
          </div>
        </div>
      </div>

      <div className="card">
        <header><h2>Para vigilar</h2><small>Lo que se le perdió o se le movió en el periodo</small></header>
        <div className="pad">
          <div className="tot"><span>Material dado de baja</span><span className="n">{c.mermas === 0 ? "Nada" : `${cuantas(c.mermas, "vez", "veces")} · ${kg(c.mermaKg)}`}</span></div>
          <div className="tot">
            <span>Ajustes de inventario</span>
            <span className="n">{c.ajustes === 0 ? "Ninguno" : `${c.ajustes} · entraron ${kg(c.ajusteEntroKg)}, salieron ${kg(c.ajusteSalioKg)}`}</span>
          </div>
          <div className="tot"><span>Se pesó y no se pagó, en compras</span><span className="n">{Number(t.kgDescontadoEnCompras) === 0 ? "Nada" : kg(t.kgDescontadoEnCompras)}</span></div>
          {Number(t.kgDescontadoEnVentas) > 0 ? <div className="tot"><span>Se pesó y no se cobró, en ventas</span><span className="n">{kg(t.kgDescontadoEnVentas)}</span></div> : null}
          {Number(c.separadoKg) > 0 ? <div className="tot"><span>Se separó en otros materiales</span><span className="n">{kg(c.separadoKg)}</span></div> : null}
          {Number(c.deSeparacionKg) > 0 ? <div className="tot"><span>Llegó de separar otro material</span><span className="n">{kg(c.deSeparacionKg)}</span></div> : null}
          <p className="note">Lo que se pesó y no se pagó son los descuentos en kilos que se dan en el mostrador. Los ajustes son lo que cambió un conteo o una corrección.</p>
        </div>
      </div>
    </>
  );
}

export default function PantallaDeLosMateriales() {
  const { persona } = useSesion();
  const dirige = DIRIGEN.includes(persona.rol);
  const [patio, setPatio] = useState<Patio | null>(null);
  const [viendo, setViendo] = useState<MaterialDelPatio | null>(null);
  const [dias, setDias] = useState<PeriodoDeMaterial>(30);
  const [ficha, setFicha] = useState<FichaDeMaterial | null>(null);
  const [aviso, setAviso] = useState("");
  const material = viendo?.id ?? null;

  /** Cuál fue la última petición: una respuesta que llega después de haber pedido otra cosa ya no se pinta. */
  const ultima = useRef(0);
  const cargar = useCallback(() => {
    if (!dirige) return;
    const esta = ++ultima.current;
    const llega = material === null
      ? pedir<{ patio: Patio }>("GET", "/api/panel/materiales").then((r) => { if (esta === ultima.current) { setPatio(r.patio); setAviso(""); } })
      : pedir<{ ficha: FichaDeMaterial }>("GET", `/api/panel/materiales/${material}?dias=${dias}`).then((r) => { if (esta === ultima.current) { setFicha(r.ficha); setAviso(""); } });
    llega.catch((e: Error) => { if (esta === ultima.current) setAviso(e.message); });
  }, [dias, dirige, material]);

  // Al llegar, al abrir un material, al cambiar de periodo y al volver a la pestaña.
  useEffect(() => {
    cargar();
    const alVolver = (): void => { if (document.visibilityState === "visible") cargar(); };
    document.addEventListener("visibilitychange", alVolver);
    return () => document.removeEventListener("visibilitychange", alVolver);
  }, [cargar]);

  if (!dirige) return <SoloQuienDirige />;

  const abrir = (m: MaterialDelPatio): void => { setViendo(m); setFicha(null); setAviso(""); window.scrollTo(0, 0); };
  const volver = (): void => { setViendo(null); setFicha(null); setAviso(""); };

  if (viendo) {
    // La ficha de otro material, si todavía está a la vista, no se enseña con el nombre de este.
    const suya = ficha?.material.id === viendo.id ? ficha : null;
    return (
      <div className="panel imprimible">
        <Secciones />
        <div className="top">
          <button className="quitar" type="button" onClick={volver}>‹ Materiales</button>
          <h2>{viendo.nombre}</h2>
          {suya ? <Imprimir /> : null}
        </div>
        <div className="chips" role="group" aria-label="Periodo">
          {PERIODOS.map((p) => (
            <button key={p.dias} type="button" className="chip" aria-pressed={p.dias === dias} onClick={() => setDias(p.dias)}>{p.nombre}</button>
          ))}
        </div>
        {aviso ? <div className="flag" role="alert">{aviso}</div> : null}
        {suya ? (
          <>
            <p className="note periodo" role="status">
              Del {fechaCorta(suya.desde)} al {fechaCorta(suya.hasta)} · {suya.material.familia}{suya.material.activo ? "" : " · dado de baja"}
              {suya.dias !== dias ? " · cargando el otro periodo…" : ""}
            </p>
            <LaFicha f={suya} />
          </>
        ) : (aviso ? null : <p className="cargando">Un momento…</p>)}
      </div>
    );
  }

  if (!patio) {
    return (
      <div className="panel">
        <Secciones />
        <div className="top"><h2>Materiales</h2></div>
        {aviso ? <div className="flag" role="alert">{aviso}</div> : <p className="cargando">Un momento…</p>}
      </div>
    );
  }

  const hay = patio.materiales.filter((m) => Number(m.kg) > 0);
  const quedados = hay.filter((m) => (m.diasSinSalir ?? 0) >= patio.seQuedan.dias);
  const seMueven = hay.filter((m) => !quedados.includes(m));
  const sinNada = patio.materiales.filter((m) => Number(m.kg) <= 0);
  // Llegan ordenados: el primero es el que más lleva.
  const elQueMas = hay[0];

  return (
    <div className="panel imprimible">
      <Secciones />
      <div className="top"><h2>Materiales</h2><Imprimir /></div>
      {aviso ? <div className="flag" role="alert">{aviso}</div> : null}
      {patio.materiales.length === 0 ? (
        <div className="card"><p className="empty">Todavía no se ha movido ningún material.</p></div>
      ) : (
        <>
          <p className="note periodo" role="status">
            Al {fechaCorta(patio.hoy)}{patio.listaDel ? ` · valuado con la lista del ${fechaCorta(patio.listaDel)}` : " · todavía no hay una lista de precios publicada"}
          </p>
          <div className="indicadores">
            <div className="indicador">
              <p className="lbl">Lo que hay vale</p>
              <b className="cifra">{pesos(patio.valor)}</b>
              <small>A precio de compra: lo que costaría volver a comprarlo, no lo que costó</small>
            </div>
            <div className="indicador">
              <p className="lbl">Con existencia</p>
              <b className="cifra">{hay.length.toLocaleString("es-MX")}</b>
              <small>{hay.length === 1 ? "material" : "materiales"}</small>
            </div>
            <div className="indicador">
              <p className="lbl">Se están quedando</p>
              <b className="cifra">{patio.seQuedan.materiales.toLocaleString("es-MX")}</b>
              <small>
                {patio.seQuedan.materiales === 0
                  ? `Nada lleva ${patio.seQuedan.dias} días sin salir`
                  : `Con ${patio.seQuedan.dias} días o más sin salir · valen ${pesos(patio.seQuedan.valor)}`}
              </small>
            </div>
            <div className="indicador">
              <p className="lbl">El que más lleva sin salir</p>
              <b className="cifra">{elQueMas ? cuantas(elQueMas.diasSinSalir!, "día", "días") : "—"}</b>
              <small>{elQueMas ? `${elQueMas.nombre}${elQueMas.ultimaSalida === null ? " · no ha salido desde que llegó" : ""}` : "No hay existencia"}</small>
            </div>
          </div>
          <Grupo titulo="Se están quedando" dice={`${patio.seQuedan.dias} días o más sin salir`} materiales={quedados} alTocar={abrir} />
          <Grupo titulo="Se mueven" dice="Primero lo que más lleva sin salir" materiales={seMueven} alTocar={abrir} />
          <Grupo titulo="Sin existencia" dice={cuantas(sinNada.length, "material", "materiales")} materiales={sinNada} alTocar={abrir} />
          <p className="note">
            Salir es venderse o separarse en otros materiales; lo dado de baja no cuenta. «Alcanza para» es lo que hay, al ritmo de lo que
            salió en las últimas cuatro semanas. Toca un material para ver su ficha.
          </p>
        </>
      )}
    </div>
  );
}
