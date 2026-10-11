"use client";
// El inventario: lo que hay en el patio por familia, los movimientos de cada material, y desde ahí
// contar, dar merma, separar y corregir. Cada cosa es su propia pantalla, con una decisión a la vez.
//
// En qué va lo que se está capturando se guarda en este equipo —nunca una clave—, para que
// recargar la página no lo pierda ni deje a medias un envío del que no se supo el resultado. Se
// guarda en el momento, no al redibujar: lo que va a salir queda guardado antes de salir.
import { useCallback, useEffect, useRef, useState } from "react";
import { pedir } from "../cliente.ts";
import { fechaCorta, kilos, kilosConSigno, kilosCortos } from "../formato.ts";
import { soltoLoHeredado } from "../pestana.ts";
import { SoloEnSuPestana } from "../SoloEnSuPestana.tsx";
import { COBRAN, useSesion } from "../Sesion.tsx";
import { CONTEO_NUEVO, Contar } from "./Contar.tsx";
import type { EstadoDeConteo } from "./Contar.tsx";
import { Corregir } from "./Corregir.tsx";
import type { EstadoDeCorreccion } from "./Corregir.tsx";
import { MERMA_NUEVA, Merma } from "./Merma.tsx";
import type { EstadoDeMerma } from "./Merma.tsx";
import { SEPARACION_NUEVA, Separar } from "./Separar.tsx";
import type { EstadoDeSeparacion } from "./Separar.tsx";
import { nombreDeMovimiento } from "./tipos.ts";
import type { Elegido, Familia, Movimiento } from "./tipos.ts";

type Vista =
  | { v: "existencias" }
  | { v: "movimientos"; material: number }
  | { v: "contar"; e: EstadoDeConteo }
  | { v: "merma"; e: EstadoDeMerma }
  | { v: "separar"; e: EstadoDeSeparacion }
  | { v: "corregir"; e: EstadoDeCorreccion; de: number };

const DONDE = "feruga.inventario";

function recordar(): Vista {
  try {
    const v = JSON.parse(sessionStorage.getItem(DONDE) ?? "null");
    if (v && typeof v === "object" && typeof v.v === "string") return v as Vista;
  } catch {
    // Sin memoria se empieza por las existencias.
  }
  return { v: "existencias" };
}

interface DeMaterial {
  material: Elegido;
  kg: string;
  movimientos: Movimiento[];
}

/** Lo guardado se lee hasta saber que esta pestaña no es copia de otra: una copia no se queda con la captura a medias. */
export function Inventario() {
  return <SoloEnSuPestana><Pantalla /></SoloEnSuPestana>;
}

function Pantalla() {
  const { persona, dia } = useSesion();
  const [vista, setVista] = useState<Vista>(recordar);
  const actual = useRef(vista);
  const [familias, setFamilias] = useState<Familia[] | null>(null);
  const [detalle, setDetalle] = useState<DeMaterial | null>(null);
  const [aviso, setAviso] = useState(() =>
    soltoLoHeredado("inventario") ? "Había una captura a medias: sigue en la otra pestaña, donde se empezó." : "");
  const [hecho, setHecho] = useState("");
  const escribe = COBRAN.includes(persona.rol);

  const fijar = (v: Vista): void => {
    actual.current = v;
    try {
      sessionStorage.setItem(DONDE, JSON.stringify(v));
    } catch {
      // Sin dónde guardar, la pantalla sigue; solo no sobrevive a una recarga.
    }
    setVista(v);
  };

  const cargar = useCallback(() => {
    pedir<{ familias: Familia[] }>("GET", "/api/inventario").then((r) => setFamilias(r.familias)).catch((e: Error) => setAviso(e.message));
  }, []);
  useEffect(cargar, [cargar]);

  const material = vista.v === "movimientos" ? vista.material : null;
  useEffect(() => {
    if (material === null) return;
    let vigente = true;
    setDetalle(null);
    pedir<DeMaterial>("GET", `/api/inventario/materiales/${material}`)
      .then((r) => { if (vigente) setDetalle(r); })
      .catch((e: Error) => { if (vigente) setAviso(e.message); });
    return () => { vigente = false; };
  }, [material]);

  if (familias === null) return aviso ? <div className="flag" role="alert">{aviso}</div> : <p className="cargando">Un momento…</p>;

  const ir = (v: Vista, mensaje = ""): void => {
    setAviso("");
    setHecho(mensaje);
    fijar(v);
    window.scrollTo(0, 0);
  };
  /** Cambia el estado de lo que se está capturando, sin salir de su pantalla. */
  const poner = <E,>(cambio: Partial<E>): void => {
    const antes = actual.current;
    if ("e" in antes) fijar({ ...antes, e: { ...antes.e, ...cambio } } as Vista);
  };
  /** Una acción quedó registrada: se vuelve a lo que hay, ya actualizado. */
  const terminar = (mensaje: string, a: Vista = { v: "existencias" }): void => {
    cargar();
    ir(a, mensaje);
  };
  const sinJornada = !dia.jornada;

  const corregir = (m: Movimiento, de: Elegido): void => {
    // Cómo cuenta hoy: si ya se corrigió, lo que dejaron sus correcciones; si no, su material y sus kilos.
    const quedo = m.quedo?.[0];
    const todos = familias.flatMap((f) => f.materiales);
    const hoyMaterial = m.quedo === null ? de : quedo ? { id: todos.find((x) => x.nombre === quedo.material)?.id ?? de.id, nombre: quedo.material } : null;
    const hoyKg = String(Math.abs(Number(m.quedo === null ? m.kg : (quedo?.kg ?? "0"))));
    ir({
      v: "corregir", de: de.id,
      e: {
        paso: "forma", movimiento: { id: m.id, tipo: m.tipo, folio: m.folio, fecha: m.fecha, hora: m.hora, correcciones: m.correcciones },
        hoy: { material: hoyMaterial, kg: hoyKg }, material: hoyMaterial ?? de, kg: hoyKg, anular: false, motivo: "", pendiente: null,
      },
    });
  };

  return (
    <div className="angosto" style={{ margin: "0 auto" }}>
      {vista.v === "contar" ? (
        <Contar e={vista.e} poner={poner} familias={familias} alTerminar={terminar} alSalir={() => ir({ v: "existencias" })} />
      ) : vista.v === "merma" ? (
        <Merma e={vista.e} poner={poner} familias={familias} alTerminar={terminar} alSalir={() => ir({ v: "existencias" })} />
      ) : vista.v === "separar" ? (
        <Separar e={vista.e} poner={poner} familias={familias} alTerminar={terminar} alSalir={() => ir({ v: "existencias" })} />
      ) : vista.v === "corregir" ? (
        <Corregir
          e={vista.e} poner={poner} familias={familias}
          alTerminar={(mensaje) => terminar(mensaje, { v: "movimientos", material: vista.de })}
          alSalir={(mensaje) => { ir({ v: "movimientos", material: vista.de }); if (mensaje) setAviso(mensaje); }}
        />
      ) : vista.v === "movimientos" ? (
        <div className="card">
          <header>
            <h2>{detalle?.material.nombre ?? "…"}</h2>
            <small>{detalle ? `${kilos(detalle.kg)} kg en el patio` : ""}</small>
          </header>
          <div className="pad">
            {hecho ? <div className="okmsg" role="status">{hecho}</div> : null}
            {aviso ? <div className="flag" role="alert" style={{ marginTop: 0, marginBottom: 12 }}>{aviso}</div> : null}
            {!detalle && !aviso ? <p className="cargando">Un momento…</p> : null}
            {detalle?.movimientos.length === 0 ? <p className="empty">Este material todavía no tiene movimientos.</p> : null}
            {detalle?.movimientos.map((m) => (
              <div className="ren" key={m.id}>
                <div className="rn">
                  <b>{nombreDeMovimiento(m)}{m.folio ? ` · folio ${m.folio}` : ""}</b>
                  <small>{fechaCorta(m.fecha)}, {m.hora} · {m.quien}{m.autorizo ? ` · autorizó ${m.autorizo}` : ""}</small>
                  {m.motivo ? <small>{m.motivo}</small> : null}
                  {m.original ? (
                    <small>
                      Corrige {nombreDeMovimiento(m.original).toLowerCase()}{m.original.folio ? ` del folio ${m.original.folio}` : ""} de {m.original.material.nombre}.
                    </small>
                  ) : null}
                  {m.quedo ? (
                    <small>
                      <b>Corregido.</b> Hoy cuenta como: {m.quedo.length ? m.quedo.map((q) => `${q.material}, ${kilos(String(Math.abs(Number(q.kg))))} kg`).join("; ") : "nada, quedó sin efecto"}.
                    </small>
                  ) : null}
                  {m.yaContado && m.tipo !== "ajuste" && m.tipo !== "transformacion" ? <small>Ya se contó después: si algo no cuadra, se vuelve a contar.</small> : null}
                </div>
                <div className="ri">{kilosConSigno(m.kg)}</div>
                {m.original && m.original.material.id !== detalle.material.id ? (
                  <button className="quitar" type="button" onClick={() => ir({ v: "movimientos", material: m.original!.material.id })}>Ver el original</button>
                ) : null}
                {escribe && m.corregible ? (
                  <button className="quitar" type="button" disabled={sinJornada} aria-label={`Corregir ${nombreDeMovimiento(m).toLowerCase()} de ${kilosCortos(String(Math.abs(Number(m.kg))))} kg`} onClick={() => corregir(m, detalle.material)}>
                    Corregir
                  </button>
                ) : null}
              </div>
            ))}
            <button className="btn ghostbtn chico" type="button" onClick={() => ir({ v: "existencias" })}>Regresar a existencias</button>
          </div>
        </div>
      ) : (
        <>
          {hecho ? <div className="okmsg" role="status">{hecho}</div> : null}
          {aviso ? <div className="flag" role="alert" style={{ marginTop: 0, marginBottom: 12 }}>{aviso}</div> : null}
          {escribe ? (
            <div className="card">
              <div className="pad">
                <div className="tres">
                  <button className="btn" type="button" disabled={sinJornada} onClick={() => ir({ v: "contar", e: CONTEO_NUEVO })}>Contar</button>
                  <button className="btn" type="button" disabled={sinJornada} onClick={() => ir({ v: "merma", e: MERMA_NUEVA })}>Merma</button>
                  <button className="btn" type="button" disabled={sinJornada} onClick={() => ir({ v: "separar", e: SEPARACION_NUEVA })}>Separar</button>
                </div>
                <p className="note">
                  {sinJornada
                    ? "Para contar, dar merma, separar o corregir hace falta que la jornada esté abierta."
                    : "Para corregir algo ya registrado, toca el material y busca el movimiento."}
                </p>
              </div>
            </div>
          ) : null}
          <div className="card">
            <header><h2>Lo que hay en el patio</h2><small>Según lo registrado</small></header>
            <div className="pad">
              {familias.map((f) => (
                <div key={f.id}>
                  <h3 className="pcat">{f.nombre}</h3>
                  {f.materiales.map((m) => (
                    <button className="exrow" key={m.id} type="button" onClick={() => ir({ v: "movimientos", material: m.id })}>
                      <span className="rn">
                        <b>{m.nombre}</b>
                        {Number(m.apartado) > 0 ? <small>{kilos(m.apartado)} kg apartados en ventas abiertas · quedan {kilos(m.disponible)}</small> : null}
                        {m.ultimoConteo ? <small>Contado el {fechaCorta(m.ultimoConteo.fecha)} a las {m.ultimoConteo.hora} · diferencia {kilosConSigno(m.ultimoConteo.diferencia)} kg</small> : null}
                      </span>
                      <span className="ri">{kilos(m.kg)} kg</span>
                    </button>
                  ))}
                </div>
              ))}
              <p className="note">La existencia no se captura: sale de sumar lo comprado, lo vendido, la merma, lo separado y los conteos.</p>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
