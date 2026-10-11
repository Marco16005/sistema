"use client";
// La hoja: lo que interrumpe —autorizar, confirmar— sube desde abajo y tapa lo demás.
//
// Usa el diálogo nativo del navegador, que ya trae lo difícil: lo de atrás queda inerte, el foco
// no sale, y no se saca del árbol de la página (se queda dentro de quien la abre).
//
// La hoja no decide nada. Se muestra porque su dueño lo dice (está montada), y se cierra solo si
// su dueño lo permite: `alCerrar` es lo que hace Escape; sin él, no se cierra. Cerrar una hoja
// nunca suelta un envío: eso lo resuelve quien lo mandó. Si el navegador la cierra por su cuenta
// (algunos lo hacen al segundo Escape, pase lo que pase), vuelve a mostrarse mientras siga montada.
import { useEffect, useRef } from "react";
import type { ReactNode } from "react";

interface Props {
  /** Cómo se llama, para quien no la ve. */
  titulo: string;
  /** Lo que hace Escape. Sin esto —ocupada, o con un envío del que no se supo— la hoja no se cierra. */
  alCerrar?: (() => void) | null;
  children: ReactNode;
}

export function Hoja({ titulo, alCerrar, children }: Props) {
  const dialogo = useRef<HTMLDialogElement>(null);
  const cerrar = useRef(alCerrar);
  cerrar.current = alCerrar;
  /** El último control que tuvo el foco aquí dentro: a él vuelve si el navegador la cierra y reaparece. */
  const ultimo = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const d = dialogo.current;
    if (!d) return;
    // Quién tenía el foco al abrir: a él se le devuelve cuando la hoja se va de verdad. Si lo que
    // la abrió ya se fue de la pantalla, el navegador dice que el foco está «en la página»: en nadie.
    const enfocado = document.activeElement;
    const antes = enfocado instanceof HTMLElement && enfocado !== document.body && enfocado !== document.documentElement ? enfocado : null;
    let montada = true;
    const mostrar = (): void => {
      // showModal, y no el atributo `open`: es lo que la pone encima y deja inerte lo demás.
      if (!d.open && d.isConnected) d.showModal();
    };
    mostrar();

    const alCancelar = (e: Event): void => {
      // Escape nunca la cierra por su cuenta: o lo decide el dueño, o no pasa nada.
      e.preventDefault();
      cerrar.current?.();
    };
    const alCerrarse = (): void => {
      // El navegador la cerró sin permiso. Su dueño la sigue teniendo montada: vuelve.
      if (!montada || !d.isConnected) return;
      // Se anota antes de mostrarla: al mostrarse, el navegador pone el foco en su primer control,
      // y eso pasa por «el último que tuvo el foco» y lo pisa.
      const volver = ultimo.current;
      mostrar();
      if (volver?.isConnected) volver.focus();
    };
    const alEnfocar = (e: FocusEvent): void => {
      if (e.target instanceof HTMLElement && e.target !== d) ultimo.current = e.target;
    };
    d.addEventListener("cancel", alCancelar);
    d.addEventListener("close", alCerrarse);
    d.addEventListener("focusin", alEnfocar);
    return () => {
      montada = false;
      d.removeEventListener("cancel", alCancelar);
      d.removeEventListener("close", alCerrarse);
      d.removeEventListener("focusin", alEnfocar);
      if (d.open) d.close();
      // El foco vuelve a donde estaba; si eso ya no existe, a la página, que es un lugar con sentido.
      if (antes?.isConnected) antes.focus();
      else document.querySelector<HTMLElement>("[data-regreso-del-foco]")?.focus();
    };
  }, []);

  return (
    <dialog ref={dialogo} className="hoja" aria-label={titulo}>
      {children}
    </dialog>
  );
}
