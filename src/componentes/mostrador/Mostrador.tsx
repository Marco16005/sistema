"use client";
// El mostrador. Las cuentas abiertas están siempre a la vista; dentro de una cuenta hay tres
// pasos —material, báscula, cuenta— y cada pantalla pide una sola decisión.
//
// La pantalla no guarda copia de las cuentas: después de cada acción muestra lo que el servidor
// devolvió. Lo único suyo es el lugar en que va cada cuenta (paso, material elegido, peso a medio
// teclear), para que cambiar de cuenta, recargar o volver a entrar no lo pierdan.
import { useCallback, useEffect, useRef, useState } from "react";
import { ErrorDeApi, cancelarEnvio, identificador, pedir, rechazoConRegla } from "../cliente.ts";
import { Autorizar } from "../Autorizar.tsx";
import type { QuienAutoriza } from "../Autorizar.tsx";
import { ajuste, cuantosMateriales, kilos, kilosCortos, pesos, pesosCerrados, precio } from "../formato.ts";
import { enviar } from "../inventario/piezas.tsx";
import type { Pendiente } from "../inventario/piezas.tsx";
import { soltoLoHeredado } from "../pestana.ts";
import { SoloEnSuPestana } from "../SoloEnSuPestana.tsx";
import { COBRAN, LoQueFalta, useSesion } from "../Sesion.tsx";
import { Teclado, Visor } from "../Teclado.tsx";
import { PrecioEspecial, precioNuevo } from "./PrecioEspecial.tsx";
import type { EstadoDePrecio } from "./PrecioEspecial.tsx";
import { Ticket } from "./Ticket.tsx";
import { nombreDe, primeraPesada, segundaPesada } from "./tipos.ts";
import type { Bascula, Catalogo, Comprobante, Cuenta, CuentaEnLista, Impresion, MaterialDeCuenta, MaterialDelCatalogo, Tipo } from "./tipos.ts";

/** Cuántas cuentas se pueden tener abiertas a la vez. Es regla de la pantalla, no de la base. */
const MAXIMO_DE_CUENTAS = 10;

type Paso = "mat" | "bas" | "cta";

/** Un material con su peso, tal como se manda. Si hay que reintentar, se reintenta este mismo, sin cambiarle nada. */
interface Envio {
  linea: string;
  captura: string;
  material: number;
  bascula: number;
  kg: string;
}

/** En qué va una cuenta en esta pantalla. Todo esto es de esa cuenta y de ninguna otra. */
interface Lugar {
  paso: Paso;
  /** 0 son los frecuentes. */
  familia: number;
  material: number | null;
  bascula: number | null;
  /** Lo tecleado y todavía no enviado. */
  peso: string;
  /**
   * Un envío del que no se supo el resultado: salió, y la respuesta no llegó. Puede que el servidor
   * lo haya guardado. Mientras exista no se teclea otro peso: se reintenta este, idéntico, y el
   * servidor contesta con lo que ya tenía en vez de agregar otro.
   */
  pendiente: Envio | null;
  /** La segunda pesada de un vehículo: a medio teclear o, si es incierta, enviada sin respuesta. */
  segunda: { linea: string; captura: string; peso: string; incierta: boolean } | null;
  /** El precio especial que se le está dando a un material: lo elegido, y su envío si ya salió y no se supo. */
  especial: EstadoDePrecio | null;
  /** Quitar un precio especial que ya salió y del que no se supo: se reintenta ese mismo, y nada más. */
  quitando: (Pendiente<{ linea: string; visto: string | null }> & { material: string }) | null;
}
const LUGAR_NUEVO: Lugar = { paso: "mat", familia: 0, material: null, bascula: null, peso: "", pendiente: null, segunda: null, especial: null, quitando: null };

interface Memoria {
  activa: string | null;
  lugares: Record<string, Lugar>;
}
const DONDE = "feruga.mostrador";

function recordar(): Memoria {
  try {
    const m = JSON.parse(sessionStorage.getItem(DONDE) ?? "null");
    if (m && typeof m === "object" && m.lugares) {
      // Lo guardado puede venir de una versión anterior de la pantalla: se completa con lo que le falte.
      const lugares = Object.fromEntries(Object.entries(m.lugares as Record<string, Partial<Lugar>>).map(([k, l]) => [k, { ...LUGAR_NUEVO, ...l }]));
      return { activa: m.activa ?? null, lugares };
    }
  } catch {
    // Sin memoria se empieza de cero.
  }
  return { activa: null, lugares: {} };
}

/** Lo tecleado, como lo espera el servidor: sin punto colgando. */
const comoTexto = (tecleado: string): string => tecleado.replace(/\.$/, "");
const pesoListo = (tecleado: string): boolean => /^\d{1,6}(\.\d{1,3})?$/.test(comoTexto(tecleado)) && Number(tecleado) > 0;

/** Lo guardado se lee hasta saber que esta pestaña no es copia de otra: una copia no se queda con el peso a medias. */
export function Mostrador() {
  return <SoloEnSuPestana><Pantalla /></SoloEnSuPestana>;
}

function Pantalla() {
  const { persona, dia } = useSesion();
  const [memoria, setMemoria] = useState<Memoria>(recordar);
  const [cuentas, setCuentas] = useState<CuentaEnLista[] | null>(null);
  const [cuenta, setCuenta] = useState<Cuenta | null>(null);
  const [catalogos, setCatalogos] = useState<Partial<Record<Tipo, Catalogo>>>({});
  const [aviso, setAviso] = useState(() =>
    soltoLoHeredado("mostrador") ? "Había un peso a medias: sigue en la otra pestaña, donde se empezó." : "");
  const [ultimo, setUltimo] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [ticket, setTicket] = useState<{ comprobante: Comprobante; impresion: Impresion | null; negocio: string } | null>(null);
  const cargaEnCurso = useRef(0);
  const riel = useRef<HTMLElement>(null);
  const accionEnCurso = useRef(false);

  useEffect(() => {
    sessionStorage.setItem(DONDE, JSON.stringify(memoria));
  }, [memoria]);

  const activa = memoria.activa;
  // La cuenta con que se trabaja es la que se MUESTRA, y solo si es la elegida. Mientras el detalle
  // de la cuenta recién tocada no llega, no hay cuenta a la vista ni nada que se pueda mandar: así
  // lo tecleado en una nunca sale hacia otra.
  const vista = cuenta && cuenta.id === activa ? cuenta : null;
  const lugar: Lugar = (vista && memoria.lugares[vista.id]) || LUGAR_NUEVO;
  const ponerLugar = useCallback((id: string, cambio: Partial<Lugar>) => {
    setMemoria((m) => ({ ...m, lugares: { ...m.lugares, [id]: { ...(m.lugares[id] ?? LUGAR_NUEVO), ...cambio } } }));
  }, []);

  /** Vuelve a pedir las cuentas abiertas y la que se está viendo. `preferida` es a cuál pasar. */
  const refrescar = useCallback(async (preferida?: string | null) => {
    const turno = ++cargaEnCurso.current;
    try {
      const { cuentas: abiertas } = await pedir<{ cuentas: CuentaEnLista[] }>("GET", "/api/cuentas");
      if (turno !== cargaEnCurso.current) return;
      let id = preferida === undefined ? recordar().activa : preferida;
      if (!id || !abiertas.some((c) => c.id === id)) id = abiertas[0]?.id ?? null;
      const llegada = id ? (await pedir<{ cuenta: Cuenta }>("GET", `/api/cuentas/${id}`)).cuenta : null;
      if (turno !== cargaEnCurso.current) return;
      setCuentas(abiertas);
      setCuenta(llegada);
      setMemoria((m) => {
        // Las cuentas que ya no están abiertas no dejan su lugar guardado.
        const lugares = Object.fromEntries(Object.entries(m.lugares).filter(([k]) => abiertas.some((c) => c.id === k)));
        if (llegada) {
          let l = lugares[llegada.id] ?? { ...LUGAR_NUEVO, paso: llegada.materiales.length ? "cta" : "mat" };
          // Un envío de resultado desconocido que sí había llegado: ya está en la cuenta, no hay nada que reintentar.
          if (l.pendiente && llegada.materiales.some((x) => x.id === l.pendiente!.linea)) {
            l = { ...l, paso: "cta", material: null, bascula: null, peso: "", pendiente: null };
          }
          if (l.segunda && !llegada.materiales.some((x) => x.id === l.segunda!.linea && x.porPesar)) l = { ...l, segunda: null };
          // El precio especial a medias vale mientras su material siga en la cuenta. Y quitar uno del que
          // no se supo deja de estar pendiente cuando el material ya no lo lleva: se quitó, o ya no está.
          if (l.especial && !llegada.materiales.some((x) => x.id === l.especial!.linea)) l = { ...l, especial: null };
          if (l.quitando && !llegada.materiales.some((x) => x.id === l.quitando!.cuerpo.linea && x.precioEspecial)) l = { ...l, quitando: null };
          lugares[llegada.id] = l;
        }
        return { activa: llegada?.id ?? null, lugares };
      });
    } catch (e) {
      if (turno === cargaEnCurso.current) setAviso((e as Error).message);
    }
  }, []);

  useEffect(() => {
    if (dia.listo) void refrescar();
  }, [dia.listo, refrescar]);

  // El catálogo se vuelve a pedir cada vez que se entra a elegir material: en venta trae lo disponible.
  const tipoActivo = vista?.tipo;
  useEffect(() => {
    if (!tipoActivo || lugar.paso === "cta") return;
    let vigente = true;
    pedir<Catalogo>("GET", `/api/catalogo?tipo=${tipoActivo}`)
      .then((c) => { if (vigente) setCatalogos((antes) => ({ ...antes, [tipoActivo]: c })); })
      .catch((e: Error) => { if (vigente) setAviso(e.message); });
    return () => { vigente = false; };
  }, [tipoActivo, lugar.paso, vista?.id]);

  // Con muchas cuentas la lista ya no cabe entera: la activa se deja siempre a la vista, sola.
  // También cuando cambia de grupo sin dejar de ser la activa: se pesó el camión y pasó a esperar,
  // o volvió y regresó al mostrador. Ahí no cambia ni la cuenta ni cuántas hay; cambia dónde está.
  const cuantas = cuentas?.length ?? 0;
  const dondeEsta = cuentas?.findIndex((c) => c.id === activa) ?? -1;
  const esperaLaActiva = Boolean(cuentas?.[dondeEsta]?.porPesar);
  useEffect(() => {
    riel.current?.querySelector('.cta[aria-pressed="true"]')?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [activa, cuantas, ticket, dondeEsta, esperaLaActiva]);

  if (!dia.listo) return <LoQueFalta para="atender" />;
  if (cuentas === null) return <p className="cargando">Un momento…</p>;

  const catalogo = vista ? catalogos[vista.tipo] : undefined;
  const material = catalogo && lugar.material !== null
    ? catalogo.familias.flatMap((f) => f.materiales).find((m) => m.id === lugar.material) ?? null
    : null;

  const irA = (paso: Paso): void => {
    if (!vista) return;
    setAviso("");
    setUltimo("");
    ponerLugar(vista.id, { paso });
    window.scrollTo(0, 0);
  };

  const entrar = (id: string): void => {
    setAviso("");
    setUltimo("");
    setTicket(null);
    setMemoria((m) => ({ ...m, activa: id }));
    void refrescar(id);
  };

  /** Corre una acción contra el servidor, de una en una, y muestra su error si lo hay. */
  const hacer = async (accion: () => Promise<void>): Promise<void> => {
    // Con una referencia y no con el estado: dos toques seguidos llegan antes de que la pantalla se redibuje.
    if (accionEnCurso.current) return;
    accionEnCurso.current = true;
    setOcupado(true);
    setAviso("");
    try {
      await accion();
    } catch (e) {
      setAviso((e as Error).message);
      // Una regla que rechazó la acción puede deberse a que la cuenta ya no es la que se ve.
      if (e instanceof ErrorDeApi && e.codigo !== "RED" && e.codigo !== "FORMA") void refrescar(memoria.activa);
    } finally {
      accionEnCurso.current = false;
      setOcupado(false);
    }
  };

  const nueva = (tipo: Tipo): Promise<void> =>
    hacer(async () => {
      // El número la distingue mientras está abierta: «Compra 3» sigue siendo la 3 aunque se cierre la 1.
      const numeros = cuentas.map((c) => Number(/ (\d+)$/.exec(c.etiqueta ?? "")?.[1] ?? 0));
      const etiqueta = `${tipo === "compra" ? "Compra" : "Venta"} ${Math.max(0, ...numeros) + 1}`;
      const id = identificador();
      await pedir("POST", "/api/cuentas", { id, tipo, etiqueta });
      setUltimo("");
      setTicket(null);
      ponerLugar(id, LUGAR_NUEVO);
      await refrescar(id);
    });

  const agregar = (): Promise<void> =>
    hacer(async () => {
      if (!vista) return;
      // Con algo del precio especial en el aire —darlo o quitarlo—, la cuenta no admite otra cosa hasta saber qué pasó.
      if (lugar.quitando || lugar.especial?.pendiente) return;
      const id = vista.id;
      // Si hay un envío de resultado desconocido, se manda ese mismo, tal cual. Si no, lo que está a la vista.
      const envio: Envio | null = lugar.pendiente
        ?? (lugar.material !== null && lugar.bascula !== null
          ? { linea: identificador(), captura: identificador(), material: lugar.material, bascula: lugar.bascula, kg: comoTexto(lugar.peso) }
          : null);
      if (!envio) return;
      // Queda guardado antes de salir: si la respuesta no llega, se sabrá qué fue lo que se mandó.
      ponerLugar(id, { pendiente: envio });
      try {
        const r = await pedir<{ cuenta: Cuenta }>("POST", `/api/cuentas/${id}/materiales`, envio);
        const agregado = r.cuenta.materiales.find((m) => m.id === envio.linea);
        setUltimo(agregado && !agregado.porPesar
          ? `Agregado: ${agregado.material.nombre} · ${kilos(agregado.kg!)} kg · ${pesos(agregado.importe!)}`
          : "");
        setCuenta(r.cuenta);
        ponerLugar(id, { paso: "cta", material: null, bascula: null, peso: "", pendiente: null });
        window.scrollTo(0, 0);
        void refrescar(id);
      } catch (e) {
        if (rechazoConRegla(e)) {
          // La regla dice que esta petición no entró; no que no haya otra igual en camino (un intento
          // anterior, u otra pestaña). Antes de soltar el peso se le pide al servidor que resuelva
          // ese envío: o ya había entrado, o queda cancelado y ya no entra aunque llegue después.
          // (Si el servidor dice que ese identificador ya no sirve —RC012—, ya está resuelto.)
          let entro = false;
          if (!(e instanceof ErrorDeApi && e.codigo === "RC012")) {
            try {
              entro = (await cancelarEnvio(envio.linea)) === "entro";
            } catch {
              throw e;      // no se pudo resolver: sigue pendiente
            }
          }
          ponerLugar(id, entro ? { paso: "cta", material: null, bascula: null, peso: "", pendiente: null } : { pendiente: null });
          throw e;
        }
        // Sin respuesta, o si el servidor falla, no se sabe si llegó: el envío se queda pendiente y
        // la pantalla lo dice. Si el servidor sí contesta, se le vuelve a pedir la cuenta: cuando
        // el material ya está en ella, no queda nada que reintentar.
        if (!(e instanceof ErrorDeApi && e.codigo === "RED")) await refrescar(id);
      }
    });

  const terminada = async (hecha: Cuenta): Promise<void> => {
    let impreso: { impresion: Impresion; comprobante: Comprobante; negocio: string };
    try {
      impreso = await pedir("POST", `/api/comprobantes/${hecha.id}/imprimir`, { id: identificador(), motivo: null });
    } catch {
      // La cuenta ya quedó terminada; si no se pudo registrar la impresión, se muestra para imprimirla desde ahí.
      const visto = await pedir<{ comprobante: Comprobante; negocio: string }>("GET", `/api/comprobantes/${hecha.id}`);
      setTicket({ ...visto, impresion: null });
      void refrescar(null);
      return;
    }
    setTicket(impreso);
    void refrescar(null);
  };

  const confirmar = (): Promise<void> =>
    hacer(async () => {
      if (!vista) return;
      try {
        const r = await pedir<{ cuenta: Cuenta }>("POST", `/api/cuentas/${vista.id}/confirmar`, { revision: vista.revision });
        await terminada(r.cuenta);
      } catch (e) {
        if (e instanceof ErrorDeApi && e.codigo === "RC011") {
          // No se vuelve a confirmar sola: la persona revisa lo que cambió y decide.
          await refrescar(vista.id);
          throw new ErrorDeApi(409, "RC011", "La cuenta cambió mientras la tenías abierta. Revísala y vuelve a tocar el botón.");
        }
        throw e;
      }
    });

  const descartar = (): Promise<void> =>
    hacer(async () => {
      if (!vista) return;
      await pedir("POST", `/api/cuentas/${vista.id}/descartar`);
      setUltimo("");
      await refrescar(null);
    });

  const lleno = cuentas.length >= MAXIMO_DE_CUENTAS;
  // Las que esperan la segunda pesada de un vehículo van aparte: el camión se fue a descargar, y su
  // cuenta no debe estorbar —ni confundirse— entre las de quienes están en el mostrador.
  const enMostrador = cuentas.filter((c) => !c.porPesar);
  const enEspera = cuentas.filter((c) => c.porPesar);
  const tarjeta = (c: CuentaEnLista) => (
    <button
      key={c.id} type="button" className={"cta" + (c.porPesar ? " falta" : "")}
      aria-pressed={!ticket && c.id === activa} onClick={() => entrar(c.id)}
    >
      <b>{nombreDe(c)}</b>
      <span className="tt">{pesosCerrados(c.total)}</span>
      <small>{c.porPesar ? `Falta pesar ${segundaPesada(c.tipo)}` : cuantosMateriales(c.materiales)}</small>
      {c.deOtraJornada ? <span className="otro">De otro día</span> : null}
    </button>
  );

  return (
    <div className="app">
      <aside className="rail" aria-label="Cuentas abiertas" ref={riel}>
        <p className="lbl">Cuentas abiertas</p>
        <div className="lista">
          <div className="grupo" role="group" aria-label="En el mostrador">
            {enEspera.length > 0 ? <p className="lbl sub">En el mostrador</p> : null}
            {enMostrador.map(tarjeta)}
          </div>
          {enEspera.length > 0 ? (
            <div className="grupo espera" role="group" aria-label="En espera de la segunda pesada">
              <p className="lbl sub">En espera</p>
              {enEspera.map(tarjeta)}
            </div>
          ) : null}
        </div>
        <div className="dos">
          <button className="nueva" type="button" disabled={lleno || ocupado} onClick={() => void nueva("compra")}>+ Compra</button>
          <button className="nueva" type="button" disabled={lleno || ocupado} onClick={() => void nueva("venta")}>+ Venta</button>
        </div>
        {lleno ? <p className="note">Máximo diez. Termina o descarta una para abrir otra.</p> : null}
      </aside>

      <div className="main">
        {ticket ? (
          <Ticket
            key={ticket.comprobante.id} comprobante={ticket.comprobante} negocio={ticket.negocio} impresion={ticket.impresion}
            puedeImprimir={COBRAN.includes(persona.rol)} alTerminar={() => { setTicket(null); void refrescar(null); }}
          />
        ) : !activa ? (
          <div className="card">
            {aviso ? <div className="pad"><div className="flag" role="alert" style={{ marginTop: 0 }}>{aviso}</div></div> : null}
            <p className="empty">No hay cuentas abiertas. Abre una compra o una venta.</p>
          </div>
        ) : !vista ? (
          // La cuenta elegida todavía no llega: no se muestra la anterior ni se ofrece nada que tocar.
          <div className="card">
            {aviso ? <div className="pad"><div className="flag" role="alert" style={{ marginTop: 0 }}>{aviso}</div></div> : null}
            <p className="cargando">Un momento…</p>
          </div>
        ) : (
          <>
            <div className="top"><h2>{nombreDe(vista)}</h2></div>
            <div className="pasos">
              {([["mat", "Material"], ["bas", "Báscula"], ["cta", "Cuenta"]] as const).map(([k, nombre], j) => (
                <button
                  key={k} type="button" aria-current={lugar.paso === k ? "step" : undefined}
                  disabled={(k === "bas" && lugar.material === null) || (k !== "cta" && vista.deOtraJornada) || (lugar.pendiente !== null && k !== "bas")
                    // Con un precio especial en el aire —darlo o quitarlo— no se sale de la cuenta a agregar otra cosa.
                    || (k !== "cta" && (lugar.quitando !== null || Boolean(lugar.especial?.pendiente)))}
                  onClick={() => irA(k)}
                >
                  <i>{j + 1}</i>{nombre}
                </button>
              ))}
            </div>

            {lugar.paso === "mat" ? (
              <PasoMaterial
                cuenta={vista} catalogo={catalogo} familia={lugar.familia} aviso={aviso}
                alCambiarFamilia={(familia) => ponerLugar(vista.id, { familia })}
                alElegir={(m) => { setAviso(""); ponerLugar(vista.id, { paso: "bas", material: m.id, bascula: null, peso: "" }); window.scrollTo(0, 0); }}
                alVerCuenta={() => irA("cta")}
              />
            ) : null}

            {lugar.paso === "bas" ? (
              <PasoBascula
                cuenta={vista} material={material} basculas={catalogo?.basculas ?? []} bascula={lugar.bascula} peso={lugar.peso}
                incierto={lugar.pendiente !== null && !ocupado} aviso={aviso} ocupado={ocupado}
                alElegirBascula={(bascula) => { setAviso(""); ponerLugar(vista.id, { bascula, peso: "" }); }}
                alTeclear={(peso) => ponerLugar(vista.id, { peso })}
                alAgregar={() => void agregar()}
              />
            ) : null}

            {lugar.paso === "cta" ? (
              <PasoCuenta
                key={vista.id}
                cuenta={vista} aviso={aviso} ultimo={ultimo} ocupado={ocupado}
                segunda={lugar.segunda} alSegunda={(segunda) => ponerLugar(vista.id, { segunda })}
                especial={lugar.especial} alEspecial={(especial) => ponerLugar(vista.id, { especial })}
                quitando={lugar.quitando} alQuitando={(quitando) => ponerLugar(vista.id, { quitando })}
                alDecir={(mensaje) => { setAviso(""); setUltimo(mensaje); void refrescar(vista.id); }}
                alAdvertir={(texto) => { setUltimo(""); setAviso(texto); void refrescar(vista.id); }}
                alAgregarOtro={() => irA("mat")} alConfirmar={() => void confirmar()} alDescartar={() => void descartar()}
                alCambiar={(c, mensaje) => { setCuenta(c); setUltimo(mensaje); void refrescar(c.id); }}
                alNoSaber={() => refrescar(vista.id)}
                alTerminar={terminada}
                hacer={hacer}
              />
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}

// ── paso 1: qué material es ────────────────────────────────────────────────

function PasoMaterial(p: {
  cuenta: Cuenta; catalogo: Catalogo | undefined; familia: number; aviso: string;
  alCambiarFamilia: (familia: number) => void; alElegir: (m: MaterialDelCatalogo) => void; alVerCuenta: () => void;
}) {
  if (!p.catalogo) return <div className="card"><p className="cargando">Un momento…</p></div>;
  const familia = p.catalogo.familias.find((f) => f.id === p.familia);
  const materiales = familia ? familia.materiales : p.catalogo.frecuentes;
  const venta = p.cuenta.tipo === "venta";

  return (
    <div className="card">
      <div className="pad">
        <p className="lbl">{p.cuenta.materiales.length ? "¿Qué material sigue?" : "¿Qué material es?"}</p>
        <div className="chips">
          {[{ id: 0, nombre: "Frecuentes" }, ...p.catalogo.familias].map((f) => (
            <button key={f.id} type="button" className="chip" aria-pressed={(familia?.id ?? 0) === f.id} onClick={() => p.alCambiarFamilia(f.id)}>
              {f.nombre}
            </button>
          ))}
        </div>
        <div className="grid">
          {materiales.map((m) => (
            <button key={m.id} type="button" className="mat" disabled={m.precio === null} onClick={() => p.alElegir(m)}>
              <b>{familia ? m.nombreCorto : m.nombre}</b>
              <span>
                {m.precio === null ? "Sin precio hoy" : `${precio(m.precio)} / kg`}
                {venta && m.precio !== null && m.disponible !== null ? ` · hay ${kilosCortos(String(Math.max(0, Number(m.disponible))))} kg` : ""}
              </span>
            </button>
          ))}
        </div>
        {p.aviso ? <div className="flag" role="alert">{p.aviso}</div> : null}
        {p.cuenta.materiales.length ? (
          <button className="btn ghostbtn" type="button" onClick={p.alVerCuenta}>
            Regresar a la cuenta · {cuantosMateriales(p.cuenta.materiales.length)} · {pesosCerrados(p.cuenta.resumen.total)}
          </button>
        ) : null}
      </div>
    </div>
  );
}

// ── paso 2: en cuál báscula está, y cuánto marca ───────────────────────────

function PasoBascula(p: {
  cuenta: Cuenta; material: MaterialDelCatalogo | null; basculas: Bascula[]; bascula: number | null; peso: string;
  /** Lo tecleado ya se mandó y no llegó respuesta: no se sabe si quedó guardado. */
  incierto: boolean; aviso: string; ocupado: boolean;
  alElegirBascula: (id: number | null) => void; alTeclear: (peso: string) => void; alAgregar: () => void;
}) {
  if (!p.material) return <div className="card"><p className="cargando">Un momento…</p></div>;
  const elegida = p.basculas.find((b) => b.id === p.bascula) ?? null;
  const listo = pesoListo(p.peso);

  return (
    <div className="card">
      <div className="pad">
        <p className="que">
          <b>{p.material.nombre}</b>
          <span>{precio(p.material.precio ?? "0")} el kilo</span>
        </p>

        {!elegida ? (
          <>
            <p className="lbl">Toca la báscula donde está</p>
            {p.basculas.map((b) => (
              <button key={b.id} type="button" className="bas" onClick={() => p.alElegirBascula(b.id)}>
                <span className="quien">
                  <b>{b.nombre}{b.doblePesaje ? " · grande" : " · chica"}</b>
                  {b.doblePesaje
                    ? <small>Camión o camioneta. Se pesa {primeraPesada(p.cuenta.tipo)} y después {segundaPesada(p.cuenta.tipo)}.</small>
                    : null}
                </span>
                <span className="toca">Tocar</span>
              </button>
            ))}
          </>
        ) : (
          <>
            <p className="lbl">{elegida.doblePesaje ? `¿Cuánto marca ${primeraPesada(p.cuenta.tipo)}?` : "¿Cuánto marca?"}</p>
            <Visor
              nombre={elegida.nombre} valor={p.peso}
              nota={elegida.doblePesaje ? `Primera pesada: ${primeraPesada(p.cuenta.tipo)}. Después se pesa ${segundaPesada(p.cuenta.tipo)}.` : undefined}
            />
            {p.incierto ? (
              <>
                <div className="flag" role="alert">
                  <b>No se supo si este peso se guardó.</b> No teclees otro: vuelve a intentar, y si ya había entrado no se agrega dos veces.
                </div>
                <button className="btn" type="button" disabled={p.ocupado} onClick={p.alAgregar}>Volver a intentar</button>
              </>
            ) : (
              <>
                <Teclado valor={p.peso} alCambiar={p.alTeclear} decimales={3} enteros={6} alTerminar={() => { if (listo && !p.ocupado) p.alAgregar(); }} />
                {p.aviso ? <div className="flag" role="alert">{p.aviso}</div> : null}
                <button className="btn" type="button" disabled={!listo || p.ocupado} onClick={p.alAgregar}>
                  {elegida.doblePesaje ? `Guardar peso ${primeraPesada(p.cuenta.tipo)}` : "Agregar a la cuenta"}
                </button>
                <button className="btn ghostbtn chico" type="button" disabled={p.ocupado} onClick={() => p.alElegirBascula(null)}>Es otra báscula</button>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ── paso 3: la cuenta ──────────────────────────────────────────────────────

function PasoCuenta(p: {
  cuenta: Cuenta; aviso: string; ultimo: string; ocupado: boolean;
  segunda: Lugar["segunda"]; alSegunda: (segunda: Lugar["segunda"]) => void;
  especial: Lugar["especial"]; alEspecial: (especial: Lugar["especial"]) => void;
  quitando: Lugar["quitando"]; alQuitando: (quitando: Lugar["quitando"]) => void;
  /** Algo quedó hecho y no se tiene la cuenta como quedó: se dice, y se vuelve a pedir. */
  alDecir: (mensaje: string) => void;
  /** Algo no se pudo porque la cuenta cambió: se dice, y se vuelve a pedir. */
  alAdvertir: (aviso: string) => void;
  alAgregarOtro: () => void; alConfirmar: () => void; alDescartar: () => void;
  alCambiar: (cuenta: Cuenta, mensaje: string) => void;
  /** El servidor falló a medio envío y no se sabe si entró: se vuelve a pedir la cuenta para ver cómo quedó. */
  alNoSaber: () => Promise<void>;
  /** Lo que sigue a una cuenta terminada: registrar la impresión y mostrar el comprobante. Corre dentro de la acción que la terminó. */
  alTerminar: (hecha: Cuenta) => Promise<void>;
  hacer: (accion: () => Promise<void>) => Promise<void>;
}) {
  const { persona } = useSesion();
  const { cuenta } = p;
  const compra = cuenta.tipo === "compra";
  const [porDescartar, setPorDescartar] = useState(false);
  const [autorizando, setAutorizando] = useState(false);
  // La segunda pesada a medias vale solo si su material sigue en esta cuenta esperando esa pesada.
  const porPesar = p.segunda ? cuenta.materiales.find((m) => m.id === p.segunda!.linea && m.porPesar) ?? null : null;
  const pesando = porPesar ? p.segunda : null;

  const falta = cuenta.resumen.porPesar > 0;
  const cobra = COBRAN.includes(persona.rol);
  // Dar y quitar precios especiales es de quien cobra; quien solo pesa no los ve.
  const conPrecios = cobra;
  // El material al que se le está dando precio especial, si sigue en la cuenta.
  const paraPrecio = p.especial ? cuenta.materiales.find((m) => m.id === p.especial!.linea) ?? null : null;
  // Con un «quitar» del que no se supo, la cuenta no deja hacer otra cosa: su total puede haber cambiado ya.
  const incierto = p.quitando !== null;
  // El vehículo de otro día lo termina un responsable tecleando su clave, aunque sea él quien atiende.
  const pideAutorizacion = cuenta.deOtraJornada;

  const guardarSegunda = (): Promise<void> =>
    p.hacer(async () => {
      if (!pesando) return;
      try {
        const r = await pedir<{ cuenta: Cuenta }>("POST", `/api/cuentas/${cuenta.id}/segunda-pesada`, {
          linea: pesando.linea, captura: pesando.captura, kg: comoTexto(pesando.peso),
        });
        const listo = r.cuenta.materiales.find((m) => m.id === pesando.linea);
        p.alSegunda(null);
        p.alCambiar(r.cuenta, listo?.kg ? `Listo: ${listo.material.nombre} · ${kilos(listo.kg)} kg · ${pesos(listo.importe!)}` : "");
      } catch (e) {
        // Con un rechazo por una regla se puede teclear otra. Aquí no hace falta cancelar nada: un
        // material tiene una sola segunda pesada, y de la anterior y la que se teclee ahora, la que
        // llegue después se rechaza.
        if (rechazoConRegla(e)) {
          p.alSegunda({ ...pesando, incierta: false });
          throw e;
        }
        // Sin respuesta, o si el servidor falla, no se sabe si llegó: se queda como está, para
        // reintentar la misma pesada. Si el servidor sí contesta, se vuelve a pedir la cuenta:
        // cuando la pesada ya está en ella, no queda nada que reintentar.
        p.alSegunda({ ...pesando, incierta: true });
        if (!(e instanceof ErrorDeApi && e.codigo === "RED")) await p.alNoSaber();
      }
    });

  const quitar = (linea: string): Promise<void> =>
    p.hacer(async () => {
      const r = await pedir<{ cuenta: Cuenta }>("POST", `/api/cuentas/${cuenta.id}/quitar`, { linea });
      p.alCambiar(r.cuenta, "");
    });

  /** Quita el precio especial de ese material; o, si hay uno del que no se supo, manda ese mismo otra vez. */
  const quitarPrecio = (m: MaterialDeCuenta | null): Promise<void> =>
    p.hacer(async () => {
      const pendiente = p.quitando;
      if (!pendiente && !m) return;
      const nombre = pendiente?.material ?? m!.material.nombre;
      const r = await enviar<{ cuenta: Cuenta }, NonNullable<Lugar["quitando"]>>(
        `/api/cuentas/${cuenta.id}/precio-especial/quitar`, pendiente,
        () => ({ id: identificador(), material: nombre, cuerpo: { linea: m!.id, visto: m!.eventoDePrecio } }), p.alQuitando,
      );
      if (r) p.alCambiar(r.cuenta, `${nombre} volvió a su precio de lista.`);
    });

  if (p.especial && paraPrecio) {
    return (
      <PrecioEspecial
        cuenta={cuenta} material={paraPrecio} e={p.especial} poner={(cambio) => p.alEspecial({ ...p.especial!, ...cambio })}
        alTerminar={(mensaje, quedo) => { p.alEspecial(null); if (quedo) p.alCambiar(quedo, mensaje); else p.alDecir(mensaje); }}
        alSalir={(aviso) => { p.alEspecial(null); if (aviso) p.alAdvertir(aviso); }}
      />
    );
  }

  if (autorizando) {
    return <AutorizarVehiculo cuenta={cuenta} hacer={p.hacer} aviso={p.aviso} ocupado={p.ocupado} alCancelar={() => setAutorizando(false)} alTerminar={p.alTerminar} />;
  }

  if (pesando && porPesar) {
    const m = porPesar;
    const listo = pesoListo(pesando.peso);
    return (
      <div className="card">
        <div className="pad">
          <p className="que">
            <b>{m.material.nombre}</b>
            <span>{primeraPesada(cuenta.tipo)}: {kilosCortos(m.pesadas[0]!)} kg</span>
          </p>
          <p className="lbl">¿Cuánto marca {segundaPesada(cuenta.tipo)}?</p>
          <Visor nombre={m.bascula.nombre} nota={`Segunda pesada: ${segundaPesada(cuenta.tipo)}.`} valor={pesando.peso} />
          {pesando.incierta && !p.ocupado ? (
            <>
              <div className="flag" role="alert">
                <b>No se supo si este peso se guardó.</b> No teclees otro: vuelve a intentar, y si ya había entrado no se asienta dos veces.
              </div>
              <button className="btn" type="button" onClick={() => void guardarSegunda()}>Volver a intentar</button>
            </>
          ) : (
            <>
              <Teclado
                valor={pesando.peso} alCambiar={(peso) => p.alSegunda({ ...pesando, peso })} decimales={3} enteros={6}
                alTerminar={() => { if (listo && !p.ocupado) void guardarSegunda(); }}
              />
              {p.aviso ? <div className="flag" role="alert">{p.aviso}</div> : null}
              <button className="btn" type="button" disabled={!listo || p.ocupado} onClick={() => void guardarSegunda()}>
                Guardar peso {segundaPesada(cuenta.tipo)}
              </button>
              <button className="btn ghostbtn chico" type="button" disabled={p.ocupado} onClick={() => p.alSegunda(null)}>Regresar a la cuenta</button>
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="card">
      <div className="pad">
        {p.ultimo ? <div className="okmsg" role="status">{p.ultimo}</div> : null}
        <p className="lbl">{cuenta.materiales.length ? `En esta cuenta · ${cuantosMateriales(cuenta.materiales.length)}` : "Esta cuenta está vacía"}</p>
        {cuenta.deOtraJornada ? <p className="note" style={{ marginTop: 0 }}>Este vehículo quedó de otro día. Se paga al precio de ese día y lo termina un responsable.</p> : null}
        {cuenta.cliente ? <p className="note" style={{ marginTop: 0 }}>A nombre de <b>{cuenta.cliente.nombre}</b>.</p> : null}
        {incierto ? (
          <div className="flag" role="alert">
            <b>No se supo si se quitó el precio especial de {p.quitando!.material}.</b> No cambies nada: vuelve a intentar, y si ya se había quitado no pasa nada.
            <button className="btn" type="button" disabled={p.ocupado} onClick={() => void quitarPrecio(null)}>Volver a intentar</button>
          </div>
        ) : null}

        {cuenta.materiales.map((m) => (
          <div key={m.id} className="renglon">
            <div className="ren">
              <div className="rn">
                <b>{m.material.nombre}</b>
                {m.porPesar ? (
                  <span className="prog">
                    <span className="hecho">1 · {primeraPesada(cuenta.tipo)} {kilosCortos(m.pesadas[0]!)} kg ✓</span>
                    <span className="sigue">2 · {segundaPesada(cuenta.tipo)}: falta</span>
                  </span>
                ) : (
                  <small>
                    {kilos(m.kg!)} kg × {precio(m.precio)} · {m.bascula.nombre}
                    {m.pesadas.length === 2 ? ` · ${kilosCortos(m.bruto!)} − ${kilosCortos(m.tara!)} kg` : ""}
                  </small>
                )}
              </div>
              <div className="ri">{m.porPesar ? "—" : pesos(m.importe!)}</div>
              {conPrecios && !m.porPesar && !m.precioEspecial ? (
                <button
                  className="quitar" type="button" aria-label={`Precio especial para ${m.material.nombre}`} disabled={p.ocupado || incierto}
                  onClick={() => p.alEspecial(precioNuevo(m.id))}
                >
                  Precio especial
                </button>
              ) : null}
              <button className="quitar" type="button" aria-label={`Quitar ${m.material.nombre}`} disabled={p.ocupado || incierto} onClick={() => void quitar(m.id)}>Quitar</button>
            </div>
            {m.porPesar ? (
              <button className="btn pesar" type="button" disabled={incierto} onClick={() => p.alSegunda({ linea: m.id, captura: identificador(), peso: "", incierta: false })}>
                Pesar {segundaPesada(cuenta.tipo)}
              </button>
            ) : null}
            {m.precioEspecial ? (
              <p className="especial">
                <span>Precio especial: lista {precio(m.precioDeLista)}, queda {precio(m.precio)} por kilo. Autorizó {m.precioEspecial.autorizo}.</span>
                {conPrecios ? (
                  <button className="quitar" type="button" aria-label={`Quitar el precio especial de ${m.material.nombre}`} disabled={p.ocupado || incierto} onClick={() => void quitarPrecio(m)}>
                    Quitar precio especial
                  </button>
                ) : null}
              </p>
            ) : null}
          </div>
        ))}

        {!cuenta.deOtraJornada ? (
          <button className="mas" type="button" disabled={incierto} onClick={p.alAgregarOtro}>
            {cuenta.materiales.length ? "＋ Agregar otro material" : "＋ Agregar material"}
          </button>
        ) : null}

        {cuenta.avisos.map((a) => (
          <div key={a.material} className="flag" role="status">
            <b>No alcanza.</b> Entre las ventas abiertas faltan {kilos(a.faltan)} kg de {a.material}.
          </div>
        ))}
        {p.aviso ? <div className="flag" role="alert">{p.aviso}</div> : null}

        <div className="tot first"><span>Suma</span><span className="n">{pesos(cuenta.resumen.suma)}</span></div>
        <div className="tot adj"><span>Ajuste por redondeo</span><span className="n">{ajuste(cuenta.resumen.ajuste)}</span></div>
        <div className="tot big"><span>{compra ? "Se paga" : "Se cobra"}</span><span className="n">{pesosCerrados(cuenta.resumen.total)}</span></div>
        <p className="note">
          {falta ? "Falta la segunda pesada para poder terminar esta cuenta." : "Pesos cerrados. El ajuste sale impreso en el ticket."}
        </p>

        {cobra ? (
          <button
            className="btn" type="button" disabled={!cuenta.materiales.length || falta || p.ocupado || incierto}
            onClick={() => (pideAutorizacion ? setAutorizando(true) : p.alConfirmar())}
          >
            {compra ? "Pagar e imprimir ticket" : "Cobrar e imprimir ticket"}
          </button>
        ) : (
          <p className="note">La cuenta la termina quien atiende el mostrador.</p>
        )}
        <button
          className="btn ghostbtn chico" type="button" disabled={p.ocupado || incierto}
          onClick={() => (cuenta.materiales.length && !porDescartar ? setPorDescartar(true) : p.alDescartar())}
        >
          {porDescartar ? `Toca otra vez para descartar ${nombreDe(cuenta)}` : "Descartar esta cuenta"}
        </button>
      </div>
    </div>
  );
}

// ── autorizar en el momento: el vehículo que quedó de otro día ─────────────

function AutorizarVehiculo(p: {
  cuenta: Cuenta; aviso: string; ocupado: boolean; hacer: (accion: () => Promise<void>) => Promise<void>;
  alCancelar: () => void; alTerminar: (hecha: Cuenta) => Promise<void>;
}) {
  const [responsables, setResponsables] = useState<QuienAutoriza[] | null>(null);

  useEffect(() => {
    pedir<{ personas: Array<QuienAutoriza & { rol: string }> }>("GET", "/api/personas")
      .then((r) => setResponsables(r.personas.filter((x) => x.rol === "responsable")))
      .catch(() => setResponsables([]));
  }, []);

  return (
    <Autorizar
      titulo="Lo termina un responsable"
      explicacion="Este vehículo quedó de otro día. Quien ponga su clave queda registrado como quien lo terminó."
      personas={responsables} boton={(nombre) => `Terminar a nombre de ${nombre}`} cancelar="Regresar a la cuenta"
      aviso={p.aviso} ocupado={p.ocupado} alCancelar={p.alCancelar}
      alAutorizar={(quien, clave) =>
        p.hacer(async () => {
          const r = await pedir<{ cuenta: Cuenta }>("POST", `/api/cuentas/${p.cuenta.id}/terminar-vehiculo`, {
            responsable: quien.id, clave, revision: p.cuenta.revision,
          });
          // Dentro de esta misma acción: una acción no llama a otra, que la guarda contra el doble toque la detendría.
          await p.alTerminar(r.cuenta);
        })}
    />
  );
}
