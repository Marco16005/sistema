"use client";
// El precio especial de un material, dentro de una cuenta abierta: a qué cliente, cuánto más o
// cuánto menos que la lista por kilo, cómo queda, y la clave de quien lo autoriza. La regla vive
// en la base; aquí se arma lo que se pide y se enseña cómo quedaría antes de autorizar.
//
// Es una acción que escribe, así que sigue la regla del envío pendiente: queda guardado antes de
// salir, con su identificador y lo que lleva; mientras no se sepa qué pasó no se cambia nada, y lo
// único que se puede hacer es autorizar ese mismo otra vez. La clave no se guarda en ningún lado.
import { useEffect, useState } from "react";
import { Autorizar } from "../Autorizar.tsx";
import type { QuienAutoriza } from "../Autorizar.tsx";
import { ErrorDeApi, cancelarEnvio, identificador, pedir } from "../cliente.ts";
import { precio } from "../formato.ts";
import { enviar, useAccion } from "../inventario/piezas.tsx";
import type { Pendiente } from "../inventario/piezas.tsx";
import { Teclado, Visor } from "../Teclado.tsx";
import type { Cuenta, MaterialDeCuenta } from "./tipos.ts";

interface Cliente {
  id: string;
  nombre: string;
}

/** Lo que viaja al dar un precio especial. La clave va aparte, y no se guarda. */
interface Orden {
  linea: string;
  /** El último cambio de precio que se le vio a ese material: si ya tiene otro, la petición llegó tarde. */
  visto: string | null;
  cliente: string | null;
  clienteNuevo: string | null;
  /** Pesos por kilo respecto de la lista, como texto: con signo de menos si es hacia abajo. */
  diferencia: string;
  autoriza: string;
}

export interface EstadoDePrecio {
  /** El material al que se le da. */
  linea: string;
  paso: "forma" | "autorizar";
  /** Un cliente de la lista… */
  cliente: Cliente | null;
  /** …o uno nuevo, por su nombre. Nada: se está eligiendo de la lista. */
  nuevo: string | null;
  /** Hacia arriba de la lista, o hacia abajo. */
  mas: boolean;
  /** La diferencia tecleada, sin signo. */
  diferencia: string;
  /**
   * El precio especial que ya salió y del que todavía no se sabe, con quien lo autorizó y cómo se
   * dijo que quedaba: mientras esté, no se cambia nada y se le pide la clave otra vez a esa persona.
   */
  pendiente: (Pendiente<Orden> & { quien: QuienAutoriza; queda: string; para: string }) | null;
}

export const precioNuevo = (linea: string): EstadoDePrecio => ({ linea, paso: "forma", cliente: null, nuevo: null, mas: true, diferencia: "", pendiente: null });

// Los precios llevan hasta cuatro decimales: se suman en diezmilésimas de peso, enteras, para no perder ninguna.
const enDiezmilesimas = (t: string): number => Math.round(Number(t) * 10_000);
const enPesos = (d: number): string => (d / 10_000).toFixed(4);
const sinPunto = (tecleado: string): string => tecleado.replace(/\.$/, "");
const diferenciaLista = (tecleado: string): boolean => /^\d{1,5}(\.\d{1,4})?$/.test(sinPunto(tecleado)) && Number(tecleado) > 0;
/** Los rechazos que quieren decir que la cuenta —o ese material— ya no está como se ve. */
const CAMBIO_LA_CUENTA = ["RC001", "RC005", "RC006", "RC011"];
/** El nombre de un cliente nuevo, como se manda: sin espacios de más. */
const nombreLimpio = (t: string): string => t.trim().replace(/\s+/g, " ");

export function PrecioEspecial(p: {
  cuenta: Cuenta; material: MaterialDeCuenta; e: EstadoDePrecio; poner: (cambio: Partial<EstadoDePrecio>) => void;
  /** Quedó dado: la cuenta como quedó, si el servidor la devolvió, y qué decir. */
  alTerminar: (mensaje: string, cuenta?: Cuenta) => void;
  /** Se sale sin darlo. Con aviso: algo cambió, y hay que volver a ver la cuenta. */
  alSalir: (aviso?: string) => void;
}) {
  const { cuenta, material: m, e, poner } = p;
  const { ocupado, aviso, setAviso, hacer } = useAccion();
  const [clientes, setClientes] = useState<Cliente[] | null>(null);
  const [quienes, setQuienes] = useState<QuienAutoriza[] | null>(null);
  const pendiente = e.pendiente ?? null;
  const hayPendiente = pendiente !== null;
  // Un cliente por cuenta: si la cuenta ya está a nombre de alguien, el precio es para esa persona.
  const fijo = cuenta.cliente;

  useEffect(() => {
    if (fijo) return;
    pedir<{ clientes: Cliente[] }>("GET", "/api/clientes").then((r) => setClientes(r.clientes)).catch(() => setClientes([]));
  }, [fijo]);
  // Quiénes pueden autorizar: se pide al llegar a ese paso, y otra vez cuando un envío se suelta.
  useEffect(() => {
    if (e.paso !== "autorizar") return;
    pedir<{ personas: QuienAutoriza[] }>("GET", "/api/inventario/autorizan").then((r) => setQuienes(r.personas)).catch(() => setQuienes([]));
  }, [e.paso, hayPendiente]);

  const cliente = fijo ?? e.cliente;
  const nombreNuevo = e.nuevo === null ? "" : nombreLimpio(e.nuevo);
  const para = cliente?.nombre ?? nombreNuevo;
  const lista = enDiezmilesimas(m.precioDeLista);
  const diferencia = diferenciaLista(e.diferencia) ? enDiezmilesimas(sinPunto(e.diferencia)) : 0;
  const queda = enPesos(lista + (e.mas ? diferencia : -diferencia));
  const quedaBien = diferencia > 0 && Number(queda) > 0 && Number(queda) <= 99_999.9999;
  const listo = quedaBien && para !== "" && para.length <= 80;
  // Lo que se dijo al autorizar un envío del que no se supo es lo que se sigue diciendo: es ese el que está en camino.
  const dicho = pendiente ?? { queda, para };

  if (e.paso === "autorizar") {
    /** Que autorice otra persona un envío del que no se supo: primero se resuelve ese envío. */
    const soltar = (): Promise<void> =>
      hacer(async () => {
        if (!pendiente) return;
        if ((await cancelarEnvio(pendiente.id)) === "entro") p.alTerminar(`Ese precio especial ya había quedado dado: ${m.material.nombre} en ${precio(pendiente.queda)} por kilo, para ${pendiente.para}.`);
        else poner({ pendiente: null });
      });

    const autorizar = (quien: QuienAutoriza, clave: string): Promise<void> =>
      hacer(async () => {
        let suelto = false;
        const nuevo = (): NonNullable<EstadoDePrecio["pendiente"]> => ({
          id: identificador(), quien, queda, para,
          cuerpo: {
            linea: m.id, visto: m.eventoDePrecio, cliente: cliente?.id ?? null, clienteNuevo: cliente ? null : nombreNuevo,
            diferencia: (e.mas ? "" : "-") + sinPunto(e.diferencia), autoriza: quien.id,
          },
        });
        try {
          const r = await enviar<{ cuenta: Cuenta }, NonNullable<EstadoDePrecio["pendiente"]>>(
            `/api/cuentas/${cuenta.id}/precio-especial`, pendiente, nuevo, (guardado) => { suelto = guardado === null; poner({ pendiente: guardado }); }, { clave },
          );
          if (r) p.alTerminar(`Precio especial: ${m.material.nombre} queda en ${precio(dicho.queda)} por kilo, para ${dicho.para}.`, r.cuenta);
        } catch (err) {
          // Lo que se rechaza porque la cuenta ya no es la que se ve —le cambiaron el precio a ese
          // material, se cobró, se descartó, se cerró el día— no se arregla desde aquí: se dice, y
          // se vuelve a ver la cuenta como quedó. Lo demás (la clave, quién autoriza) se queda aquí.
          if (err instanceof ErrorDeApi && suelto && CAMBIO_LA_CUENTA.includes(err.codigo)) {
            p.alSalir(err.codigo === "RC011"
              ? "El precio de ese material cambió mientras lo tenías abierto. Míralo como quedó antes de cambiarlo otra vez."
              : `${err.message}. No se dio el precio especial.`);
            return;
          }
          throw err;
        }
      });

    return (
      <Autorizar
        titulo="Autorizar el precio especial"
        explicacion={pendiente && !ocupado
          ? "No se supo si el precio especial quedó dado. Teclea la clave otra vez: si ya había entrado, no se da dos veces."
          : `${m.material.nombre}: lista ${precio(m.precioDeLista)} → queda ${precio(dicho.queda)} por kilo, para ${dicho.para}.`}
        personas={quienes} quien={pendiente?.quien} alSoltar={soltar} boton={(nombre) => `Autorizar a nombre de ${nombre}`} cancelar="Regresar"
        aviso={aviso} ocupado={ocupado} alAutorizar={autorizar} alCancelar={() => { setAviso(""); poner({ paso: "forma" }); }}
      />
    );
  }

  return (
    <div className="card">
      <div className="pad">
        <p className="que">
          <b>Precio especial · {m.material.nombre}</b>
          <span>Lista: {precio(m.precioDeLista)} por kilo{m.precioEspecial ? ` · hoy lleva ${precio(m.precio)}` : ""}</span>
        </p>

        {pendiente ? (
          <div className="flag" role="alert">
            <b>No se supo si este precio especial quedó dado.</b> No lo cambies: vuelve a autorizarlo, y si ya había entrado no se da dos veces.
          </div>
        ) : (
          <>
            <p className="lbl">¿A qué cliente?</p>
            {fijo ? (
              <p className="note" style={{ marginTop: 0 }}>Esta cuenta ya está a nombre de <b>{fijo.nombre}</b>: el precio es para ese cliente.</p>
            ) : e.nuevo !== null ? (
              <>
                <label className="lbl" htmlFor="cliente-nuevo">Nombre del cliente nuevo</label>
                <input
                  id="cliente-nuevo" className="campo" type="text" value={e.nuevo} maxLength={80} autoComplete="off" autoCapitalize="words" enterKeyHint="done"
                  onChange={(x) => poner({ nuevo: x.target.value })}
                />
                <button className="btn ghostbtn chico" type="button" onClick={() => poner({ nuevo: null })}>Elegir uno de la lista</button>
              </>
            ) : (
              <>
                {clientes === null ? <p className="cargando">Un momento…</p> : null}
                {clientes?.length === 0 ? <p className="note" style={{ marginTop: 0 }}>Todavía no hay clientes registrados.</p> : null}
                <div className="grid">
                  {clientes?.map((c) => (
                    <button key={c.id} type="button" className="mat" aria-pressed={e.cliente?.id === c.id} onClick={() => poner({ cliente: c })}>
                      <b>{c.nombre}</b>
                    </button>
                  ))}
                </div>
                <button className="btn ghostbtn chico" type="button" onClick={() => poner({ cliente: null, nuevo: "" })}>Es un cliente nuevo</button>
              </>
            )}

            <p className="lbl" style={{ marginTop: 16 }}>¿Cuánto de diferencia por kilo?</p>
            <div className="chips">
              <button type="button" className="chip" aria-pressed={e.mas} onClick={() => poner({ mas: true })}>Más que la lista</button>
              <button type="button" className="chip" aria-pressed={!e.mas} onClick={() => poner({ mas: false })}>Menos que la lista</button>
            </div>
            <Visor
              nombre="Diferencia por kilo" nota={e.mas ? "Se suma al precio de lista." : "Se resta del precio de lista."} valor={e.diferencia}
              unidad="$/kg" leyenda={`Diferencia tecleada: ${e.diferencia || "nada"} pesos por kilo`}
            />
            <Teclado valor={e.diferencia} alCambiar={(diferencia) => poner({ diferencia })} decimales={4} enteros={5} />
          </>
        )}

        <p className="queda" role="status">
          {quedaBien || pendiente
            ? <>Lista {precio(m.precioDeLista)} → queda <b>{precio(dicho.queda)}</b> por kilo{dicho.para ? `, para ${dicho.para}` : ""}.</>
            : diferencia > 0 ? "El precio tiene que quedar mayor que cero." : "Teclea la diferencia para ver cómo queda."}
        </p>
        {aviso ? <div className="flag" role="alert">{aviso}</div> : null}
        <button className="btn" type="button" disabled={!pendiente && !listo} onClick={() => { setAviso(""); poner({ paso: "autorizar" }); window.scrollTo(0, 0); }}>
          {pendiente ? "Volver a autorizar" : "Autorizar el precio especial"}
        </button>
        {!pendiente ? <button className="btn ghostbtn chico" type="button" onClick={() => p.alSalir()}>No dar precio especial</button> : null}
      </div>
    </div>
  );
}
