"use client";
// Los tipos de gasto: cuáles se restan en la ganancia, cuáles siguen en uso, y dar de alta otro. Un
// tipo no se borra: se deja de usar, y sus gastos se quedan como estaban.
import { useState } from "react";
import { pedir } from "../cliente.ts";
import { useAccion } from "../inventario/piezas.tsx";
import type { TipoDeGasto } from "../panel/tipos.ts";

export function TiposDeGasto({ tipos, alCambiar }: { tipos: TipoDeGasto[]; alCambiar: () => void }) {
  const [nombre, setNombre] = useState("");
  const { ocupado, aviso, hacer } = useAccion();

  const cambiar = (t: TipoDeGasto, o: { cuenta: boolean; activo: boolean }): Promise<void> =>
    hacer(async () => {
      await pedir("POST", `/api/gastos/tipos/${t.id}`, o);
      alCambiar();
    });
  const alta = (): Promise<void> =>
    hacer(async () => {
      await pedir("POST", "/api/gastos/tipos", { nombre: nombre.trim() });
      setNombre("");
      alCambiar();
    });

  return (
    <div className="card tipos-de-gasto">
      <header><h2>Tipos de gasto</h2><small>Cuáles se restan en la ganancia</small></header>
      <div className="pad">
        {tipos.map((t) => (
          <div className="administrado" key={t.id}>
            <b>{t.nombre}</b>
            <small>{!t.activo ? "Ya no se usa" : t.cuenta ? "Se resta en la ganancia" : "No se resta en la ganancia"}</small>
            <div className="dos">
              {t.activo ? (
                <button
                  className="btn ghostbtn chico" type="button" disabled={ocupado} onClick={() => void cambiar(t, { cuenta: !t.cuenta, activo: true })}
                  aria-label={t.cuenta ? `Que ${t.nombre} no se reste en la ganancia` : `Que ${t.nombre} se reste en la ganancia`}
                >
                  {t.cuenta ? "Que no se reste" : "Que se reste"}
                </button>
              ) : null}
              <button
                className="btn ghostbtn chico" type="button" disabled={ocupado} onClick={() => void cambiar(t, { cuenta: t.cuenta, activo: !t.activo })}
                aria-label={t.activo ? `Dejar de usar ${t.nombre}` : `Volver a usar ${t.nombre}`}
              >
                {t.activo ? "Dejar de usarlo" : "Volver a usarlo"}
              </button>
            </div>
          </div>
        ))}
        <form className="alta-de-tipo" onSubmit={(e) => { e.preventDefault(); if (nombre.trim()) void alta(); }}>
          <label>
            <span className="lbl" style={{ display: "block", marginTop: 16 }}>Otro tipo de gasto</span>
            <input className="campo" type="text" value={nombre} maxLength={40} autoComplete="off" placeholder="Por ejemplo: Teléfono" onChange={(e) => setNombre(e.target.value)} />
          </label>
          <button className="btn ghostbtn" type="submit" disabled={!nombre.trim() || ocupado}>Agregar el tipo</button>
        </form>
        {aviso ? <div className="flag" role="alert">{aviso}</div> : null}
        <p className="note">Si un tipo deja de restarse, o vuelve a restarse, cambia también lo de periodos anteriores: es del tipo, no de cada gasto. Un tipo que ya no se usa no aparece al registrar, y sus gastos se quedan.</p>
      </div>
    </div>
  );
}
