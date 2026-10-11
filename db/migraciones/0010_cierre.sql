-- Cierre de jornada y sus reportes. Los totales los saca el sistema; nadie suma a mano.
--
-- Una jornada no cierra con cuentas abiertas, salvo una clase: la de un vehículo que ya se pesó
-- una vez y no volvió a pesarse el mismo día. Esa cuenta sobrevive al cierre y la termina un
-- responsable en una jornada posterior. Una jornada cerrada ya no recibe movimientos, así que
-- su reporte no cambia.

CREATE FUNCTION jornada_cerrada_no_cambia() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF OLD.cerrada_en IS NOT NULL THEN
    RAISE EXCEPTION 'La jornada del % ya está cerrada y no se modifica', OLD.fecha USING ERRCODE = 'RC001';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;
CREATE TRIGGER jornada_cerrada_no_cambia BEFORE UPDATE OR DELETE ON jornada
  FOR EACH ROW EXECUTE FUNCTION jornada_cerrada_no_cambia();

-- Las cuentas que siguen abiertas, y de cada una si lo único que espera es que un vehículo vuelva
-- a pesarse. Esas no impiden cerrar el día: el vehículo puede volver mañana. Las demás sí.
-- La regla está aquí, una sola vez: la usan el cierre y la pantalla que dice qué falta.
CREATE VIEW cuenta_pendiente AS
SELECT o.id AS operacion_id, o.jornada_id, o.tipo, o.etiqueta, o.creada_en,
       (SELECT count(*)::int FROM operacion_linea l WHERE l.operacion_id = o.id) AS materiales,
       EXISTS (
         SELECT 1 FROM operacion_linea l JOIN linea_pesada lp ON lp.linea_id = l.id AND lp.orden = 1
         WHERE l.operacion_id = o.id AND l.peso_bruto IS NULL
       ) AS espera_vehiculo
FROM operacion o
WHERE o.estado = 'borrador';

CREATE FUNCTION cerrar_jornada(p_jornada bigint, p_usuario bigint) RETURNS jornada
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  j jornada;
  v_abiertas   int;
  v_pendientes int;
BEGIN
  PERFORM exigir_rol(p_usuario, 'mostrador', 'responsable');
  -- Cerrar bloquea la jornada: quien esté abriendo una cuenta espera y la encuentra cerrada.
  SELECT * INTO j FROM jornada WHERE id = p_jornada FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'La jornada % no existe', p_jornada USING ERRCODE = 'RC006';
  END IF;
  IF j.cerrada_en IS NOT NULL THEN
    RAISE EXCEPTION 'La jornada del % ya estaba cerrada', j.fecha USING ERRCODE = 'RC006';
  END IF;

  SELECT count(*) FILTER (WHERE NOT espera_vehiculo), count(*) FILTER (WHERE espera_vehiculo)
  INTO v_abiertas, v_pendientes
  FROM cuenta_pendiente WHERE jornada_id = p_jornada;
  IF v_abiertas > 0 THEN
    RAISE EXCEPTION 'Hay % cuentas abiertas: se terminan o se descartan antes de cerrar', v_abiertas
      USING ERRCODE = 'RC006';
  END IF;

  UPDATE jornada SET cerrada_en = now(), cerrada_por = p_usuario WHERE id = p_jornada RETURNING * INTO j;
  PERFORM anotar(p_usuario, 'cerrar', 'jornada', p_jornada::text,
                 jsonb_build_object('fecha', j.fecha, 'vehiculos_pendientes', v_pendientes));
  RETURN j;
END $$;

-- Kilos que entraron y salieron de cada material en la jornada, con todo tipo de movimiento.
CREATE VIEW cierre_material AS
SELECT mv.jornada_id, mv.material_id, m.nombre,
       coalesce(sum(mv.cantidad_kg) FILTER (WHERE mv.cantidad_kg > 0), 0)::numeric(14,3) AS entro_kg,
       coalesce(-sum(mv.cantidad_kg) FILTER (WHERE mv.cantidad_kg < 0), 0)::numeric(14,3) AS salio_kg
FROM movimiento_inventario mv
JOIN material m ON m.id = mv.material_id
WHERE mv.jornada_id IS NOT NULL
GROUP BY mv.jornada_id, mv.material_id, m.nombre;

-- Lo que se asentó en la jornada. Los totales son lo que debe liquidarse, no lo que se pagó:
-- el pago se lleva aparte.
CREATE VIEW cierre_resumen AS
SELECT j.id AS jornada_id, j.fecha, j.cerrada_en,
       (SELECT count(*) FROM operacion o WHERE o.confirmada_en_jornada = j.id)::int AS operaciones,
       (SELECT coalesce(sum(o.total), 0) FROM operacion o
        WHERE o.confirmada_en_jornada = j.id AND o.tipo = 'compra')::numeric(14,0) AS total_compras,
       (SELECT coalesce(sum(o.total), 0) FROM operacion o
        WHERE o.confirmada_en_jornada = j.id AND o.tipo = 'venta')::numeric(14,0) AS total_ventas,
       (SELECT coalesce(sum(o.ajuste_redondeo), 0) FROM operacion o
        WHERE o.confirmada_en_jornada = j.id)::numeric(14,2) AS ajustes_redondeo,
       (SELECT count(*) FROM operacion o WHERE o.jornada_id = j.id AND o.estado = 'borrador')::int AS cuentas_pendientes
FROM jornada j;
