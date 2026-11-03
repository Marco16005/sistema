> **3 de noviembre de 2026.** Verificación con ejecución de Codex (encargo 37) de las correcciones a su revisión 36.
> **H1 a H7: cerrados.** Dejó una observación aparte (el «pasó» de `fuera.sh` antes de borrar la base desechable),
> atendida en `fuera.sh` el mismo día. No corrió el ensayo integral; lo corrió Claude, y encontró que el latido
> perdía el certificado en sesiones TLS reanudadas (corregido en `ad428de`).

# Verificación 37 — correcciones de la revisión 36

Fecha: 2026-11-03. Copia exclusiva: `/tmp/feruga-codex-qa14/`.

## Alcance y método
Una pasada de verificación de H1–H7. Se leyó primero `docs/revisiones/2026-11-03-respuesta-a-la-revision-de-la-fase-del-servidor.md`. Se conservan los casos de las tres sondas 36, adaptando sus expectativas y sus intermediarios a las interfaces corregidas. Ejecuciones secuenciales, sin instalar dependencias ni cambiar código del producto. Los archivos auxiliares quedan en `qa/`; este informe es la excepción de ruta solicitada. No se operará sobre los contenedores protegidos ni la base `feruga` del usuario. Las limitaciones sobre procesos ajenos no cuentan como hallazgos.

## Resultado
**H1, H2, H3, H4, H5, H6 y H7: CERRADOS.** Las tres sondas adaptadas aprueban; 16/16 interrupciones conservan un estado recuperable y comprobado. Pruebas 57/58/59: **20/20**; tipos: **APROBADO**. No se detectaron nuevos defectos de seguridad o consistencia en los casos ejercitados. Se señala aparte una frase de éxito anticipada que continúa en `fuera.sh`.

Una sola pasada de revisión, con dos correcciones del arnés documentadas: un arranque fallido antes de ALTER y una repetición exclusiva de H7 al detectar que las opciones de arranque impedían separar los perfiles de registro. No se repitió la matriz ni las suites.

## Parte 1 — H1, H2 y H3
Orden: `sh qa/node.sh qa/sonda-avisos-36.ts`, salida 0. Registro: `qa/resultado-avisos-37.log`.

- **H1 CERRADO.** Servidor SMTPS real repite la contraseña y, por separado, el AUTH PLAIN. Ambos errores quedan en «el servidor de correo no aceptó el usuario y la contraseña (535)», sin secreto literal ni base64. Se conservan SMTPS/STARTTLS sin AUTH en claro, protección ante respuesta sobrante previa a TLS, DATA e inyección de encabezados, plazos SMTP, token de Telegram ausente del error y aviso sin marcar cuando falla un canal.
- **H2 CERRADO.** HTTPS real con certificado confiable: goteo cada 20 ms y plazo total de 70 ms rechaza a los **74 ms**; respuesta cortada rechaza a los **24 ms** con «el sitio cortó la respuesta antes de terminarla». Son peticiones independientes, y ambas promesas terminan.
- **H3 CERRADO.** NaN, infinito, libre mayor que total, total cero, certificado ausente y fechas inválidas producen `latido:fallo`. Se conservan los bordes de 5 GB/10 % y un sexto de vigencia, y los rechazos inmediatamente inferiores. El certificado de fechas futuras inyectado sigue dando bien: la validez actual corresponde al TLS real, como se delimitó en la revisión 36; no se presenta como una aceptación de certificado inválido por TLS.

## Parte 2 — H4 y H5
Orden: `python3 qa/sonda-fuera-limpieza-36.py`, salida 0. Registro: `qa/resultado-fuera-limpieza-37.log`.

- **H4 CERRADO.** Se rechazan `BD_CLAVE=…`, `  BD_CLAVE=…`, el nombre heredado `BD_CLAVE` y `  DATABASE_URL=…`. Docker real, sin red ni base conectada, confirma que los mismos archivos sí cargan esas variables: se repitió exactamente la discrepancia que originó el hallazgo.
- **H5 CERRADO.** Con eliminación fallida, se hacen dos intentos y se comprueba la presencia del contenedor. El proceso termina **1**, identifica `feruga-fuera-base-3161`, advierte que conserva datos y muestra `docker rm -f` con su nombre. La restauración sí imprime antes «El ensayo pasó… La base desechable se borra»; el resultado final y stderr ya no silencian el fallo de limpieza. Esa frase anticipada sigue siendo imprecisa, pero ya no reproduce el éxito silencioso de H5.
- Se conserva el rechazo de llave a terminal real, ausencia de puertos publicados y llave ausente de argumentos. La limpieza de imágenes busca `recicladora_qa36-herramientas:abcdef012345` y, sin herramientas, aborta sin construir ni borrar.

Límite: la falla de eliminación se inyecta en Docker simulado; la interpretación de archivos de entorno se prueba con Docker real.

Preparación de H6/H7: el primer arranque del arnés se detuvo antes de ejecutar ALTER por una sustitución demasiado amplia de `NODE` en su intermediario. Se corrigió únicamente la sonda para sustituir el shebang; no fue un fallo del producto ni una interrupción de la matriz. El contenedor aislado se eliminó al salir.

## Parte 3 — H6: matriz de interrupciones
**H6 CERRADO.** Las 16 interrupciones conservan base y `.env` compatibles, o dejan `.env.nueva` con la clave que autentica contra PostgreSQL real. Toda marca observada tiene permisos 0600. Los tres guiones originales se ejecutaron para comprobar su rechazo por la marca, sin ninguna llamada a Docker. Se repitió la rotación después de cada fila con marca: recuperó y quitó la marca en todas.

Orden: `python3 qa/sonda-rotacion-36.py`. Evidencia: `qa/resultado-rotacion-37.log`, `qa/resultado-rotacion-37.json` y salidas por caso en `qa/rotacion-37/`.

Se usa PostgreSQL 17 exclusivo `feruga-qa37-rotacion`, sin red externa ni puertos, con SCRAM exigido por TCP; clave errónea rechazada antes de empezar. Se copian sin editar los guiones del producto; manifiesto/Compose y levantamiento final están simulados. El verificador se calcula con `operacion/scram.ts` real y el cambio/auth se ejecutan en PostgreSQL real.

| Punto | Señal | Base y `.env` iguales | Marca presente | Clave de marca autentica | Levantar bloqueado | Publicar bloqueado | Volver bloqueado | Repetición recupera |
|---|---|---|---|---|---|---|---|---|
| antes-alter | SIGTERM | No | Sí | Sí | Sí | Sí | Sí | Sí |
| despues-alter | SIGTERM | No | Sí | Sí | Sí | Sí | Sí | Sí |
| despues-verificar-nueva | SIGTERM | No | Sí | Sí | Sí | Sí | Sí | Sí |
| despues-verificar-vieja | SIGTERM | No | Sí | Sí | Sí | Sí | Sí | Sí |
| despues-temporal | SIGTERM | Sí | Sí | No | Sí | Sí | Sí | Sí |
| antes-mv | SIGTERM | Sí | No | No aplica | No aplica | No aplica | No aplica | No aplica |
| despues-mv | SIGTERM | Sí | No | No aplica | No aplica | No aplica | No aplica | No aplica |
| antes-levantar | SIGTERM | Sí | No | No aplica | No aplica | No aplica | No aplica | No aplica |
| antes-alter | SIGKILL | No | Sí | Sí | Sí | Sí | Sí | Sí |
| despues-alter | SIGKILL | No | Sí | Sí | Sí | Sí | Sí | Sí |
| despues-verificar-nueva | SIGKILL | No | Sí | Sí | Sí | Sí | Sí | Sí |
| despues-verificar-vieja | SIGKILL | No | Sí | Sí | Sí | Sí | Sí | Sí |
| despues-temporal | SIGKILL | Sí | Sí | No | Sí | Sí | Sí | Sí |
| antes-mv | SIGKILL | Sí | No | No aplica | No aplica | No aplica | No aplica | No aplica |
| despues-mv | SIGKILL | Sí | No | No aplica | No aplica | No aplica | No aplica | No aplica |
| antes-levantar | SIGKILL | Sí | No | No aplica | No aplica | No aplica | No aplica | No aplica |

«No aplica» en bloqueos significa que no quedó marca; no se ejecutan publicaciones reales en esta matriz. En `despues-temporal`, el punto original de la sonda ahora equivale a haber escrito `.env.nueva` antes del ALTER: la base todavía tiene la del `.env` y la marca guarda la próxima. Se bloquean los tres guiones también en ese estado, y la repetición descarta el intento no aplicado y hace uno nuevo.

Como en la 36, se señala al padre y luego se libera el hijo detenido: «antes de ALTER» y «antes de mv» son comandos ya delegados que pueden terminar después de morir su padre. No se confunden con una barrera previa a lanzar el comando. Se espera a que termine el hijo antes de comprobar el estado. No se simulan apagones ni fallos físicos de disco.

Casos de error originales adaptados:
- Primera comprobación con la nueva falla (`rollback`, nombre histórico de la sonda): salida 1, `.env` no autentica, marca sí; no afirma que dejó la clave anterior ni que no tocó nada. Los tres guiones bloquean y repetir recupera. El producto corregido ya no intenta rollback.
- Respuesta perdida después del ALTER aplicado: salida 0; consulta a la base, confirma el cambio y deja `.env` coincidente sin marca.
- ALTER rechazado antes de aplicar: salida 1, base conserva la anterior y `.env` coincide; descarta la marca. Aquí «No se tocó nada» corresponde al estado comprobado.
- Ninguna de las dos claves coincide: rechaza, conserva marca, indica `--la-del-env` y bloquea los tres guiones; esa opción recupera y repetirla es idempotente.
- Candado real ocupado: se niega antes de llamar a Docker. Ninguna clave nueva apareció en argumentos ni salida durante las 16 filas.

## Parte 4 — H7: registros de PostgreSQL y Docker
**H7 CERRADO.** La sonda de rotación terminó con salida 0. Se ejecutaron dos perfiles efectivos, comprobados con `pg_settings` y conservados en `qa/rotacion-37/configuracion-muestreo.txt` y `configuracion-todos.txt`:

| Perfil | Sentencias | Duración mínima | Muestreo mínimo / tasa | `log_duration` | Sentencias en error |
|---|---|---|---|---|---|
| Muestreo | none | -1 | 0 / 1 | off | error |
| Todos | all | 0 | 0 / 1 | on | error |

En cada perfil se ejecutó una rotación normal y otra con error real de PostgreSQL: el intermediario conserva los SET del producto y cambia solo el destinatario de ALTER a un rol inexistente. Así se comprueba el camino de error sin inventar un rechazo del cliente. El error real aparece en el registro; su sentencia con el verificador no aparece.

Las cuatro combinaciones, confirmadas en la ejecución exclusiva de H7, dieron **clave ausente del SQL, de los logs, de los argumentos y de stdout/stderr; verificador también ausente de los logs**. El SQL contiene `SCRAM-SHA-256$…`, calculado por el módulo real. La rotación normal autentica con la nueva; tras error, sigue autenticando la anterior y la marca se descarta. Búsqueda de las **33 claves capturadas** en la primera ejecución (registro completo activo) y de las **4 claves** de la ejecución exclusiva de H7 en las salidas acumuladas de PostgreSQL (`docker logs`, stdout y stderr): **0 fugas**. No se imprimen secretos ni verificadores en este informe.

Órdenes: `python3 qa/sonda-rotacion-36.py` y, para corregir la configuración del arnés sin repetir H6, `python3 qa/verificar-registros-37.py`; ambas terminaron con salida 0. Evidencia: `qa/resultado-registros-37.json`, `qa/resultado-registros-37.log`, `qa/resultado-rotacion-37.log`, configuraciones efectivas y salidas de cada combinación en `qa/rotacion-37/`. El contenedor exclusivo se eliminó al finalizar. Esta evidencia corresponde a los perfiles probados, no a cualquier extensión de auditoría externa imaginable.

## Parte 5 — pruebas pedidas
- `sh qa/prueba.sh pruebas/57-avisos-de-fuera.test.ts`: **10/10**, salida 0; `qa/resultado-57-37.log`.

- `sh qa/prueba.sh pruebas/58-fuera.test.ts`: **5/5**, salida 0; `qa/resultado-58-37.log`.
- `sh qa/prueba.sh pruebas/59-clave-de-la-base.test.ts`: **5/5**, salida 0; `qa/resultado-59-37.log`.
- `sh qa/tipos.sh`: **APROBADO**, salida 0; `qa/resultado-tipos-37.log`.

Total de pruebas pedidas: **20/20**, sin fallos, omisiones ni cancelaciones; tipos aprobado. Se usaron los guiones existentes, sin `npm ci` ni `npm install`, y sus bases desechables desde la plantilla `feruga_plantilla_codex`; no la base de negocio `feruga`.

## Control de la evidencia y límites
Control de evidencia H7: al releer los `pg_settings` se detectó que las opciones de arranque del arnés prevalecieron sobre `ALTER SYSTEM`: ambos perfiles anteriores fueron en realidad «Todos». Esa primera corrida sí demuestra la ausencia de fugas con todos los registros activos y en 33 claves, pero no una configuración separada de solo muestreo. Se corrigió el arnés para establecer opciones recargables y se repitió únicamente H7. Esa ejecución terminó con salida 0 y aserciones explícitas sobre cada valor de `pg_settings`: los dos perfiles de la tabla quedaron confirmados. No se repitió la matriz H6.

La copia de los siete guiones de operación usados por la sonda coincide byte por byte con los originales de esta copia de trabajo. No se editó código del producto. Los cambios de sondas se limitan a las expectativas corregidas, el cálculo SCRAM real, la marca persistente, los bloqueos y su recuperación, y los perfiles de registro necesarios para verificar lo solicitado.

No se volvió a correr el ensayo integral `qa/ensayo-36.sh`: esta verificación ejercita las sondas y pruebas pedidas. El levantamiento final de la matriz es simulado; el bloqueo de levantar/publicar/volver por la marca usa los guiones originales. No se atribuye a esta pasada una validación nueva de publicación integral ni del reinicio de consumidores. Las suites corrieron con `--no-deps`; no se levantaron, detuvieron ni eliminaron los contenedores protegidos. No se consultó ni alteró la base de negocio `feruga`; las pruebas usan bases desechables y la rotación usa `postgres` del contenedor exclusivo. No se inspeccionaron ni mataron procesos ajenos.

## Observación aparte
**Mensaje anticipado de éxito (sin reabrir H5).** `operacion/fuera.sh` todavía escribe «El ensayo pasó… La base desechable se borra» antes de ejecutar su trap de limpieza. Si borrar falla, el resultado final ahora es inequívoco para el proceso: código 1, dos intentos, comprobación y advertencia con la orden de borrado. La frase previa puede confundir a quien lea únicamente stdout. Es una observación sobre el mensaje que persiste, no un nuevo caso de fallo silencioso. No se encontraron otros problemas nuevos en lo corregido dentro del alcance ejecutado.

## Cierre y artefactos
- Informe completo: `/tmp/feruga-codex-informe-37.md`.
- Sondas adaptadas: `qa/sonda-avisos-36.ts`, `qa/sonda-fuera-limpieza-36.py`, `qa/sonda-rotacion-36.py`; comprobación exclusiva de perfiles: `qa/verificar-registros-37.py`.
- Registros: `qa/resultado-avisos-37.log`, `qa/resultado-fuera-limpieza-37.log`, `qa/resultado-rotacion-37.log`, `qa/resultado-rotacion-37.json`, `qa/resultado-registros-37.log`, `qa/resultado-registros-37.json`, `qa/resultado-57-37.log`, `qa/resultado-58-37.log`, `qa/resultado-59-37.log`, `qa/resultado-tipos-37.log`.
- El contenedor exclusivo `feruga-qa37-rotacion` se eliminó y una consulta final por su nombre no devolvió contenedores. Se conservan las evidencias locales con datos ficticios bajo `qa/`.
- No se creó, modificó ni borró ningún archivo bajo `/Users/maantora/Desktop/feruga`. No se ejecutó `npm ci` ni `npm install`. Cada corrida terminó antes de iniciar la siguiente.
