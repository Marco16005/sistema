> Informe de Codex (`gpt-6-astra`, esfuerzo alto, con ejecución), tal como lo dejó en
> `/tmp/feruga-codex-informe-10a.md`. **Completo:** los nueve puntos, en cinco minutos.
> La décima pasada va en cinco partes chicas (A precio especial; B publicar: la lógica;
> C publicar: los guiones; D respaldo diario; E rediseño), para que la cuota alcance. Esta es la
> parte A. Revisó una copia (`/tmp/feruga-codex-qa10/`) ya preparada, sin repetir la batería.
> Lo que se hizo con cada hallazgo está en `2026-10-07-respuesta-a-la-decima-revision.md`.

# Décima pasada de calidad, parte A — el precio especial (la base y el servidor) — 2026-10-07

1. EL DINERO: hallazgo confirmado; las comparaciones de cuenta, precio de lista y transacción no cubren la identidad de una encarnación del renglón.

### [importante] Recrear un renglón permite reutilizar su autorización, incluso para otro material o después de quitarla
Dónde: db/migraciones/0025_precio_especial.sql:244, :307 y :204
Escenario: como dueño, sin desactivar reglas, BEGIN → crear y aplicar «dar» para Cartón a 3.10 (lista 2.10) → borrar el renglón → insertar el mismo UUID para PET con lista 2.10 → volver a instalar el mismo evento → COMMIT acepta. También acepta recrear el mismo material. Variante: dar → quitar → SET CONSTRAINTS ALL IMMEDIATE → SET CONSTRAINTS ALL DEFERRED → borrar/recrear → reinstalar el «dar» ya quitado → COMMIT acepta.
Confirmado con: `sh qa/node.sh qa/10a-recrear.ts` → `otro-material {"precio_unitario":"3.1000","material_renglon":24,"material_evento":22,"precio_evento":"1","evento_ya_quitado":false}` y `ya-quitado {"precio_unitario":"3.1000","material_renglon":22,"material_evento":22,"precio_evento":"1","evento_ya_quitado":true}`.
Corrección sugerida: identificar cada nacimiento del renglón con un valor generado por la base y vincular el evento a ese nacimiento; comprobarlo junto con el material al aplicar el evento. Comprobar solo el material no evita revivir la autorización en el mismo material.

2. Sin hallazgos nuevos: cotejé importe generado (peso bruto − tara − descuento, redondeado a centavos), suma y redondeo al confirmar, incremento de revisión y lectura única de cuenta/renglones; las pruebas ya pasadas cubren fracciones, dos renglones, quitar y cobro concurrente. No repetí esas pruebas.

3. EL ENVÍO: sin duplicación detectada; contenido, evento y bitácora no incorporan la clave ni un derivado suyo. Hallazgo en el rechazo/reintento:

### [importante] Un envío cancelado puede bloquear al autorizante; un duplicado concurrente puede responder CLAVE aunque ya se aplicó
Dónde: db/migraciones/0025_precio_especial.sql:406 y :494
Escenario: cancelar un envío → dar con ese UUID y clave incorrecta cinco veces → devuelve NULL (el servidor lo traduce a 401 CLAVE), en vez de RC012, y bloquea a la persona aunque el envío ya está resuelto. Variante concurrente: A aplica un envío y aún no confirma; B repite el mismo contenido con otra clave (la clave no forma parte del contenido), espera la credencial; A confirma → B devuelve NULL en lugar del evento que ya existe.
Confirmado con: `sh qa/node.sh qa/10a-envios.ts` → `cancelado-estado {"fallos":0,"bloqueos":1,"bloqueada":true,"eventos":0}` y `repetido-concurrente {"original":"1","repetido":null}`.
Corrección sugerida: comprobar primero el registro de envío, incluso cancelado o de otra clase, y serializar/releer el mismo UUID antes de gastar la clave. Conservar que una clave mala no consuma un envío nuevo ni revierta su contador de fallos.

4. Sin hallazgos nuevos: cotejé exclusión de dos clientes, alta concurrente por índice único y ON CONFLICT, baja protegida por FOR SHARE, nombre capturado al confirmar e inmutabilidad posterior; los casos ya están en las pruebas pasadas, sin repetirlas.

5. Candados: confirmé el abrazo mortal, sin precio/envío parcial ni intentos duplicados por el aborto: `sh qa/node.sh qa/10a-candados.ts` → `cruce {"dar":{"codigo":"40P01"},"termina":{"codigo":"OK","id":null}}`; con dos fallos previos queda `despues {"fallos":3,"bloqueos":0,"bloqueada":false,"eventos":0,"envios":0,"cuenta":"borrador"}`: solo cuenta la clave mala del superviviente. El gasto evitable y bloqueo por envíos cancelados es el hallazgo 3. Sí unificaría el orden con terminar_vehiculo: resolver/serializar el envío, cuenta y renglón, validar lo posible, credencial y después jornada con relectura de hoy. Separaría renglon_para_precio: moverla entera antes de la clave también adelanta la jornada y puede crear cruces con otras autorizaciones. El 40P01 actual termina como 500 genérico; requiere reintento con el mismo envío.

6. Sin hallazgos nuevos: cotejé confirmada_en_jornada y estado confirmada, exclusión de abiertos/descartados/quitados y diferencia entre importes redondeados separadamente (incluido el centavo); las pruebas pasadas ya cubren el vehículo de ayer y 1.0051 frente a 1.0049. No atribuye al cliente el redondeo a pesos.

7. Sin hallazgos: `sh qa/sql.sh < qa/10a-permisos.sql` confirmó lectura sin escritura en las cuatro tablas y seis columnas, ejecución solo de dar/quitar/cierre entre las funciones revisadas, consola e internas inaccesibles, search_path fijo `public, pg_temp` y `esquema_creable|f`.

8. Sin hallazgos adicionales: cotejé las tres rutas y dominio con forma, ruta, bd y verCuenta: diferencia decimal como texto parametrizado, visto explícito, roles mostrador/responsable, COMMIT del fallo de clave antes del 401 CLAVE, errores RC traducidos y errores PostgreSQL inesperados ocultos tras 500 INTERNO. La respuesta de cuenta no expone credenciales; el defecto de reintento del punto 3 sí se propaga al servidor. Las pruebas de rutas ya pasadas cubren forma, roles y CLAVE; no las repetí.

9. VEREDICTO: no daría por cerradas las tareas 1 y 2. Antes de construir la pantalla:

1. Corregir la reutilización de eventos entre nacimientos de renglón (punto 1), incluida la variante ya quitada; agregar regresiones que exijan rechazo al confirmar.

2. Corregir la resolución y serialización del envío antes de comprobar la clave (punto 3); exigir RC012 sin gastar intentos en cancelados y devolver el evento original en duplicados concurrentes, también desde el servidor.

3. Unificar el orden cuenta → credencial → jornada y verificar el cruce con terminar_vehiculo (punto 5). Es una mejora de disponibilidad conocida, no pérdida de dinero; si se difiere, dejar explícito el tratamiento de 40P01 y el reintento con el mismo UUID.

Archivos creados en qa/: 10a-apoyo.ts, 10a-recrear.ts, 10a-envios.ts, 10a-candados.ts, 10a-permisos.sql. No dejé contenedores corriendo: `docker ps --filter label=com.docker.compose.service=pruebas --format '{{.Names}} {{.Status}}'` devolvió cero filas. No modifiqué archivos del proyecto original ni operé sobre sus contenedores o su base.
