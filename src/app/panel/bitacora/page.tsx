"use client";
// La bitácora a la vista: quién hizo qué y cuándo, en palabras llanas, de lo más reciente a lo más
// viejo. Nadie puede cambiar ni borrar lo que aquí aparece: la base no lo admite.
import { useCallback, useEffect, useRef, useState } from "react";
import { pedir } from "../../../componentes/cliente.ts";
import { fechaConDia } from "../../../componentes/formato.ts";
import { Secciones, SoloQuienDirige } from "../../../componentes/panel/Secciones.tsx";
import { DIRIGEN, useSesion } from "../../../componentes/Sesion.tsx";

interface Asiento {
  id: string;
  fecha: string;
  hora: string;
  quien: string | null;
  accion: string;
  entidad: string;
  que: string;
}

const mayuscula = (t: string): string => t.slice(0, 1).toUpperCase() + t.slice(1);

export default function PantallaDeLaBitacora() {
  const { persona, dia: hoy } = useSesion();
  const dirige = DIRIGEN.includes(persona.rol);
  const [asientos, setAsientos] = useState<Asiento[] | null>(null);
  const [hayMas, setHayMas] = useState(false);
  const [aviso, setAviso] = useState("");
  const [personas, setPersonas] = useState<Array<{ id: string; nombre: string }>>([]);
  const [quien, setQuien] = useState("");
  const [dia, setDia] = useState("");

  /** Cuál fue la última petición: lo de una búsqueda que llega después de haber pedido otra ya no se pinta. */
  const ultima = useRef(0);
  /** Trae lo anterior a ese asiento; sin él, lo más reciente de lo que se busca. */
  const traer = useCallback((antes: string | null) => {
    const esta = ++ultima.current;
    const busca = new URLSearchParams();
    if (antes) busca.set("antes", antes);
    if (quien) busca.set("persona", quien);
    if (dia) busca.set("dia", dia);
    pedir<{ asientos: Asiento[]; hayMas: boolean }>("GET", `/api/bitacora${busca.size > 0 ? `?${busca}` : ""}`)
      .then((r) => {
        if (esta !== ultima.current) return;
        setAsientos((ya) => (antes && ya ? [...ya, ...r.asientos] : r.asientos));
        setHayMas(r.hayMas);
        setAviso("");
      })
      .catch((e: Error) => { if (esta === ultima.current) setAviso(e.message); });
  }, [quien, dia]);
  useEffect(() => { if (dirige) traer(null); }, [dirige, traer]);
  useEffect(() => {
    if (dirige) pedir<{ personas: Array<{ id: string; nombre: string }> }>("GET", "/api/personas").then((r) => setPersonas(r.personas)).catch(() => setPersonas([]));
  }, [dirige]);

  if (!dirige) return <SoloQuienDirige />;

  // Un encabezado cada vez que cambia el día.
  const porDia: Array<{ fecha: string; asientos: Asiento[] }> = [];
  for (const a of asientos ?? []) {
    if (porDia.at(-1)?.fecha === a.fecha) porDia.at(-1)!.asientos.push(a);
    else porDia.push({ fecha: a.fecha, asientos: [a] });
  }

  return (
    <div className="angosto" style={{ margin: "0 auto" }}>
      <Secciones />
      <div className="top"><h2>Bitácora</h2></div>
      <div className="card">
        <div className="pad filtros">
          <label>
            <span className="lbl">Quién</span>
            <select className="campo" value={quien} onChange={(e) => setQuien(e.target.value)}>
              <option value="">Todas las personas</option>
              {personas.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
            </select>
          </label>
          <label>
            <span className="lbl">Qué día</span>
            <input className="campo" type="date" value={dia} max={hoy.hoy} onChange={(e) => setDia(e.target.value)} />
          </label>
          {quien || dia ? <button className="btn ghostbtn" type="button" onClick={() => { setQuien(""); setDia(""); }}>Ver todo</button> : null}
        </div>
      </div>
      {aviso ? <div className="flag" role="alert">{aviso}</div> : null}
      {asientos === null ? (aviso ? null : <p className="cargando">Un momento…</p>) : (
        <div className="card">
          <div className="pad">
            {asientos.length === 0 ? <p className="empty">No hay nada anotado con eso que buscas.</p> : null}
            {porDia.map((d) => (
              <section key={d.fecha} aria-label={fechaConDia(d.fecha)}>
                <p className="pcat">{mayuscula(fechaConDia(d.fecha))}</p>
                {d.asientos.map((a) => (
                  <div className="asiento" key={a.id}>
                    <span className="hora">{a.hora}</span>
                    <span><b>{a.quien ?? "Quien administra"}</b> {a.que}</span>
                  </div>
                ))}
              </section>
            ))}
            {hayMas ? <button className="btn ghostbtn" type="button" onClick={() => traer(asientos.at(-1)!.id)}>Ver lo anterior</button> : null}
            <p className="note">Lo que aquí aparece no se puede cambiar ni borrar: la base no lo admite.</p>
          </div>
        </div>
      )}
    </div>
  );
}
