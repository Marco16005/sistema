-- Cuál respaldo de cada hora es el diario de cada día.
--
-- De cada día se guarda un respaldo un año (operacion/diario.ts). Cuál, se elige una vez. Esa
-- elección se escribía en el depósito diario, y se protegía preguntando antes por el turno de los
-- respaldos. Pero una escritura que ya salió no se detiene preguntando: la de una corrida que
-- perdió el turno podía llegar tarde y pisar la de la corrida que siguió, que había elegido otro.
-- Lo encontró Codex en su décima revisión, y otra vez al verificarla.
--
-- Ahora la elección se decide aquí, donde sí hay con qué: una fila por día, que se escribe una
-- sola vez —quien llega segundo se queda con la del primero— y no se cambia ni se borra. Lo que
-- se escribe en el depósito diario sale de esta fila, así que una escritura atrasada escribe lo
-- mismo que cualquiera. Viaja en el respaldo, como todo lo demás; si la base vuelve de un respaldo
-- anterior a una elección, se toma de la que quedó escrita en el depósito diario.
--
-- Es del servicio de respaldo, que entra como dueño de la base. La aplicación no la lee ni la toca.

CREATE TABLE respaldo_diario (
  dia        date PRIMARY KEY,
  objeto     text NOT NULL CHECK (objeto <> ''),
  bytes      bigint NOT NULL CHECK (bytes > 0),
  sha256     text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  elegido_en timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TRIGGER respaldo_diario_inmutable BEFORE UPDATE OR DELETE ON respaldo_diario
  FOR EACH ROW EXECUTE FUNCTION rechazar_cambio();
CREATE TRIGGER respaldo_diario_sin_vaciar BEFORE TRUNCATE ON respaldo_diario
  FOR EACH STATEMENT EXECUTE FUNCTION rechazar_cambio();
