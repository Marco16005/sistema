> Informe de Codex (`gpt-6-astra`, esfuerzo alto, con ejecución), tal como lo dejó en
> `/tmp/feruga-codex-informe-10v-ab.md` (9 de octubre, cuatro minutos). Es la **verificación de las
> correcciones** de las partes A y B de la décima pasada. Dio por cerrados A2, A3, B1, B2, B5 y B7,
> y **no cerrados A1, B3, B4 y B6**, cada uno con su reproducción.
> Lo que se hizo con ellos está en `2026-10-07-respuesta-a-la-decima-revision.md`.

# Décima pasada de calidad — verificación de las correcciones de las partes A y B — 2026-10-09

A1. NO CERRADO: dos transacciones del dueño, sin desactivar reglas, permiten instalar el evento de Cartón en un renglón recreado como PET; el evento aún invisible elude linea_nace y sigue perteneciendo a la transacción que lo instala.
A2. CERRADO: cotejé cuenta → envio → validaciones → clave; un cancelado ya confirmado se rechaza antes de gastar intentos y el duplicado de igual contenido espera la misma cuenta antes de releer. No repetí sus regresiones.
A3. CERRADO: cotejé conteo, corrección, reabrir/cerrar, agregar/quitar material, cobrar, cancelar_envio y consola de clientes; no encontré un nuevo orden inverso con precio especial en sus llamadas ordinarias. Conteo/corrección no toman cuentas, cierre no toma credenciales y la consola de clientes no toma cuentas ni credenciales. No implica ausencia de deadlocks en transacciones arbitrarias con varias acciones.
B1. CERRADO: cotejé porQueNoCierra y entender; los cierres publicados/restaurados/desistidos exigen sus marcas, se rechazan campos extra y sustituida. No repetí sus regresiones.
B2. CERRADO: marcar y entender rechazan desistir y abrir sin anterior; decidir también detiene si la decisión proviene de la base. No repetí sus regresiones.
B3. NO CERRADO: la creación normal sincroniza los padres, pero tras un EIO el reintento considera durable la carpeta ya visible y omite su padre; pasos.sh también condiciona sync a que la carpeta no exista.
B4. NO CERRADO: asegurar al leer resuelve los reintentos del archivo, pero no asegura la entrada de la carpeta de publicación en la raíz después de fallar el fsync final de crear. pendiente y marcar avanzan con ese error aún activo.
B5. CERRADO: cotejé el registro inmutable, su carga desde bitácora y consulta/inserción bajo la misma fila de mantenimiento; repetir el cierre actual cerrado sigue siendo idempotente y reutilizar uno terminado se rechaza.
B6. NO CERRADO: el servicio extra ordinario se rechaza, pero --nada-mas ignora contenedores sobrantes cuyo servicio se llama constructor, toString o __proto__, porque usa pertenencia heredada del objeto esperado. Cotejé la recogida sin filtro de servicio en pasos.sh y la excepción parcial declarada.
B7. CERRADO: acepto caso 2 con base ausente, marca desconocida y sin decisión de apertura; cotejé que el guion solo repite migración hacia adelante cuando no hay conjunto anterior. Si la marca ya se conoce o se decidió abrir, la ausencia de base sigue deteniendo. No repetí la tabla ni el ensayo.


### [importante] A1: un evento sin confirmar permite recrear su renglón en otra transacción
Dónde: db/migraciones/0027_precio_especial_en_orden.sql:44; db/migraciones/0025_precio_especial.sql:273
Escenario: como dueño, T1 BEGIN → INSERT precio_especial para Cartón (lista 2.10, nuevo 3.10), sin actualizar aún el renglón; T2 BEGIN → DELETE del renglón → INSERT del mismo UUID y cuenta para PET con lista 2.10 → COMMIT; T1 UPDATE instala su evento y precio 3.10 → COMMIT acepta. precio_especial_nace no toma la cuenta ni el renglón; T2 no ve el evento sin confirmar. No requiere SAVEPOINT ni SET CONSTRAINTS. El camino ordinario dar ya toma la cuenta; el agujero es la garantía declarada frente a escritura directa del dueño.
Confirmado con: `sh qa/node.sh qa/10v-a1.ts` → `A1 EVENTO AJENO INSTALADO {"material_actual":24,"material_evento":22,"precio_unitario":"3.1000"}`.
Corrección sugerida: serializar también el nacimiento de TODO evento con la cuenta y releer su renglón después del candado; resolver además la reserva del UUID entre cuentas distintas. Añadir esta carrera y su variante del mismo material: comparar solo el material no garantiza una única encarnación.

### [importante] B3: el reintento omite el padre cuya sincronización falló
Dónde: operacion/publicacion.ts:384; operacion/pasos.sh:99
Escenario: raíz ausente → mkdir funciona → fsync de su padre da EIO → repetir crear con la raíz ya visible: mkdir devuelve undefined, se omite el padre y se devuelve éxito aunque su fsync sigue fallando. El guion tiene el mismo retorno por existencia: mkdir → sync falla → reintento omite sync.
Confirmado con: `sh qa/node.sh qa/10v-b-disco.ts` → `B3 REINTENTO ACEPTADO; fsync padre=0; EIO padre sigue activo`. Confirmada la omisión por inyección en Node; no se simuló apagón ni se ejecutó el guion.
Corrección sugerida: asegurar los ancestros pertinentes también al retomar una creación fallida; en el servidor asegurar PUBLICACIONES antes de usarla aunque ya exista. No usar existencia como prueba de durabilidad.

### [importante] B4: se puede avanzar sin asegurar el nombre de la carpeta de publicación
Dónde: operacion/publicacion.ts:187; operacion/publicacion.ts:430
Escenario: crear renombra .nueva-ID a ID → falla fsync de la raíz → pendiente lee ID/manifiesto.json y marcar escribe empezoLaMigracion; ambos tienen éxito porque aseguran el archivo y la carpeta ID, pero nunca la raíz que contiene el nombre ID. Se puede empezar una migración sin haber asegurado que su publicación sobreviva al apagón.
Confirmado con: `sh qa/node.sh qa/10v-b-disco.ts` → `B4 PENDIENTE LEIDA Y MIGRACION MARCADA; publicacion=20261009T194135Z-abcdef123456-112233; fsync raiz=0; EIO raiz sigue activo`. Inyección de EIO después del rename; no se simuló pérdida física.
Corrección sugerida: al recuperar/leer, asegurar también la raíz que nombra la carpeta de publicación; conservar el error si esa sincronización falla. Coordinarlo con la garantía de los ancestros de B3.

### [importante] B6: nombres heredados del objeto eluden el control de servicios sobrantes
Dónde: operacion/publicacion.ts:745
Escenario: esperado={web:huella}, web correcto y otro contenedor Running=true, oneoff=False, servicio=constructor → faltasDeLoQueCorre(...,{nadaMas:true}) devuelve []. Es un contenedor sobrante (por ejemplo, huérfano de otra configuración) que el inventario completo debía denunciar; no necesita figurar en la configuración candidata. También ocurre con toString y __proto__.
Confirmado con: `sh qa/node.sh qa/10v-b-conjunto.ts` → `B6 extra ["corre extra, que aquí no se esperaba"]`, pero `B6 constructor []`, `B6 toString []` y `B6 __proto__ []`.
Corrección sugerida: sustituir `servicio in esperado` por `Object.hasOwn(esperado, servicio)`; aplicar comprobaciones de propiedad propia también a HERMANOS y demás mapas de servicios.

B4, límites adicionales: leer abre con «r», no exige escritura por permisos de archivo/carpeta; un sistema de archivos que rechace sync detiene la lectura, como corresponde al contrato. todas hace dos fsync secuenciales por publicación (costo lineal; no medí latencia ni atribuyo un problema de rendimiento). Linux exige sincronizar también el directorio que contiene la entrada: [fsync(2)](https://man7.org/linux/man-pages/man2/fsync.2.html). En macOS nativo, repetir fsync no sustituye F_FULLFSYNC ante pérdida de alimentación: [Apple](https://developer.apple.com/library/archive/documentation/System/Conceptual/ManPages_iPhoneOS/man2/fsync.2.html). No extrapolo estas sondas de Docker a una garantía física del almacenamiento del servidor.

Dictamen final: NO doy por cerrado el conjunto de tareas 1 y 2 de precio especial para construir su pantalla: queda A1 en la protección de la base; A2 y A3 están cerrados. NO doy por cerrada la lógica de publicar: quedan B3, B4 y B6. B1, B2, B5 y B7 están cerrados.

Archivos creados en /tmp/feruga-codex-qa11/qa/: 10v-a1.ts, 10v-b-disco.ts y 10v-b-conjunto.ts; no dejé contenedores de estas sondas corriendo (sus ejecuciones --rm terminaron). El único contenedor de pruebas activo, feruga-pruebas-run-927a5a21ec96, ejecuta pruebas/36-guiones.test.ts desde el proyecto original: es ajeno y no lo toqué. No modifiqué archivos del proyecto original ni operé sobre feruga-web-1, feruga-db-1 o la base feruga.
