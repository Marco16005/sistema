// Lo que hace un navegador frente a las rutas, para probarlas como funciones: guarda la cookie que
// le dan, la presenta en la petición siguiente, y dice de qué origen viene y quién cree que atiende.
process.env.SESION_CLAVE = "una clave de prueba para sellar la cookie, bien larga";

export const ORIGEN = "http://mostrador.test";

export type Manejador = (peticion: Request, extra?: { params?: Promise<Record<string, string>> }) => Promise<Response>;

export interface Extra {
  origen?: string | null;
  persona?: string | null;
  crudo?: string;
  tipo?: string | null;
  /** Lo que la dirección trae entre corchetes. */
  parametros?: Record<string, string>;
}

export class Navegador {
  cookie = "";
  /** Como quién cree estar actuando esta pestaña. */
  persona: string | null = null;

  async pedir(manejador: Manejador, metodo: "GET" | "POST", camino: string, cuerpo?: unknown, extra: Extra = {}): Promise<Response> {
    const encabezados = new Headers();
    if (this.cookie) encabezados.set("cookie", this.cookie);
    if (metodo === "POST") {
      const origen = extra.origen === undefined ? ORIGEN : extra.origen;
      if (origen) encabezados.set("origin", origen);
      const tipo = extra.tipo === undefined ? "application/json" : extra.tipo;
      if (tipo) encabezados.set("content-type", tipo);
      const persona = extra.persona === undefined ? this.persona : extra.persona;
      if (persona) encabezados.set("x-persona", persona);
    }
    const r = await manejador(
      new Request(ORIGEN + camino, {
        method: metodo,
        headers: encabezados,
        body: metodo === "POST" ? (extra.crudo ?? JSON.stringify(cuerpo ?? {})) : undefined,
      }),
      { params: Promise.resolve(extra.parametros ?? {}) },
    );
    const puesta = r.headers.get("set-cookie");
    if (puesta) this.cookie = puesta.split(";")[0]!;
    return r;
  }

  /** Pide y devuelve el cuerpo ya leído; falla si la respuesta no fue 200. */
  async bien(manejador: Manejador, metodo: "GET" | "POST", camino: string, cuerpo?: unknown, extra: Extra = {}): Promise<any> {
    const r = await this.pedir(manejador, metodo, camino, cuerpo, extra);
    const datos = await r.json();
    if (r.status !== 200) throw new Error(`${metodo} ${camino} respondió ${r.status}: ${JSON.stringify(datos)}`);
    return datos;
  }
}
