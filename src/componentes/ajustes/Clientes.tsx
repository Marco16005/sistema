"use client";
// Los clientes a los que se les puede dar precio especial, para un responsable: dar de alta uno
// —sin esperar a darle el primero en el mostrador—, cambiarle el nombre, darlo de baja y
// reactivarlo. Tenerlo en la lista no le da nada: cada precio especial sigue pidiendo la clave de
// quien autoriza. Dado de baja ya no se ofrece en el mostrador; lo que se le compró y vendió se
// conserva, con el nombre que tenía ese día. Las reglas las cuida la base (migraciones 0033 y 0036).
import { useCallback, useEffect, useRef, useState } from "react";
import { pedir } from "../cliente.ts";
import { fechaCorta } from "../formato.ts";
import type { ClienteDelPanel } from "../panel/tipos.ts";

/** Lo que hay que saber de ese cliente de un vistazo. */
const estado = (c: ClienteDelPanel): string => c.ultimaVez
  ? `${c.cuentas} ${c.cuentas === 1 ? "cuenta" : "cuentas"} con precio especial · la última, el ${fechaCorta(c.ultimaVez)}`
  : "todavía sin cuentas con precio especial";
const porNombre = (a: ClienteDelPanel, b: ClienteDelPanel): number => a.nombre.localeCompare(b.nombre, "es", { sensitivity: "base" });

export function Clientes() {
  const [lista, setLista] = useState<ClienteDelPanel[] | null>(null);
  // Lo que se contesta va junto a lo que se tocó. `de` es el cliente; nada, si fue el alta o al traer la lista.
  const [dicho, setDicho] = useState<{ de: string | null; texto: string; mal: boolean } | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [porBajar, setPorBajar] = useState<string | null>(null);
  // A quién se le está cambiando el nombre, y cómo va quedando.
  const [renombrando, setRenombrando] = useState<string | null>(null);
  const [otroNombre, setOtroNombre] = useState("");
  const [dando, setDando] = useState(false);
  const [nombre, setNombre] = useState("");

  /** Cuál fue la última petición: la lista de antes, si llega después, ya no se pinta. */
  const ultima = useRef(0);
  const traer = useCallback(() => {
    const esta = ++ultima.current;
    pedir<{ clientes: ClienteDelPanel[] }>("GET", "/api/clientes/resumen")
      .then((r) => { if (esta === ultima.current) setLista(r.clientes); })
      .catch((e: Error) => { if (esta === ultima.current) setDicho({ de: null, texto: e.message, mal: true }); });
  }, []);
  useEffect(traer, [traer]);

  /**
   * Manda un cambio y vuelve a traer la lista, haya salido bien o no: lo que se ve es lo que hay.
   * Lo que se dice lleva el nombre como quedó guardado, que puede no ser letra por letra el tecleado.
   */
  const mandar = async (de: string | null, camino: string, cuerpo: Record<string, unknown>, bien: (nombre: string) => string): Promise<boolean> => {
    setOcupado(true);
    setDicho(null);
    try {
      const { cliente } = await pedir<{ cliente: { nombre: string } }>("POST", camino, cuerpo);
      setDicho({ de, texto: bien(cliente.nombre), mal: false });
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

  /** Lo dicho sobre ese cliente (o, sin cliente, sobre el alta y la lista), si es lo último que se dijo. */
  const loDicho = (de: string | null) => dicho?.de !== de ? null
    : dicho.mal ? <div className="flag" role="alert">{dicho.texto}</div> : <div className="okmsg" role="status">{dicho.texto}</div>;

  if (lista === null) return loDicho(null) ?? <p className="cargando">Un momento…</p>;

  const activos = lista.filter((c) => c.activo).sort(porNombre);
  const deBaja = lista.filter((c) => !c.activo).sort(porNombre);
  const limpio = (t: string): string => t.trim().replace(/\s+/g, " ");
  const elNombre = limpio(nombre);
  const elOtro = limpio(otroNombre);
  const cerrarAlta = (): void => { setDando(false); setNombre(""); };
  const dejarElNombre = (): void => { setRenombrando(null); setOtroNombre(""); };
  const cambiarElNombre = async (c: ClienteDelPanel): Promise<void> => {
    if (elOtro === "" || elOtro === c.nombre || ocupado) return;
    const bien = await mandar(c.id, `/api/clientes/${c.id}/nombre`, { nombre: elOtro },
      (como) => `Ahora se llama ${como}. Los comprobantes ya entregados conservan el nombre de antes.`);
    // Si no se pudo —ya hay otro con ese nombre—, lo tecleado se queda para corregirlo.
    if (bien) dejarElNombre();
  };

  const darDeAlta = async (): Promise<void> => {
    if (elNombre === "" || ocupado) return;
    const bien = await mandar(null, "/api/clientes", { nombre: elNombre },
      (como) => `${como} quedó dado de alta. Ya se le puede dar precio especial en el mostrador, con la clave de quien autoriza.`);
    if (bien) cerrarAlta();
  };

  return (
    // «clientela» parte los nombres larguísimos y sin espacios donde haga falta (ajustes.css).
    <div className="clientela">
      {loDicho(null)}

      {dando ? (
        <div className="card">
          <header><h2>Cliente nuevo</h2></header>
          <div className="pad">
            <label>
              <span className="lbl">Cómo se llama</span>
              <input className="campo" type="text" value={nombre} maxLength={80} autoComplete="off" autoCapitalize="words" enterKeyHint="done" placeholder="Don Chuy, Fundidora del Norte…" onChange={(e) => setNombre(e.target.value)} />
            </label>
            <p className="note">Escríbelo como debe salir en sus comprobantes.</p>
            <button className="btn" type="button" disabled={elNombre === "" || ocupado} onClick={() => void darDeAlta()}>Dar de alta a {elNombre || "…"}</button>
            <button className="btn ghostbtn" type="button" disabled={ocupado} onClick={cerrarAlta}>No dar de alta a nadie</button>
          </div>
        </div>
      ) : (
        <button className="btn arriba" type="button" onClick={() => { setDando(true); setDicho(null); }}>Dar de alta un cliente</button>
      )}

      <div className="card">
        <header><h2>Clientes</h2><small>{activos.length === 1 ? "1 cliente" : `${activos.length} clientes`}</small></header>
        <div className="pad">
          {activos.length === 0 ? <p className="empty">Todavía no hay clientes. También se dan de alta en el mostrador, al darles su primer precio especial.</p> : null}
          {activos.map((c) => (
            <div className="administrado" key={c.id}>
              <b>{c.nombre}</b>
              <small>{estado(c)}</small>
              {loDicho(c.id)}
              {porBajar === c.id ? (
                <>
                  <p className="note primera">¿Dar de baja a {c.nombre}? Ya no se le podrá dar precio especial. Lo que se le compró y vendió se conserva, una cuenta abierta que ya lleve su precio se cobra como está, y se puede reactivar.</p>
                  <div className="dos">
                    <button className="btn chico" type="button" disabled={ocupado} onClick={() => void mandar(c.id, `/api/clientes/${c.id}`, { activo: false }, (como) => `${como} quedó dado de baja.`)}>Sí, dar de baja</button>
                    <button className="btn ghostbtn chico" type="button" disabled={ocupado} onClick={() => setPorBajar(null)}>No</button>
                  </div>
                </>
              ) : renombrando === c.id ? (
                <>
                  <label>
                    <span className="lbl sep">Cómo se llama ahora</span>
                    <input className="campo" type="text" value={otroNombre} maxLength={80} autoComplete="off" autoCapitalize="words" enterKeyHint="done" onChange={(e) => setOtroNombre(e.target.value)} />
                  </label>
                  <p className="note">Los comprobantes ya entregados conservan el nombre que tenía ese día.</p>
                  <div className="dos">
                    <button className="btn chico" type="button" disabled={elOtro === "" || elOtro === c.nombre || ocupado} onClick={() => void cambiarElNombre(c)}>Guardar el nombre</button>
                    <button className="btn ghostbtn chico" type="button" disabled={ocupado} onClick={dejarElNombre}>No cambiarlo</button>
                  </div>
                </>
              ) : (
                <div className="dos">
                  <button className="btn ghostbtn chico" type="button" disabled={ocupado} aria-label={`Cambiarle el nombre a ${c.nombre}`} onClick={() => { setRenombrando(c.id); setOtroNombre(c.nombre); setPorBajar(null); setDicho(null); }}>Cambiar el nombre</button>
                  <button className="btn ghostbtn chico" type="button" disabled={ocupado} aria-label={`Dar de baja a ${c.nombre}`} onClick={() => { setPorBajar(c.id); dejarElNombre(); setDicho(null); }}>Dar de baja</button>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {deBaja.length > 0 ? (
        <div className="card">
          <header><h2>Dados de baja</h2><small>{deBaja.length}</small></header>
          <div className="pad">
            {deBaja.map((c) => (
              <div className="administrado" key={c.id}>
                <b>{c.nombre}</b>
                <small>{estado(c)} · no se ofrece en el mostrador</small>
                {loDicho(c.id)}
                <button className="btn ghostbtn chico" type="button" disabled={ocupado} aria-label={`Reactivar a ${c.nombre}`} onClick={() => void mandar(c.id, `/api/clientes/${c.id}`, { activo: true }, (como) => `${como} quedó reactivado.`)}>Reactivar</button>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <p className="note">Un cliente también se da de alta en el mostrador, al darle su primer precio especial. Lo que se le ha comprado y vendido a cada uno está en Clientes, en el panel.</p>
    </div>
  );
}
