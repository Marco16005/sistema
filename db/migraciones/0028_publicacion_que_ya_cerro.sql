-- Una publicación que ya terminó no vuelve a cerrar la operación.
--
-- Cerrar la operación pertenece a una publicación, y una que ya abrió no se vuelve a usar: la
-- siguiente lleva otro identificador. Eso solo se comprobaba contra la última. Una de antes —la
-- A, después de que la B ya cerró, decidió y abrió— podía volver a cerrar, y quedarse con la
-- operación. Lo encontró Codex en su décima revisión.
--
-- Ahora la base lleva el registro de las publicaciones que han cerrado la operación. Solo crece,
-- y viaja en el respaldo como todo lo demás. Se consulta y se anota en el mismo cierre, con la
-- fila del mantenimiento tomada: dos cierres a la vez no lo ven distinto.

CREATE TABLE mantenimiento_publicacion (
  publicacion text PRIMARY KEY,
  cerro_en    timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TRIGGER mantenimiento_publicacion_inmutable BEFORE UPDATE OR DELETE ON mantenimiento_publicacion
  FOR EACH ROW EXECUTE FUNCTION rechazar_cambio();
CREATE TRIGGER mantenimiento_publicacion_sin_vaciar BEFORE TRUNCATE ON mantenimiento_publicacion
  FOR EACH STATEMENT EXECUTE FUNCTION rechazar_cambio();

-- Las que cerraron antes de que existiera este registro las dice la bitácora, que anota cada
-- cierre y tampoco se borra.
INSERT INTO mantenimiento_publicacion (publicacion, cerro_en)
SELECT entidad_id, min(ocurrido_en)
FROM bitacora
WHERE accion = 'mantenimiento' AND entidad = 'publicacion' AND detalle->>'paso' = 'cerrar' AND entidad_id IS NOT NULL
GROUP BY entidad_id;

-- Cierra la operación para esa publicación.
CREATE OR REPLACE FUNCTION cerrar_operacion(p_motivo text, p_publicacion text) RETURNS mantenimiento
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  m        mantenimiento;
  v_motivo text := nullif(btrim(p_motivo), '');
  v_pub    text := nullif(btrim(p_publicacion), '');
BEGIN
  IF v_motivo IS NULL OR v_pub IS NULL THEN
    RAISE EXCEPTION 'Para cerrar la operación hay que decir por qué y de cuál publicación' USING ERRCODE = 'RC005';
  END IF;
  SELECT * INTO m FROM mantenimiento FOR UPDATE;
  IF NOT m.abierta THEN
    IF m.publicacion = v_pub THEN
      RETURN m;          -- ya la había cerrado esta misma publicación
    END IF;
    RAISE EXCEPTION 'La operación ya está cerrada por otra publicación (%)', m.publicacion USING ERRCODE = 'RC005';
  END IF;
  -- Está abierta. Una publicación que ya la cerró alguna vez ya terminó: la última, o una de antes.
  IF EXISTS (SELECT 1 FROM mantenimiento_publicacion WHERE publicacion = v_pub) THEN
    RAISE EXCEPTION 'La publicación % ya terminó: cerró la operación, y después se abrió. Una publicación nueva lleva otro identificador', v_pub
      USING ERRCODE = 'RC005';
  END IF;
  INSERT INTO mantenimiento_publicacion (publicacion) VALUES (v_pub);
  UPDATE mantenimiento
  SET abierta = false, motivo = v_motivo, publicacion = v_pub, decidida_en = NULL, abrio_en = NULL, cambio_en = clock_timestamp()
  RETURNING * INTO m;
  PERFORM anotar(NULL, 'mantenimiento', 'publicacion', v_pub, jsonb_build_object('paso', 'cerrar', 'publicacion', v_pub, 'motivo', v_motivo));
  RETURN m;
END $$;
