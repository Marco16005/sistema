> **3 de noviembre de 2026.** Revisión con ejecución de Codex (`gpt-6-astra`, esfuerzo alto), encargo 36: lo que
> escribió Claude en la fase del servidor que toca claves. Completa. 7 hallazgos (3 altos, 4 medios); lo que se
> hizo con cada uno está en `2026-11-03-respuesta-a-la-revision-de-la-fase-del-servidor.md`.

# Revisión con ejecución — fase del servidor y claves

Fecha: 2026-11-03. Copia: `/tmp/feruga-codex-qa14/`.

## Alcance y condiciones
Revisión de SMTP, avisos y servicio, operación desde fuera, rotación de clave e integración de limpieza. Se ejecutan las comprobaciones secuencialmente, sin instalar dependencias, sin modificar el producto y sin tocar los contenedores ni la base protegidos. Las sondas nuevas se guardarán en `qa/`. Se distinguirán hallazgos comprobados, observaciones de código y limitaciones del entorno.

## Resultado
Revisión terminada: **7 hallazgos (3 de gravedad alta y 4 media)**. Prioridad: H1 (secreto en error SMTP), H6 (rotación inconsistente o diagnóstico falso) y H7 (secreto en registros con muestreo). Las pruebas existentes y el ensayo integral pasan, pero no cubrían estos casos adversarios. No se aplicaron correcciones al producto.

Todas las órdenes de este informe se ejecutan desde `/tmp/feruga-codex-qa14/`.

## Parte 1 — pruebas existentes
- `sh qa/prueba.sh pruebas/57-avisos-de-fuera.test.ts`: **9/9 aprobadas**; registro `qa/resultado-57.log`.
- `sh qa/prueba.sh pruebas/58-fuera.test.ts`: **5/5 aprobadas**; registro `qa/resultado-58.log`.
- Bien: las pruebas comprueban reintento tras fallo de canal, rechazo de SMTP sin STARTTLS, descarte de respuestas agregadas antes del cifrado, destinos de correo, llave por stdin, ausencia de puertos y limpieza tras fallos ordinarios.
- Estas pruebas no bastan para demostrar secretos ausentes de cualquier error ni consistencia de claves después de interrupciones. Se añaden sondas adversarias.

## Parte 2 — ensayo de operación real
Se usa `qa/ensayo-36.sh`, copia del ensayo original con proyecto exclusivo `feruga_qa36`, y `qa/comun-36.sh`, que coloca su instalación temporal dentro de `qa/` y excluye `qa/` de la copia para evitar recursión. No se modifica ningún archivo del producto.

Orden: `QA36_RAIZ="$PWD" BUILDX_CONFIG="$PWD/qa/buildx-36" sh qa/ensayo-36.sh > qa/resultado-ensayo-36.log 2>&1`.

La primera preparación se detuvo porque Buildx intentaba escribir su actividad fuera de la copia; se resolvió redirigiendo `BUILDX_CONFIG`. El ensayo aislado aprobó el latido real y «Desde fuera» (generar llave/sello, identificar respaldo, restaurar, avisar al vigilante y eliminar base desechable).

Resultado del ensayo integral: **«El ensayo pasó»**, incluido el último paso: clave nueva válida, clave anterior rechazada, resto del `.env` intacto, aplicación conservada, respaldo y consola funcionando, candado libre y publicación de una versión nueva satisfactoria. El latido real también pasó. Esto valida el camino normal, no las interrupciones adversarias.

## Parte 3 — SMTP, avisos y latido adversarios
Orden: `sh qa/node.sh qa/sonda-avisos-36.ts`; registro `qa/resultado-avisos-36.log`. La sonda terminó correctamente y usa certificados y claves ficticios.

### H1 — Alta: una respuesta SMTP puede poner la contraseña en el error y en el registro
**Dónde:** `operacion/correo.ts:111`, construcción del error con `r.texto`; propagación en `operacion/avisos.ts` y `operacion/respaldar.ts`.

**Qué pasa:** el servidor recibe AUTH por TLS, pero puede rechazarlo devolviendo la contraseña literal o el bloque `AUTH PLAIN` completo. Se copia ese texto al `Error`; el servicio lo imprime. Base64 es reversible y contiene la contraseña. Limitar a 300 caracteres no impide la fuga.

**Reproducción:** casos `eco-clave` y `eco-auth` de la sonda, con servidor SMTPS real y certificado confiable. Ambos verifican que el error contiene el secreto ficticio o el bloque de autenticación que lo codifica; salida `fuga:true`.

**Corrección propuesta:** no incluir texto libre recibido del servidor en errores operativos; conservar fase y código SMTP, y códigos mejorados validados si hacen falta. Añadir pruebas de eco de contraseña y AUTH en todas las fases, no solamente de rechazo normal de destinatario.

### H2 — Media: el latido puede quedarse pendiente indefinidamente
**Dónde:** uso en `operacion/respaldar.ts:589`; `operacion/comprobar.ts:125–156` (`estadoPorHttps`).

**Qué pasa:** el timeout HTTPS es de inactividad, no un límite total. Un cuerpo que entrega bytes continuamente lo mantiene vivo. Además, si la respuesta se corta después de sus encabezados, no se atienden `aborted`/`error`/cierre prematuro de la respuesta, y la promesa puede no resolverse. La vuelta del latido no termina y la parada del servicio espera en `Promise.all`.

**Reproducción:** casos `HTTPS goteando` y `HTTPS respuesta truncada`: plazo 70 ms, se sigue pendiente a los 350 ms y también después de destruir la conexión. Se ejecutó con HTTPS real y certificado validado. La vigilancia externa dejaría de recibir latidos y alertaría; no se afirma que continúe enviando éxitos.

**Corrección propuesta:** límite absoluto por petición, destruir petición/respuesta al vencer, y rechazar ante respuesta abortada, error o cierre antes de `end`; limpiar el reloj al resolver o rechazar.

### H3 — Media: el latido comunica éxito aunque no pudo evaluar todos sus datos
**Dónde:** `operacion/avisos.ts`, `revisarSitio`.

**Qué pasa:** disco con `NaN`, `Infinity`, libre mayor que total o total cero con libre positivo pasa como sano; certificado ausente o con fechas inválidas también produce `bien`. La conexión TLS válida demuestra validez actual, pero no demuestra que reste al menos un sexto de vida si no se leyó la vigencia. La prueba existente exige explícitamente éxito con certificado nulo: es una decisión implementada, pero deja sin cubrir esa protección.

**Reproducción:** casos correspondientes en `qa/sonda-avisos-36.ts`, todos con `latido:"bien"`. Fechas futuras o inválidas se inyectan directamente en `revisarSitio`: una conexión TLS real normalmente las rechazaría; no se afirma que el cliente TLS acepte certificados inválidos. Los discos anómalos se inyectan en la interfaz, no se observaron en `statfs` real.

**Corrección propuesta:** exigir números finitos, total positivo y `0 <= libre <= total`; validar fechas y orden de vigencia. Si faltan datos del certificado, avisar «no se pudo comprobar la renovación», sin afirmar que venció. Puede distinguirse monitor degradado de sitio caído.

**Bien:** SMTPS y STARTTLS reales cifran antes de AUTH; la respuesta sobrante parcial antes de TLS se rechaza. El texto con `CRLF . CRLF` y un encabezado falso queda dentro del cuerpo base64 y no termina DATA; el asunto con CRLF tampoco agrega encabezados. Las esperas SMTP probadas (saludo, autenticación, DATA, QUIT) terminan en el plazo configurado. Telegram no devuelve el token aunque el cuerpo HTTP de error lo contenga. Un canal fallido impide marcar el aviso enviado.

**Bien:** 5 GB/10 % exactos y un sexto exacto son aceptados; un byte o un milisegundo por debajo alerta, igual que un certificado vencido. El servicio solo procesa avisos si hay canales y reintenta sus vueltas sin detener los respaldos; latido real aprobado en el ensayo.

## Parte 4 — fuera y limpieza
Orden: `python3 qa/sonda-fuera-limpieza-36.py`; registro `qa/resultado-fuera-limpieza-36.log`. Sonda aprobada. Se simulan las llamadas operativas de `fuera.sh`; la interpretación de `--env-file` se verifica además con Docker real, sin red y sin ninguna base conectada.

### H4 — Media: el filtro del archivo de recuperación acepta datos prohibidos que Docker sí carga
**Dónde:** `operacion/fuera.sh:68`.

**Qué pasa:** el filtro reconoce únicamente `NOMBRE=` al principio exacto del renglón. Docker también admite espacios iniciales y nombres sin `=` que heredan el valor del entorno del cliente. `  BD_CLAVE=…`, `  DATABASE_URL=…` y un renglón `BD_CLAVE` eluden el filtro y llegan al contenedor.

**Reproducción:** casos `espacios`, `variable heredada` y `URL con espacios`; `fuera.sh version` acepta y una ejecución real con el mismo `--env-file` comprueba que la variable está definida. El caso normal `BD_CLAVE=…` sí se rechaza. Se usaron valores ficticios.

**Corrección propuesta:** analizar el archivo con las mismas reglas que Docker y usar una lista de variables permitidas (`RESPALDO_DESTINO`, `RESPALDO_DESTINO_DIARIO`, familias RCLONE permitidas, `ENSAYO_VIGIA_URL`); rechazar herencia implícita y nombres ajenos. No basta extender la expresión a cuatro nombres si la intención es aceptar únicamente almacenamiento/vigilante.

### H5 — Media: un fallo al borrar la base desechable se silencia y se devuelve éxito
**Dónde:** `operacion/fuera.sh:35–41`.

**Qué pasa:** `docker rm -f` y la eliminación de la red ignoran cualquier error (`|| true`, salida descartada). Puede quedar una base restaurada con datos reales mientras la orden termina con código 0 y dice que el ensayo pasó. No se refiere a la imposibilidad general de limpiar ante SIGKILL: ocurre también en una salida normal.

**Reproducción:** caso `docker rm falla`: Docker simulado completa restauración y devuelve 1 en la eliminación; el guion devuelve 0 sin advertencia. El ensayo real sí eliminó su base en condiciones normales.

**Corrección propuesta:** comprobar eliminación, reintentar fallos transitorios y confirmar ausencia. Si no se puede borrar, devolver fallo y mostrar nombre del recurso y orden de limpieza, manteniendo también el resultado de restauración.

**Bien:** `llave` rechaza stdout conectado a una terminal real antes de generar la llave. En los caminos revisados, la llave privada viaja por memoria/stdin, no por argumentos; las corridas que la manejan usan `--log-driver none`. No hay `-p`/`--publish` en ninguna orden de `fuera.sh`; el ensayo completo restauró sin publicar su base. Los archivos de salida de las sondas solo contienen claves ficticias.

**Bien — integración de limpieza:** sin herramientas disponibles, la función inspecciona exactamente `recicladora_qa36-herramientas:abcdef012345` (proyecto, guion, `herramientas`, dos puntos, commit de 12 caracteres). Si no existe, aborta sin construir ni borrar. `limpieza.ts` conserva ese mismo esquema. `publicar.sh` llama la limpieza después de abrir/comprobar/cerrar el manifiesto y conserva el candado; un fallo imprime aviso sin deshacer la publicación. Sin hallazgos en el cambio de integración solicitado.

## Parte 5 — rotación: interrupciones, errores, argumentos y registros
Orden: `python3 qa/sonda-rotacion-36.py`; registros `qa/resultado-rotacion-36.log` y `qa/resultado-rotacion-36.json`.

La sonda usa el script de rotación, `pasos.sh` y `candado.sh` copiados sin alterarlos, un PostgreSQL 17 real exclusivo (`feruga-qa36-rotacion`, sin red externa ni puertos publicados), y barreras en ejecutables para detener cada transición. Se exige SCRAM para la conexión TCP y se comprueba antes que la contraseña errónea no sirve. Se simulan el manifiesto/Compose y `levantar.sh`: el levantamiento y la siguiente publicación reales ya se comprobaron en el ensayo integral. Las claves son ficticias. El contenedor se elimina al finalizar incluso ante fallo.

Se completaron **16 interrupciones**, ocho puntos con SIGTERM y SIGKILL, además de dos errores inducidos posteriores al cambio, recuperación e idempotencia con `--la-del-env`, candado real ocupado y captura de argumentos.

### H6 — Alta: la rotación puede dejar base y `.env` distintos, sin advertirlo; ciertos errores incluso afirman lo contrario
**Dónde:** `operacion/cambiar-clave-de-la-base.sh:33–41, 95–107`.

**Qué pasa:** después de aplicar ALTER ROLE y antes de reemplazar `.env`, los traps solo limpian y sueltan el candado. No revierten la clave ni dejan una marca duradera de operación pendiente. Con SIGTERM el guion sale 143 sin explicación del desajuste; con SIGKILL tampoco queda información de recuperación específica. La próxima rotación detecta el desacuerdo, pero hasta que alguien la ejecute los consumidores del `.env` conservan una contraseña inválida.

Además, si falla la comprobación con la nueva contraseña y también falla el intento de reversión, `poner_en_la_base "$del_env" || true` oculta el segundo fallo y se afirma «se dejó la de antes» aunque no sea cierto. Si Docker pierde/falla la respuesta después de que PostgreSQL aplicó el ALTER, se afirma «No se tocó nada» aunque la clave ya cambió.

**Reproducción:** `qa/sonda-rotacion-36.py`, puntos `despues-alter`, `despues-verificar-nueva`, `despues-verificar-vieja`, `despues-temporal`, con ambas señales: `env_autentica:false`, `advierte_desajuste:false`. Casos `rollback` y `respuesta-perdida`: `.env` no autentica y `afirma_que_no_cambio:true`. Los fallos de respuesta/reversión se inducen en el intermediario; el estado de contraseña se comprueba contra PostgreSQL real.

**Corrección propuesta:** registrar y sincronizar en disco una rotación pendiente antes de modificar PostgreSQL, guardar material de recuperación con permisos 0600 y actualizar sus fases de forma duradera. En salida interrumpida informar claramente del estado incierto; la próxima operación debe detectar y resolver la marca antes de publicar/levantar. Confirmar mediante autenticación cualquier reversión, nunca silenciar su fallo ni afirmar que no se tocó nada ante una respuesta ambigua. `--la-del-env` puede ser la vía de reparación explícita, pero debe quedar indicada. El marcador no debe desaparecer con la limpieza genérica de `.operacion.trabajo`.

### H7 — Alta: el muestreo de PostgreSQL guarda la contraseña nueva, también en los logs de Docker
**Dónde:** `operacion/cambiar-clave-de-la-base.sh:76–78`.

**Qué pasa:** se desactivan `log_statement` y `log_min_duration_statement`, pero no `log_min_duration_sample`. Con muestreo habilitado, PostgreSQL registra la sentencia completa `ALTER ROLE … PASSWORD '…'`; al ir a stderr del servidor también se ve en `docker logs`. No necesita que falle ALTER.

**Reproducción:** la misma sonda arranca PostgreSQL 17 con `-c log_min_duration_sample=0 -c log_statement_sample_rate=1` y ejecuta la función original mediante la rotación. El resultado es `clave_nueva_en_log_postgresql_y_docker:true`. La sonda comprueba presencia sin imprimir la contraseña ni volcar los registros. Esta condición no se afirma para los valores de registro por omisión: se reproduce al activar muestreo, configuración válida que la protección «nunca en los registros» debe contemplar.

**Corrección propuesta:** desactivar también el muestreo en la sesión y evitar que errores de ALTER impriman su sentencia (`log_min_error_statement` y verbosidad de psql, según el método elegido). Preferir enviar un verificador SCRAM calculado del lado del cliente, como hace `psql \password`, para que la contraseña literal no forme parte del SQL, además de controlar registros. Añadir regresión con registro de sentencias, duración, muestreo y error habilitados. No se propone interpolar la contraseña en argumentos.

**Bien:** no se encontró la contraseña nueva en argumentos capturados ni stdout/stderr de la rotación durante las 16 interrupciones. El candado real ocupado impidió llegar a Docker. `--la-del-env` recuperó la base y repetirlo fue idempotente. Después del reemplazo del `.env` ambas credenciales coinciden. El ensayo integral probó la publicación siguiente con éxito.


## Matriz de interrupciones y límites de la evidencia

| Barrera de la sonda | `.env` autentica tras SIGTERM | Tras SIGKILL |
|---|---|---|
| ALTER delegado, antes de ejecutarlo | No | No |
| Después de ALTER | No | No |
| Después de verificar clave nueva | No | No |
| Después de verificar rechazo de clave vieja | No | No |
| Después de escribir archivo temporal | No | No |
| `mv` delegado, antes de ejecutarlo | Sí | Sí |
| Después de `mv` | Sí | Sí |
| Antes de levantar servicios | Sí | Sí |

Las barreras detienen el ejecutable hijo; se mata al guion padre y luego se libera al hijo, que termina su operación. Por eso las filas «antes de ALTER» y «antes de mv» reflejan una operación **ya delegada que sobrevive al padre**, no una ejecución detenida antes de lanzar el comando. Las filas posteriores a ALTER y a la escritura temporal demuestran directamente la ventana vulnerable. En ninguno de los casos con desajuste se emitió una advertencia específica. Para SIGKILL no se espera que el proceso pueda imprimir nada: lo que falta es un estado duradero que otras operaciones detecten.

No se hizo inspección global de procesos con `ps` ni se usó `pkill`: los argumentos se capturaron en intermediarios y las señales se enviaron únicamente a hijos propios. Las limitaciones de visibilidad de procesos ajenos no se consideran hallazgos. El candado se probó con bloqueo real, no solo mediante simulación.

No se simularon apagones de hardware ni fallos de `fsync`. No se afirma garantía universal de los caminos que pasaron: los resultados indican exactamente qué condiciones se ejercitaron. La validación de errores en el borrado de `fuera.sh` es una inyección de fallo, separada de la eliminación real que sí pasó.

## Cierre y artefactos
- `sh qa/tipos.sh`: **aprobado**, registro `qa/resultado-tipos-36.log`.
- Suites 57 y 58: **14/14**; ensayo completo: **aprobado**; sondas finales: **aprobadas como comprobaciones del comportamiento descrito**, incluidas las aserciones que demuestran defectos.
- Sondas nuevas: `qa/sonda-avisos-36.ts`, `qa/sonda-fuera-limpieza-36.py`, `qa/sonda-rotacion-36.py`; adaptación aislada del ensayo: `qa/ensayo-36.sh`, `qa/comun-36.sh`.
- No se modificó código del producto. Las copias usadas por la sonda de rotación coinciden byte por byte con sus originales. Solo se crearon archivos de revisión bajo `qa/` y este informe.
- Verificación final: no quedaron contenedores de `feruga_qa36`, ni su red/volúmenes, ni `feruga-qa36-rotacion`; el paso real «Desde fuera» verificó ausencia de su base desechable.
- No se operó sobre los contenedores protegidos ni sobre la base `feruga` del usuario. Las suites usaron las bases desechables de la plantilla indicada por `qa/`; el ensayo usó su instalación independiente. No se ejecutó instalación manual de dependencias en la copia. La construcción y el recorrido incluidos en el ensayo original se ejecutaron en su entorno aislado.
