"use client";
// Las personas que pueden entrar, para el responsable que las administra: dar de alta a alguien de
// mostrador, de patio o de consulta, cambiarle la clave y darlo de baja; y a quien es de mostrador,
// darle o quitarle el permiso de hacer el corte del cajón. Los responsables y quien administra se
// ven aquí, pero se tocan solo por la consola.
import { useState } from "react";
import { NOMBRE_DE_ROL } from "../formato.ts";
import type { Pedido } from "./ConTuClave.tsx";
import type { PersonaAdministrada, UnaVez } from "./tipos.ts";

const ROLES: Array<{ rol: string; nombre: string; que: string }> = [
  { rol: "mostrador", nombre: "Mostrador", que: "Atiende, cobra, imprime y cierra el día." },
  { rol: "patio", nombre: "Patio", que: "Arma cuentas y pesa. No cobra." },
  { rol: "consulta", nombre: "Consulta", que: "Solo ve: los precios, el cierre y el panel." },
];

/** Lo que hay que saber de esa persona de un vistazo. */
function estado(p: PersonaAdministrada): string {
  const partes = [NOMBRE_DE_ROL[p.rol] ?? p.rol];
  if (p.puedeAutorizar) partes.push("autoriza");
  // Los responsables siempre hacen el corte: se dice solo de quien es de mostrador.
  if (p.haceCorte && p.rol === "mostrador") partes.push("hace el corte");
  if (p.adentroDe) partes.push(`está adentro, en ${p.adentroDe}`);
  if (p.bloqueada) partes.push("bloqueada por intentos: se le quita cambiándole la clave");
  if (!p.seAdministra) partes.push("se cambia por la consola");
  return partes.join(" · ");
}

export function Personas({ personas, pedirlo, alVer }: { personas: PersonaAdministrada[]; pedirlo: (p: Pedido) => void; alVer: (s: UnaVez) => void }) {
  const [dando, setDando] = useState(false);
  const [nombre, setNombre] = useState("");
  const [rol, setRol] = useState("mostrador");
  const activas = personas.filter((p) => p.activa);
  const deBaja = personas.filter((p) => !p.activa);
  const quien = nombre.trim();

  const darDeAlta = (): void => pedirlo({
    titulo: `Dar de alta a ${quien}`,
    explicacion: `Entra como ${ROLES.find((r) => r.rol === rol)!.nombre.toLowerCase()}. Al terminar se enseña su clave, una sola vez.`,
    boton: "Dar de alta",
    camino: "/api/administracion/personas",
    cuerpo: { nombre: quien, rol },
    alLograrlo: (r: { persona: { nombre: string }; clave: string }) => {
      setDando(false);
      setNombre("");
      alVer({ titulo: `Clave de ${r.persona.nombre}`, valor: r.clave, nota: "Anótala y entrégasela en persona: no se vuelve a mostrar. Si se pierde, se le cambia.", entendido: "Ya la anoté" });
    },
  });
  const cambiarClave = (p: PersonaAdministrada): void => pedirlo({
    titulo: `Cambiar la clave de ${p.nombre}`,
    explicacion: "Su clave de ahora deja de servir y, si está adentro, se le saca. Al terminar se enseña la nueva, una sola vez.",
    boton: "Cambiar la clave",
    camino: `/api/administracion/personas/${p.id}/clave`,
    cuerpo: {},
    alLograrlo: (r: { clave: string }) => alVer({ titulo: `Clave nueva de ${p.nombre}`, valor: r.clave, nota: "Anótala y entrégasela en persona: no se vuelve a mostrar.", entendido: "Ya la anoté" }),
  });
  const permisoDeCorte = (p: PersonaAdministrada, puede: boolean): void => pedirlo({
    titulo: puede ? `Dar a ${p.nombre} el permiso de corte` : `Quitar a ${p.nombre} el permiso de corte`,
    explicacion: puede
      ? `${p.nombre} podrá contar el cajón al cerrar el día y firmar el corte con su clave. Queda en la bitácora.`
      : `${p.nombre} ya no podrá firmar el corte. Lo que ya firmó se conserva.`,
    boton: puede ? "Dar el permiso" : "Quitar el permiso",
    camino: `/api/administracion/personas/${p.id}/corte`,
    cuerpo: { puede },
    alLograrlo: () => {},
  });
  const darDeBaja = (p: PersonaAdministrada): void => pedirlo({
    titulo: `Dar de baja a ${p.nombre}`,
    explicacion: `${p.nombre} ya no podrá entrar y, si está adentro, se le saca. Lo que hizo se conserva. Para que vuelva hay que darle de alta otra vez.`,
    boton: "Dar de baja",
    camino: `/api/administracion/personas/${p.id}/baja`,
    cuerpo: {},
    alLograrlo: () => {},
  });

  return (
    <>
      <div className="card">
        <header><h2>Personas</h2><small>{activas.length} {activas.length === 1 ? "activa" : "activas"}</small></header>
        <div className="pad">
          {activas.map((p) => (
            <div className="administrado" key={p.id}>
              <b>{p.nombre}</b>
              <small>{estado(p)}</small>
              {p.seAdministra ? (
                <div className="dos">
                  <button className="btn ghostbtn chico" type="button" aria-label={`Cambiar la clave de ${p.nombre}`} onClick={() => cambiarClave(p)}>Cambiar clave</button>
                  <button className="btn ghostbtn chico" type="button" aria-label={`Dar de baja a ${p.nombre}`} onClick={() => darDeBaja(p)}>Dar de baja</button>
                </div>
              ) : null}
              {p.seAdministra && p.rol === "mostrador" ? (
                <button
                  className="btn ghostbtn chico" type="button" onClick={() => permisoDeCorte(p, !p.haceCorte)}
                  aria-label={p.haceCorte ? `Quitar a ${p.nombre} el permiso de corte` : `Dar a ${p.nombre} el permiso de corte`}
                >
                  {p.haceCorte ? "Quitar el permiso de corte" : "Dar permiso de corte"}
                </button>
              ) : null}
            </div>
          ))}
          {dando ? null : <button className="btn" type="button" onClick={() => setDando(true)}>Dar de alta a una persona</button>}
          <p className="note">A un responsable y a quien administra se les da de alta, se les cambia la clave y se les da de baja por la consola, no desde aquí. Los responsables siempre pueden hacer el corte; a alguien de mostrador se le da el permiso aquí.</p>
        </div>
      </div>

      {dando ? (
        <div className="card">
          <header><h2>Persona nueva</h2></header>
          <div className="pad">
            <label>
              <span className="lbl">Cómo se llama</span>
              <input className="campo" type="text" value={nombre} maxLength={40} autoComplete="off" autoCapitalize="words" enterKeyHint="done" onChange={(e) => setNombre(e.target.value)} />
            </label>
            <p className="lbl sep">Qué va a hacer</p>
            <div className="chips" role="group" aria-label="Qué va a hacer">
              {ROLES.map((r) => <button key={r.rol} type="button" className="chip" aria-pressed={r.rol === rol} onClick={() => setRol(r.rol)}>{r.nombre}</button>)}
            </div>
            <p className="note primera">{ROLES.find((r) => r.rol === rol)!.que}</p>
            <button className="btn" type="button" disabled={quien === ""} onClick={darDeAlta}>Dar de alta a {quien || "…"}</button>
            <button className="btn ghostbtn" type="button" onClick={() => { setDando(false); setNombre(""); }}>No dar de alta a nadie</button>
          </div>
        </div>
      ) : null}

      {deBaja.length > 0 ? (
        <div className="card">
          <header><h2>Dadas de baja</h2><small>{deBaja.length}</small></header>
          <div className="pad">
            {deBaja.map((p) => <div className="administrado" key={p.id}><b>{p.nombre}</b><small>{NOMBRE_DE_ROL[p.rol] ?? p.rol} · ya no entra</small></div>)}
          </div>
        </div>
      ) : null}
    </>
  );
}
