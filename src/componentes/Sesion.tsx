"use client";
// Quién atiende en este equipo y en qué va el día. Envuelve a toda la aplicación: si el equipo no
// está dado de alta pide el código, si no hay nadie adentro pide la clave, y solo entonces deja
// ver lo demás. Cuando la sesión vence a media tarea vuelve a pedir la clave y, al entrar, la
// pantalla sigue donde estaba: las cuentas abiertas viven en el servidor.
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Boton, claseDeBoton } from "./base/Boton.tsx";
import { ErrorDeApi, actuarComo, avisarDelMantenimiento, avisarSiSePierdeLaSesion, pedir } from "./cliente.ts";
import { NOMBRE_DE_ROL, fechaCorta } from "./formato.ts";
import { pestanaLista } from "./pestana.ts";
import { Teclado } from "./Teclado.tsx";
import { AvisosEnLaBarra } from "./caja/Avisos.tsx";
import { ContarElCajon } from "./caja/ContarElCajon.tsx";

export type Rol = "responsable" | "mostrador" | "patio" | "consulta" | "administracion";

export interface Persona {
  id: string;
  nombre: string;
  rol: Rol;
  puedeAutorizar: boolean;
}

export interface Dia {
  hoy: string;
  arranqueTerminado: boolean;
  jornada: { id: string; fecha: string; esDeHoy: boolean; cierres: number } | null;
  /** La jornada de hoy, si ya se cerró: es la que se puede reabrir. */
  cerradaHoy: { id: string; cierre: number } | null;
  lista: { id: string; publicada: boolean; precios: number } | null;
  vehiculosPorVolver: number;
  listo: boolean;
  /** El cajón de la jornada abierta: si ya se contó al abrir, y lo que se dejó en el último corte. */
  cajon: { contado: boolean; sugerido: string | null } | null;
}

/** Quien cobra no atiende hasta que se cuenta el cajón: sin el fondo de la mañana no hay corte. */
export const faltaContarElCajon = (dia: Dia, rol: Rol): boolean => COBRAN.includes(rol) && dia.cajon !== null && !dia.cajon.contado;

interface Contexto {
  persona: Persona;
  dia: Dia;
  /** Vuelve a preguntar en qué va el día, después de una acción que lo cambia. */
  ponerDia: (dia: Dia) => void;
  recargarDia: () => Promise<void>;
}

const ContextoDeSesion = createContext<Contexto | null>(null);

export function useSesion(): Contexto {
  const c = useContext(ContextoDeSesion);
  if (!c) throw new Error("useSesion se usa dentro de <Sesion>");
  return c;
}

export const ARMAN: readonly Rol[] = ["responsable", "mostrador", "patio"];
export const COBRAN: readonly Rol[] = ["responsable", "mostrador"];
/** Quien ve el dinero de todos los días: el panel y lo que cuelga de él. */
export const DIRIGEN: readonly Rol[] = ["responsable", "consulta"];

type Estado = "cargando" | "sin-equipo" | "sin-persona" | "adentro" | "sin-servidor" | "mantenimiento";

/** Lo que va en todas las pantallas, también en las de entrada: el interruptor de contraste. */
const Ajustes = createContext<ReactNode>(null);

export function Sesion({ children, ajustes = null }: { children: ReactNode; ajustes?: ReactNode }) {
  return <Ajustes.Provider value={ajustes}><ConSesion>{children}</ConSesion></Ajustes.Provider>;
}

function ConSesion({ children }: { children: ReactNode }) {
  const ajustes = useContext(Ajustes);
  const [estado, setEstado] = useState<Estado>("cargando");
  const [persona, setPersona] = useState<Persona | null>(null);
  const [dia, setDia] = useState<Dia | null>(null);
  /** A media tarea, el servidor dijo que está en mantenimiento: se avisa arriba, sin quitar nada de la pantalla. */
  const [enMantenimiento, setEnMantenimiento] = useState(false);
  const router = useRouter();
  /** Quién atendía antes de que se pidiera la clave. */
  const anterior = useRef<string | null>(null);

  const cargar = useCallback(async (): Promise<Persona | null> => {
    try {
      const s = await pedir<{ persona: Persona | null }>("GET", "/api/sesion");
      if (!s.persona) {
        actuarComo(null);
        setPersona(null);
        setEstado("sin-persona");
        return null;
      }
      actuarComo(s.persona.id);
      const d = await pedir<{ dia: Dia }>("GET", "/api/dia");
      setPersona(s.persona);
      setDia(d.dia);
      setEstado("adentro");
      return s.persona;
    } catch (e) {
      if (e instanceof ErrorDeApi && e.codigo === "EQUIPO") setEstado("sin-equipo");
      else if (e instanceof ErrorDeApi && e.codigo === "SESION") setEstado("sin-persona");
      else if (e instanceof ErrorDeApi && e.codigo === "MANTENIMIENTO") setEstado("mantenimiento");
      else setEstado("sin-servidor");
      return null;
    }
  }, []);

  /** Después de teclear la clave: quien vuelve se queda donde estaba; quien llega va a su pantalla. */
  const alEntrar = useCallback(async () => {
    const quien = await cargar();
    if (quien && quien.id !== anterior.current) router.replace("/");
    if (quien) anterior.current = quien.id;
  }, [cargar, router]);

  useEffect(() => {
    // Toda pestaña se da a conocer al cargar, esté en la pantalla que esté: así una copia suya la encuentra.
    void pestanaLista();
  }, []);

  useEffect(() => {
    // Cualquier petición puede descubrir que la sesión ya no vale: se vuelve a preguntar quién atiende.
    avisarSiSePierdeLaSesion(() => void cargar());
    avisarDelMantenimiento(setEnMantenimiento);
    void cargar().then((quien) => { if (quien) anterior.current = quien.id; });
  }, [cargar]);

  const recargarDia = useCallback(async () => {
    setDia((await pedir<{ dia: Dia }>("GET", "/api/dia")).dia);
  }, []);

  const salir = async (): Promise<void> => {
    try {
      await pedir("POST", "/api/sesion/salir");
    } finally {
      await cargar();
    }
  };

  const contexto = useMemo(
    () => (persona && dia ? { persona, dia, ponerDia: setDia, recargarDia } : null),
    [persona, dia, recargarDia],
  );

  if (estado === "cargando") return <div className="entrada">{ajustes}<p className="cargando">Un momento…</p></div>;
  if (estado === "sin-servidor") {
    return (
      <div className="entrada">
        {ajustes}
        <h1>Sin conexión</h1>
        <p className="sub">No se pudo hablar con el servidor.</p>
        <Boton onClick={() => void cargar()}>Volver a intentar</Boton>
      </div>
    );
  }
  if (estado === "mantenimiento") {
    return (
      <div className="entrada">
        {ajustes}
        <h1>En mantenimiento</h1>
        <p className="sub">Estamos actualizando el sistema. No se perdió nada de lo que ya estaba guardado: espera unos minutos y vuelve a intentar.</p>
        <Boton onClick={() => void cargar()}>Volver a intentar</Boton>
      </div>
    );
  }
  if (estado === "sin-equipo") return <AltaDeEquipo alTerminar={async () => { await cargar(); }} />;
  if (estado === "sin-persona" || !contexto) return <Entrar alEntrar={alEntrar} />;

  return (
    <ContextoDeSesion.Provider value={contexto}>
      <Barra persona={contexto.persona} dia={contexto.dia} alSalir={salir} />
      {enMantenimiento ? (
        <div className="en-mantenimiento" role="status">
          <b>El sistema está en mantenimiento.</b> Lo que tienes a medias sigue aquí: espera unos minutos y vuelve a intentar.
        </div>
      ) : null}
      {children}
    </ContextoDeSesion.Provider>
  );
}

// ── dar de alta el equipo ──────────────────────────────────────────────────

function AltaDeEquipo({ alTerminar }: { alTerminar: () => Promise<void> }) {
  const ajustes = useContext(Ajustes);
  const [codigo, setCodigo] = useState("");
  const [aviso, setAviso] = useState("");
  const [enviando, setEnviando] = useState(false);

  const enviar = async (): Promise<void> => {
    setEnviando(true);
    setAviso("");
    try {
      await pedir("POST", "/api/equipo/alta", { codigo });
      await alTerminar();
    } catch (e) {
      setAviso((e as Error).message);
      setEnviando(false);
    }
  };

  return (
    <form className="entrada" onSubmit={(e) => { e.preventDefault(); void enviar(); }}>
      {ajustes}
      <h1>Dar de alta este equipo</h1>
      <p className="sub">Este equipo todavía no puede usar el sistema. Pide un código a quien lo administra y escríbelo aquí.</p>
      <label className="lbl" htmlFor="codigo">Código de alta</label>
      <input
        id="codigo" className="codigo" value={codigo} autoComplete="off" autoCapitalize="characters" autoCorrect="off" spellCheck={false}
        enterKeyHint="send" placeholder="XXXXX-XXXXX" maxLength={24} onChange={(e) => setCodigo(e.target.value.toUpperCase())}
      />
      {aviso ? <div className="flag" role="alert">{aviso}</div> : null}
      <Boton type="submit" disabled={enviando || codigo.replace(/[\s-]/g, "").length < 10}>Dar de alta</Boton>
    </form>
  );
}

// ── entrar con la clave ────────────────────────────────────────────────────

interface PersonaParaEntrar {
  id: string;
  nombre: string;
  rol: Rol;
}

function Entrar({ alEntrar }: { alEntrar: () => Promise<void> }) {
  const ajustes = useContext(Ajustes);
  const [personas, setPersonas] = useState<PersonaParaEntrar[] | null>(null);
  const [quien, setQuien] = useState<PersonaParaEntrar | null>(null);
  const [clave, setClave] = useState("");
  const [aviso, setAviso] = useState("");
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    pedir<{ personas: PersonaParaEntrar[] }>("GET", "/api/personas")
      .then((r) => setPersonas(r.personas))
      .catch((e: Error) => setAviso(e.message));
  }, []);

  const entrar = async (): Promise<void> => {
    if (!quien || clave.length < 4 || enviando) return;
    setEnviando(true);
    setAviso("");
    try {
      await pedir("POST", "/api/sesion/entrar", { persona: quien.id, clave });
      await alEntrar();
    } catch (e) {
      setAviso((e as Error).message);
      setClave("");
      setEnviando(false);
    }
  };

  if (!quien) {
    return (
      <div className="entrada">
        {ajustes}
        <h1>¿Quién atiende?</h1>
        <p className="sub">Toca tu nombre.</p>
        {aviso ? <div className="flag" role="alert">{aviso}</div> : null}
        {personas === null ? <p className="cargando">Un momento…</p> : null}
        {personas?.length === 0 ? <p className="empty">No hay personas dadas de alta. Las da de alta quien administra el sistema.</p> : null}
        <div className="personas">
          {personas?.map((p) => (
            <button key={p.id} type="button" className="persona" onClick={() => { setQuien(p); setAviso(""); }}>
              <i className="inicial" aria-hidden="true">{inicial(p.nombre)}</i>
              <span><b>{p.nombre}</b><small>{NOMBRE_DE_ROL[p.rol]}</small></span>
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="entrada">
      {ajustes}
      <h1>{quien.nombre}</h1>
      <p className="sub">Escribe tu clave.</p>
      <div className="puntos" role="status" aria-label={`${clave.length} dígitos escritos`}>
        {Array.from({ length: Math.max(clave.length, 4) }, (_, k) => <i key={k} className={k < clave.length ? "lleno" : ""} />)}
      </div>
      {aviso ? <div className="flag" role="alert">{aviso}</div> : null}
      <Teclado valor={clave} alCambiar={setClave} decimales={0} enteros={8} alTerminar={() => void entrar()} />
      <Boton disabled={enviando || clave.length < 4} onClick={() => void entrar()}>Entrar</Boton>
      <Boton clase="gris" onClick={() => { setQuien(null); setClave(""); setAviso(""); }}>No soy {quien.nombre}</Boton>
    </div>
  );
}

// ── la barra: qué día es, quién atiende y a dónde se puede ir ──────────────

/** La letra con que se reconoce a alguien de un vistazo. */
const inicial = (nombre: string): string => nombre.trim().slice(0, 1).toUpperCase();

function Barra({ persona, dia, alSalir }: { persona: Persona; dia: Dia; alSalir: () => Promise<void> }) {
  const ajustes = useContext(Ajustes);
  const donde = usePathname();
  const pantallas: Array<[string, string]> = [];
  if (ARMAN.includes(persona.rol)) pantallas.push(["/mostrador", "Mostrador"]);
  pantallas.push(["/inventario", "Inventario"], ["/precios", "Precios"], ["/cierre", "Cierre"]);
  if (DIRIGEN.includes(persona.rol)) pantallas.push(["/panel", "Panel"]);
  if (persona.rol === "responsable" && !dia.arranqueTerminado) pantallas.push(["/arranque", "Arranque"]);

  return (
    <>
      <header className="barra">
        <span className="dia">{fechaCorta(dia.hoy)}</span>
        {ajustes}
        <span className="quien">
          <span className="ficha">
            <i className="inicial" aria-hidden="true">{inicial(persona.nombre)}</i>
            <span><b>{persona.nombre}</b><small>{NOMBRE_DE_ROL[persona.rol]}</small></span>
          </span>
          <Boton clase="gris" corto onClick={() => void alSalir()}>Salir</Boton>
        </span>
      </header>
      <nav className="pantallas vidrio" aria-label="Pantallas">
        {pantallas.map(([ruta, nombre]) => (
          <Link key={ruta} href={ruta} aria-current={donde === ruta || donde.startsWith(`${ruta}/`) ? "true" : "false"}>{nombre}</Link>
        ))}
      </nav>
      {/* Al responsable le llegan los avisos del cajón en cuanto entra. En el panel ya están, con su botón. */}
      {persona.rol === "responsable" && !donde.startsWith("/panel") ? <AvisosEnLaBarra /> : null}
    </>
  );
}

/** Lo que falta para poder atender, con el botón que lo resuelve si a esta persona le toca. */
export function LoQueFalta({ para }: { para: "atender" | "precios" }) {
  const { persona, dia, ponerDia } = useSesion();
  const [aviso, setAviso] = useState("");
  const [enviando, setEnviando] = useState(false);

  const abrir = async (): Promise<void> => {
    setEnviando(true);
    setAviso("");
    try {
      ponerDia((await pedir<{ dia: Dia }>("POST", "/api/jornada/abrir")).dia);
    } catch (e) {
      setAviso((e as Error).message);
    } finally {
      setEnviando(false);
    }
  };

  if (dia.jornada && !dia.jornada.esDeHoy) {
    return (
      <div className="falta-dia" role="status">
        <b>Sigue abierta la jornada del {fechaCorta(dia.jornada.fecha)}</b>
        Hay que cerrarla para poder abrir la de hoy.
        <Link className={claseDeBoton()} href="/cierre">Ir al cierre</Link>
      </div>
    );
  }
  if (!dia.jornada && dia.cerradaHoy) {
    // Abrir «la de hoy» ya no se puede: existe y se cerró. Lo que cabe es reabrirla, y eso se hace en el cierre.
    return (
      <div className="falta-dia" role="status">
        <b>El día de hoy ya se cerró</b>
        {COBRAN.includes(persona.rol)
          ? "Si se cerró por error, se puede reabrir con la clave de quien autoriza."
          : "Si se cerró por error, lo reabre quien atiende el mostrador o un responsable."}
        {COBRAN.includes(persona.rol) ? <Link className={claseDeBoton()} href="/cierre">Ir al cierre</Link> : null}
      </div>
    );
  }
  if (!dia.jornada) {
    return (
      <div className="falta-dia" role="status">
        <b>La jornada de hoy no está abierta</b>
        {COBRAN.includes(persona.rol)
          ? "Al abrirla quedan listos, sin publicar, los últimos precios."
          : "La abre quien atiende el mostrador o un responsable."}
        {aviso ? <div className="flag" role="alert">{aviso}</div> : null}
        {COBRAN.includes(persona.rol)
          ? <Boton disabled={enviando} onClick={() => void abrir()}>Abrir la jornada de hoy</Boton>
          : null}
      </div>
    );
  }
  if (para === "atender" && dia.lista?.publicada && faltaContarElCajon(dia, persona.rol)) {
    return <ContarElCajon jornada={dia.jornada.id} sugerido={dia.cajon!.sugerido} alContar={ponerDia} />;
  }
  if (para === "atender" && !dia.lista?.publicada) {
    return (
      <div className="falta-dia" role="status">
        <b>Los precios de hoy no se han publicado</b>
        {persona.rol === "responsable" ? "Revísalos y publícalos para empezar a atender." : "Los publica un responsable. Mientras tanto no se puede atender."}
        {persona.rol === "responsable" ? <Link className={claseDeBoton()} href="/precios">Ir a precios</Link> : null}
      </div>
    );
  }
  return null;
}
