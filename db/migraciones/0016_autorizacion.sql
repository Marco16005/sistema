-- Autorizar con la clave, comprobada en la base.
--
-- Hasta aquí, cuando una segunda persona autorizaba algo, el servidor comprobaba su clave en una
-- transacción y después llamaba a la función del núcleo con el identificador de esa persona. La
-- base no podía saber si la clave se había comprobado. Y la confirmación ordinaria dejaba que una
-- sesión de responsable terminara el vehículo de otra jornada sin teclear nada.
--
-- Ahora la confirmación tiene dos entradas, y la aplicación ya no alcanza la función interna:
--
--   confirmar_cuenta    la de todos los días. Rechaza una cuenta que quedó de otra jornada.
--   terminar_vehiculo   la excepción. Recibe la clave del responsable y la comprueba aquí mismo,
--                       en la transacción en que confirma.
--
-- Cuando la clave no pasa, la función no lanza error: contesta sin cuenta. Así el intento fallido
-- queda contado en vez de deshacerse, y quien llama lo traduce a «la clave no pasó».

CREATE FUNCTION confirmar_cuenta(p_cuenta uuid, p_usuario bigint, p_revision int) RETURNS operacion
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  op operacion;
BEGIN
  PERFORM exigir_rol(p_usuario, 'mostrador', 'responsable');
  SELECT * INTO op FROM operacion WHERE id = p_cuenta FOR UPDATE;
  IF FOUND AND op.estado = 'borrador'
     AND (SELECT cerrada_en FROM jornada WHERE id = op.jornada_id) IS NOT NULL THEN
    RAISE EXCEPTION 'Esta cuenta quedó de otra jornada: la termina un responsable tecleando su clave'
      USING ERRCODE = 'RC008';
  END IF;
  RETURN confirmar_operacion(p_cuenta, p_usuario, p_revision);
END $$;

CREATE FUNCTION terminar_vehiculo(p_cuenta uuid, p_revision int, p_responsable bigint, p_clave text, p_huella text)
RETURNS operacion
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  op       operacion;
  v_equipo uuid;
BEGIN
  SELECT * INTO op FROM operacion WHERE id = p_cuenta FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'La cuenta % no existe', p_cuenta USING ERRCODE = 'RC005';
  END IF;
  -- El mismo envío, otra vez: ya está terminada.
  IF op.estado = 'confirmada' THEN
    RETURN op;
  END IF;
  -- Lo que no procede se rechaza antes de mirar la clave: no gasta un intento.
  IF (SELECT cerrada_en FROM jornada WHERE id = op.jornada_id) IS NULL THEN
    RAISE EXCEPTION 'Esta cuenta no es de otra jornada: la termina quien atiende, a su nombre' USING ERRCODE = 'RC005';
  END IF;
  IF p_revision IS DISTINCT FROM op.revision THEN
    RAISE EXCEPTION 'La cuenta cambió desde que se revisó (revisión % contra %): hay que volver a verla',
      p_revision, op.revision USING ERRCODE = 'RC011';
  END IF;

  v_equipo := equipo_vigente(p_huella);
  IF v_equipo IS NULL OR NOT comprobar_clave(v_equipo, p_responsable, p_clave) THEN
    RETURN NULL;
  END IF;
  -- Queda a nombre de quien tecleó la clave. Que sea responsable lo exige la confirmación.
  RETURN confirmar_operacion(p_cuenta, p_responsable, p_revision);
END $$;

-- Repetir una impresión con otro motivo no es el mismo envío: se rechaza en vez de contestar con
-- el motivo anterior como si nada.
CREATE OR REPLACE FUNCTION registrar_impresion(p_id uuid, p_operacion uuid, p_motivo text, p_usuario bigint) RETURNS impresion
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
    -- El original no lleva motivo, mande lo que mande quien lo pidió; una reimpresión sí, y es parte del envío.
    IF i.numero > 1 AND i.motivo IS DISTINCT FROM v_motivo THEN
      RAISE EXCEPTION 'Esa reimpresión ya se había registrado con otro motivo' USING ERRCODE = 'RC005';
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

REVOKE EXECUTE ON FUNCTION confirmar_operacion(uuid, bigint, int) FROM feruga_app;
GRANT EXECUTE ON FUNCTION
  confirmar_cuenta(uuid, bigint, int),
  terminar_vehiculo(uuid, int, bigint, text, text)
TO feruga_app;
