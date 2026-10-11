"use client";
// Corregir un movimiento ya asentado: se dice cómo debió quedar —de qué material y de cuántos
// kilos, o que no debió registrarse— y se autoriza. Arregla el inventario; no toca dinero.
import { useEffect, useState } from "react";
import { Autorizar } from "../Autorizar.tsx";
import type { QuienAutoriza } from "../Autorizar.tsx";
import { ErrorDeApi, cancelarEnvio, identificador, pedir } from "../cliente.ts";
import { fechaCorta, kilos } from "../formato.ts";
import { ElegirMaterial, Motivo, TeclearKilos, enviar, useAccion } from "./piezas.tsx";
import type { Pendiente } from "./piezas.tsx";
import { comoTexto, kilosOCero, nombreDeMovimiento } from "./tipos.ts";
import type { Elegido, Familia } from "./tipos.ts";

export interface EstadoDeCorreccion {
  paso: "forma" | "material" | "kilos" | "autorizar";
  /** El movimiento que se corrige, como se vio: sus correcciones son las que se mandan al autorizar. */
  movimiento: { id: string; tipo: string; folio: string | null; fecha: string; hora: string; correcciones: number };
  /** De qué material y de cuántos kilos cuenta hoy. Sin material: quedó sin efecto. */
  hoy: { material: Elegido | null; kg: string };
  /** Cómo debió quedar. */
  material: Elegido;
  kg: string;
  anular: boolean;
  motivo: string;
  /**
   * La corrección que ya salió y de la que todavía no se sabe, con quien la autorizó: mientras
   * esté, no se cambia nada y se le pide la clave otra vez a esa misma persona. La clave no se guarda.
   */
  pendiente: (Pendiente<{ movimiento: string; material: number; kg: string; vistas: number; motivo: string; autoriza: string }> & { quien: QuienAutoriza }) | null;
}

const MOTIVOS = ["Se eligió otro material", "Se tecleó mal el peso", "Se registró dos veces"];

export function Corregir(p: {
  e: EstadoDeCorreccion; poner: (cambio: Partial<EstadoDeCorreccion>) => void; familias: Familia[];
  alTerminar: (mensaje: string) => void; alSalir: (aviso?: string) => void;
}) {
  const { e, poner } = p;
  const { ocupado, aviso, setAviso, hacer } = useAccion();
  const [quienes, setQuienes] = useState<QuienAutoriza[] | null>(null);

  // Quiénes pueden autorizar: se pide al llegar a ese paso, y otra vez cuando un envío se suelta.
  const hayPendiente = Boolean(e.pendiente);
  useEffect(() => {
    if (e.paso !== "autorizar") return;
    pedir<{ personas: QuienAutoriza[] }>("GET", "/api/inventario/autorizan").then((r) => setQuienes(r.personas)).catch(() => setQuienes([]));
  }, [e.paso, hayPendiente]);

  const pendiente = e.pendiente ?? null;

  if (e.paso === "material" && !pendiente) {
    return (
      <ElegirMaterial
        pregunta="¿De qué material era en realidad?" familias={p.familias}
        alElegir={(material) => poner({ material, paso: "forma" })} cancelar="Regresar" alCancelar={() => poner({ paso: "forma" })}
      />
    );
  }
  if (e.paso === "kilos" && !pendiente) {
    return (
      <TeclearKilos
        titulo={e.material.nombre} pregunta="¿Cuántos kilos eran en realidad?" nombre="Kilos correctos" valor={e.kg} alCambiar={(kg) => poner({ kg })}
        listo={kilosOCero(e.kg) && e.kg !== ""} boton="Listo" alSeguir={() => poner({ paso: "forma", anular: Number(e.kg) === 0 })}
        cancelar="Regresar" alCancelar={() => poner({ paso: "forma" })}
      />
    );
  }

  const kgCorrectos = e.anular ? "0" : comoTexto(e.kg);
  const comoQueda = e.anular ? "sin efecto en el inventario" : `${e.material.nombre}, ${kilos(kgCorrectos)} kg`;

  if (e.paso === "autorizar") {
    /** Que autorice otra persona un envío del que no se supo: primero se resuelve ese envío (ver `soltar` en Contar). */
    const soltar = (): Promise<void> =>
      hacer(async () => {
        if (!pendiente) return;
        if ((await cancelarEnvio(pendiente.id)) === "entro") p.alTerminar(`Esa corrección ya había quedado registrada: quedó ${comoQueda}.`);
        else poner({ pendiente: null });
      });

    const autorizar = (quien: QuienAutoriza, clave: string): Promise<void> =>
      hacer(async () => {
        let suelto = false;
        const nuevo = (): NonNullable<EstadoDeCorreccion["pendiente"]> => ({
          id: identificador(), quien,
          cuerpo: {
            movimiento: e.movimiento.id, material: e.material.id, kg: kgCorrectos, vistas: e.movimiento.correcciones,
            motivo: e.motivo, autoriza: quien.id,
          },
        });
        try {
          const r = await enviar<object, NonNullable<EstadoDeCorreccion["pendiente"]>>(
            "/api/inventario/correccion", pendiente, nuevo, (queda) => { suelto = queda === null; poner({ pendiente: queda }); }, { clave },
          );
          if (r) p.alTerminar(`Corrección registrada: quedó ${comoQueda}.`);
        } catch (err) {
          if (err instanceof ErrorDeApi && err.codigo === "RC011" && suelto) {
            // Alguien más corrigió este movimiento mientras tanto: se vuelve a ver cómo quedó antes de corregir.
            p.alSalir("Ese movimiento se corrigió mientras lo tenías abierto. Míralo como quedó antes de corregirlo otra vez.");
            return;
          }
          throw err;
        }
      });
    return (
      <Autorizar
        titulo="Autorizar la corrección"
        explicacion={pendiente && !ocupado
          ? "No se supo si la corrección se registró. Teclea la clave otra vez: si ya había entrado, no se corrige dos veces."
          : `Quedará ${comoQueda}. Motivo: ${e.motivo}.`}
        personas={quienes} quien={pendiente?.quien} alSoltar={soltar} boton={(nombre) => `Autorizar a nombre de ${nombre}`} cancelar="Regresar"
        aviso={aviso} ocupado={ocupado} alAutorizar={autorizar} alCancelar={() => { setAviso(""); poner({ paso: "forma" }); }}
      />
    );
  }

  return (
    <div className="card">
      <header>
        <h2>Corregir {nombreDeMovimiento(e.movimiento).toLowerCase()}</h2>
        <small>{e.movimiento.folio ? `Folio ${e.movimiento.folio} · ` : ""}{fechaCorta(e.movimiento.fecha)}, {e.movimiento.hora}</small>
      </header>
      <div className="pad">
        <p className="note" style={{ marginTop: 0 }}>
          Hoy cuenta como: <b>{e.hoy.material ? `${e.hoy.material.nombre}, ${kilos(e.hoy.kg)} kg` : "nada: quedó sin efecto"}</b>.
        </p>
        <p className="lbl" style={{ marginTop: 14 }}>¿Cómo debió quedar?</p>
        <div className="ren">
          <div className="rn"><b>Material</b><small>{e.anular ? "—" : e.material.nombre}</small></div>
          <button className="quitar" type="button" disabled={e.anular || pendiente !== null} onClick={() => poner({ paso: "material" })}>Cambiar material</button>
        </div>
        <div className="ren">
          <div className="rn"><b>Kilos</b><small>{e.anular ? "—" : `${kilos(kgCorrectos)} kg`}</small></div>
          <button className="quitar" type="button" disabled={e.anular || pendiente !== null} onClick={() => poner({ paso: "kilos", kg: "" })}>Cambiar kilos</button>
        </div>
        <button className="btn ghostbtn chico" type="button" aria-pressed={e.anular} disabled={pendiente !== null} onClick={() => poner({ anular: !e.anular, kg: e.anular ? e.hoy.kg : e.kg })}>
          {e.anular ? "Sí debió registrarse: quitar esta marca" : "No debió registrarse"}
        </button>

        {pendiente ? (
          <div className="flag" role="alert"><b>No se supo si esta corrección se registró.</b> No la cambies: vuelve a autorizarla, y si ya había entrado no se corrige dos veces.</div>
        ) : (
          <>
            <p className="lbl" style={{ marginTop: 16 }}>¿Por qué se corrige?</p>
            <Motivo opciones={MOTIVOS} valor={e.motivo} alCambiar={(motivo) => poner({ motivo })} />
          </>
        )}

        <div className="flag">
          <b>Esto corrige el inventario.</b> El comprobante y lo que se pagó o se cobró no cambian.
        </div>
        {aviso ? <div className="flag" role="alert">{aviso}</div> : null}
        <button className="btn" type="button" disabled={e.motivo.trim() === ""} onClick={() => { setAviso(""); poner({ paso: "autorizar" }); window.scrollTo(0, 0); }}>
          Autorizar: quedará {comoQueda}
        </button>
        {!pendiente ? <button className="btn ghostbtn chico" type="button" onClick={() => p.alSalir()}>No corregir</button> : null}
      </div>
    </div>
  );
}
