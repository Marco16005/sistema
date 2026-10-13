"use client";
// Los equipos que pueden usar el sistema: solo desde uno dado de alta se puede siquiera teclear una
// clave. Aquí se pide el código para dar de alta uno nuevo y se da de baja el que ya no se usa.
import { useState } from "react";
import { fechaCorta } from "../formato.ts";
import type { Pedido } from "./ConTuClave.tsx";
import type { EquipoAdministrado, UnaVez } from "./tipos.ts";

/** XXXXX-XXXXX: como se lee y se dicta mejor. */
const enDos = (codigo: string): string => `${codigo.slice(0, 5)}-${codigo.slice(5)}`;

export function Equipos({ equipos, pedirlo, alVer }: { equipos: EquipoAdministrado[]; pedirlo: (p: Pedido) => void; alVer: (s: UnaVez) => void }) {
  const [dando, setDando] = useState(false);
  const [nombre, setNombre] = useState("");
  const activos = equipos.filter((e) => e.activo);
  const deBaja = equipos.filter((e) => !e.activo);
  const cual = nombre.trim();

  const pedirCodigo = (): void => pedirlo({
    titulo: `Dar de alta el equipo ${cual}`,
    explicacion: "Se genera un código para teclearlo en la pantalla del equipo nuevo. Sirve una vez y vence en 15 minutos.",
    boton: "Pedir el código",
    camino: "/api/administracion/equipos",
    cuerpo: { nombre: cual },
    alLograrlo: (r: { codigo: string }) => {
      setDando(false);
      setNombre("");
      alVer({
        titulo: `Código para ${cual}`, valor: enDos(r.codigo), entendido: "Listo",
        nota: "Abre el sistema en el equipo nuevo y teclea este código. Sirve una vez y vence en 15 minutos; no se vuelve a mostrar.",
      });
    },
  });
  const darDeBaja = (e: EquipoAdministrado): void => pedirlo({
    titulo: `Dar de baja el equipo ${e.nombre}`,
    explicacion: `Desde ${e.nombre} ya no se podrá entrar${e.atiende ? `, y a ${e.atiende}, que está adentro, se le saca` : ""}. Para volver a usarlo hay que darlo de alta con un código nuevo.`,
    boton: "Dar de baja",
    camino: `/api/administracion/equipos/${e.id}/baja`,
    cuerpo: {},
    alLograrlo: () => {},
  });

  return (
    <>
      <div className="card">
        <header><h2>Equipos</h2><small>{activos.length} {activos.length === 1 ? "en uso" : "en uso"}</small></header>
        <div className="pad">
          {activos.map((e) => (
            <div className="administrado" key={e.id}>
              <b>{e.nombre}</b>
              <small>
                {e.esEste ? "Es este equipo · " : ""}desde el {fechaCorta(e.altaEl)} · {e.atiende ? `atiende ${e.atiende}` : "nadie adentro"}
              </small>
              {e.esEste ? null : (
                <button className="btn ghostbtn chico" type="button" aria-label={`Dar de baja el equipo ${e.nombre}`} onClick={() => darDeBaja(e)}>Dar de baja</button>
              )}
            </div>
          ))}
          {dando ? null : <button className="btn" type="button" onClick={() => setDando(true)}>Dar de alta un equipo</button>}
          <p className="note">Este equipo no se da de baja desde sí mismo: se hace desde otro.</p>
        </div>
      </div>

      {dando ? (
        <div className="card">
          <header><h2>Equipo nuevo</h2></header>
          <div className="pad">
            <label>
              <span className="lbl">Cómo se va a llamar</span>
              <input className="campo" type="text" value={nombre} maxLength={40} autoComplete="off" autoCapitalize="words" enterKeyHint="done" placeholder="Oficina, Tableta del patio…" onChange={(e) => setNombre(e.target.value)} />
            </label>
            <button className="btn" type="button" disabled={cual === ""} onClick={pedirCodigo}>Pedir el código para {cual || "…"}</button>
            <button className="btn ghostbtn" type="button" onClick={() => { setDando(false); setNombre(""); }}>No dar de alta ninguno</button>
          </div>
        </div>
      ) : null}

      {deBaja.length > 0 ? (
        <div className="card">
          <header><h2>Dados de baja</h2><small>{deBaja.length}</small></header>
          <div className="pad">
            {deBaja.map((e) => <div className="administrado" key={e.id}><b>{e.nombre}</b><small>desde el {fechaCorta(e.altaEl)} · ya no entra</small></div>)}
          </div>
        </div>
      ) : null}
    </>
  );
}
