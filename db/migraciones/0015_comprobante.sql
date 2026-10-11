-- Las impresiones del comprobante.
--
-- El comprobante no se guarda como documento: se rearma del libro cada vez, y lo que el libro
-- dice de una cuenta confirmada —pesos, precios, importes, total— no cambia. Lo que sí se guarda
-- es cada vez que se mandó a imprimir: la primera es el original; de la segunda en adelante es una
-- reimpresión, lleva motivo y sale marcada con su número.
--
-- Se registra el intento, antes de abrir el diálogo de impresión, porque el navegador no puede
-- decir si el papel salió. Por eso el motivo más común de una reimpresión es justo ese: no salió.

CREATE TABLE impresion (
  id           uuid PRIMARY KEY,                    -- lo pone quien envía: repetir el envío no suma otra
  operacion_id uuid NOT NULL REFERENCES operacion,
  numero       int NOT NULL CHECK (numero >= 1),
  motivo       text,
  impresa_por  bigint NOT NULL REFERENCES usuario,
  impresa_en   timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (operacion_id, numero),
  CONSTRAINT reimpresion_con_motivo CHECK ((numero = 1) = (motivo IS NULL))
);
CREATE TRIGGER impresion_inmutable BEFORE UPDATE OR DELETE ON impresion
  FOR EACH ROW EXECUTE FUNCTION rechazar_cambio();
CREATE TRIGGER impresion_sin_vaciar BEFORE TRUNCATE ON impresion
  FOR EACH STATEMENT EXECUTE FUNCTION rechazar_cambio();

CREATE FUNCTION registrar_impresion(p_id uuid, p_operacion uuid, p_motivo text, p_usuario bigint) RETURNS impresion
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  op            operacion;
  i             impresion;
  v_numero      int;
  v_motivo      text := nullif(btrim(p_motivo), '');
  v_restriccion text;
BEGIN
  PERFORM exigir_rol(p_usuario, 'mostrador', 'responsable');
  IF p_id IS NULL THEN
    RAISE EXCEPTION 'La impresión llegó sin identificador' USING ERRCODE = 'RC005';
  END IF;
  -- La cuenta se bloquea: dos impresiones a la vez toman números distintos, una tras otra.
  SELECT * INTO op FROM operacion WHERE id = p_operacion FOR UPDATE;
  IF NOT FOUND OR op.estado <> 'confirmada' THEN
    RAISE EXCEPTION 'Solo se imprime el comprobante de una cuenta terminada' USING ERRCODE = 'RC005';
  END IF;

  SELECT * INTO i FROM impresion WHERE id = p_id;
  IF FOUND THEN
    IF i.operacion_id <> p_operacion THEN
      RAISE EXCEPTION 'Esa impresión ya se había registrado para otra cuenta' USING ERRCODE = 'RC005';
    END IF;
    RETURN i;       -- el mismo envío, otra vez
  END IF;

  SELECT coalesce(max(numero), 0) + 1 INTO v_numero FROM impresion WHERE operacion_id = p_operacion;
  IF v_numero = 1 THEN
    v_motivo := NULL;
  ELSIF v_motivo IS NULL THEN
    RAISE EXCEPTION 'Este comprobante ya se imprimió: la reimpresión lleva motivo' USING ERRCODE = 'RC005';
  ELSIF char_length(v_motivo) > 120 THEN
    RAISE EXCEPTION 'El motivo de la reimpresión lleva hasta 120 letras' USING ERRCODE = 'RC005';
  END IF;

  BEGIN
    INSERT INTO impresion (id, operacion_id, numero, motivo, impresa_por)
    VALUES (p_id, p_operacion, v_numero, v_motivo, p_usuario) RETURNING * INTO i;
  EXCEPTION WHEN unique_violation THEN
    -- El mismo identificador llegó a la vez para otra cuenta.
    GET STACKED DIAGNOSTICS v_restriccion = CONSTRAINT_NAME;
    IF v_restriccion = 'impresion_pkey' THEN
      RAISE EXCEPTION 'Esa impresión ya se había registrado para otra cuenta' USING ERRCODE = 'RC005';
    END IF;
    RAISE;
  END;
  IF v_numero > 1 THEN
    PERFORM anotar(p_usuario, 'reimprimir', 'operacion', p_operacion::text,
                   jsonb_build_object('numero', v_numero, 'motivo', v_motivo, 'folio', op.folio));
  END IF;
  RETURN i;
END $$;

GRANT SELECT ON impresion TO feruga_app;
GRANT EXECUTE ON FUNCTION registrar_impresion(uuid, uuid, text, bigint) TO feruga_app;
