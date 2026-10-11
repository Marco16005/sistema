-- Jornada y lista de precios del día. Los precios se publican una vez por jornada y desde ese
-- momento no cambian: cada renglón del día queda atado a esa lista.

CREATE TABLE jornada (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  sucursal_id smallint NOT NULL REFERENCES sucursal,
  fecha       date NOT NULL,
  abierta_en  timestamptz NOT NULL DEFAULT now(),
  abierta_por bigint NOT NULL REFERENCES usuario,
  cerrada_en  timestamptz,
  cerrada_por bigint REFERENCES usuario,
  UNIQUE (sucursal_id, fecha),
  CONSTRAINT cierre_completo CHECK ((cerrada_en IS NULL) = (cerrada_por IS NULL))
);
-- Una sola jornada abierta por sucursal.
CREATE UNIQUE INDEX jornada_una_abierta ON jornada (sucursal_id) WHERE cerrada_en IS NULL;

-- La jornada abierta de la sucursal; si no hay, falla.
CREATE FUNCTION jornada_abierta(p_sucursal smallint) RETURNS bigint
LANGUAGE plpgsql STABLE SET search_path = public, pg_temp AS $$
DECLARE
  v bigint;
BEGIN
  SELECT id INTO v FROM jornada WHERE sucursal_id = p_sucursal AND cerrada_en IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No hay jornada abierta' USING ERRCODE = 'RC006';
  END IF;
  RETURN v;
END $$;

CREATE TABLE lista_precios (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  jornada_id    bigint NOT NULL UNIQUE REFERENCES jornada,
  publicada_en  timestamptz,
  publicada_por bigint REFERENCES usuario,
  CONSTRAINT publicacion_completa CHECK ((publicada_en IS NULL) = (publicada_por IS NULL))
);

CREATE TABLE precio (
  lista_id    bigint NOT NULL REFERENCES lista_precios,
  material_id int NOT NULL REFERENCES material,
  compra      numeric(14,4) NOT NULL CHECK (compra >= 0 AND compra <> 'NaN'),
  venta       numeric(14,4) NOT NULL CHECK (venta >= 0 AND venta <> 'NaN'),
  PRIMARY KEY (lista_id, material_id)
);

-- Una lista publicada no se toca: ni ella ni sus precios.
CREATE FUNCTION lista_publicada_no_cambia() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF OLD.publicada_en IS NOT NULL THEN
    RAISE EXCEPTION 'La lista de precios % ya está publicada y no se modifica', OLD.id USING ERRCODE = 'RC001';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;
CREATE TRIGGER lista_publicada_no_cambia BEFORE UPDATE OR DELETE ON lista_precios
  FOR EACH ROW EXECUTE FUNCTION lista_publicada_no_cambia();

-- Quien cambia un precio bloquea su lista contra la publicación: si la lista se está publicando,
-- espera, y al releerla la encuentra publicada.
CREATE FUNCTION precio_solo_antes_de_publicar() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  l lista_precios;
BEGIN
  FOR l IN
    SELECT * FROM lista_precios
    WHERE id IN (CASE WHEN TG_OP <> 'INSERT' THEN OLD.lista_id END, CASE WHEN TG_OP <> 'DELETE' THEN NEW.lista_id END)
    ORDER BY id
    FOR SHARE
  LOOP
    IF l.publicada_en IS NOT NULL THEN
      RAISE EXCEPTION 'La lista de precios ya está publicada: sus precios no se agregan, cambian ni quitan'
        USING ERRCODE = 'RC001';
    END IF;
  END LOOP;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;
CREATE TRIGGER precio_solo_antes_de_publicar BEFORE INSERT OR UPDATE OR DELETE ON precio
  FOR EACH ROW EXECUTE FUNCTION precio_solo_antes_de_publicar();

CREATE TRIGGER jornada_sin_vaciar BEFORE TRUNCATE ON jornada
  FOR EACH STATEMENT EXECUTE FUNCTION rechazar_cambio();
CREATE TRIGGER lista_sin_vaciar BEFORE TRUNCATE ON lista_precios
  FOR EACH STATEMENT EXECUTE FUNCTION rechazar_cambio();
CREATE TRIGGER precio_sin_vaciar BEFORE TRUNCATE ON precio
  FOR EACH STATEMENT EXECUTE FUNCTION rechazar_cambio();

-- Abre la jornada y deja lista, sin publicar, una copia de los últimos precios publicados:
-- si hoy no cambió nada, el responsable solo revisa y publica.
CREATE FUNCTION abrir_jornada(p_sucursal smallint, p_fecha date, p_usuario bigint) RETURNS jornada
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  j       jornada;
  v_lista bigint;
  v_antes bigint;
BEGIN
  PERFORM exigir_rol(p_usuario, 'responsable', 'mostrador');
  IF EXISTS (SELECT 1 FROM jornada WHERE sucursal_id = p_sucursal AND cerrada_en IS NULL) THEN
    RAISE EXCEPTION 'Ya hay una jornada abierta: hay que cerrarla antes de abrir otra' USING ERRCODE = 'RC006';
  END IF;
  IF EXISTS (SELECT 1 FROM jornada WHERE sucursal_id = p_sucursal AND fecha = p_fecha) THEN
    RAISE EXCEPTION 'La jornada del % ya existe', p_fecha USING ERRCODE = 'RC006';
  END IF;

  SELECT l.id INTO v_antes
  FROM lista_precios l JOIN jornada jj ON jj.id = l.jornada_id
  WHERE jj.sucursal_id = p_sucursal AND l.publicada_en IS NOT NULL
  ORDER BY jj.fecha DESC LIMIT 1;

  INSERT INTO jornada (sucursal_id, fecha, abierta_por) VALUES (p_sucursal, p_fecha, p_usuario) RETURNING * INTO j;
  INSERT INTO lista_precios (jornada_id) VALUES (j.id) RETURNING id INTO v_lista;
  IF v_antes IS NOT NULL THEN
    INSERT INTO precio (lista_id, material_id, compra, venta)
    SELECT v_lista, material_id, compra, venta FROM precio WHERE lista_id = v_antes;
  END IF;
  PERFORM anotar(p_usuario, 'abrir', 'jornada', j.id::text, jsonb_build_object('fecha', p_fecha));
  RETURN j;
END $$;

CREATE FUNCTION publicar_lista(p_lista bigint, p_usuario bigint) RETURNS lista_precios
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  l lista_precios;
  n int;
BEGIN
  PERFORM exigir_rol(p_usuario, 'responsable');
  SELECT * INTO l FROM lista_precios WHERE id = p_lista FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'La lista de precios % no existe', p_lista USING ERRCODE = 'RC009';
  END IF;
  IF l.publicada_en IS NOT NULL THEN
    RAISE EXCEPTION 'La lista de precios % ya está publicada', p_lista USING ERRCODE = 'RC001';
  END IF;
  SELECT count(*) INTO n FROM precio WHERE lista_id = p_lista;
  IF n = 0 THEN
    RAISE EXCEPTION 'La lista no tiene precios: no hay nada que publicar' USING ERRCODE = 'RC009';
  END IF;
  UPDATE lista_precios SET publicada_en = now(), publicada_por = p_usuario WHERE id = p_lista RETURNING * INTO l;
  PERFORM anotar(p_usuario, 'publicar', 'lista_precios', p_lista::text, jsonb_build_object('precios', n));
  RETURN l;
END $$;
