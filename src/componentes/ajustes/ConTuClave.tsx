"use client";
// Lo que se hace en los ajustes con personas y equipos lo pide un responsable facultado, y lo
// demuestra con su clave en ese momento: tener la sesión abierta no basta. Aquí no se elige quién
// —es quien está adentro—; se dice qué se va a hacer, se teclea la clave y se manda. La clave
// viaja con el pedido y la comprueba la base; aquí no se guarda en ningún lado.
import { useState } from "react";
import type { ReactNode } from "react";
import { Hoja } from "../base/Hoja.tsx";
import { ErrorDeApi, pedir } from "../cliente.ts";
import { Teclado } from "../Teclado.tsx";

/** Lo que se va a hacer con la clave de quien lo pide. */
export interface Pedido {
  titulo: string;
  explicacion: string;
  /** El texto del botón que lo hace. */
  boton: string;
  camino: string;
  cuerpo: Record<string, unknown>;
  alLograrlo: (respuesta: any) => void;
}

function ConTuClave({ pedido, nombre, aviso, ocupado, alTeclear, alCancelar }: {
  pedido: Pedido; nombre: string; aviso: string; ocupado: boolean; alTeclear: (clave: string) => Promise<void>; alCancelar: () => void;
}) {
  const [clave, setClave] = useState("");
  const lista = clave.length >= 6;
  const mandar = async (): Promise<void> => {
    if (!lista || ocupado) return;
    try {
      await alTeclear(clave);
    } finally {
      setClave("");       // acertada o no, la clave no se queda en la pantalla
    }
  };
  return (
    <Hoja titulo={pedido.titulo} alCerrar={ocupado ? null : alCancelar}>
      <div className="pad">
        <p className="que"><b>{pedido.titulo}</b><span>{pedido.explicacion}</span></p>
        <p className="lbl">Tu clave, {nombre}</p>
        <div className="puntos" role="status" aria-label={`${clave.length} dígitos escritos`}>
          {Array.from({ length: Math.max(clave.length, 6) }, (_, k) => <i key={k} className={k < clave.length ? "lleno" : ""} />)}
        </div>
        <Teclado valor={clave} alCambiar={setClave} decimales={0} enteros={8} alTerminar={() => void mandar()} />
        {aviso ? <div className="flag" role="alert">{aviso}</div> : null}
        <button className="btn" type="button" disabled={!lista || ocupado} onClick={() => void mandar()}>{pedido.boton}</button>
        <button className="btn ghostbtn" type="button" disabled={ocupado} onClick={alCancelar}>No, regresar</button>
      </div>
    </Hoja>
  );
}

/**
 * Pedir algo con la clave de quien está adentro. Devuelve cómo pedirlo y la hoja que hay que pintar.
 * `alTerminar` corre después de cada intento que pudo haber cambiado algo, para volver a traer la lista.
 */
export function usePedidoConClave(nombre: string, alTerminar: () => void): { pedirlo: (p: Pedido) => void; hoja: ReactNode; noSeSupo: string } {
  const [pedido, setPedido] = useState<Pedido | null>(null);
  const [aviso, setAviso] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [noSeSupo, setNoSeSupo] = useState("");

  const mandar = async (clave: string): Promise<void> => {
    if (!pedido) return;
    setOcupado(true);
    setAviso("");
    try {
      const r = await pedir("POST", pedido.camino, { ...pedido.cuerpo, clave });
      pedido.alLograrlo(r);
      setPedido(null);
      alTerminar();
    } catch (e) {
      const error = e as ErrorDeApi;
      // El servidor contestó con una regla o con que la clave no pasó: no se hizo, y se dice ahí mismo.
      if (error.estado > 0 && error.estado < 500) {
        setAviso(error.message);
      } else {
        // Sin respuesta, o con una falla de en medio: pudo haberse hecho. Se cierra y se mira la lista.
        setPedido(null);
        setNoSeSupo("No se supo si se hizo. Mira la lista: si ya se ve el cambio, se hizo. Si diste de alta a alguien y ya aparece, cámbiale la clave para conocerla.");
        alTerminar();
      }
    } finally {
      setOcupado(false);
    }
  };

  return {
    pedirlo: (p) => { setAviso(""); setNoSeSupo(""); setPedido(p); },
    hoja: pedido ? <ConTuClave pedido={pedido} nombre={nombre} aviso={aviso} ocupado={ocupado} alTeclear={mandar} alCancelar={() => setPedido(null)} /> : null,
    noSeSupo,
  };
}

/**
 * Lo que se ve una sola vez —una clave, un código—, grande y con lo que hay que hacer con ello. Va
 * en una hoja, que tapa lo demás: quien lo pidió pudo haber bajado en la lista, y esto no se puede
 * quedar fuera de la vista. No se cierra sola ni con Escape: se cierra al decir que ya se anotó.
 */
export function SeVeUnaVez({ titulo, valor, nota, entendido, alEntender }: { titulo: string; valor: string; nota: string; entendido: string; alEntender: () => void }) {
  return (
    <Hoja titulo={titulo} alCerrar={null}>
      <div className="pad unavez" role="status">
        <p className="lbl">{titulo}</p>
        <b className="secreto">{valor}</b>
        <p className="note">{nota}</p>
        <button className="btn" type="button" onClick={alEntender}>{entendido}</button>
      </div>
    </Hoja>
  );
}
