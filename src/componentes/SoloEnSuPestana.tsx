"use client";
// Envuelve a las pantallas que guardan lo que está a medias (inventario, mostrador). No las deja
// aparecer —ni leer lo guardado— hasta saber que esta pestaña es la dueña de lo suyo.
import type { ReactNode } from "react";
import { usePestana } from "./pestana.ts";

export function SoloEnSuPestana({ children }: { children: ReactNode }) {
  const { estado, otraVez } = usePestana();
  if (estado === "propia") return <>{children}</>;
  if (estado === "esperando") return <p className="cargando">Un momento…</p>;
  if (estado === "enmarcada") {
    return (
      <div className="card">
        <div className="pad">
          <div className="flag" role="alert"><b>Esta pantalla no se usa dentro de otra página.</b> Ábrela en su propia pestaña.</div>
        </div>
      </div>
    );
  }
  return (
    <div className="card">
      <div className="pad">
        <div className="flag" role="alert">
          <b>No se pudo comprobar que esta pestaña sea la única con lo que estaba a medias.</b> Para no registrar algo dos veces,
          aquí no se captura hasta saberlo. Lo que estaba guardado no se ha tocado.
        </div>
        <button className="btn" type="button" onClick={otraVez}>Volver a comprobar</button>
      </div>
    </div>
  );
}
