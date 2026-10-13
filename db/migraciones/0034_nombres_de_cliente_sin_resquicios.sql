-- La regla de los nombres de cliente, sin resquicios. La 0033 la escribió; la revisión de
-- seguridad de ese guardado (13 de octubre de 2026) señaló que todavía dejaba hacerse pasar por
-- otro cliente, y se comprobó:
--
--   · Quitaba lo invisible DESPUÉS de juntar cada letra con su acento. Un invisible metido entre
--     la «e» y su acento impedía juntarlos, y al quitarlo quedaba una «é» escrita en dos piezas:
--     distinta de «José» para la base, igual a la vista. Ni siquiera era estable —aplicada otra
--     vez daba otra cosa—, así que la propia tabla la rechazaba, pero con un error crudo, y el
--     mostrador contestaba «algo falló» en vez de «ese cliente ya existe».
--   · No conocía lo invisible de fuera del plano básico de Unicode (los selectores de variación
--     del plano 14, las etiquetas, las marcas de formato musicales), ni los caracteres de control,
--     ni el blanco braille. «Don Chuy» con uno de esos al final era otro cliente.
--
-- Ahora: primero se quita todo lo que Unicode manda no pintar (Default_Ignorable_Code_Point,
-- completo) y los caracteres de control; después todo blanco es un espacio, sin dos seguidos ni a
-- las orillas; y AL FINAL se juntan las letras con sus acentos (NFC). En ese orden la regla es
-- estable: aplicarla a su propio resultado no cambia nada, que es lo que la tabla exige.
--
-- Lo que NO se cierra, a propósito: letras de otro alfabeto que se dibujan igual (una «а» cirílica
-- por una «a»), y las formas «de compatibilidad» (la ligadura «ﬁ» por «fi», las letras de ancho
-- completo). Juntarlas pediría la normalización NFKC, que también cambia lo que alguien sí quiso
-- escribir —«Nº» pasaría a «No», «Mª» a «Ma»—, o una tabla de parecidos que este sistema no
-- lleva. Un cliente en la lista no da nada por sí solo: cada precio especial sigue pidiendo la
-- clave de quien autoriza, que lee el nombre antes de teclearla. Lo que un nombre parecido puede
-- hacer es repartir en dos renglones lo que se le dio a uno; se ve en Clientes y se arregla
-- dando de baja el repetido.

CREATE OR REPLACE FUNCTION nombre_de_cliente(p_nombre text) RETURNS text
LANGUAGE plpgsql IMMUTABLE SET search_path = public, pg_temp AS $$
DECLARE
  v text := coalesce(p_nombre, '');
BEGIN
  v := regexp_replace(v,
    '[\u0001-\u0008\u000E-\u001F\u007F-\u0084\u0086-\u009F­͏؜ᅟᅠ឴឵᠋-᠏​-‏‪-‮⁠-⁯ㅤ︀-️﻿ﾠ￰-￻\U0001BCA0-\U0001BCA3\U0001D173-\U0001D17A\U000E0000-\U000E0FFF]',
    '', 'g');
  v := regexp_replace(v, '[\s\u0085   -     ⠀　]+', ' ', 'g');
  v := nullif(normalize(btrim(v, ' '), NFC), '');
  IF char_length(v) > 80 THEN
    RAISE EXCEPTION 'El nombre del cliente lleva hasta 80 letras' USING ERRCODE = 'RC005';
  END IF;
  RETURN v;
END $$;

-- Los clientes que ya existían pasan por la regla, igual que en la 0033: al que quedaría sin
-- nombre, o igual a otro, se le pone uno que dice cuál es —su número—, y se corrige después
-- renombrándolo por la consola.
DO $$
DECLARE
  r record;
  v text;
BEGIN
  FOR r IN SELECT id, nombre FROM cliente ORDER BY id LOOP
    v := nombre_de_cliente(left(r.nombre, 80));
    IF v IS NULL THEN
      v := 'Cliente sin nombre (' || r.id || ')';
    ELSIF v <> r.nombre AND EXISTS (SELECT 1 FROM cliente WHERE lower(nombre) = lower(v) AND id <> r.id) THEN
      v := left(v, 58) || ' (' || r.id || ')';
    END IF;
    IF v <> r.nombre THEN
      UPDATE cliente SET nombre = v WHERE id = r.id;
    END IF;
  END LOOP;
END $$;

-- La restricción es la misma, pero se vuelve a poner para que la base la compruebe ahora contra
-- todos los renglones: cambiar la función que nombra no los vuelve a mirar.
ALTER TABLE cliente DROP CONSTRAINT cliente_nombre_check;
ALTER TABLE cliente ADD CONSTRAINT cliente_nombre_check CHECK (nombre IS NOT DISTINCT FROM nombre_de_cliente(nombre));
