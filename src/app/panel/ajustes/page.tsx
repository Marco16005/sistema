"use client";
// Los ajustes: lo que antes solo se hacía por la consola o por migración y el dueño decidió poder
// hacer desde la pantalla (12 de octubre de 2026). Personas y equipos, para el responsable
// facultado para autorizar y con su clave cada vez —los responsables mismos siguen siendo de la
// consola—; y el catálogo de materiales y los clientes con precio especial (13 de octubre), para
// cualquier responsable.
import { useCallback, useEffect, useRef, useState } from "react";
import { Clientes } from "../../../componentes/ajustes/Clientes.tsx";
import { SeVeUnaVez, usePedidoConClave } from "../../../componentes/ajustes/ConTuClave.tsx";
import { Equipos } from "../../../componentes/ajustes/Equipos.tsx";
import { Materiales } from "../../../componentes/ajustes/Materiales.tsx";
import { Personas } from "../../../componentes/ajustes/Personas.tsx";
import type { EquipoAdministrado, PersonaAdministrada, UnaVez } from "../../../componentes/ajustes/tipos.ts";
import { pedir } from "../../../componentes/cliente.ts";
import { Secciones } from "../../../componentes/panel/Secciones.tsx";
import { useSesion } from "../../../componentes/Sesion.tsx";

type Parte = "personas" | "equipos" | "materiales" | "clientes";
const PARTES: Array<[Parte, string]> = [["personas", "Personas"], ["equipos", "Equipos"], ["materiales", "Materiales"], ["clientes", "Clientes"]];

export default function PantallaDeAjustes() {
  const { persona } = useSesion();
  const responsable = persona.rol === "responsable";
  const facultado = responsable && persona.puedeAutorizar;
  // Quien no está facultado empieza en lo que sí le toca: los materiales.
  const [parte, setParte] = useState<Parte>(facultado ? "personas" : "materiales");
  const [datos, setDatos] = useState<{ personas: PersonaAdministrada[]; equipos: EquipoAdministrado[] } | null>(null);
  const [aviso, setAviso] = useState("");
  const [unaVez, setUnaVez] = useState<UnaVez | null>(null);

  /** Cuál fue la última petición: la lista de antes, si llega después, ya no se pinta. */
  const ultima = useRef(0);
  const traer = useCallback(() => {
    if (!facultado) return;
    const esta = ++ultima.current;
    pedir<{ personas: PersonaAdministrada[]; equipos: EquipoAdministrado[] }>("GET", "/api/administracion")
      .then((r) => { if (esta === ultima.current) { setDatos(r); setAviso(""); } })
      .catch((e: Error) => { if (esta === ultima.current) setAviso(e.message); });
  }, [facultado]);
  // Al llegar y al volver a la pestaña: quién está adentro cambia sin que esta pantalla lo sepa.
  useEffect(() => {
    traer();
    const alVolver = (): void => { if (document.visibilityState === "visible") traer(); };
    document.addEventListener("visibilitychange", alVolver);
    return () => document.removeEventListener("visibilitychange", alVolver);
  }, [traer]);

  const { pedirlo, hoja, noSeSupo } = usePedidoConClave(persona.nombre, traer);

  if (!responsable) return <div className="card"><p className="empty">Los ajustes son de un responsable.</p></div>;

  return (
    <div className="angosto" style={{ margin: "0 auto" }}>
      <Secciones />
      <div className="top"><h2>Ajustes</h2></div>
      <div className="chips" role="group" aria-label="Qué se ajusta">
        {PARTES.map(([cual, nombre]) => (
          // Al cambiar de parte se vuelve a preguntar: un equipo que se dio de alta con el código pedido aquí aparece al mirar.
          <button key={cual} type="button" className="chip" aria-pressed={cual === parte} onClick={() => { setParte(cual); traer(); }}>{nombre}</button>
        ))}
      </div>
      {hoja}
      {unaVez ? <SeVeUnaVez {...unaVez} alEntender={() => setUnaVez(null)} /> : null}
      {noSeSupo ? <div className="flag" role="alert">{noSeSupo}</div> : null}
      {aviso ? <div className="flag" role="alert">{aviso}</div> : null}

      {parte === "materiales" ? <Materiales /> : parte === "clientes" ? <Clientes /> : !facultado ? (
        <div className="card"><p className="empty">Dar de alta y de baja personas y equipos le toca a un responsable facultado para autorizar.</p></div>
      ) : datos === null ? (aviso ? null : <p className="cargando">Un momento…</p>) : parte === "personas" ? (
        <Personas personas={datos.personas} pedirlo={pedirlo} alVer={setUnaVez} />
      ) : (
        <Equipos equipos={datos.equipos} pedirlo={pedirlo} alVer={setUnaVez} />
      )}
    </div>
  );
}
