> Informe de Codex (`gpt-6-astra`, esfuerzo alto, con ejecución), tal como lo dejó en
> `/tmp/feruga-codex-informe-10b.md`. **Completo:** los nueve puntos, en cinco minutos.
> Es la parte B de la décima pasada (A precio especial; B publicar: la lógica; C publicar: los
> guiones; D respaldo diario; E rediseño). Revisó una copia (`/tmp/feruga-codex-qa10/`) ya
> preparada, sin repetir la batería ni los ensayos.
> Lo que se hizo con cada hallazgo está en `2026-10-07-respuesta-a-la-decima-revision.md`.

# Décima pasada de calidad, parte B — publicar una versión: la lógica — 2026-10-07

1. Sin hallazgos en la tabla: `sh qa/node.sh qa/qa10b-manifiesto.ts tabla` → «TABLA: 252 combinaciones coinciden con el diseño; otra marca y falta de respuesta detienen». Incluye primera/siguientes, desistimiento y base.publicacion distinta del conjunto anterior; los estados incompatibles que permite crear el manifiesto se tratan en 2.

2. Marcas y cierre: la historia publicada → restaurada → no publicada conserva correctamente conjunto y marca (`sh qa/node.sh qa/qa10b-manifiesto.ts marcas` → «HISTORIA: publicada -> restaurada -> no publicada conserva conjunto y marca; siguiente recupera caso 3»).

### [importante] Se acepta un cierre contradictorio y se lo toma como vigente
Dónde: operacion/publicacion.ts:204, operacion/publicacion.ts:263
Escenario: un manifiesto JSON legible trae cierre «publicada», sin migración, sin apertura y con base.marca=null → leer lo acepta y vigente anuncia su candidata como publicada. Requiere archivo alterado/inconsistente; no lo produce cerrar normalmente.
Confirmado con: `sh qa/node.sh qa/qa10b-manifiesto.ts marcas` → «CIERRE CONTRADICTORIO ACEPTADO: publicada … "base":{"marca":null}».
Corrección sugerida: validar al leer las invariantes del cierre igual que al escribirlo; exigir también anterior y marca nueva válida para «restaurada».

### [menor] La primera publicación puede decidir abrir un conjunto anterior inexistente
Dónde: operacion/publicacion.ts:379
Escenario: crear la primera → marcar noSePublica → marcar seDecidioAbrir: se acepta aunque anterior=null. Con evidencia de esta base, decidir devuelve caso 1 anterior; con base inexistente se detiene y ya no recupera por el caso 3.
Confirmado con: `sh qa/node.sh qa/qa10b-manifiesto.ts marcas` → «PRIMERA SIN ANTERIOR: {"caso":1,"conjunto":"anterior"} anterior=null».
Corrección sugerida: rechazar seDecidioAbrir/abierta si noSePublica y no hay anterior; rechazar esa combinación también al leer.

3. Precisiones: (1) acepto noSePublica: evita abrir la candidata al recuperar un desistimiento; falta la restricción del punto 2. (2) acepto vigente derivada del cierre, con la validación pendiente. (3) acepto commit como identidad de versión y levantar para cambios de entorno; presupone construcción desde ese commit limpio. (4) acepto PostgreSQL oficial fijo: una actualización mayor exige otro procedimiento. (5) acepto la comprobación sin sesión: exige exactamente 503/MANTENIMIENTO, de modo que 401 no pasa; ruta.ts:133 consulta mantenimiento antes de acreditar y la prueba existente 17-rutas:648 cubre sesión válida y fallo de consulta. No demuestra por sí sola el rechazo a usuarios autenticados: esa cobertura se conserva en pruebas. (6) acepto herramientas por commit y separación de credenciales/red; su ejecución concreta corresponde a C. (7) acepto el intervalo «Sin conexión»: detener y drenar ya era parte del diseño. Sin hallazgos adicionales; no volví a ejecutar las pruebas ya aprobadas.

4. Escrituras existentes: revisados archivo temporal → sync → rename → sync del directorio y carpeta oculta completa → rename → sync raíz; un fallo se propaga y lo incompleto oculto no cuenta. En Linux, es el orden adecuado si la raíz ya es durable. En macOS nativo fsync no ofrece la misma garantía ante pérdida de alimentación: Apple indica F_FULLFSYNC; el servidor Linux no hereda esa limitación ([Linux](https://man7.org/linux/man-pages/man2/fsync.2.html), [Apple](https://developer.apple.com/library/archive/documentation/System/Conceptual/ManPages_iPhoneOS/man2/fsync.2.html)). No se simuló un apagón físico.

### [importante] La primera creación no sincroniza el padre de la raíz de publicaciones
Dónde: operacion/publicacion.ts:305, operacion/publicacion.ts:351
Escenario: la raíz no existe → crear la hace con mkdir y termina correctamente → apagón antes de persistir la entrada de esa raíz en su padre; podría perderse toda la carpeta aunque sus archivos y su propio directorio se sincronizaron. No aplica si el aprovisionamiento ya dejó esa raíz durable.
Confirmado con: Sin confirmar: hipótesis; falta reproducción con corte de energía en el sistema de archivos del servidor. La ausencia de sync del padre se observa en crear; la necesidad de persistir entradas de directorio está documentada en fsync(2), enlazado arriba.
Corrección sugerida: sincronizar el padre de cada directorio recién creado, o exigir y verificar una raíz aprovisionada durable antes de publicar.

### [importante] El reintento da por durable una marca cuyo fsync falló
Dónde: operacion/publicacion.ts:157, operacion/publicacion.ts:370
Escenario: marcar empezoLaMigracion renombra el archivo, pero falla al sincronizar su directorio → la orden falla, aunque el archivo nuevo ya es visible. Repetir marcar encuentra la marca y devuelve éxito sin sincronizar; permite avanzar sin haber confirmado su persistencia. Un apagón posterior podría perder la marca de una migración ya iniciada. El mismo retorno anticipado existe en respaldo, fijarBase y cerrar.
Confirmado con: `sh qa/node.sh qa/qa10b-durabilidad.ts` → «REINTENTO: marca aceptada; fsync adicionales=0; el fsync del directorio sigue fallando». Se inyectó EIO después del rename; no se simuló pérdida física de datos.
Corrección sugerida: antes de confirmar una repetición, volver a garantizar la persistencia del archivo y su directorio; mantener el error si sync falla. Revisar también la lectura que habilita avanzar tras recuperar un fallo de durabilidad.

5. Puerta: revisadas las 43 rutas; solo salud y contraste no usan ruta, ninguna escribe negocio. Si falla la consulta se rechaza. La carrera pregunta/escritura existe para peticiones ya admitidas y el diseño la resuelve deteniendo la aplicación y drenando antes del respaldo: cerrar por sí solo no es una barrera de transacciones. Repetir inmediatamente cerrar/decidir/abrir no cambia el estado; decidir después de abrir se rechaza expresamente (ya cubierto en 29-mantenimiento:73), sin deshacer la apertura. El bloqueo de fila impide que dos publicaciones se apropien a la vez del mantenimiento cerrado.

### [menor] Una publicación antigua puede volver a cerrar después de otra
Dónde: db/migraciones/0026_mantenimiento.sql:56
Escenario: cerrar/decidir/abrir A → cerrar/decidir/abrir B → cerrar A otra vez; se acepta, sustituye la propiedad por A y deja el negocio cerrado. Solo se compara con la publicación más reciente; contradice «una que ya abrió no se vuelve a usar». El manifiesto impide reutilizar su carpeta por el camino normal, por eso no es una pérdida de datos demostrada.
Confirmado con: `sh qa/sql.sh < qa/qa10b-mantenimiento.sql` → «REUSO=qa10b-A,abierta=false».
Corrección sugerida: rechazar identificadores ya terminados consultando un registro histórico durable de publicaciones, bajo el mismo bloqueo de fila.

6. Sin hallazgos dentro del protocolo: revisados filtro por base/PID/no-superusuario, sesiones inactivas y con transacción, terminación seguida de recuento, y candado 7150 con clase/subclave/base exactas (incluye quienes esperan). La aplicación se crea NOSUPERUSER; las sesiones administrativas quedan fuera. Drenar certifica el instante del recuento, no impide conexiones posteriores: requiere detener previamente los procesos; el migrador además revoca CONNECT y recuenta. Una aplicación aún viva o un migrador que todavía no pidió el candado no quedan excluidos por estas funciones solas: comprobar su detención corresponde a C. Los casos de terminación, otros candados y otra base ya están cubiertos en 33-operacion:112/178; no se repitieron.

7. Sin hallazgos nuevos: comparadas huellas, migraciones ausentes y pendientes anteriores; archivos leídos una sola vez, nueva comparación bajo advisory lock y huella en la transacción de aplicación. Dos migradores se serializan. Sellar exige el inventario exacto si faltan huellas y conserva las existentes. Acepto sellado automático solo con MODO=desarrollo explícito; esa variable es una decisión del operador, no una barrera frente al administrador. Sin pendientes/sin huellas se avisa y no se modifica en operación; --revisar lo rechaza, por lo que no habilita publicar. revisar() devuelve sinHuella por separado: su consumidor debe atenderlo; la CLI lo hace. Casos ya cubiertos en 30-migrar-huellas:102/120/132/190/219/245/283/342, sin repetirlos.

8. Controles confirmados: `sh qa/node.sh qa/qa10b-conjunto.ts` → «CONTROLES: duplicado, health=starting e imagen por etiqueta de servicio conocido rechazados». Los contenedores oneoff se excluyen deliberadamente; la herramienta solo acredita los servicios que se le piden.

### [importante] Un servicio adicional queda fuera del manifiesto de imágenes y de la comprobación
Dónde: operacion/publicacion.ts:614, operacion/publicacion.ts:637
Escenario: configuración resuelta con los cinco servicios conocidos más extra={image:"extra:latest",build:{context:"."}} → imagenesDe la acepta pero omite extra. Entregar a faltasDeLoQueCorre los contenedores esperados y otro de extra → devuelve []. Tampoco detecta un proxy incorrecto si solo se pide mirar web (esto último es el contrato deliberado de la función).
Confirmado con: `sh qa/node.sh qa/qa10b-conjunto.ts` → «EXTRA: configuración con extra:latest y build aceptada; extra no figura en imágenes; faltas=[]» y «OMITIDO: proxy con imagen equivocada, solicitado solo web; faltas=[]».
Corrección sugerida: rechazar servicios desconocidos o inventariarlos con imágenes inmutables y sin build. Agregar comprobación estricta del conjunto completo con exclusiones explícitas por fase; conservar la comprobación parcial para pasos intermedios.

9. Veredicto: la tabla central es consistente, pero no daría todavía conformidad plena a la lógica de soporte. Corregir, en orden: (1) revalidar durabilidad al reintentar o recuperar tras error de sync; (2) exigir inventario completo y control explícito de servicios sobrantes; (3) validar cierres al leer; (4) impedir apertura del anterior inexistente y reutilización histórica de publicaciones. Resolver o descartar la hipótesis del directorio raíz con el aprovisionamiento/sistema de archivos real. Acepto las siete precisiones del diseño con los límites del punto 3; no acepto interpretar una comprobación parcial como garantía del conjunto completo. En C queda verificar detención de procesos antes del drenado/espera, lista completa de servicios por fase y construcción desde commit limpio. No se revisaron los guiones, --corregida ni la instalación inicial del mantenimiento.

Archivos creados en /tmp/feruga-codex-qa10/qa/: qa10b-manifiesto.ts, qa10b-durabilidad.ts, qa10b-mantenimiento.sql y qa10b-conjunto.ts; no dejé contenedores de esta revisión corriendo (comprobado con docker ps); no modifiqué el proyecto original ni los contenedores del usuario.
