"use client";
// «Más contraste, para el sol»: un interruptor a un toque, en todas las pantallas. Lo que se elige
// se guarda en el servidor, por equipo, y se ve al instante; no recarga la página ni desmonta nada.
//
// No miente: mientras guarda no admite otro toque, y si no se pudo guardar vuelve a como estaba y
// lo dice. Mientras nadie haya elegido, dice lo que el equipo pide.
import { useSyncExternalStore } from "react";
import { Interruptor } from "./base/Interruptor.tsx";

interface Props {
  /** Lo que este equipo tiene elegido, según el servidor; nada si nunca se ha tocado. */
  elegido: "alto" | "normal" | null;
}

// ── lo que se sabe del contraste: uno solo para toda la página ─────────────
//
// El interruptor aparece en varias pantallas (las de entrada, la barra), y al pasar de una a otra
// el que se ve es otro. Si cada uno llevara su cuenta, el que aparece a medio guardar no sabría que
// se está guardando —y admitiría otro toque—, ni se enteraría de que no se pudo: diría una cosa y
// la pantalla mostraría otra. Por eso lo que se sabe vive aquí, fuera de todos, y todos lo leen.

interface Estado {
  alto: boolean;
  guardando: boolean;
  aviso: string;
}

/** Nada, mientras nadie haya mirado la página. */
let estado: Estado | null = null;
const oyentes = new Set<() => void>();
let siguiendoAlEquipo = false;

/** Lo que la página lleva puesto ahora. Sin elección manda el equipo. */
function loQueSeVe(): boolean {
  const puesto = document.documentElement.dataset.contraste;
  return puesto ? puesto === "alto" : window.matchMedia("(prefers-contrast: more)").matches;
}

function leer(): Estado {
  estado ??= { alto: loQueSeVe(), guardando: false, aviso: "" };
  return estado;
}

function publicar(cambio: Partial<Estado>): void {
  estado = { ...leer(), ...cambio };
  for (const oyente of oyentes) oyente();
}

function suscribir(oyente: () => void): () => void {
  oyentes.add(oyente);
  if (!siguiendoAlEquipo) {
    siguiendoAlEquipo = true;
    // Si el equipo cambia de parecer y nadie ha elegido, el interruptor lo sigue.
    window.matchMedia("(prefers-contrast: more)").addEventListener("change", () => publicar({ alto: loQueSeVe() }));
  }
  return () => { oyentes.delete(oyente); };
}

async function cambiar(): Promise<void> {
  const antes = leer();
  if (antes.guardando) return;
  const raiz = document.documentElement;
  const puesto = raiz.dataset.contraste;
  const nuevo = antes.alto ? "normal" : "alto";
  // Se ve de una vez; si no se guarda, se regresa.
  raiz.dataset.contraste = nuevo;
  publicar({ alto: nuevo === "alto", guardando: true, aviso: "" });
  try {
    const r = await fetch("/api/equipo/contraste", {
      method: "POST", cache: "no-store", credentials: "same-origin",
      headers: { "content-type": "application/json" }, body: JSON.stringify({ contraste: nuevo }),
    });
    if (!r.ok) throw new Error(String(r.status));
    publicar({ guardando: false });
  } catch {
    if (puesto === undefined) delete raiz.dataset.contraste;
    else raiz.dataset.contraste = puesto;
    // Lo que el interruptor dice es lo que se ve, no lo que decía antes: si mientras tanto el equipo
    // cambió de parecer, quitar lo elegido deja la pantalla siguiéndolo a él.
    publicar({ alto: loQueSeVe(), guardando: false, aviso: "No se pudo guardar. Sigue como estaba." });
  }
}

// Lo que el servidor pinta, y lo que la página dice mientras se engancha a lo que él mandó.
const DEL_SERVIDOR = {
  alto: { alto: true, guardando: false, aviso: "" },
  otro: { alto: false, guardando: false, aviso: "" },
} satisfies Record<string, Estado>;

/** Un sol: es para cuando pega el sol en la pantalla. */
const SOL = (
  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
  </svg>
);

export function Contraste({ elegido }: Props) {
  const { alto, guardando, aviso } = useSyncExternalStore(suscribir, leer, () => (elegido === "alto" ? DEL_SERVIDOR.alto : DEL_SERVIDOR.otro));
  return (
    <div className="ajuste">
      <Interruptor rotulo="Más contraste" encendido={alto} ocupado={guardando} alCambiar={() => void cambiar()} dibujo={SOL} />
      {aviso ? <span className="ajuste-aviso" role="alert">{aviso}</span> : null}
    </div>
  );
}
