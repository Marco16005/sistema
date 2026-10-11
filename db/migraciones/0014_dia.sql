-- El día del patio, y las acciones que lo echan a andar: terminar el arranque, abrir la jornada de
-- hoy y publicar la lista de hoy.
--
-- Qué día es «hoy» lo dice la base, con la zona horaria del patio: no el reloj del servidor, que
-- puede estar en otra parte, ni el del navegador. La aplicación ya no escoge la fecha de la
-- jornada, ni cuál lista publica, ni cuál jornada cierra: pide «la de hoy» y «la que está abierta».

ALTER TABLE sucursal ADD COLUMN zona text NOT NULL DEFAULT 'America/Mexico_City';

CREATE FUNCTION hoy_en(p_sucursal smallint) RETURNS date
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT (clock_timestamp() AT TIME ZONE zona)::date FROM sucursal WHERE id = p_sucursal;
$$;

CREATE FUNCTION abrir_jornada_de_hoy(p_usuario bigint) RETURNS jornada
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  u usuario;
BEGIN
  u := exigir_rol(p_usuario, 'responsable', 'mostrador');
  RETURN abrir_jornada(u.sucursal_id, hoy_en(u.sucursal_id), p_usuario);
END $$;

CREATE FUNCTION publicar_lista_de_hoy(p_usuario bigint) RETURNS lista_precios
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  u usuario;
BEGIN
  u := exigir_rol(p_usuario, 'responsable');
  RETURN publicar_lista((SELECT id FROM lista_precios WHERE jornada_id = jornada_abierta(u.sucursal_id)), p_usuario);
END $$;

CREATE FUNCTION cerrar_jornada_abierta(p_usuario bigint) RETURNS jornada
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  u usuario;
BEGIN
  u := exigir_rol(p_usuario, 'mostrador', 'responsable');
  RETURN cerrar_jornada(jornada_abierta(u.sucursal_id), p_usuario);
END $$;

-- ── terminar el arranque ────────────────────────────────────────────────────
--
-- Cargar lo que ya hay en el patio y cerrar el corte, en una sola acción.
--
-- El saldo inicial se captura una vez, antes de empezar a operar. Hacerlo con llamadas sueltas
-- tendría dos problemas: una repetida duplicaría el saldo —el libro no se edita—, y quedaría un
-- estado a medias entre «ya cargué algo» y «ya cerré». Aquí o entra todo y se cierra, o no entra
-- nada. Repetirla no hace daño: la segunda encuentra el corte cerrado y se rechaza.
--
-- p_saldos es una lista de {"material": 23, "kg": "10000", "origen": "estimado"}. Vacía vale:
-- es arrancar en ceros. Lo que después resulte distinto se corrige por conteo, que deja explicación.

CREATE FUNCTION terminar_arranque(p_saldos jsonb, p_usuario bigint) RETURNS sucursal
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  u          usuario;
  s          jsonb;
  v_material int;
  v_kg       numeric;
  v_origen   text;
BEGIN
  u := exigir_rol(p_usuario, 'responsable');
  IF p_saldos IS NULL OR jsonb_typeof(p_saldos) <> 'array' THEN
    RAISE EXCEPTION 'El saldo inicial llega como una lista de materiales' USING ERRCODE = 'RC005';
  END IF;
  -- El candado del patio, antes que nada: es el mismo que toma el libro, así que dos arranques a
  -- la vez pasan de uno en uno y el segundo encuentra el corte ya cerrado.
  PERFORM pg_advisory_xact_lock(7151, u.sucursal_id);
  IF (SELECT corte_cerrado_en FROM sucursal WHERE id = u.sucursal_id) IS NOT NULL THEN
    RAISE EXCEPTION 'El arranque ya se terminó: el saldo inicial ya no se carga, se ajusta por conteo' USING ERRCODE = 'RC003';
  END IF;

  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_saldos) e
             WHERE jsonb_typeof(e) <> 'object' OR coalesce(e->>'material', '') !~ '^[0-9]{1,9}$') THEN
    RAISE EXCEPTION 'A un saldo le falta su material' USING ERRCODE = 'RC005';
  END IF;
  IF (SELECT count(*) <> count(DISTINCT e->>'material') FROM jsonb_array_elements(p_saldos) e) THEN
    RAISE EXCEPTION 'Un material viene dos veces en el saldo inicial' USING ERRCODE = 'RC005';
  END IF;

  FOR s IN SELECT e FROM jsonb_array_elements(p_saldos) e ORDER BY (e->>'material')::int LOOP
    v_material := (s->>'material')::int;
    v_origen := s->>'origen';
    IF coalesce(s->>'kg', '') !~ '^-?[0-9]{1,9}(\.[0-9]{1,9})?$' THEN
      RAISE EXCEPTION 'El peso tiene que ser un número' USING ERRCODE = 'RC004';
    END IF;
    v_kg := (s->>'kg')::numeric;
    PERFORM exigir_kilos(v_kg);
    IF v_origen IS NULL OR v_origen NOT IN ('contado', 'estimado') THEN
      RAISE EXCEPTION 'Cada saldo dice si fue contado o estimado' USING ERRCODE = 'RC005';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM material WHERE id = v_material AND sucursal_id = u.sucursal_id AND activo) THEN
      RAISE EXCEPTION 'El material % no existe o está dado de baja', v_material USING ERRCODE = 'RC005';
    END IF;
    PERFORM registrar_apertura(v_material, v_kg, v_origen, p_usuario);
  END LOOP;
  RETURN cerrar_corte(u.sucursal_id, p_usuario);
END $$;

-- La aplicación pide lo de hoy: ya no carga saldos sueltos, ni cierra el corte aparte, ni escoge
-- la fecha de la jornada o la lista que publica.
REVOKE EXECUTE ON FUNCTION
  registrar_apertura(int, numeric, text, bigint),
  cerrar_corte(smallint, bigint),
  abrir_jornada(smallint, date, bigint),
  publicar_lista(bigint, bigint),
  cerrar_jornada(bigint, bigint)
FROM feruga_app;
GRANT EXECUTE ON FUNCTION
  hoy_en(smallint),
  terminar_arranque(jsonb, bigint),
  abrir_jornada_de_hoy(bigint),
  publicar_lista_de_hoy(bigint),
  cerrar_jornada_abierta(bigint)
TO feruga_app;
