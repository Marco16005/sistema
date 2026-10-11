// La base habla de sus reglas con códigos de la clase RC. Aquí se convierten en un error que el
// resto del servidor reconoce; todo lo demás sigue de largo sin tocarse.

/** Una regla del negocio que no dejó pasar la acción. Su mensaje es para la persona que atiende. */
export class ErrorDeNegocio extends Error {
  readonly codigo: string;

  constructor(codigo: string, mensaje: string) {
    super(mensaje);
    this.name = "ErrorDeNegocio";
    this.codigo = codigo;
  }
}

const DE_NEGOCIO = /^RC\d{3}$/;

export function traducir(error: unknown): unknown {
  const e = error as { code?: unknown; message?: unknown } | null;
  if (e && typeof e.code === "string" && DE_NEGOCIO.test(e.code) && typeof e.message === "string") {
    return new ErrorDeNegocio(e.code, e.message);
  }
  return error;
}
