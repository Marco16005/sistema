> Informe de Codex (`gpt-6-astra`, esfuerzo alto, con ejecución), tal como lo dejó en
> `/tmp/feruga-codex-informe-10v-c.md` (9 de octubre). Es la **verificación de las correcciones**
> de la parte C de la décima pasada (los guiones de publicar) y de los cuatro puntos que había
> dejado abiertos al verificar A y B. Dio por **cerrados A1, B3, B4 y B6**, y de la parte C dejó
> **cuatro cosas abiertas**: el migrador que arranca tarde, el respaldo de fuera sin autenticar,
> `compose.sh run -d`, y la imagen de la base elegida desde la carpeta.
> Lo que se hizo con ellas está en `2026-10-07-respuesta-a-la-decima-revision.md`.

# Décima pasada de calidad — verificación de las correcciones de la parte C — 2026-10-09

1. A1 — CERRADO: precio_especial_nace toma cuenta → reserva UUID → relee renglón FOR UPDATE; linea_nace reserva el mismo UUID antes de consultar historia, también entre cuentas. Cotejada la prueba de dos sesiones (26-precio-especial:418); no repetida.
2. B3 — CERRADO para PUBLICACIONES en la instalación: crear sincroniza siempre su padre; asegurar_publicaciones hace sync aunque ya exista y conserva el fallo. Revisado el reintento, sin simular apagón.
3. B4 — CERRADO: leer y vuelta pasan la raíz a asegurar; el fallo al asegurar el nombre de la publicación impide leer y avanzar.
4. B6 — CERRADO: esperado, imagenes y HERMANOS comprueban propiedades propias con Object.hasOwn; constructor, toString y __proto__ ya no eluden esos mapas.
5. C-candado — NO CERRADO en conjunto: los tres defectos del relevo anterior están corregidos por el candado del sistema y la comprobación de escritura; pasó la prueba selectiva de herencia del candado en Linux; NO acepto todavía la excepción del migrador por el lanzamiento tardío confirmado abajo.
6. C-primera — CERRADO por lectura: recuperar caso 2 repite migrar_la_base únicamente sin anterior y luego comprueba/abre. Revisadas las ventanas migrar:antes, migrar:despues y antes de anotar marca/cerrar; no ejecuté el ensayo.
7. C-abrir — CERRADO: la rama ya abierta llega a arrancar respaldo, corre completo y HTTPS; cada fallo impide anunciar éxito. Verificación por lectura de volver.sh:180-215.
8. C-restaurador — CERRADO el solapamiento de restauradores observado: el turno se toma en postgres antes de descifrar/borrar temporal y se conserva hasta el finally; recuperar/volver esperan comprobacion y respaldo del proyecto guardado. Instalar espera esos hijos; no lanza un migrador independiente. La ventana del migrador se informa en C-candado.
9. C-imágenes de fuera — NO CERRADO el límite de confianza: eliminar descargar/guardar imágenes sí cierra esos dos hallazgos (incluido guardar repetido), pero el dump sigue siendo código remoto sin autenticación de origen y el manifiesto decide el commit sugerido. No acepto la afirmación nueva de que del almacenamiento no viene nada ejecutable; sonda abajo.
10. C-migrar — CERRADO: el modo que escribe toma el candado antes de preparar herramientas y leer pendiente/vigente; --revisar sigue siendo consulta.
11. C-compose — NO CERRADO: lista de consultas y rechazo de up/down correctos; run/exec toman candado y consultan pendiente, pero aceptan ejecución desacoplada que sobrevive a soltarlo (sonda abajo).
12. C-lecturas — CERRADO para los fallos denunciados: productores Git/Compose/ps y lecturas decisorias de manifiesto/base propagan fallo; misma_huella distingue error. Restan lecturas toleradas en diagnóstico (publicar:440, vigilante) y en volver:194-195, donde vacío impide abrir; no encontré una aprobación falsa adicional por esas lecturas.
13. C-llave — CERRADO: llave en variable sin exportar, entrega por stdin, ninguna escritura de llave; preparar_trabajo limpia y crea 700 bajo candado en publicar/volver/levantar. No ejecuté una prueba de SIGKILL para repetir la ausencia comprobable por lectura.
14. C-asentado — CERRADO el alcance anterior: DEL_NEGOCIO incluye detalles, inventario, catálogos, clientes y precios especiales; huella ordena por contenido y el ensayo altera cliente para comprobar sensibilidad. No corrí el ensayo.
15. C-volver / C-proyecto — NO CERRADO por lanzamiento tardío: volver sí espera antes de mover bases; proyecto_de usa configuración guardada, ps fallido detiene y kill tiene tope. La ausencia instantánea de contenedor/sesión no descarta al cliente aún lanzándolo.
16. C-commit — NO CERRADO del todo: ADMIN/WEB/RESPALDO/PROXY y construcción de herramientas usan git archive; DB aún lee FROM del archivo mutable en la carpeta (sonda abajo).
17. C-B3/B6 en los guiones — CERRADO lo solicitado: sync se intenta también con carpeta existente; corre recoge sin filtro de servicio y exige --nada-mas. Las dos excepciones corre_al_menos están explícitas (respaldo fallido y apertura tras vuelta).


### [bloqueante] El migrador sin descriptor puede arrancar después de que la recuperación lo dio por ausente
Dónde: operacion/pasos.sh:289, 309; db/migrar.ts:312
Escenario: A entra en migrar_con; su cliente Docker se pausa antes de crear el contenedor → matar solo A → B toma el candado, docker ps no encuentra migrador y tampoco hay sesión en la base → B continúa → el cliente de A despierta y lanza el migrador viejo. OPERACION_TURNO solo se exige no vacío, no se comprueba su vigencia. Puede alcanzar la base que B acaba de restaurar.
Confirmado con: `python3 qa/10vc-migrador.py` → `CANDADO_REAL_ESPERA_REAL_DOCKER_SIMULADO: MIGRADOR_ARRANCO_CON_SEGUNDO_DENTRO`. Usa candado y esperar_al_migrador reales; simula exclusivamente Docker y la respuesta de base ausente. Sin confirmar: para correr aquí la variante Docker real, reteniendo el cliente antes de crear el contenedor, matando al padre y soltándolo después de vuelta:restaurada.
Corrección sugerida: conservar el candado durante la creación y registrar durablemente un contenedor identificable antes de permitir el relevo; quien retoma debe poder cancelarlo aun sin arrancar. Alternativamente, validar/revocar el turno con una exclusión que abarque migración, rol y restauración.

### [bloqueante] El respaldo remoto todavía introduce código que se ejecuta antes de la auditoría
Dónde: operacion/restaurar.ts:123; operacion/destino.ts:336; operacion/version-del-respaldo.ts:54
Escenario: quien sustituye objetos del almacenamiento obtiene la llave pública del manifiesto → cifra su propio dump con ella → sustituye respaldo y manifiesto recalculando tamaño/SHA256 y conservando una publicación de forma válida → instalar/volver descifra y pg_restore ejecuta SQL del dump con la conexión administrativa antes de auditar. La forma del identificador no autentica tampoco el commit declarado: el manifiesto aún decide qué commit se solicita al operador.
Confirmado con: `sh qa/node.sh qa/10vc-respaldo.ts` → `MANIFIESTO_SUSTITUIDO_ACEPTADO commit=abcdef123456` y `QA10VC_SQL_DEL_ALMACEN_EJECUTADO antes_de_auditar=true; cifrado_con_solo_llave_publica=true`. Destino simulado en memoria; age, pg_dump, pg_restore y restaurarDelDestino reales, bases desechables. Una función inocua de una vista materializada lanza el mensaje al restaurar; la auditoría todavía no comenzó.
Corrección sugerida: autenticar el respaldo y su manifiesto (incluido commit/publicación) con firma y clave de verificación confiable fuera del almacenamiento, antes de pg_restore. Cifrar con age y comparar contra un hash sustituible no autentica al productor; la auditoría posterior no sustituye esa barrera.

### [importante] Compose permite soltar el candado mientras sigue una ejecución administrativa desacoplada
Dónde: operacion/compose.sh:26, 56; operacion/pasos.sh:339
Escenario: `sh operacion/compose.sh run -d --rm --no-deps consola persona alta Sonda mostrador` → el cliente termina y libera el candado, aunque la orden remota siga viva → publicar/migrar/levantar entra. También se admite exec -d; esas tareas no heredan el descriptor del host y esperar_lo_que_quedo no busca consola ni los exec.
Confirmado con: `python3 qa/10vc-guiones.py` → `COMPOSE_ADMITE_RUN_DETACHED_Y_SEGUNDO_ENTRA`. Wrapper y candado reales, Docker simulado: acredita que se acepta -d y se libera el candado. Sin confirmar: para correr aquí, retener una orden administrativa desacoplada antes de escribir y comprobar que otra operación entra antes de liberarla.
Corrección sugerida: rechazar --detach/-d en run y exec (también opciones combinadas), o registrar y esperar la ejecución remota hasta terminar antes de liberar el candado.

### [importante] La imagen de PostgreSQL todavía se elige desde la carpeta mutable
Dónde: operacion/publicar.sh:118
Escenario: comprobar carpeta limpia → cambiar docker/db.Dockerfile antes de construir → construir lee su FROM de la carpeta y etiqueta esa imagen como parte de la publicación del commit original. Las otras cuatro imágenes sí usan git archive. Basta una edición concurrente; la primera instalación no tiene una configuración anterior con que rechazar el cambio de db.
Confirmado con: `python3 qa/10vc-guiones.py` → `CONSTRUIR_REAL_DOCKER_SIMULADO: DB_USADA=bbbb DB_DEL_COMMIT=aaaa`. Ejecuta construir real con Docker simulado; confirma la elección del FROM mutable, sin construir ni descargar imágenes.
Corrección sugerida: leer también docker/db.Dockerfile del commit fijado (git show o el mismo archivo exportado), comprobando el estado del productor antes de extraer FROM.

Publicación en servidor real: NO todavía. Falta, en orden:
1. Cerrar el lanzamiento tardío del migrador; no basta observar ausencia de contenedor y sesión. En el ensayo, pausar el cliente antes de crear el contenedor y soltarlo después de volver al respaldo.
2. Autenticar respaldo y manifiesto antes de restaurar; exigir que el caso del dump sustituido se rechace antes de pg_restore. Construir imágenes desde el repositorio es una mejora válida, pero no elimina esta ejecución remota.
3. Impedir que run/exec desacoplados liberen la exclusión con trabajo administrativo vivo; probar también --detach y opciones combinadas.
4. Elegir la imagen DB desde el commit fijado; comprobar una edición concurrente del Dockerfile entre comprobar limpieza y construir.
5. Incorporar esos casos al ensayo de publicación que se está corriendo aquí, y recoger su resultado. No ejecuté batería, navegador ni ensayos; esta revisión no acredita su resultado pendiente.

Comprobación adicional: `sh qa/prueba.sh pruebas/31-candado.test.ts 'mientras siga trabajando'` → `ℹ tests 1`, `ℹ pass 1`, `ℹ fail 0`; `sh -n` correcto en los siete guiones. Los cierres por lectura están identificados como tales; no repetí las regresiones ya corridas.

Archivos creados en /tmp/feruga-codex-qa11/qa/: 10vc-migrador.py, 10vc-respaldo.ts y 10vc-guiones.py; no dejé contenedores corriendo (las dos ejecuciones Docker terminaron con --rm y docker ps filtrado por servicio pruebas quedó vacío), ni bases de las sondas. No modifiqué el proyecto original ni docker-compose.yml.
