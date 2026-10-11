-- Base: sucursal, personas, bitácora y las piezas comunes de inmutabilidad y autorización.
--
-- Códigos de error de negocio (clase RC):
--   RC001 registro inmutable            RC006 jornada: estado inválido
--   RC002 existencia insuficiente       RC007 la transformación no cuadra
--   RC003 apertura ya cerrada           RC008 falta autorización
--   RC004 pesada inválida               RC009 precio o lista no publicados
--   RC005 la cuenta no puede cambiar o terminarse así

CREATE TABLE sucursal (
  id                smallint PRIMARY KEY,
  nombre            text NOT NULL,
  -- Cerrado el corte de arranque, ya no se admite cargar saldo inicial.
  corte_cerrado_en  timestamptz,
  corte_cerrado_por bigint
);

CREATE TABLE usuario (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  sucursal_id     smallint NOT NULL REFERENCES sucursal,
  nombre          text NOT NULL,
  rol             text NOT NULL
                  CONSTRAINT rol_conocido CHECK (rol IN ('responsable', 'mostrador', 'patio', 'consulta', 'administracion')),
  -- El rol habilita; la facultad de autorizar correcciones se concede a personas concretas.
  puede_autorizar boolean NOT NULL DEFAULT false,
  activo          boolean NOT NULL DEFAULT true,
  CONSTRAINT autoriza_solo_responsable CHECK (NOT puede_autorizar OR rol = 'responsable')
);

ALTER TABLE sucursal
  ADD CONSTRAINT corte_cerrado_por_fk FOREIGN KEY (corte_cerrado_por) REFERENCES usuario,
  ADD CONSTRAINT corte_completo CHECK ((corte_cerrado_en IS NULL) = (corte_cerrado_por IS NULL));

INSERT INTO sucursal (id, nombre) VALUES (1, 'Patio');

CREATE TABLE bitacora (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ocurrido_en timestamptz NOT NULL DEFAULT now(),
  usuario_id  bigint REFERENCES usuario,
  accion      text NOT NULL,
  entidad     text NOT NULL,
  entidad_id  text,
  detalle     jsonb NOT NULL DEFAULT '{}'
);

-- Un solo disparador para toda tabla que solo admite inserciones.
CREATE FUNCTION rechazar_cambio() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  RAISE EXCEPTION 'La tabla % no admite %: sus registros no se modifican ni se borran', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'RC001';
END $$;

CREATE TRIGGER bitacora_inmutable BEFORE UPDATE OR DELETE ON bitacora
  FOR EACH ROW EXECUTE FUNCTION rechazar_cambio();
CREATE TRIGGER bitacora_sin_vaciar BEFORE TRUNCATE ON bitacora
  FOR EACH STATEMENT EXECUTE FUNCTION rechazar_cambio();

-- Devuelve a la persona si está activa y tiene uno de los roles pedidos; si no, falla.
CREATE FUNCTION exigir_rol(p_usuario bigint, VARIADIC p_roles text[]) RETURNS usuario
LANGUAGE plpgsql STABLE SET search_path = public, pg_temp AS $$
DECLARE
  u usuario;
BEGIN
  SELECT * INTO u FROM usuario WHERE id = p_usuario AND activo;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'La persona % no existe o está dada de baja', p_usuario USING ERRCODE = 'RC008';
  END IF;
  IF NOT (u.rol = ANY (p_roles)) THEN
    RAISE EXCEPTION '% tiene el rol % y esto requiere: %', u.nombre, u.rol, array_to_string(p_roles, ', ')
      USING ERRCODE = 'RC008';
  END IF;
  RETURN u;
END $$;

CREATE FUNCTION anotar(p_usuario bigint, p_accion text, p_entidad text, p_entidad_id text, p_detalle jsonb DEFAULT '{}')
RETURNS void
LANGUAGE sql SET search_path = public, pg_temp AS $$
  INSERT INTO bitacora (usuario_id, accion, entidad, entidad_id, detalle)
  VALUES (p_usuario, p_accion, p_entidad, p_entidad_id, p_detalle);
$$;

-- Rastro de los cambios a catálogos y personas. Quién lo hizo llega en la variable de sesión
-- feruga.usuario, que la aplicación fija en cada transacción.
CREATE FUNCTION auditar() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  INSERT INTO bitacora (usuario_id, accion, entidad, detalle)
  VALUES (
    nullif(current_setting('feruga.usuario', true), '')::bigint,
    lower(TG_OP),
    TG_TABLE_NAME,
    jsonb_build_object(
      'antes',   CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD) END,
      'despues', CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW) END));
  RETURN NULL;
END $$;

CREATE TRIGGER usuario_auditado AFTER INSERT OR UPDATE OR DELETE ON usuario
  FOR EACH ROW EXECUTE FUNCTION auditar();
