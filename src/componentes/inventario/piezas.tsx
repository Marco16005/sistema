"use client";
// Las piezas que comparten las pantallas de inventario: elegir un material, teclear kilos, dar un
// motivo, y la regla para hacer una acción contra el servidor de una en una.
import { useRef, useState } from "react";
import type { ReactNode } from "react";
import { ErrorDeApi, cancelarEnvio, pedir, rechazoConRegla } from "../cliente.ts";
import { kilosCortos } from "../formato.ts";
import { Teclado, Visor } from "../Teclado.tsx";
import type { Elegido, Familia, MaterialEnExistencia } from "./tipos.ts";

/**
 * Corre una acción contra el servidor, de una en una, y guarda su aviso si falla. La guarda es una
 * referencia y no el estado: dos toques seguidos llegan antes de que la pantalla se redibuje.
 */
export function useAccion() {
  const [ocupado, setOcupado] = useState(false);
  const [aviso, setAviso] = useState("");
  const enCurso = useRef(false);

  const hacer = async (accion: () => Promise<void>): Promise<void> => {
    if (enCurso.current) return;
    enCurso.current = true;
    setOcupado(true);
    setAviso("");
    try {
      await accion();
    } catch (e) {
      setAviso((e as Error).message);
    } finally {
      enCurso.current = false;
      setOcupado(false);
    }
  };
  return { ocupado, aviso, setAviso, hacer };
}

/** Algo que ya salió hacia el servidor: su identificador y lo que llevaba, tal cual. */
export interface Pendiente<C> {
  id: string;
  cuerpo: C;
}

/** ¿El servidor dijo que ese identificador ya no sirve? Se canceló, o lo ocupa otro envío. */
const identificadorResuelto = (e: unknown): boolean => e instanceof ErrorDeApi && e.codigo === "RC012";

/**
 * Manda algo que escribe en el inventario. Antes de salir queda guardado en este equipo, con su
 * identificador y lo que lleva, y así se queda hasta saber qué pasó: mientras esté guardado, la
 * pantalla no deja cambiar nada y lo único que se puede hacer es mandar ese mismo otra vez (si ya
 * había entrado, no se asienta dos veces). Si no hay respuesta, si el servidor falla o si la
 * página se recarga con el envío en el aire, no se sabe: se queda guardado.
 *
 * Devuelve lo que contestó la acción, o nada si no se supo. Que algo quedó registrado solo lo
 * dice la acción misma, nunca una deducción de la pantalla.
 *
 * La captura se suelta solo cuando el servidor deja resuelto su identificador:
 *  · si contesta que ese identificador ya no sirve (se canceló, o lo ocupa otro envío), ya está
 *    resuelto: nada con este contenido va a entrar con él;
 *  · con cualquier otra regla, esa petición no entró, pero puede haber otra igual en camino —un
 *    intento anterior, u otra pestaña con lo mismo guardado—. Se pide cancelar el envío. Si queda
 *    cancelado, se suelta. Si el servidor dice que el identificador ya había entrado, se manda la
 *    acción otra vez: si era esta captura, devuelve lo que hizo; si no se puede confirmar, sigue
 *    guardada.
 *
 * `pendiente` es el envío del que no se supo, si lo hay: entonces se manda ese. Si no, se arma uno
 * con `nuevo`. `aparte` es lo que viaja y no se guarda: la clave de quien autoriza.
 */
export async function enviar<R, P extends Pendiente<object>>(
  camino: string, pendiente: P | null, nuevo: () => P, guardar: (pendiente: P | null) => void, aparte: object = {},
): Promise<R | null> {
  const envio = pendiente ?? nuevo();
  const mandar = (): Promise<R> => pedir<R>("POST", camino, { id: envio.id, ...envio.cuerpo, ...aparte });
  /** Suelta la captura si el servidor ya tiene resuelto el identificador; y deja pasar el rechazo. */
  const rechazada = (e: unknown): never => {
    if (identificadorResuelto(e)) guardar(null);
    throw e;
  };
  guardar(envio);
  try {
    return await mandar();
  } catch (e) {
    if (e instanceof ErrorDeApi && e.codigo === "RED") return null;
    if (!rechazoConRegla(e) || identificadorResuelto(e)) return rechazada(e);
    let resuelto: "entro" | "cancelado";
    try {
      resuelto = await cancelarEnvio(envio.id);
    } catch {
      throw e;      // no se pudo resolver: sigue guardada
    }
    if (resuelto === "cancelado") {
      guardar(null);
      throw e;
    }
    try {
      return await mandar();
    } catch (otra) {
      return rechazada(otra);
    }
  }
}

export function ElegirMaterial(p: {
  pregunta: string; familias: Familia[]; nota?: (m: MaterialEnExistencia) => string; excluir?: number[];
  alElegir: (m: Elegido) => void; cancelar: string; alCancelar: () => void;
}) {
  const [familia, setFamilia] = useState(p.familias[0]?.id ?? 0);
  const materiales = (p.familias.find((f) => f.id === familia)?.materiales ?? []).filter((m) => !p.excluir?.includes(m.id));
  return (
    <div className="card">
      <div className="pad">
        <p className="lbl">{p.pregunta}</p>
        <div className="chips">
          {p.familias.map((f) => (
            <button key={f.id} type="button" className="chip" aria-pressed={f.id === familia} onClick={() => setFamilia(f.id)}>{f.nombre}</button>
          ))}
        </div>
        <div className="grid">
          {materiales.map((m) => (
            <button key={m.id} type="button" className="mat" onClick={() => p.alElegir({ id: m.id, nombre: m.nombre })}>
              <b>{m.nombreCorto}</b>
              <span>{p.nota ? p.nota(m) : `hay ${kilosCortos(m.kg)} kg`}</span>
            </button>
          ))}
        </div>
        {materiales.length === 0 ? <p className="empty">No queda ningún material de esta familia por elegir.</p> : null}
        <button className="btn ghostbtn chico" type="button" onClick={p.alCancelar}>{p.cancelar}</button>
      </div>
    </div>
  );
}

export function TeclearKilos(p: {
  titulo: string; subtitulo?: string; pregunta: string; nombre: string; valor: string; alCambiar: (valor: string) => void;
  listo: boolean; boton: string; alSeguir: () => void; ocupado?: boolean; aviso?: string;
  cancelar: string; alCancelar: () => void; children?: ReactNode;
}) {
  return (
    <div className="card">
      <div className="pad">
        <p className="que"><b>{p.titulo}</b>{p.subtitulo ? <span>{p.subtitulo}</span> : null}</p>
        <p className="lbl">{p.pregunta}</p>
        <Visor nombre={p.nombre} valor={p.valor} />
        <Teclado valor={p.valor} alCambiar={p.alCambiar} decimales={3} enteros={6} alTerminar={() => { if (p.listo && !p.ocupado) p.alSeguir(); }} />
        {p.children}
        {p.aviso ? <div className="flag" role="alert">{p.aviso}</div> : null}
        <button className="btn" type="button" disabled={!p.listo || p.ocupado} onClick={p.alSeguir}>{p.boton}</button>
        <button className="btn ghostbtn chico" type="button" disabled={p.ocupado} onClick={p.alCancelar}>{p.cancelar}</button>
      </div>
    </div>
  );
}

/** Un motivo: los de siempre, a un toque; o escribir otro. */
export function Motivo(p: { opciones: string[]; valor: string; alCambiar: (valor: string) => void }) {
  const esOtro = p.valor !== "" && !p.opciones.includes(p.valor);
  const [escribiendo, setEscribiendo] = useState(esOtro);
  return (
    <>
      <div className="chips" role="group" aria-label="Motivo">
        {p.opciones.map((o) => (
          <button key={o} type="button" className="chip" aria-pressed={!escribiendo && p.valor === o} onClick={() => { setEscribiendo(false); p.alCambiar(o); }}>{o}</button>
        ))}
        <button type="button" className="chip" aria-pressed={escribiendo} onClick={() => { setEscribiendo(true); p.alCambiar(""); }}>Otro</button>
      </div>
      {escribiendo ? (
        <input className="campo" aria-label="Otro motivo" placeholder="Escribe el motivo" maxLength={200} value={p.valor} onChange={(e) => p.alCambiar(e.target.value)} />
      ) : null}
    </>
  );
}

/** Lo que se muestra mientras hay un envío sin resultado: no se edita nada, se manda ese mismo otra vez. */
export function Incierto(p: { que: string; ocupado: boolean; aviso: string; alReintentar: () => void }) {
  if (p.ocupado) return <p className="cargando">Registrando…</p>;
  return (
    <>
      <div className="flag" role="alert">
        <b>No se supo si {p.que} se guardó.</b> No lo captures otra vez: vuelve a intentar, y si ya había entrado no se registra dos veces.
      </div>
      {p.aviso ? <div className="flag" role="alert">{p.aviso}</div> : null}
      <button className="btn" type="button" onClick={p.alReintentar}>Volver a intentar</button>
    </>
  );
}
