"use client";
// El catálogo de materiales, para un responsable: dar de alta uno, darlo de baja, reactivarlo y
// marcarlo o no como frecuente. El nombre de un material no se cambia: el comprobante se rearma
// del libro y toma el nombre de hoy, así que renombrar cambiaría lo que dicen los comprobantes
// viejos. Para otro nombre se da de baja uno y se da de alta otro. Las reglas —quién, y que no se
// dé de baja lo que todavía hay en el patio— las cuida la base (migración 0030).
import { useCallback, useEffect, useRef, useState } from "react";
import { pedir } from "../cliente.ts";
import { kilosCortos } from "../formato.ts";

interface Material {
  id: number;
  nombre: string;
  nombreCorto: string;
  familia: string;
  familiaId: number;
  frecuente: boolean;
  activo: boolean;
  existencia: string;
  enCuentasAbiertas: number;
  conPrecioHoy: boolean;
}
interface Catalogo {
  familias: Array<{ id: number; nombre: string }>;
  materiales: Material[];
}

/** Lo que hay que saber de ese material de un vistazo. */
function estado(m: Material): string {
  const partes: string[] = [];
  if (m.frecuente) partes.push("frecuente");
  partes.push(Number(m.existencia) === 0 ? "nada en el patio" : `${kilosCortos(m.existencia)} kg en el patio`);
  if (m.enCuentasAbiertas > 0) partes.push(m.enCuentasAbiertas === 1 ? "está en una cuenta abierta" : `está en ${m.enCuentasAbiertas} cuentas abiertas`);
  if (!m.conPrecioHoy) partes.push("sin precio en la lista de hoy");
  return partes.join(" · ");
}
/** Por qué no se puede dar de baja ahora; nada si sí se puede. */
function loQueLoDetiene(m: Material): string {
  if (Number(m.existencia) !== 0) return "No se puede dar de baja mientras haya en el patio: primero se vende, se da de baja del inventario o se corrige.";
  if (m.enCuentasAbiertas > 0) return "No se puede dar de baja mientras esté en una cuenta abierta.";
  return "";
}
/** Como se lee dentro de su familia: «Aluminio bote» → «Bote». Es una propuesta: se puede cambiar. */
function cortoDe(nombre: string, familia: string): string {
  const limpio = nombre.trim().replace(/ +/g, " ");
  const resto = limpio.toLowerCase().startsWith(`${familia.toLowerCase()} `) ? limpio.slice(familia.length + 1) : limpio;
  return (resto.slice(0, 1).toUpperCase() + resto.slice(1)).slice(0, 24);
}

export function Materiales() {
  const [catalogo, setCatalogo] = useState<Catalogo | null>(null);
  // Lo que se contesta a una acción va junto a lo que se tocó: quien bajó hasta el último material
  // no ve un aviso que salga arriba. `de` es el material; nada, si fue el alta o al traer la lista.
  const [dicho, setDicho] = useState<{ de: number | null; texto: string; mal: boolean } | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [porBajar, setPorBajar] = useState<number | null>(null);
  const [dando, setDando] = useState(false);
  const [familia, setFamilia] = useState<number | null>(null);
  const [nombre, setNombre] = useState("");
  const [corto, setCorto] = useState<string | null>(null);     // null: todavía es el que se propone
  const [frecuente, setFrecuente] = useState(false);

  /** Cuál fue la última petición: el catálogo de antes, si llega después, ya no se pinta. */
  const ultima = useRef(0);
  const traer = useCallback(() => {
    const esta = ++ultima.current;
    pedir<Catalogo>("GET", "/api/materiales")
      .then((r) => { if (esta === ultima.current) setCatalogo(r); })
      .catch((e: Error) => { if (esta === ultima.current) setDicho({ de: null, texto: e.message, mal: true }); });
  }, []);
  useEffect(traer, [traer]);

  /** Manda un cambio y vuelve a traer el catálogo, haya salido bien o no: lo que se ve es lo que hay. */
  const mandar = async (de: number | null, camino: string, cuerpo: Record<string, unknown>, bien: string): Promise<boolean> => {
    setOcupado(true);
    setDicho(null);
    try {
      await pedir("POST", camino, cuerpo);
      setDicho({ de, texto: bien, mal: false });
      return true;
    } catch (e) {
      setDicho({ de, texto: (e as Error).message, mal: true });
      return false;
    } finally {
      setOcupado(false);
      setPorBajar(null);
      traer();
    }
  };

  /** Lo dicho sobre ese material (o, sin material, sobre el alta y la lista), si es lo último que se dijo. */
  const loDicho = (de: number | null) => dicho?.de !== de ? null
    : dicho.mal ? <div className="flag" role="alert">{dicho.texto}</div> : <div className="okmsg" role="status">{dicho.texto}</div>;

  if (catalogo === null) return loDicho(null) ?? <p className="cargando">Un momento…</p>;

  const activos = catalogo.materiales.filter((m) => m.activo);
  const deBaja = catalogo.materiales.filter((m) => !m.activo);
  const laFamilia = catalogo.familias.find((f) => f.id === familia) ?? null;
  const elNombre = nombre.trim().replace(/ +/g, " ");
  const elCorto = corto ?? (laFamilia ? cortoDe(nombre, laFamilia.nombre) : "");
  const listo = laFamilia !== null && elNombre.length >= 2 && elCorto.trim() !== "";
  const cerrarAlta = (): void => { setDando(false); setFamilia(null); setNombre(""); setCorto(null); setFrecuente(false); };

  const darDeAlta = async (): Promise<void> => {
    if (!listo || ocupado) return;
    const bien = await mandar(null, "/api/materiales", { familia: laFamilia.id, nombre: elNombre, nombreCorto: elCorto.trim(), frecuente },
      `${elNombre} quedó dado de alta. Tendrá precio cuando lo pongas en la lista de precios: si la de hoy ya se publicó, desde la de mañana.`);
    if (bien) cerrarAlta();
  };

  return (
    <>
      {loDicho(null)}

      {dando ? (
        <div className="card">
          <header><h2>Material nuevo</h2></header>
          <div className="pad">
            <p className="lbl">De qué familia es</p>
            <div className="chips" role="group" aria-label="Familia">
              {catalogo.familias.map((f) => <button key={f.id} type="button" className="chip" aria-pressed={f.id === familia} onClick={() => setFamilia(f.id)}>{f.nombre}</button>)}
            </div>
            <label>
              <span className="lbl">Cómo se llama</span>
              <input className="campo" type="text" value={nombre} maxLength={40} autoComplete="off" autoCapitalize="sentences" enterKeyHint="done" placeholder="Aluminio bote, Cartón…" onChange={(e) => setNombre(e.target.value)} />
            </label>
            <label>
              <span className="lbl sep">Cómo se lee dentro de su familia</span>
              <input className="campo" type="text" value={elCorto} maxLength={24} autoComplete="off" autoCapitalize="sentences" enterKeyHint="done" onChange={(e) => setCorto(e.target.value)} />
            </label>
            <p className="lbl sep">¿Va entre los frecuentes del mostrador?</p>
            <div className="chips" role="group" aria-label="Frecuente">
              <button type="button" className="chip" aria-pressed={!frecuente} onClick={() => setFrecuente(false)}>No</button>
              <button type="button" className="chip" aria-pressed={frecuente} onClick={() => setFrecuente(true)}>Sí, frecuente</button>
            </div>
            <p className="note primera">El nombre ya no se podrá cambiar: escríbelo como debe salir en los comprobantes.</p>
            <button className="btn" type="button" disabled={!listo || ocupado} onClick={() => void darDeAlta()}>Dar de alta {elNombre || "…"}</button>
            <button className="btn ghostbtn" type="button" disabled={ocupado} onClick={cerrarAlta}>No dar de alta ninguno</button>
          </div>
        </div>
      ) : (
        <button className="btn arriba" type="button" onClick={() => { setDando(true); setDicho(null); }}>Dar de alta un material</button>
      )}

      {catalogo.familias.map((f) => {
        const suyos = activos.filter((m) => m.familiaId === f.id);
        if (suyos.length === 0) return null;
        return (
          <div className="card" key={f.id}>
            <header><h2>{f.nombre}</h2><small>{suyos.length} {suyos.length === 1 ? "material" : "materiales"}</small></header>
            <div className="pad">
              {suyos.map((m) => (
                <div className="administrado" key={m.id}>
                  <b>{m.nombre}</b>
                  <small>{estado(m)}</small>
                  {loDicho(m.id)}
                  {porBajar === m.id ? (
                    <>
                      <p className="note primera">¿Dar de baja {m.nombre}? Deja de ofrecerse en el mostrador y de llevar precio. Lo comprado y lo vendido se conserva, y se puede reactivar.</p>
                      <div className="dos">
                        <button className="btn chico" type="button" disabled={ocupado} onClick={() => void mandar(m.id, `/api/materiales/${m.id}`, { activo: false }, `${m.nombre} quedó dado de baja.`)}>Sí, dar de baja</button>
                        <button className="btn ghostbtn chico" type="button" disabled={ocupado} onClick={() => setPorBajar(null)}>No</button>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="dos">
                        <button className="btn ghostbtn chico" type="button" disabled={ocupado} aria-label={m.frecuente ? `Quitar ${m.nombre} de los frecuentes` : `Marcar ${m.nombre} como frecuente`}
                          onClick={() => void mandar(m.id, `/api/materiales/${m.id}`, { frecuente: !m.frecuente }, m.frecuente ? `${m.nombre} ya no está entre los frecuentes.` : `${m.nombre} quedó entre los frecuentes.`)}>
                          {m.frecuente ? "Quitar de frecuentes" : "Marcar frecuente"}
                        </button>
                        {loQueLoDetiene(m) ? null : (
                          <button className="btn ghostbtn chico" type="button" disabled={ocupado} aria-label={`Dar de baja ${m.nombre}`} onClick={() => { setPorBajar(m.id); setDicho(null); }}>Dar de baja</button>
                        )}
                      </div>
                      {loQueLoDetiene(m) ? <small className="detiene">{loQueLoDetiene(m)}</small> : null}
                    </>
                  )}
                </div>
              ))}
            </div>
          </div>
        );
      })}

      {deBaja.length > 0 ? (
        <div className="card">
          <header><h2>Dados de baja</h2><small>{deBaja.length}</small></header>
          <div className="pad">
            {deBaja.map((m) => (
              <div className="administrado" key={m.id}>
                <b>{m.nombre}</b>
                <small>{m.familia} · no se ofrece en el mostrador</small>
                {loDicho(m.id)}
                <button className="btn ghostbtn chico" type="button" disabled={ocupado} aria-label={`Reactivar ${m.nombre}`} onClick={() => void mandar(m.id, `/api/materiales/${m.id}`, { activo: true }, `${m.nombre} quedó reactivado.`)}>Reactivar</button>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <p className="note">A un material no se le cambia el nombre: los comprobantes de antes lo tomarían. Si hace falta otro nombre, se da de baja este y se da de alta otro.</p>
    </>
  );
}
