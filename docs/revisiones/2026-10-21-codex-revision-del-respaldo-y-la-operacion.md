# Codex revisa: lo que quedaba del respaldo y la operación, antes del servidor de verdad

> **21 de octubre de 2026.** Revisión de calidad de Codex (`gpt-6-astra`, esfuerzo alto), en su copia
> (encargo 32, al final). Terminó sus seis partes; la cuota se le acabó al cerrar el informe, que
> quedó completo. Verificó lo corregido del sello (13 de octubre), del respaldo diario y de los
> guiones (9 de octubre): **cerrado**. Revisó por primera vez restaurar del diario y las seis
> precisiones del diseño, y dio su veredicto. Dejó tres hallazgos nuevos (H32-1 a H32-3) y opinó
> sobre no hacer `--corregida`. Lo que se hizo con cada cosa está en
> `2026-10-21-respuesta-a-la-revision-del-respaldo-y-la-operacion.md`.

# Revisión 32: respaldo y operación antes del servidor real

Fecha: 21 de octubre de 2026. Copia: `/tmp/feruga-codex-qa14/`.

## Alcance y reglas
Una sola pasada, en el orden solicitado. No se modifica el proyecto original, no se instalan dependencias, no se sustituyen archivos Compose ni se corrige código de producción. Las pruebas se ejecutan secuencialmente mediante `qa/`. Hallazgos demostrados y límites de evidencia se distinguirán explícitamente.

## Estado
**Revisión terminada, partes 1–6 cubiertas. NO CERRADO para operar con datos reales.** Se ejecutaron secuencialmente **135 pruebas distintas, todas aprobadas**, y cuatro sondas específicas. Las pruebas existentes no cubrían los tres defectos demostrados por sondas.

| Hallazgo nuevo | Gravedad | Veredicto |
|---|---|---|
| H32-2: la aceptación externa pasa con pública B y sello A, aunque A no descifra | **Bloqueante** para aceptar respaldos de una instalación real | NO CERRADO |
| H32-3: la rotación de llave declara perdidos diarios antiguos íntegros | **Importante** | NO CERRADO |
| H32-1: se inicia una descarga grande después del presupuesto | **Importante** | NO CERRADO |

Las correcciones del sello, elección, avisos y guiones se cierran en sus alcances detallados abajo. La decisión de no construir `--corregida` se sostiene como simplificación, con las precondiciones y excepciones de la parte 5. No se certifica todavía el servidor real.

## 1. El sello

Ejecución: `sh qa/prueba.sh pruebas/23-respaldo.test.ts` → **61 pruebas, 61 pasan, 0 fallos** (64,3 s). Salida completa: `qa/revision32-23.log` en la copia.

- **CERRADO:** restaurar del remoto y del diario usa `restaurarDelDestino` → `traer` → `manifiestoDe` → `leerManifiesto`, con la derivada de la privada antes de bajar el cifrado. La huella se comprueba después de bajarlo y antes de descifrar. `--como-estaba` cambia la vista del destino, no la verificación. La prueba «quien puede escribir en el almacenamiento sustituye…» pasa; también «restaurar comprueba el sello con la clave que sale de la llave…» y la consola `--diario`.
- **CERRADO:** el servicio acredita el último con `ultimoUtilizable`; el diario valida manifiestos antes de elegir o de repasar. El caché de pares ya comprobados tiene un límite de siete días: no es una nueva comprobación en cada corrida. El fragmento huérfano del diario se compara contra la elección autenticada, aunque aún no tenga manifiesto; no se entrega para restaurar.
- **CERRADO:** lectura de una sola identidad X25519, comentarios ignorados, longitud y suma Bech32 comprobadas; pública contrastada con age-keygen; prueba «la llave se lee como la lee age…» pasa. `sello.ts` da pública y derivada juntas; la prueba de su consola pasa. Límite: tener esos dos valores bien formados no demuestra por sí solo que se copiaron juntos al servidor; sigue siendo condición verificar el primer respaldo desde fuera con la privada.
- **CERRADO con límite explícito:** se muestra la edad y se advierte si se pidió el último y supera un día (prueba «al restaurar se dice de cuándo…» pasa). No demuestra completitud del listado ni detecta omisiones de menos de 24 horas. Al instalar, el guion resuelve primero un objeto y luego restaura por nombre: muestra su fecha, pero no dispara esa advertencia del modo implícito. Comparar con el vigilante sigue siendo responsabilidad operativa.
- Primera transición sin sello: acepto la exclusión declarada en la respuesta del 13 de octubre porque no existe instalación real anterior; no se ha demostrado compatibilidad con una instalación histórica sin sello.
- Comparación Compose: el archivo de esta copia sí contiene `RESPALDO_SELLO` obligatorio, línea 25. La ubicación real del proyecto es `.../feruga/sistema/docker-compose.operacion.yml` (la ruta directamente en feruga no existía). Comparación posterior de solo lectura: **Compose operación idéntico: True**; ambos contienen la variable obligatoria en línea 25. No se modificó ni sustituyó ningún Compose; no hay hallazgo de divergencia.

Las verificaciones de notas y versión se completaron a continuación.

### Cierre de la parte 1

- **CERRADO:** notas de hueco y elección autenticadas con dominios distintos; una firma de elección no acredita un hueco. Archivo 28: **42/42 pasan**, incluidas «una anotación de hueco sin el sello…» y «una elección escrita… no se fija…». Cubren sin sello, otra clave, otro dominio y modificación posterior para huecos. La elección inválida deja falla visible y no se fija.
- **CERRADO:** elección auténtica pero del día equivocado tampoco se fija. `sh qa/node.sh qa/sonda32-diario.ts` → `ELECCION: sellada pero de otro día: no fijada; falla visible=la elección del diario del 2026-10-21 nombra un respaldo que no es de ese día…`.
- **CERRADO:** la versión para instalar viene del manifiesto autenticado. `sh qa/prueba.sh pruebas/35-version-del-respaldo.test.ts` → **2/2 pasan**, incluida publicación alterada sin rehacer el sello, privada ausente y privada ajena. `publicar.sh:506` invoca este programa antes de construir/seleccionar el commit; `:551` vuelve a pasar por el restaurador autenticado. No se ejecutó instalación completa ni simulacro.

## 2. Correcciones del diario del 9 de octubre

Evidencia principal: `qa/revision32-28.log` (**42 pasan, 0 fallos**) y `qa/revision32-23.log` (**61 pasan, 0 fallos**). Sonda adicional: `qa/sonda32-diario.ts`, salida `qa/revision32-sonda-diario.log`.

| Punto | Veredicto | Prueba y salida |
|---|---|---|
| Elección única en PostgreSQL, migración 0029 | **CERRADO** | 23: «la elección del diario se decide en la base…» ✔. Mata la sesión mientras sale la elección, hace entrar otra y comprueba que ambas escriben el mismo objeto. Rechaza UPDATE, DELETE y TRUNCATE; la aplicación recibe 42501 al leer. |
| Base restaurada de antes de elegir | **CERRADO**, con evidencia de decisión simulada | 28: «la elección también queda escrita… si la base se restaura de antes…» ✔. Registro vacío recupera elección remota; no selecciona el candidato anterior que apareció después. Si la base sí conserva elección, repone la nota remota dañada. No se ejecutó aquí una restauración PostgreSQL específica de esa tabla seguida de promoción. |
| Dañados avisados hasta recepción | **CERRADO** | 28: «un diario viejo que ya no coincide… se avisa hasta que el vigilante lo recibe…» ✔; se repite sin volver a bajar y cesa al confirmar. 23: «el aviso de un día sin diario se repite…» ✔, con vigilante. |
| Presupuesto dentro del día | **NO CERRADO** | Las pruebas 28 pasan, pero la sonda demuestra una descarga grande iniciada después de vencer: hallazgo H32-1 abajo. |
| Completar una subida parcial | **CERRADO** | 28: «si lo que se perdió fue la respuesta al subir el archivo…» ✔ y «lo que quedó subido a medias y no es lo elegido…» ✔. Compara huella antes de completar solo el manifiesto. |
| Dos corridas seguidas sin tiempo | **CERRADO**, en el alcance implementado | 28: «un día al que se le acaba el tiempo…» ✔: a la segunda corrida normal falla, un éxito reinicia el contador; el arranque corto no cuenta. El contador vive en memoria: reiniciar entre cada corrida lo reinicia, y los días que ni se alcanzaron a empezar no incrementan su propio contador; la falla del día que los bloquea sí queda visible. |
| Recorrido desde el primer día conocido | **CERRADO** | 28: «los días se recorren de corrido…» ✔: incluye elecciones y pares diarios, días intermedios, y no inventa hueco para un diario cuyo original venció. |
| Repaso por turnos | **CERRADO** | 28: «un diario viejo que no se deja leer no acapara…» ✔: el siguiente dañado se revisa y el fallo del ilegible se sigue reportando hasta que puede leerse. |

### H32-1 — importante, demostrado: se inicia una descarga grande con el presupuesto agotado

Dónde: `operacion/diario.ts:233` (`plazo`, mínimo de un minuto), `:332`–`:334` (`traer`: manifiesto y luego cifrado sin `aTiempo` intermedio); el mismo patrón aparece en el repaso, `:504`–`:506`.

Reproducir: `sh qa/node.sh qa/sonda32-diario.ts`. Destinos en memoria y reloj controlado: presupuesto normal del arranque, 300000 ms; los dos listados consumen 270000 ms; el manifiesto tarda 60000 ms (plazo pequeño permitido). Salida literal:

```
TIEMPO: presupuesto=300000; descarga grande comienza=330000; plazo=60000; pendientes=1
```

El chequeo antes de `traer` todavía encuentra tiempo; el manifiesto lo agota; se empieza el archivo grande y se le concede otro minuto. No es una suposición sobre rclone: se observa la llamada al destino. No demuestra pérdida de datos ni descarga sin autenticación; incumple el límite y prolonga el turno que retrasa el siguiente respaldo. El mínimo de 60000 también concede más que el remanente a una operación grande cuando quedan menos de 60000.

Arreglo propuesto: comprobar `aTiempo()` inmediatamente antes de cada operación grande, también después de leer su manifiesto y en el repaso; para las grandes usar el remanente positivo real, reservando el minuto fijo para notas. Probar cruce del límite durante el manifiesto y remanente menor de un minuto. No se corrigió código.

## 3. Parte D que no se había revisado

### (8) Restaurar del diario y credenciales — CERRADO en el almacenamiento de pruebas

En `qa/revision32-23.log` pasan «el diario se baja con la credencial de recuperación y se restaura…» y «por la consola, con depósito diario…». La primera compara el retrato de la base restaurada con el anterior; rechaza borrado del objeto y su versión, acortar retención, cambiar o quitar retención por defecto con la credencial del servidor, y hasta acortarla sobre el objeto con la administradora. Conserva **365 días**. Son credenciales diferentes: el servidor tiene PutObject/GetObject; recuperación, GetObject y ListBucket. La lectura de versiones históricas requiere adicionalmente GetObjectVersion/ListBucketVersions: no está implícita en «solo lee».

Límite: MinIO, bases y depósitos desechables de `qa/`; no se ha acreditado B2 real. `--diario` y `--como-estaba` confluyen en `destinoRclone`; la combinación quedó comprobada con la sonda específica detallada al final.

### (9) Las seis precisiones — valoración individual

1. **CERRADO, aceptada con ventana explícita.** El texto antiguo del plan dice «hasta reiniciar»; el código actual revalida cada siete días y cada arranque. 28: «lo ya comprobado…» y «lo comprobado se vuelve a comprobar cada semana…» ✔. Cambiar objeto/manifiesto manteniendo tamaño puede pasar inadvertido dentro de esa ventana; al restaurar se comprueba siempre. Para diarios sin original, repaso cada treinta días, uno por corrida, sujeto a disponibilidad y a que alcance tiempo.
2. **CERRADO, aceptada con recepción confirmada.** El hueco se silencia después de que el vigilante recibe el aviso, con nota autenticada. 28: «el hueco se da por avisado cuando el aviso llegó…» ✔. No cierra definitivamente el día: «un hueco ya avisado no cierra el día…» ✔. Recibir no significa que una persona haya resuelto el incidente; hay que conservar su seguimiento fuera del servicio.
3. **CERRADO, aceptada.** El recorrido actual amplía lo escrito originalmente: desde respaldo, elección o diario conocido, sin hueco para hoy ni para un día antiguo ya cubierto. Prueba específica 28 ✔.
4. **CERRADO, aceptada.** Volver a bajar del horario simplifica el reintento y exige comprobar sello y huella antes de promover. Coste: transferencia, tiempo y espacio temporal adicionales; no es otra instantánea. Pruebas de primer diario, reintento y huella 28 ✔.
5. **CERRADO, aceptada con precisión de alcance.** Si falla un listado inicial, no se infieren huecos. Si falla leer un día concreto, ese día falla y se prosigue con otros: «un día que no se puede resolver no detiene a los demás…» ✔. «Sin marcar nada» no debe interpretarse como rollback de toda la corrida ni como desconocer subidas previas exitosas.
6. **NO CERRADO para operación real; aplazamiento aceptado.** B2, sus ciclos de vida y retenciones reales, las credenciales y mantener privadas antiguas durante la vida completa de sus objetos siguen siendo condición de servidor. No se simula un año de tiempo aquí. Guardar llaves antiguas permite restaurar por nombre con ellas; no acredita por sí solo que el servicio pueda seguir repasando objetos de otra clave.

### (10) Veredicto del diario

**NO CERRADO globalmente para datos reales.** El mecanismo de elección, integridad, reintentos y avisos corregido está acreditado salvo H32-1. Orden: corregir el límite de las operaciones grandes; resolver los límites de configuración/llaves que aparezcan al revisar la guía; ejecutar con B2 real la matriz de retención, permisos, lectura de versiones, restauración y avisos; medir tiempo y capacidad con un volumen representativo. Esto no exige repetir toda la batería ni abrir otra cadena de revisiones: basta evidencia dirigida de lo pendiente.

## 4. Guiones de publicar — CERRADO para las tres correcciones

`sh qa/prueba.sh pruebas/36-guiones.test.ts` → **18 pruebas, 18 pasan, 0 fallos** (0,83 s); salida `qa/revision32-36.log`. También `pruebas/20-entorno.test.ts` → **11/11 pasan**, salida `qa/revision32-20.log`.

- **CERRADO:** `pasos.sh:302` crea/arranca el migrador mediante `run -d` conservando el descriptor 9; `logs`, `wait` y `rm` cierran ese descriptor en el hijo. Prueba «el migrador se crea y arranca con el candado en las manos…» ✔: inspecciona herencia del descriptor, falla al no crear/no identificar y propaga el código de terminación. `esperar_al_migrador` retira también creados y terminados y se detiene si no puede confirmar su ausencia. Prueba específica ✔. Límite: Docker simulado en 36; no se repitió el simulacro real ni se inyectó apagón del daemon con una petición de creación en tránsito. Esto último sigue siendo una prueba de servidor, no una garantía deducible solo del descriptor del cliente.
- **CERRADO:** `compose.sh:45`–`:65` analiza opciones antes del servicio y rechaza desacoplado (`-d`, `--detach`, `-dT`, `-Td`) y desconocidas. «el Compose de lo publicado…» ✔; `psql -d` después de `db` sí pasa. Los argumentos que son valor de una opción se consumen como tales.
- **CERRADO:** `pasos.sh:82` usa `git show "$1:docker/db.Dockerfile"`; falla si no puede leer o si falta digest. «la imagen de la base…» ✔ en 36, incluyendo lectura fallida; `publicar.sh:122` pasa el commit. No se toma el Dockerfile mutable de la carpeta.

## 5. Decisión del 21 de octubre sobre `--corregida`

**CERRADO como decisión de alcance, con límites; NO sostengo su justificación absoluta de que no gana nada salvo tiempo.**

Sí sostengo quitar esa segunda máquina de estados para la operación prevista: `publicar.sh:148`–`:163` cierra, detiene web/respaldo y drena **antes** de `respaldar_antes`; solo después anota e inicia migración. Sin decisión de abrir, no hay nuevas escrituras del negocio por el camino autorizado. Volver conserva el último estado comercial completo; los cambios de la migración fallida se descartan intencionalmente. El cierre `sustituida` ya no pertenece al tipo ni a `CIERRES` (`publicacion.ts:73`–`:74`). No se observó una transición vigente que lo requiera.

**Sí hay casos donde restaurar no se puede y una corrección hacia adelante podría servir:** respaldo previo vencido (cierre que dura más que su retención), perdido/no accesible, privada perdida o equivocada, falta de espacio para coexistir con la base apartada y los temporales, o fallo del restaurador de la versión anterior. Si la base de trabajo sigue íntegra y la migración falló transaccionalmente o se puede reparar de manera conocida, una migración corregida podría recuperarla sin depender del respaldo. Son contraejemplos de disponibilidad, no pruebas de que el actual `--corregida` (que no existe) funcionaría. No se reprodujeron destruyendo respaldos reales ni llenando discos.

No encontré pérdida de operaciones del negocio dentro del protocolo. Fuera de él, escrituras administrativas directas posteriores al respaldo, efectos externos de una futura migración o una apertura forzada no estarían cubiertos. «No pierde nada» debe decir «no pierde operaciones del negocio realizadas por los caminos permitidos durante este cierre». La restauración sí cambia marca, sesiones y bloque de folios: no es un estado byte a byte idéntico.

**Publicar después de volver:** el manifiesto «restaurada» apunta al conjunto anterior y a la **marca nueva** (`publicacion.ts:343`–`:348`); `crear` contrasta contra esa marca (`:400`). Prueba nueva `pruebas/90-revision-publicar-32.test.ts`: crea primera publicación, deja otra fallida/restaurada y publica una tercera sobre la marca nueva; rechaza la marca antigua, usa el conjunto anterior correcto y termina publicada. Ejecución definitiva ampliada a la consola: **1/1 pasa**, `qa/revision32-publicar.log`; exige abrir primero y acepta la publicación después. Solo esta prueba nueva se repitió al ampliar su alcance; los archivos existentes se ejecutaron una vez cada uno.

**Paso necesario:** `volver.sh` termina CERRADA y sin servicio de respaldo. Antes de publicar normalmente hay que ejecutar `volver.sh --abrir` como indica la guía: publicar exige operación abierta (`publicacion.ts:848`) y conjunto completo (`publicar.sh:316`). No se puede saltar directamente de «restaurada y cerrada» a la publicación normal; mantener el negocio cerrado de corrido requeriría otra capacidad. Basta hacer ambos pasos en la misma ventana de mantenimiento, sin reanudar la atención física entre ellos.

Arreglo documental propuesto: declarar esas precondiciones y una salida de soporte si no puede restaurarse el previo; no presentar la restauración como garantía incondicional ni prometer una recuperación automática hacia adelante. La decisión de no implementar `--corregida` puede mantenerse. No se ejecutó publicación real completa, por la exclusión de simulacros.

## 6. Guía y servidor real

### H32-2 — bloqueante como aceptación de una instalación real, demostrado: la comprobación externa no demuestra que la pública sea la del dueño

Dónde: `docs/operacion.md:112`–`:123`, especialmente la afirmación de `:120`; `operacion/version-del-respaldo.ts:58` y `:74`–`:77` (solo valida manifiesto con la derivada; no compara la pública derivada de la privada con `manifiesto.llavePublica`).

La limitación del servidor ante claves disparejas ya se conocía y no se cuenta como hallazgo nuevo. Lo nuevo es que **la aceptación desde fuera prescrita para mitigar esa limitación también puede pasar con el par disparejo**.

Reproducir: `sh qa/node.sh qa/sonda32-configuracion.ts` (patio y depósito desechables mediante los auxiliares de qa). Genera dos identidades A y B, respalda PostgreSQL con pública B y sello derivado de A, recibe éxito, consulta `versionDe` con la derivada de la privada A y finalmente intenta restaurar con A. Salida (`qa/revision32-configuracion.log`):

```
CONFIGURACION: pública B + sello A; respaldo avisa bien=1; versionDe con privada A ACEPTA; restaurar con A FALLA al descifrar
```

El manifiesto auténtico dice expresamente pública B; leerlo no lo compara con la pública de A. No se falsificó HMAC ni se eludió el sello. Es la mezcla de renglones que la guía pretende detectar: el orden inverso (pública correcta y sello ajeno) sí lo detecta. Si el dueño no conserva B, sus respaldos no le sirven pese a haber pasado esta aceptación.

Arreglo propuesto: en la comprobación externa derivar también `identidadDe(llave).publica` y exigir igualdad con `manifiesto.llavePublica`; mejor aún, exigir la restauración real inicial en una base desechable antes de dar por buenos los respaldos. Actualizar la afirmación de la guía y probar las dos direcciones del intercambio de claves. `sello.ts` ya da ambas juntas, pero no impide que se copien por separado. **NO CERRADO** hasta que la aceptación detecte este caso. No se modificó producción.

### H32-3 — importante, demostrado: rotar la llave convierte diarios íntegros en avisos falsos de pérdida

Dónde: `docs/operacion.md:277` (procedimiento de rotación); `operacion/diario.ts:307` (valida con la única derivada del destino), `:319`–`:325` (sello ajeno se convierte en `YaNoSirve`), `:420`–`:430` y `:452`–`:463` (rechaza par diario y original de la llave anterior, avisa hueco); para los más antiguos, `:504`–`:520` los considera dañados en el repaso.

Reproducir: `sh qa/node.sh qa/sonda32-diario.ts`. Se crea diario válido del 20 de octubre, se conserva la elección en la base simulada, se reemplaza la derivada de ambos destinos como prescribe la guía, se toma otro respaldo con la nueva el 21 y se vuelve a poner al día. Se compara que los bytes anteriores siguen idénticos. Salida:

```
ROTACION: diario anterior intacto; hoy sube; día anterior se avisa como hueco: el respaldo elegido para ese día (...) ya no está en el depósito de cada hora, o ya no coincide con su huella
```

No es pérdida física del archivo: el sello anterior deja de verificarse con la nueva clave. El servidor mezcla «otra llave» con «dañado o desaparecido» y produce alertas de días perdidos que no lo están; también deja de verificar/reponer su historia anterior. Guardar la privada antigua en el paquete permite restaurar manualmente con ella, pero no resuelve el repaso del servicio. El escenario observado conserva la elección en la base; si se restaura la base de antes de esa elección, una nota remota sellada con la clave antigua tampoco se recupera con la nueva (consecuencia de lectura, no otra sonda).

Arreglo propuesto: plan explícito de varias generaciones con identificador de clave y conjunto acotado de derivadas anteriores para verificar (sin privadas en el servidor); emitir con la actual. Alternativamente, separar generaciones y mantener su seguimiento con las claves correspondientes. Distinguir «no tengo la clave para acreditar» de «se dañó»; no arreglarlo re-sellando datos antiguos sin acreditarlos. Añadir rotación antes/después de elegir el diario y restauración de base anterior. **NO CERRADO** el procedimiento de rotación de la guía.

### Qué coincide y qué falta en la guía

- **CERRADO:** órdenes ordinarias de lista/diario/ahora, exclusión de modos de restauración y lectura de la versión; evidencia 23, 35 y 36. La guía explica correctamente que perder el servidor exige reconstruir del commit respaldado. La excepción del archivo local sin manifiesto está en el contrato del programa y la revisión anterior; no se extiende la garantía del sello a ese modo.
- **CERRADO:** publicar, recuperar y volver describen la frontera de apertura del código. La secuencia incluye `volver.sh --abrir` antes de volver a publicar. Prueba nueva ampliada: **1/1 pasa**, `qa/revision32-publicar.log`: `NUEVA PUBLICACION: anterior original, marca restaurada; rechaza marca antigua; cierre publicada correcto; CLI exige --abrir antes y acepta después`.
- **NO CERRADO:** aceptación externa del primer respaldo (H32-2), rotación (H32-3) y presupuesto estricto del diario (H32-1). Son los tres hallazgos nuevos demostrados de esta pasada.
- **NO CERRADO, preparación ya declarada pendiente:** la guía invoca `node operacion/*.ts` en la computadora de recuperación, pero la lista de preparación menciona Docker/repositorio/PostgreSQL sin un procedimiento reproducible de Node compatible con TypeScript, dependencias y binarios age/rclone/pg_restore; A9 debe realizarse desde una máquina limpia siguiendo solo esos pasos y dejar el comando/contenedor y variables exactos. No se instaló nada para simularlo aquí.

### Ampliaciones concretas de la tarea 7

La lista final de tarea 7 cubre puertos, permisos del almacenamiento, A9, caída de sitio/respaldo y repetir el sello. No enumera explícitamente estas comprobaciones que la propia guía deja pendientes o que importan para lo revisado:

1. **Alerta del diario y del ensayo por separado**, incluyendo que no llegue el aviso y que se pierda el latido; recepción efectiva por quien da soporte, no solo HTTP 200. La guía anuncia tres señales, y el latido del sitio aún está por diseñarse.
2. **Certificado real: renovación y aviso de vencimiento**, además de emisión/HTTPS inicial. Ya está en sección 10 de la guía, no explícito en la lista de tarea 7.
3. **Rotación de BD_CLAVE en base persistente y disco lleno**, ambos pendientes explícitos de la guía, tampoco enumerados en esa lista. Incluir espacio para base apartada + restaurada + temporales e imágenes anteriores; restauración y conservación de la evidencia ante ENOSPC.
4. **B2 en ambos depósitos:** versiones anteriores después de sobrescritura, retención de manifiestos y notas además del cifrado, ciclo de vida tras 30/365 días, lectura de versiones con la credencial de recuperación, y límites de listas/transferencias con volumen representativo. Se pueden considerar ampliaciones de «los mismos casos de tarea 3», pero diario de un año y notas deben quedar nombrados en la evidencia.
5. **Reinicio/apagón real del host y Docker durante publicar/migrar/volver**, especialmente creación de migrador en tránsito, persistencia del manifiesto y exclusión tras reiniciar. La prueba 36 es con Docker simulado; no certifica el daemon/disco del servidor. El plan menciona apagones en su cuerpo, no en su lista final de tarea 7.
6. **Primer respaldo realmente restaurado desde fuera con la privada correcta**, validando ambas direcciones de la mezcla de claves (H32-2), y medido con los datos previstos. Añadir contingencia de soporte si el previo no se puede restaurar, tras la decisión de quitar `--corregida`.

Estas son condiciones o pruebas pendientes, no resultados ejecutados en el servidor ni fallas de B2 afirmadas sin comprobar.

## Evidencia final complementaria

**CERRADO: diario histórico.** `sh qa/node.sh qa/sonda32-diario-historico.ts` → salida en `qa/revision32-diario-historico.log`:

```
DIARIO HISTORICO: versión actual dañada rechazada; --diario + --como-estaba restaura el retrato idéntico con credencial lectora de versiones
```

La sonda toma respaldo real PostgreSQL, lo promueve al depósito de 365 días, sobrescribe la versión visible, comprueba que restaurar la visible falla y restaura la histórica por la consola. Compara el retrato de datos después; no es solo un listado de objetos. La credencial histórica solo tiene GetObject/GetObjectVersion y ListBucket/ListBucketVersions, sin escritura, borrado ni retención. Esto cierra el vacío específico señalado en el punto 6 del diseño, dentro de MinIO.

**CERRADO: el plazo sí llega al proceso de rclone al subir/listar/bajar.** `sh qa/node.sh qa/sonda32-plazos.ts` → `qa/revision32-plazos.log`:

```
RCLONE subir: plazo propio 100 ms llega al proceso; termina por plazo
RCLONE listar: plazo propio 100 ms llega al proceso; termina por plazo
RCLONE bajar: plazo propio 100 ms llega al proceso; termina por plazo
```

Sustituye únicamente el ejecutable rclone de esa sonda por un proceso que no termina antes de diez segundos, en una carpeta temporal; cada llamada con 100 ms termina por plazo. No es tráfico ni credenciales reales y no modifica el rclone del entorno. El defecto H32-1 está en cuándo el diario llama y qué plazo calcula, no en perder el parámetro al ejecutar rclone. `PRESUPUESTO_AL_ARRANCAR = 5 * 60_000` se transmite por `diarioAlArrancar`/`pasoDiario` (lectura); la sonda del cruce usa precisamente cinco minutos.

## Comprobaciones, límites y orden final

| Orden | Corrida | Salida |
|---|---|---|
| 1 | `sh qa/prueba.sh pruebas/23-respaldo.test.ts` | 61 pasan, 0 fallos; `qa/revision32-23.log` |
| 2 | `sh qa/prueba.sh pruebas/28-respaldo-diario.test.ts` | 42 pasan, 0 fallos; `qa/revision32-28.log` |
| 3 | `sh qa/prueba.sh pruebas/35-version-del-respaldo.test.ts` | 2 pasan, 0 fallos; `qa/revision32-35.log` |
| 4 | `sh qa/node.sh qa/sonda32-diario.ts` | Elección rechazada y presupuesto vencido demostrado; al ampliarse demuestra rotación; `qa/revision32-sonda-diario.log` |
| 5 | `sh qa/prueba.sh pruebas/20-entorno.test.ts` | 11 pasan, 0 fallos; `qa/revision32-20.log` |
| 6 | `sh qa/prueba.sh pruebas/36-guiones.test.ts` | 18 pasan, 0 fallos; `qa/revision32-36.log` |
| 7 | `sh qa/prueba.sh pruebas/90-revision-publicar-32.test.ts` | 1 pasa, 0 fallos, ampliada a CLI; `qa/revision32-publicar.log` |
| 8 | `sh qa/node.sh qa/sonda32-configuracion.ts` | Pública B/sello A aceptados por consulta, restauración con A rechazada; `qa/revision32-configuracion.log` |
| 9 | `sh qa/node.sh qa/sonda32-diario-historico.ts` | Restauración histórica por consola y datos iguales; `qa/revision32-diario-historico.log` |
| 10 | `sh qa/node.sh qa/sonda32-plazos.ts` | Plazos efectivos en tres operaciones; `qa/revision32-plazos.log` |

Todas las rutas de pruebas/logs anteriores están dentro de `/tmp/feruga-codex-qa14/`. La tabla agrupa la repetición de las dos sondas/pruebas nuevas ampliadas durante la revisión; nunca hubo dos corridas simultáneas.

**Qué quedó demostrado:** los tres hallazgos nuevos, las correcciones cerradas con las salidas citadas, la restauración diaria/histórica, los permisos de MinIO y las transiciones de manifiesto posteriores a «restaurada». **Qué es análisis con límites:** los contraejemplos de disponibilidad para `--corregida`, la creación de contenedor en tránsito al perder el daemon y las condiciones futuras de B2/servidor. No se presentaron como incidentes observados.

**Qué no se ejecutó / no alcanza esta evidencia:** instalación/publicación/vuelta completas con Docker real (simulacros excluidos), recorridos de navegador, batería total, tipos globales, proveedor B2/Healthchecks, apagón físico, envejecimiento de retención, disco lleno, migración de una instalación histórica sin sello, restauración específica de una base anterior a la elección seguida de promoción real (la decisión se probó con registro simulado, y la unicidad/inmutabilidad sí en PostgreSQL). No quedaron puntos 1–6 sin leer ni sin veredicto, pero estos límites no se declaran aprobados. La revisión de «rediseño» citada en tarea 7 no forma parte del encargo actual.

**Orden para cerrar antes de datos reales:** (1) corregir la aceptación del primer respaldo, H32-2, y exigir restaurarlo con la privada del dueño; (2) resolver rotación/repaso de generaciones, H32-3; (3) completar la frontera de presupuesto, H32-1; (4) ejecutar y registrar las condiciones de servidor de tarea 7 con las ampliaciones de la parte 6. Las pruebas verdes actuales no sustituyen esas condiciones.

**Disciplina de trabajo:** no se corrigió código de producción; solo se añadieron las sondas, una prueba nueva y sus logs en la copia, y este informe en la ruta solicitada. No se instaló ningún paquete ni se modificó archivo alguno del proyecto original. El Compose original solo se leyó para compararlo. No se ejecutó Docker fuera de los guiones de `qa/`; los datos de prueba se manejaron mediante sus auxiliares desechables. La copia no contiene repositorio Git, por lo que `git status` no permite certificar cambios por diff; esa limitación no es un hallazgo del proyecto.


---

## El encargo

```text
REVISIÓN DE CALIDAD, una sola pasada: lo que quedó sin verificar del respaldo y la operación, antes del servidor de verdad.
Proyecto: gestión de una recicladora (Next.js, PostgreSQL 17, Docker Compose; operacion/ en TypeScript y sh). Todo en español.
TU COPIA DE TRABAJO: /tmp/feruga-codex-qa14/   (al día)
TU INFORME: /tmp/feruga-codex-informe-32.md

REGLAS (obligatorias)
- No modifiques, crees ni borres ningún archivo dentro de /Users/maantora/Desktop/feruga.
  Trabaja SOLO en /tmp/feruga-codex-qa14/. No ejecutes npm ci ni npm install. No sustituyas su
  docker-compose*.yml (los de tu copia pueden estar atrasados respecto del proyecto: si algo depende
  de ellos, compáralo con lo que dice el proyecto y anótalo, no lo cuentes como hallazgo). Una sola
  corrida a la vez.
- No toques los contenedores feruga-web-1 y feruga-db-1 más allá de lo que hacen los guiones de
  qa/, ni la base «feruga»: son del usuario.
- NO TE DETENGAS A PREGUNTAR: ante una duda, decide, anótalo en el informe y sigue.
- Tu cuota puede cortarse. Crea el informe al empezar y GUÁRDALO después de cada parte, con lo
  encontrado hasta ese momento. Ve en el orden de abajo.

HERRAMIENTAS: las de qa/ (ver qa/LEEME.md). Puedes correr, una por una, pruebas existentes
(pruebas/20-entorno, 23-respaldo, 28-respaldo-diario, 36-guiones, las del sello) y escribir pruebas o
sondas nuevas en tu copia (pruebas/90-revision-*.test.ts, qa/sonda32-*.ts) para demostrar un
hallazgo. NO corras la batería completa, los recorridos ni los simulacros. NO corrijas el código:
anota el arreglo que propones.

QUÉ ES: el plan docs/planes/2026-10-03-despliegue.md (tareas 3, 3b, 5 y 7) y la guía docs/operacion.md.
Tus revisiones anteriores de esto, con lo que se hizo con cada hallazgo:
  docs/revisiones/2026-10-07-respuesta-a-la-decima-revision.md   (partes C y D)
  docs/revisiones/2026-10-13-codex-revision-de-los-intentos-y-el-sello.md   (con su respuesta)
Ninguna de esas correcciones la has vuelto a ver. El usuario pidió una sola pasada sobre todo lo
pendiente, no una cadena: comprueba y da un veredicto.

QUÉ REVISAR, EN ESTE ORDEN
1. EL SELLO DE LOS RESPALDOS (operacion/sello.ts, llave.ts, destino.ts, respaldar.ts, restaurar.ts,
   diario.ts, version-del-respaldo.ts): ¿se comprueba siempre antes de bajar, descifrar o restaurar,
   por todos los caminos (restaurar del de cada hora y del diario, instalar desde un respaldo, la
   versión que se instala, elegir el diario)? Verifica lo corregido tras tu revisión del 13 de
   octubre: las anotaciones del diario selladas (hueco y elección, una no vale por la otra); la
   elección escrita sin sello no se fija y queda como falla visible; la edad del respaldo y su
   advertencia al restaurar «el último»; leer la llave como la lee age (comentarios, una sola
   identidad, suma Bech32); sello.ts da juntos RESPALDO_LLAVE_PUBLICA y RESPALDO_SELLO.
2. EL RESPALDO DIARIO, lo corregido el 9 de octubre (segunda vuelta de tu parte D): la elección de
   cada día en la base (migración 0029, tabla respaldo_diario) y lo que pasa si la base vuelve de un
   respaldo anterior; los dañados que se siguen avisando hasta que el vigilante recibe el aviso; el
   tiempo de la corrida dentro de un día (lo subido a medias que se completa; dos corridas seguidas
   sin tiempo = falla); el recorrido de corrido desde el primer día conocido; el repaso por turnos.
   Para cada uno: ¿cerrado, o no? con la prueba o sonda que lo muestre.
3. LO QUE NUNCA REVISASTE DE LA PARTE D:
   (8) restaurar del diario, y con qué credenciales (la de recuperación; el servidor no puede borrar
       ni acortar);
   (9) las seis precisiones del diseño, al final de la tarea 3b del plan («Lo que se construyó, y en
       qué se aparta del diseño», puntos 1 a 6): ¿las aceptas, con qué límites?
   (10) tu veredicto sobre el respaldo diario y el orden de lo que falte.
4. LOS GUIONES DE PUBLICAR, lo corregido el 9 de octubre sin verificar (parte C): el migrador que se
   crea y arranca con el candado en las manos; compose.sh rechaza run/exec desacoplados (-d, -dT,
   -Td) y opciones desconocidas antes del servicio; la imagen de la base leída del commit (git show).
5. UNA DECISIÓN DEL 21 DE OCTUBRE: no se construye «publicar.sh --corregida» (el relevo a una versión
   corregida, sección D del diseño en la tarea 5). Razón: en el único caso en que serviría —la
   migración empezó y no se decidió abrir— el negocio estuvo cerrado desde antes de tomar el
   respaldo previo, así que volver a él (operacion/volver.sh) no pierde nada, y la corregida se
   publica después como cualquier otra. Se quitó el cierre «sustituida» de operacion/publicacion.ts.
   ¿La sostienes? ¿Hay algún caso en que volver al respaldo previo pierda algo o no se pueda, y la
   corregida sí? ¿Publicar normalmente después de volver funciona (el manifiesto «restaurada» como
   vigente, con la marca nueva de la base)?
6. SI ALCANZA: lo que la guía (docs/operacion.md) dice que se haga, ¿coincide con lo que hacen los
   guiones? y ¿queda algo que solo se puede probar en el servidor de verdad que no esté en la lista
   de la tarea 7 del plan?

AL TERMINAR: el informe completo en /tmp/feruga-codex-informe-32.md. Para cada punto: CERRADO o NO
CERRADO, con la prueba o sonda y su salida. Para cada hallazgo nuevo: gravedad (bloqueante:
condición para operar con datos reales; importante; menor), dónde (archivo y línea), cómo
reproducirlo y el arreglo que propones. Separa lo demostrado de lo sospechado, y di qué no alcanzaste.
En tu respuesta final, solo tres renglones y la ruta del informe.

```
