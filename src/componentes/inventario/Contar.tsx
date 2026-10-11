"use client";
// Contar un material: qué material, cuántos kilos se contaron, y —antes de autorizar— lo que el
// libro decía y la diferencia. Al autorizar, la existencia queda en lo contado.
import { useEffect, useState } from "react";
import { Autorizar } from "../Autorizar.tsx";
import type { QuienAutoriza } from "../Autorizar.tsx";
import { ErrorDeApi, cancelarEnvio, identificador, pedir } from "../cliente.ts";
import { kilos, kilosConSigno } from "../formato.ts";
import { ElegirMaterial, TeclearKilos, enviar, useAccion } from "./piezas.tsx";
import type { Pendiente } from "./piezas.tsx";
import { comoTexto, kilosOCero } from "./tipos.ts";
import type { Elegido, Familia, PreviaDeConteo } from "./tipos.ts";

export interface EstadoDeConteo {
  paso: "material" | "kilos" | "revisar" | "autorizar";
  material: Elegido | null;
  kg: string;
  /** HH:MM si no se contó ahorita; vacío si fue ahora. */
  hora: string;
  previa: PreviaDeConteo | null;
  nota: string;
  /**
   * El conteo que ya salió y del que todavía no se sabe, con quien lo autorizó: mientras esté, no
   * se cambia nada y se le pide la clave otra vez a esa misma persona. La clave no se guarda.
   */
  pendiente: (Pendiente<{ material: number; contado: string; contadoEn: string; registrado: string; nota: string | null; autoriza: string }> & { quien: QuienAutoriza }) | null;
}
export const CONTEO_NUEVO: EstadoDeConteo = { paso: "material", material: null, kg: "", hora: "", previa: null, nota: "", pendiente: null };

export function Contar(p: {
  e: EstadoDeConteo; poner: (cambio: Partial<EstadoDeConteo>) => void; familias: Familia[];
  alTerminar: (mensaje: string) => void; alSalir: () => void;
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

  if (e.paso === "material" || !e.material) {
    return (
      <ElegirMaterial
        pregunta="¿Qué material se contó?" familias={p.familias} nota={(m) => `el libro dice ${kilos(m.kg)} kg`}
        alElegir={(material) => poner({ material, paso: "kilos", kg: "", previa: null })} cancelar="Regresar a existencias" alCancelar={p.alSalir}
      />
    );
  }
  const material = e.material;

  const verDiferencia = (): Promise<void> =>
    hacer(async () => {
      const r = await pedir<{ previa: PreviaDeConteo }>("POST", "/api/inventario/conteo/previa", {
        material: material.id, contado: comoTexto(e.kg), ...(e.hora ? { hora: e.hora } : {}),
      });
      poner({ previa: r.previa, paso: "revisar" });
      window.scrollTo(0, 0);
    });

  if (e.paso === "kilos" || !e.previa) {
    return (
      <TeclearKilos
        titulo={material.nombre} pregunta="¿Cuántos kilos se contaron?" nombre="Contado" valor={e.kg} alCambiar={(kg) => poner({ kg })}
        listo={kilosOCero(e.kg) && e.kg !== ""} boton="Ver la diferencia" alSeguir={() => void verDiferencia()} ocupado={ocupado} aviso={aviso}
        cancelar="Es otro material" alCancelar={() => { setAviso(""); poner({ paso: "material" }); }}
      >
        <label className="lbl" htmlFor="hora-del-conteo" style={{ display: "block", marginTop: 14 }}>¿A qué hora se contó? Vacío: ahorita</label>
        <input id="hora-del-conteo" className="campo" type="time" value={e.hora} onChange={(ev) => poner({ hora: ev.target.value })} />
      </TeclearKilos>
    );
  }
  const previa = e.previa;
  const pendiente = e.pendiente ?? null;

  if (e.paso === "revisar") {
    return (
      <div className="card">
        <header><h2>{material.nombre}</h2><small>Contado a las {previa.hora}</small></header>
        <div className="pad">
          <div className="tot"><span>El libro decía</span><span className="n">{kilos(previa.registrado)} kg</span></div>
          <div className="tot"><span>Se contó</span><span className="n">{kilos(previa.contado)} kg</span></div>
          <div className="tot big"><span>Diferencia</span><span className="n">{kilosConSigno(previa.diferencia)} kg</span></div>
          <p className="note">Al autorizar, la existencia queda en lo contado y la diferencia queda anotada con quien la autorizó.</p>
          <label className="lbl" htmlFor="nota-del-conteo" style={{ display: "block", marginTop: 14 }}>Nota (si hace falta)</label>
          <input id="nota-del-conteo" className="campo" maxLength={200} value={e.nota} disabled={pendiente !== null} onChange={(ev) => poner({ nota: ev.target.value })} />
          {pendiente ? (
            <div className="flag" role="alert"><b>No se supo si este conteo se registró.</b> No lo cambies: vuelve a autorizarlo, y si ya había entrado no se cuenta dos veces.</div>
          ) : null}
          <button className="btn" type="button" onClick={() => { setAviso(""); poner({ paso: "autorizar" }); window.scrollTo(0, 0); }}>Autorizar el conteo</button>
          {!pendiente ? <button className="btn ghostbtn chico" type="button" onClick={() => poner({ paso: "kilos", previa: null })}>Corregir lo tecleado</button> : null}
        </div>
      </div>
    );
  }

  /**
   * Que autorice otra persona un envío del que no se supo: primero se resuelve ese envío. Si el
   * servidor dice que ya había entrado, la captura termina. Aquí no se puede pedir que la acción
   * lo confirme, porque eso lleva la clave de quien ya no está: se confía en que un identificador
   * hecho al azar por esta pantalla no lo ocupa otra cosa.
   */
  const soltar = (): Promise<void> =>
    hacer(async () => {
      if (!pendiente) return;
      if ((await cancelarEnvio(pendiente.id)) === "entro") {
        p.alTerminar(`Ese conteo ya había quedado registrado: ${material.nombre} quedó en ${kilos(previa.contado)} kg.`);
      } else poner({ pendiente: null });
    });

  const autorizar = (quien: QuienAutoriza, clave: string): Promise<void> =>
    hacer(async () => {
      let suelto = false;
      const nuevo = (): NonNullable<EstadoDeConteo["pendiente"]> => ({
        id: identificador(), quien,
        cuerpo: {
          material: material.id, contado: previa.contado, contadoEn: previa.contadoEn, registrado: previa.registrado,
          nota: e.nota.trim() === "" ? null : e.nota, autoriza: quien.id,
        },
      });
      try {
        const r = await enviar<{ conteo: { contado: string; diferencia: string } }, NonNullable<EstadoDeConteo["pendiente"]>>(
          "/api/inventario/conteo", pendiente, nuevo, (queda) => { suelto = queda === null; poner({ pendiente: queda }); }, { clave },
        );
        if (r) p.alTerminar(`Conteo registrado: ${material.nombre} quedó en ${kilos(r.conteo.contado)} kg (diferencia ${kilosConSigno(r.conteo.diferencia)} kg).`);
      } catch (err) {
        if (err instanceof ErrorDeApi && err.codigo === "RC011" && suelto) {
          // Lo que se vio ya no es lo que dice el libro: se vuelve a ver antes de autorizar.
          poner({ paso: "kilos", previa: null });
          throw new ErrorDeApi(409, "RC011", "El libro cambió desde que viste la diferencia. Vuelve a verla antes de autorizar.");
        }
        throw err;
      }
    });

  return (
    <Autorizar
      titulo={`Conteo de ${material.nombre}`}
      explicacion={pendiente && !ocupado
        ? "No se supo si el conteo se registró. Teclea la clave otra vez: si ya había entrado, no se cuenta dos veces."
        : `Se contaron ${kilos(previa.contado)} kg y el libro decía ${kilos(previa.registrado)}: diferencia de ${kilosConSigno(previa.diferencia)} kg.`}
      personas={quienes} quien={pendiente?.quien} alSoltar={soltar} boton={(nombre) => `Autorizar a nombre de ${nombre}`} cancelar="Regresar"
      aviso={aviso} ocupado={ocupado} alAutorizar={autorizar}
      alCancelar={() => { setAviso(""); poner({ paso: "revisar" }); }}
    />
  );
}
