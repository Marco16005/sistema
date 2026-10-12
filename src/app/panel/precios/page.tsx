"use client";
// La historia de precios: cómo se ha movido lo que se paga y lo que se cobra por kilo de cada
// material. Sale de las listas publicadas (src/servidor/dominio/historia-de-precios.ts): una por
// día, y un día sin lista sigue valiendo lo último publicado. Aquí solo se dibuja y se da formato.
import { useCallback, useEffect, useRef, useState } from "react";
import { pedir } from "../../../componentes/cliente.ts";
import { diaCorto, fechaConDia, fechaCorta, precio } from "../../../componentes/formato.ts";
import { Escalones } from "../../../componentes/panel/Graficas.tsx";
import type { Escalon } from "../../../componentes/panel/Graficas.tsx";
import { Imprimir } from "../../../componentes/panel/Imprimir.tsx";
import { Secciones, SoloQuienDirige } from "../../../componentes/panel/Secciones.tsx";
import type { HistoriaDeMaterial, HistoriaDePrecios, PeriodoDePrecios } from "../../../componentes/panel/tipos.ts";
import { DIRIGEN, useSesion } from "../../../componentes/Sesion.tsx";

const PERIODOS: Array<{ dias: PeriodoDePrecios; nombre: string }> = [
  { dias: 30, nombre: "30 días" }, { dias: 91, nombre: "3 meses" }, { dias: 365, nombre: "1 año" },
];
type Cual = "compra" | "venta";

const cuantas = (n: number, una: string, varias: string): string => `${n.toLocaleString("es-MX")} ${n === 1 ? una : varias}`;
const mayuscula = (t: string): string => t.slice(0, 1).toUpperCase() + t.slice(1);
const porCiento = (t: string): string => `${Math.abs(Number(t)).toLocaleString("es-MX", { maximumFractionDigits: 1 })} %`;
const veces = (n: number): string => (n === 0 ? "No cambió" : n === 1 ? "Cambió una vez" : `Cambió ${n} veces`);
/** En qué día del periodo cae esa fecha: 0 es el primero. Es para colocar el dibujo, no una cuenta. */
const diaDe = (desde: string, fecha: string): number => Math.round((Date.parse(`${fecha}T00:00:00Z`) - Date.parse(`${desde}T00:00:00Z`)) / 86_400_000);
const escalones = (m: HistoriaDeMaterial, desde: string, cual: Cual): Escalon[] => [
  ...(m.alEmpezar ? [{ dia: 0, valor: Number(m.alEmpezar[cual]) }] : []),
  ...m.cambios.map((c) => ({ dia: diaDe(desde, c.fecha), valor: c[cual] === null ? null : Number(c[cual]) })),
];

/** Subió o bajó, y cuánto. Si quedó igual o no hay con qué comparar, no dice nada: en una lista deja su hueco, para que los precios queden en columna. */
function Variacion({ valor, hueco = false }: { valor: string | null; hueco?: boolean }) {
  const n = Number(valor ?? 0);
  if (n === 0) return hueco ? <em className="variacion" /> : null;
  return <em className="variacion"><span aria-hidden="true">{n > 0 ? "▲" : "▼"}</span><span className="oculto">{n > 0 ? "subió" : "bajó"}</span> {porCiento(valor!)}</em>;
}

/** Hacia dónde se movió un precio respecto del que traía: para la flecha de cada cambio. */
function Flecha({ antes, ahora }: { antes: string | null; ahora: string }) {
  if (antes === null || Number(antes) === Number(ahora)) return null;
  const subio = Number(ahora) > Number(antes);
  return <><span aria-hidden="true"> {subio ? "▲" : "▼"}</span><span className="oculto"> {subio ? "subió" : "bajó"}</span></>;
}

/** El material que más subió (o más bajó) de compra, si alguno. */
function ElQueMas({ titulo, material }: { titulo: string; material: HistoriaDeMaterial | undefined }) {
  return (
    <div className="indicador">
      <p className="lbl">{titulo}</p>
      {material ? (
        <>
          <b className="cifra">{Number(material.variacion.compra) > 0 ? "▲" : "▼"} {porCiento(material.variacion.compra!)}</b>
          <small>{material.nombre}: de {precio(material.base!.compra)} a {precio(material.ahora!.compra)}</small>
        </>
      ) : <><b className="cifra">Ninguna</b><small>En este periodo</small></>}
    </div>
  );
}

function UnMaterial({ m, h }: { m: HistoriaDeMaterial; h: HistoriaDePrecios }) {
  const valores = (["compra", "venta"] as const).flatMap((cual) => escalones(m, h.desde, cual).flatMap((e) => (e.valor === null ? [] : [e.valor])));
  // Del más reciente al más viejo; cada renglón se compara con lo que valía justo antes.
  const antesDe = (k: number, cual: Cual): string | null => (k > 0 ? m.cambios[k - 1]![cual] : m.alEmpezar?.[cual] ?? null);
  const cifra = (cual: Cual, nombre: string) => (
    <div className="indicador">
      <p className="lbl">{nombre}, por kilo</p>
      <b className="cifra">{m.ahora ? precio(m.ahora[cual]) : "Sin precio"}</b>
      {m.ahora && m.base ? (
        Number(m.variacion[cual] ?? 0) === 0
          ? <small>Igual que como empezó el periodo</small>
          : <small><Variacion valor={m.variacion[cual]} /> en el periodo: empezó en {precio(m.base[cual])}</small>
      ) : <small>{m.ahora ? "Sin nada antes con qué comparar" : "No está en la última lista publicada"}</small>}
    </div>
  );
  return (
    <>
      <div className="indicadores dos">{cifra("compra", "Compra")}{cifra("venta", "Venta")}</div>
      <div className="card">
        <header><h2>Precio por kilo</h2><small>{veces(m.veces)}</small></header>
        <div className="pad">
          <div className="grafica">
            <small className="tope">{precio(String(Math.max(...valores)))}</small>
            <Escalones dias={h.dias} series={[{ clase: "compra", escalones: escalones(m, h.desde, "compra") }, { clase: "venta", escalones: escalones(m, h.desde, "venta") }]} />
            <small className="tope">{precio(String(Math.min(...valores)))}</small>
            <div className="eje" aria-hidden="true"><small>{diaCorto(h.desde)}</small><small>{diaCorto(h.hasta)}</small></div>
          </div>
          <p className="leyenda"><span><i className="barrita compra" />Compra</span><span><i className="barrita venta" />Venta</span></p>
          <p className="note">La escala va del precio más bajo al más alto del periodo, no desde cero: así se ven los centavos.</p>
        </div>
      </div>
      <div className="card">
        <header><h2>Cada cambio</h2><small>Del más reciente al más viejo</small></header>
        <div className="pad">
          <div className="scroll">
            <table className="cambios">
              <thead><tr><th>Día</th><th>Compra</th><th>Venta</th></tr></thead>
              <tbody>
                {m.cambios.map((c, k) => (
                  <tr key={c.fecha}>
                    <td>{mayuscula(fechaConDia(c.fecha))}</td>
                    {c.compra === null || c.venta === null ? <td colSpan={2}>Se quedó sin precio</td> : (
                      <>
                        <td className="mn">{precio(c.compra)}<Flecha antes={antesDe(k, "compra")} ahora={c.compra} /></td>
                        <td className="mn">{precio(c.venta)}<Flecha antes={antesDe(k, "venta")} ahora={c.venta} /></td>
                      </>
                    )}
                  </tr>
                )).reverse()}
                {m.alEmpezar ? (
                  <tr><td>Al empezar el periodo</td><td className="mn">{precio(m.alEmpezar.compra)}</td><td className="mn">{precio(m.alEmpezar.venta)}</td></tr>
                ) : null}
              </tbody>
            </table>
          </div>
          <p className="note">Un precio vale desde el día en que se publica su lista hasta que otra lo cambia.</p>
        </div>
      </div>
    </>
  );
}

export default function PantallaDeLaHistoriaDePrecios() {
  const { persona } = useSesion();
  const dirige = DIRIGEN.includes(persona.rol);
  const [dias, setDias] = useState<PeriodoDePrecios>(30);
  const [historia, setHistoria] = useState<HistoriaDePrecios | null>(null);
  const [aviso, setAviso] = useState("");
  const [viendo, setViendo] = useState<number | null>(null);

  /** Cuál fue la última petición: una respuesta que llega después de haber pedido otra cosa ya no se pinta. */
  const ultima = useRef(0);
  const cargar = useCallback(() => {
    if (!dirige) return;
    const esta = ++ultima.current;
    pedir<{ historia: HistoriaDePrecios }>("GET", `/api/precios/historia?dias=${dias}`)
      .then((r) => { if (esta === ultima.current) { setHistoria(r.historia); setAviso(""); } })
      .catch((e: Error) => { if (esta === ultima.current) setAviso(e.message); });
  }, [dias, dirige]);

  // Al llegar, al cambiar de periodo y al volver a la pestaña: los precios se publican una vez al día.
  useEffect(() => {
    cargar();
    const alVolver = (): void => { if (document.visibilityState === "visible") cargar(); };
    document.addEventListener("visibilitychange", alVolver);
    return () => document.removeEventListener("visibilitychange", alVolver);
  }, [cargar]);

  if (!dirige) return <SoloQuienDirige />;

  const elegir = (
    <div className="chips" role="group" aria-label="Periodo">
      {PERIODOS.map((p) => (
        <button key={p.dias} type="button" className="chip" aria-pressed={p.dias === dias} onClick={() => setDias(p.dias)}>{p.nombre}</button>
      ))}
    </div>
  );
  const material = historia?.materiales.find((m) => m.id === viendo) ?? null;
  const rotulo = historia ? (
    <p className="note periodo" role="status">
      Del {fechaCorta(historia.desde)} al {fechaCorta(historia.hasta)} · {historia.listas === 0 ? "ninguna lista publicada" : cuantas(historia.listas, "lista publicada", "listas publicadas")}
      {historia.dias !== dias ? " · cargando el otro periodo…" : ""}
    </p>
  ) : null;

  if (historia && material) {
    return (
      <div className="panel imprimible">
        <Secciones />
        <div className="top">
          <button className="quitar" type="button" onClick={() => setViendo(null)}>‹ Precios</button>
          <h2>{material.nombre}</h2>
          <Imprimir />
        </div>
        {elegir}
        {aviso ? <div className="flag" role="alert">{aviso}</div> : null}
        {rotulo}
        <UnMaterial m={material} h={historia} />
      </div>
    );
  }

  if (!historia) {
    return (
      <div className="panel">
        <Secciones />
        <div className="top"><h2>Historia de precios</h2></div>
        {elegir}
        {aviso ? <div className="flag" role="alert">{aviso}</div> : <p className="cargando">Un momento…</p>}
      </div>
    );
  }

  const cambiaron = historia.materiales.filter((m) => m.veces > 0).length;
  const porCompra = historia.materiales.filter((m) => m.variacion.compra !== null).sort((a, b) => Number(b.variacion.compra) - Number(a.variacion.compra));
  const subio = porCompra.find((m) => Number(m.variacion.compra) > 0);
  const bajo = porCompra.findLast((m) => Number(m.variacion.compra) < 0);
  const familias = historia.materiales.reduce<Array<{ nombre: string; materiales: HistoriaDeMaterial[] }>>((f, m) => {
    if (f.at(-1)?.nombre === m.familia) f.at(-1)!.materiales.push(m);
    else f.push({ nombre: m.familia, materiales: [m] });
    return f;
  }, []);

  return (
    <div className="panel imprimible">
      <Secciones />
      <div className="top"><h2>Historia de precios</h2><Imprimir /></div>
      {elegir}
      {aviso ? <div className="flag" role="alert">{aviso}</div> : null}
      {rotulo}
      {historia.materiales.length === 0 ? (
        <div className="card"><p className="empty">Todavía no se ha publicado ninguna lista de precios.</p></div>
      ) : (
        <>
          <div className="indicadores">
            <div className="indicador">
              <p className="lbl">Listas publicadas</p>
              <b className="cifra">{historia.listas.toLocaleString("es-MX")}</b>
              <small>Una por cada día que se abrió con precios</small>
            </div>
            <div className="indicador">
              <p className="lbl">Cambiaron de precio</p>
              <b className="cifra">{cambiaron} de {historia.materiales.length}</b>
              <small>materiales</small>
            </div>
            <ElQueMas titulo="La compra que más subió" material={subio} />
            <ElQueMas titulo="La compra que más bajó" material={bajo} />
          </div>
          <div>
            {familias.map((f) => (
              <div className="card" key={f.nombre}>
                <header><h2>{f.nombre}</h2><small>{cuantas(f.materiales.length, "material", "materiales")}</small></header>
                <div className="pad">
                  {f.materiales.map((m) => (
                    <button className="exrow material" type="button" key={m.id} onClick={() => { setViendo(m.id); window.scrollTo(0, 0); }}>
                      <span className="rn">
                        <b>{m.nombre}</b>
                        <small>{veces(m.veces)}</small>
                      </span>
                      <Escalones chica dias={historia.dias} series={[{ clase: "compra", escalones: escalones(m, historia.desde, "compra") }]} />
                      {m.ahora ? (
                        <span className="dinero">
                          <small><span>Compra </span><b>{precio(m.ahora.compra)}</b><Variacion hueco valor={m.variacion.compra} /></small>
                          <small><span>Venta </span><b>{precio(m.ahora.venta)}</b><Variacion hueco valor={m.variacion.venta} /></small>
                        </span>
                      ) : <span className="dinero sin"><small>Hoy no tiene precio</small></span>}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <p className="note">La rayita de cada material es su precio de compra en el periodo. Toca un material para ver sus cambios uno por uno.</p>
        </>
      )}
    </div>
  );
}
