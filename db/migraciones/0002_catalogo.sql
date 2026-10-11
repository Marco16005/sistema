-- Catálogo de materiales. Los 27 que dictó el responsable el 30 de septiembre de 2026
-- (campo/CATALOGO-MATERIALES.md), agrupados en las familias que usa la pantalla de captura.
-- Todo se compra y se vende por kilogramo: no hay unidad alternativa.
-- Ninguna tabla guarda la existencia: se calcula de los movimientos.

CREATE TABLE familia (
  id     smallint PRIMARY KEY,
  nombre text NOT NULL UNIQUE,
  orden  smallint NOT NULL
);

CREATE TABLE material (
  id           int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  sucursal_id  smallint NOT NULL REFERENCES sucursal,
  familia_id   smallint NOT NULL REFERENCES familia,
  nombre       text NOT NULL,
  nombre_corto text NOT NULL,           -- como se lee dentro de su familia, sin repetir el prefijo
  frecuente    boolean NOT NULL DEFAULT false,
  activo       boolean NOT NULL DEFAULT true,
  UNIQUE (sucursal_id, nombre)
);

INSERT INTO familia (id, nombre, orden) VALUES
  (1, 'Aluminio', 1), (2, 'Cobre y bronce', 2), (3, 'Fierro', 3),
  (4, 'Otros metales', 4), (5, 'Papel', 5), (6, 'Plástico', 6);

INSERT INTO material (sucursal_id, familia_id, nombre, nombre_corto, frecuente) VALUES
  (1, 1, 'Aluminio bote',           'Bote',             true),
  (1, 1, 'Aluminio blando',         'Blando',           false),
  (1, 1, 'Aluminio macizo',         'Macizo',           false),
  (1, 1, 'Aluminio perfil',         'Perfil',           false),
  (1, 1, 'Aluminio traste',         'Traste',           false),
  (1, 1, 'Aluminio pistón',         'Pistón',           false),
  (1, 1, 'Aluminio rin',            'Rin',              false),
  (1, 1, 'Aluminio rin cromado',    'Rin cromado',      false),
  (1, 1, 'Aluminio rin de tráiler', 'Rin de tráiler',   false),
  (1, 1, 'Aluminio radiador',       'Radiador',         false),
  (1, 2, 'Cobre de primera',        'Cobre de primera', true),
  (1, 2, 'Cobre de segunda',        'Cobre de segunda', false),
  (1, 2, 'Bronce',                  'Bronce',           false),
  (1, 2, 'Bronce radiador',         'Bronce radiador',  false),
  (1, 3, 'Fierro lámina',           'Lámina',           true),
  (1, 3, 'Fierro pesado',           'Pesado',           false),
  (1, 3, 'Bote chilero',            'Bote chilero',     false),
  (1, 4, 'Magnesio',                'Magnesio',         false),
  (1, 4, 'Plomo',                   'Plomo',            false),
  (1, 4, 'Antimonio',               'Antimonio',        false),
  (1, 4, 'Antimonio mono',          'Antimonio mono',   false),
  (1, 5, 'Cartón',                  'Cartón',           true),
  (1, 5, 'Archivo',                 'Archivo',          false),
  (1, 6, 'PET',                     'PET',              false),
  (1, 6, 'Plástico duro',           'Duro',             false),
  (1, 6, 'Plástico de color HD',    'De color HD',      false),
  (1, 6, 'Polietileno',             'Polietileno',      false);

-- El rastro empieza después de la carga inicial: el catálogo de arranque no es un cambio.
CREATE TRIGGER material_auditado AFTER INSERT OR UPDATE OR DELETE ON material
  FOR EACH ROW EXECUTE FUNCTION auditar();
