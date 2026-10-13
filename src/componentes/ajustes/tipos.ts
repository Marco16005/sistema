// Lo que el servidor manda a los ajustes (src/servidor/dominio/administracion.ts).

export interface PersonaAdministrada {
  id: string;
  nombre: string;
  rol: string;
  puedeAutorizar: boolean;
  activa: boolean;
  bloqueada: boolean;
  /** El equipo en el que está adentro ahora, si lo está. */
  adentroDe: string | null;
  /** Si se le cambia la clave o se le da de baja desde la pantalla: mostrador, patio y consulta. */
  seAdministra: boolean;
}

export interface EquipoAdministrado {
  id: string;
  nombre: string;
  altaEl: string;
  activo: boolean;
  atiende: string | null;
  esEste: boolean;
}

/** Algo que se ve una sola vez: la clave de una persona, o el código de un equipo. */
export interface UnaVez {
  titulo: string;
  valor: string;
  nota: string;
  entendido: string;
}
