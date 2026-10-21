"use client";
// Autorizar en el momento: se elige a quien autoriza y esa persona teclea su clave ahí mismo. La
// clave viaja con la acción que autoriza y la comprueba la base; aquí no se guarda en ningún lado.
//
// Es una hoja: interrumpe, y tapa lo demás mientras se decide. Escape hace lo mismo que su botón
// de salir, y solo cuando no está ocupada. Cerrarla no suelta ningún envío: eso lo lleva su dueño.
import { useState } from "react";
import type { ReactNode } from "react";
import { Hoja } from "./base/Hoja.tsx";
import { Teclado } from "./Teclado.tsx";

export interface QuienAutoriza {
  id: string;
  nombre: string;
  /** Cuántos dígitos tiene su clave, por lo menos: seis la de un responsable (lo de siempre), cuatro la de mostrador. */
  digitos?: number;
}

interface Props {
  titulo: string;
  explicacion: ReactNode;
  /** Quiénes pueden autorizar esto; vacío mientras llegan. */
  personas: QuienAutoriza[] | null;
  /** Quien ya autorizó un envío del que no se supo: se le pide la clave a esa misma persona, sin elegir. */
  quien?: QuienAutoriza | null;
  /** Con un envío del que no se supo, para que autorice otra persona: primero hay que resolver ese envío. */
  alSoltar?: () => Promise<void>;
  /** El texto del botón, con el nombre de quien autoriza. */
  boton: (nombre: string) => string;
  /** Lo que hace cada persona de la lista: «autoriza», salvo que se diga otra cosa («firma el corte»). */
  verbo?: string;
  cancelar: string;
  aviso: string;
  ocupado: boolean;
  alAutorizar: (quien: QuienAutoriza, clave: string) => Promise<void>;
  alCancelar: () => void;
}

export function Autorizar(p: Props) {
  const [elegido, setQuien] = useState<QuienAutoriza | null>(null);
  const quien = p.quien ?? elegido;
  const [clave, setClave] = useState("");
  const minimo = quien?.digitos ?? 6;
  const lista = clave.length >= minimo;

  const otraPersona = async (): Promise<void> => {
    if (p.ocupado) return;
    setClave("");
    if (p.quien && p.alSoltar) await p.alSoltar();
    setQuien(null);       // si el envío no se pudo soltar, sigue mandando quien ya lo autorizó
  };

  const autorizar = async (): Promise<void> => {
    if (!quien || !lista || p.ocupado) return;
    try {
      await p.alAutorizar(quien, clave);
    } finally {
      setClave("");       // acertada o no, la clave no se queda en la pantalla
    }
  };

  return (
    <Hoja titulo={p.titulo} alCerrar={p.ocupado ? null : p.alCancelar}>
      <div className="pad">
        <p className="que">
          <b>{p.titulo}</b>
          <span>{p.explicacion}</span>
        </p>
        {!quien ? (
          <>
            <p className="lbl">¿Quién autoriza?</p>
            {p.personas === null ? <p className="cargando">Un momento…</p> : null}
            {p.personas?.length === 0 ? <p className="empty">No hay nadie dado de alta que pueda autorizar esto.</p> : null}
            {p.aviso ? <div className="flag" role="alert">{p.aviso}</div> : null}
            <div className="personas">
              {p.personas?.map((x) => (
                <button key={x.id} type="button" className="mat" onClick={() => setQuien(x)}><b>{x.nombre}</b><span>{p.verbo ?? "autoriza"}</span></button>
              ))}
            </div>
          </>
        ) : (
          <>
            <p className="lbl">Clave de {quien.nombre}</p>
            <div className="puntos" role="status" aria-label={`${clave.length} dígitos escritos`}>
              {Array.from({ length: Math.max(clave.length, minimo) }, (_, k) => <i key={k} className={k < clave.length ? "lleno" : ""} />)}
            </div>
            <Teclado valor={clave} alCambiar={setClave} decimales={0} enteros={8} alTerminar={() => void autorizar()} />
            {p.aviso ? <div className="flag" role="alert">{p.aviso}</div> : null}
            <button className="btn" type="button" disabled={!lista || p.ocupado} onClick={() => void autorizar()}>{p.boton(quien.nombre)}</button>
            <button className="btn ghostbtn" type="button" disabled={p.ocupado} onClick={() => void otraPersona()}>Autoriza otra persona</button>
          </>
        )}
        <button className="btn ghostbtn" type="button" disabled={p.ocupado} onClick={p.alCancelar}>{p.cancelar}</button>
      </div>
    </Hoja>
  );
}
