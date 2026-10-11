-- El rol de la aplicación. Tiene lo mínimo: leer, capturar cuentas y pesadas, y llamar a las
-- funciones de entrada. No puede escribir en el libro mayor ni en la bitácora, ni poner peso,
-- precio, folio o estado, ni tocar personas, jornadas o básculas por su cuenta.
--
-- La base valida el rol y la facultad de la persona que cada función recibe, pero no puede saber
-- si quien llama es esa persona: eso lo acredita el servidor de la aplicación, el único que tiene
-- estas credenciales. Nada de esto resiste a un superusuario ni al dueño de las tablas; por eso
-- administración y operación usan credenciales distintas.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'feruga_app') THEN
    CREATE ROLE feruga_app NOLOGIN;
  END IF;
END $$;

-- Nadie tiene nada por omisión.
REVOKE ALL ON SCHEMA public FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM feruga_app;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM feruga_app;

GRANT USAGE ON SCHEMA public TO feruga_app;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO feruga_app;       -- tablas y vistas: leer, todo

-- Catálogo: se agregan y se ajustan materiales; cada cambio queda en la bitácora.
GRANT INSERT (sucursal_id, familia_id, nombre, nombre_corto, frecuente, activo),
      UPDATE (familia_id, nombre, nombre_corto, frecuente, activo) ON material TO feruga_app;

-- Precios: solo mientras la lista no se ha publicado (lo cuida su disparador).
GRANT INSERT, UPDATE, DELETE ON precio TO feruga_app;

-- Pesadas: se registran, no se tocan.
GRANT INSERT (id, instrumento_id, valor_kg, origen, motivo, tomada_por) ON captura_peso TO feruga_app;

-- Cuentas: se abren, se etiquetan y se descartan mientras están abiertas.
GRANT INSERT (id, sucursal_id, jornada_id, tipo, etiqueta, creada_por), UPDATE (etiqueta), DELETE ON operacion TO feruga_app;

-- Renglones: se agregan con material y báscula; ni peso ni precio. Cambiarlos o quitarlos es por
-- función (fijar_descuento, quitar_renglon), para que todas las rutas tomen los candados en el mismo orden.
GRANT INSERT (id, operacion_id, material_id, instrumento_id) ON operacion_linea TO feruga_app;

-- Asentar una pesada en un renglón.
GRANT INSERT ON linea_pesada TO feruga_app;

-- Las funciones de entrada, y nada más. Los auxiliares (anotar, exigir_rol, jornada_abierta)
-- los usan las funciones por dentro y no son interfaz de la aplicación.
GRANT EXECUTE ON FUNCTION
  abrir_jornada(smallint, date, bigint),
  publicar_lista(bigint, bigint),
  quitar_renglon(uuid),
  fijar_descuento(uuid, numeric),
  confirmar_operacion(uuid, bigint, int),
  registrar_apertura(int, numeric, text, bigint),
  cerrar_corte(smallint, bigint),
  registrar_conteo(int, numeric, bigint, bigint, text, timestamptz),
  registrar_ajuste(int, numeric, text, bigint, bigint, bigint),
  corregir_material(bigint, int, text, bigint, bigint),
  registrar_merma(int, numeric, text, bigint),
  registrar_transformacion(int, numeric, jsonb, text, bigint),
  cerrar_jornada(bigint, bigint)
TO feruga_app;
