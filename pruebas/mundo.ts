// Un mundo para probar las rutas como funciones: una persona de cada rol con su clave, y
// navegadores en equipos dados de alta.
import type pg from "pg";
import { conBase, una, urlApp } from "./apoyo.ts";
import { Navegador } from "./navegador.ts";
import type { Manejador } from "./navegador.ts";
import { crearBd, usarBd } from "../src/servidor/bd.ts";

export type Rol = "responsable" | "mostrador" | "patio" | "consulta" | "administracion";
export const TODOS: Rol[] = ["responsable", "mostrador", "patio", "consulta", "administracion"];
export const CLAVES: Record<Rol, string> = { responsable: "481516", mostrador: "4815", patio: "2718", consulta: "3141", administracion: "271828" };

export interface Mundo {
  db: pg.Client;
  base: string;
  /** El identificador de la persona de cada rol. La responsable es además quien autoriza. */
  personas: Record<Rol, string>;
  /** Un navegador en un equipo dado de alta, sin nadie adentro. */
  equipo(): Promise<Navegador>;
  /** Un navegador con la persona de ese rol ya adentro. */
  adentro(rol: Rol): Promise<Navegador>;
}

export const conMundo = (prueba: (m: Mundo) => Promise<void>) =>
  conBase(async (db, base) => {
    const bd = crearBd(await urlApp(base), { conexiones: 4 });
    usarBd(bd);
    try {
      const personas = {} as Record<Rol, string>;
      for (const rol of TODOS) {
        personas[rol] = (await una(db, "SELECT * FROM alta_persona($1, $2, $3, $4)", [`De ${rol}`, rol, rol === "responsable", CLAVES[rol]])).id;
      }
      const { POST: alta } = await import("../src/app/api/equipo/alta/route.ts");
      const { POST: entrar } = await import("../src/app/api/sesion/entrar/route.ts");
      const m: Mundo = {
        db, base, personas,
        async equipo() {
          const n = new Navegador();
          await n.bien(alta, "POST", "/api/equipo/alta", { codigo: (await una(db, "SELECT crear_codigo_alta('Mostrador') AS c")).c });
          return n;
        },
        async adentro(rol) {
          const n = await m.equipo();
          await n.bien(entrar, "POST", "/api/sesion/entrar", { persona: personas[rol], clave: CLAVES[rol] });
          n.persona = personas[rol];
          return n;
        },
      };
      await prueba(m);
    } finally {
      usarBd(null);
      await bd.cerrar();
    }
  });

/** El manejador de una ruta, por su camino bajo src/app/api. */
export const ruta = async (camino: string, metodo: "GET" | "POST"): Promise<Manejador> =>
  (await import(new URL(`../src/app/api/${camino}/route.ts`, import.meta.url).href))[metodo];
