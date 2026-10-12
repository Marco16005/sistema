"use client";
// Sacar reportes: bajar lo de un periodo como archivo para Excel (CSV). El archivo lo arma el
// servidor (src/servidor/dominio/exportar.ts), con la misma regla del cierre; aquí solo se elige de
// cuándo a cuándo y qué hoja. Imprimir se hace desde cada pantalla, con su botón.
import { useState } from "react";
import { fechaCorta } from "../../../componentes/formato.ts";
import { Secciones, SoloQuienDirige } from "../../../componentes/panel/Secciones.tsx";
import { DIRIGEN, useSesion } from "../../../componentes/Sesion.tsx";

const HOJAS: Array<{ hoja: string; nombre: string; que: string }> = [
  { hoja: "dias", nombre: "Los días", que: "Un renglón por día: sus cuentas, lo pagado, lo cobrado y los kilos." },
  { hoja: "cuentas", nombre: "Las cuentas", que: "Un renglón por cuenta: folio, hora, de quién fue, kilos, total y quién atendió." },
  { hoja: "renglones", nombre: "Los materiales de cada cuenta", que: "Un renglón por material: pesos, precio de lista, precio cobrado e importe." },
  { hoja: "precios", nombre: "Los precios", que: "Lo que valió cada material en cada lista publicada." },
];
/** Lo más que cabe en un archivo: un año y un día. */
const TOPE = 366;

const aFecha = (d: Date): string => d.toISOString().slice(0, 10);
const deFecha = (f: string): Date => new Date(`${f}T00:00:00Z`);
/** Esa fecha, movida tantos días. Es para elegir el periodo, no una cuenta de dinero. */
const mas = (f: string, dias: number): string => aFecha(new Date(deFecha(f).getTime() + dias * 86_400_000));
const primeroDelMes = (f: string): string => `${f.slice(0, 8)}01`;

/** Los periodos de un toque, a partir del día de hoy en el patio. */
const atajos = (hoy: string): Array<{ nombre: string; desde: string; hasta: string }> => {
  const finDelPasado = mas(primeroDelMes(hoy), -1);
  return [
    { nombre: "Últimos 7 días", desde: mas(hoy, -6), hasta: hoy },
    { nombre: "Este mes", desde: primeroDelMes(hoy), hasta: hoy },
    { nombre: "El mes pasado", desde: primeroDelMes(finDelPasado), hasta: finDelPasado },
    { nombre: "Últimos 3 meses", desde: mas(hoy, -90), hasta: hoy },
  ];
};

/** Por qué ese periodo no se puede pedir; nada si sí se puede. */
function loQueFalta(desde: string, hasta: string): string {
  if (!desde || !hasta) return "Falta decir de qué día a qué día.";
  if (desde > hasta) return "El primer día no puede ser posterior al último.";
  if ((deFecha(hasta).getTime() - deFecha(desde).getTime()) / 86_400_000 + 1 > TOPE) return "En un archivo cabe hasta un año. Pide un periodo más corto.";
  return "";
}

export default function PantallaDeReportes() {
  const { persona, dia } = useSesion();
  const dirige = DIRIGEN.includes(persona.rol);
  const [desde, setDesde] = useState(primeroDelMes(dia.hoy));
  const [hasta, setHasta] = useState(dia.hoy);
  const [aviso, setAviso] = useState("");
  const [bajando, setBajando] = useState("");
  const [listo, setListo] = useState("");

  if (!dirige) return <SoloQuienDirige />;

  const falta = loQueFalta(desde, hasta);
  const elegir = (d: string, h: string): void => { setDesde(d); setHasta(h); setAviso(""); setListo(""); };

  /** Pide el archivo y se lo entrega al navegador para que lo guarde. Si el servidor no lo da, se dice por qué. */
  const bajar = async (hoja: string, nombre: string): Promise<void> => {
    setAviso(""); setListo(""); setBajando(hoja);
    try {
      const r = await fetch(`/api/exportar?hoja=${hoja}&desde=${desde}&hasta=${hasta}`, { cache: "no-store", credentials: "same-origin" });
      if (!r.ok) {
        const e = await r.json().catch(() => null) as { error?: { mensaje?: string } } | null;
        setAviso(e?.error?.mensaje ?? "No se pudo sacar el archivo. Intenta de nuevo.");
        return;
      }
      const liga = document.createElement("a");
      liga.href = URL.createObjectURL(await r.blob());
      liga.download = `${hoja}-${desde}-a-${hasta}.csv`;
      document.body.append(liga);
      liga.click();
      liga.remove();
      setTimeout(() => URL.revokeObjectURL(liga.href), 10_000);
      setListo(`Se bajó «${nombre}», del ${fechaCorta(desde)} al ${fechaCorta(hasta)}. Está en las descargas de este equipo.`);
    } catch {
      setAviso("No se pudo hablar con el servidor. Revisa la conexión y vuelve a intentar.");
    } finally {
      setBajando("");
    }
  };

  return (
    <div className="angosto" style={{ margin: "0 auto" }}>
      <Secciones />
      <div className="top"><h2>Reportes</h2></div>
      <div className="card">
        <header><h2>De qué días</h2></header>
        <div className="pad">
          <div className="chips" role="group" aria-label="Periodo">
            {atajos(dia.hoy).map((a) => (
              <button key={a.nombre} type="button" className="chip" aria-pressed={a.desde === desde && a.hasta === hasta} onClick={() => elegir(a.desde, a.hasta)}>{a.nombre}</button>
            ))}
          </div>
          <div className="filtros">
            <label>
              <span className="lbl">Desde</span>
              <input className="campo" type="date" value={desde} max={dia.hoy} onChange={(e) => elegir(e.target.value, hasta)} />
            </label>
            <label>
              <span className="lbl">Hasta</span>
              <input className="campo" type="date" value={hasta} max={dia.hoy} onChange={(e) => elegir(desde, e.target.value)} />
            </label>
          </div>
          {falta ? <p className="note" role="status">{falta}</p> : null}
        </div>
      </div>

      {aviso ? <div className="flag" role="alert">{aviso}</div> : null}
      {listo ? <div className="okmsg" role="status">{listo}</div> : null}

      <div className="card">
        <header><h2>Archivos para Excel</h2><small>{falta ? "Elige el periodo" : `Del ${fechaCorta(desde)} al ${fechaCorta(hasta)}`}</small></header>
        <div className="pad">
          {HOJAS.map((h) => (
            <button className="exrow" type="button" key={h.hoja} disabled={falta !== "" || bajando !== ""} onClick={() => void bajar(h.hoja, h.nombre)} aria-label={`Bajar ${h.nombre.toLowerCase()}`}>
              <span className="rn">
                <b>{h.nombre}</b>
                <small>{h.que}</small>
              </span>
              <span className="ri">{bajando === h.hoja ? "Un momento…" : "Bajar"}</span>
            </button>
          ))}
          <p className="note">
            Cada archivo se abre con Excel o con Números. Trae lo que quedó asentado en esos días, con la misma regla del cierre: una cuenta es del día en que se cobró.
          </p>
        </div>
      </div>

      <div className="card">
        <header><h2>En papel</h2></header>
        <div className="pad">
          <p className="note" style={{ marginTop: 0 }}>
            El resumen, cada día, la historia de precios y la ficha de un cliente se imprimen desde su propia pantalla, con el botón «Imprimir»: sale lo que se está viendo, en una hoja normal.
          </p>
        </div>
      </div>
    </div>
  );
}
