# Respuesta a la revisión de la fase del servidor (Codex, 3 de noviembre de 2026)

La revisión (`2026-11-03-codex-revision-de-la-fase-del-servidor.md`, encargo 36) revisó con ejecución
lo que escribió Claude en la fase del servidor que toca claves: el correo de los avisos, los avisos y
el latido, `operacion/fuera.sh`, `operacion/cambiar-clave-de-la-base.sh` y lo integrado de la limpieza
de imágenes. Dejó siete hallazgos, todos confirmados con una sonda (en `sondas-36/`). Los siete se
corrigieron, cada uno con su prueba vista fallar antes de corregir.

| Hallazgo | Gravedad | Qué se hizo | Dónde |
|---|---|---|---|
| H1: un rechazo del servidor de correo podía llevar la contraseña (o el bloque de AUTH) al error y al registro | Alta | El error dice el paso y el código del rechazo (p. ej. `535 5.7.8`), nunca el texto que escribió el servidor | `operacion/correo.ts`; prueba en `57-avisos-de-fuera` (servidor que repite AUTH y la contraseña) — `3899dc1` |
| H2: el latido podía quedarse esperando para siempre (sitio a goteo, respuesta cortada) | Media | Plazo total por petición; una respuesta que se corta antes de terminar falla | `operacion/comprobar.ts` (`estadoPorHttps`); prueba con HTTPS de verdad — `3899dc1` |
| H3: datos de disco imposibles o un certificado sin vigencia legible daban «bien» | Media | Se avisan como «no se pudo comprobar»: números finitos, total positivo, 0 ≤ libre ≤ total; fechas válidas y en orden | `operacion/avisos.ts` (`revisarSitio`) — `3899dc1` |
| H4: `recuperacion.env` dejaba pasar variables con espacios delante o sin `=`, que Docker sí carga | Media | Lista de lo permitido, como la lee Docker: `RESPALDO_DESTINO`, `RESPALDO_DESTINO_DIARIO`, `RCLONE_CONFIG_…`, `ENSAYO_VIGIA_URL`, cada una al principio del renglón. También cierra el paso a otras variables (`NODE_OPTIONS`, por ejemplo) | `operacion/fuera.sh`; prueba en `58-fuera` — `998b216` |
| H5: si la base desechable del ensayo no se borraba, se callaba y se daba por bueno | Media | Dos intentos, y se comprueba que ya no está; si queda, se dice cuál y cómo borrarla, y no termina en «bien» | `operacion/fuera.sh` — `998b216` |
| H6: interrumpido después de cambiar la base y antes del `.env`, quedaban distintas sin aviso; una vuelta atrás fallida se callaba | Alta | Marca duradera: el `.env` nuevo se escribe como `.env.nueva` **antes** de tocar la base. Levantar, publicar y volver no entran mientras esté. Correr el guion otra vez decide por lo que dice la base (termina, descarta o se niega y dice `--la-del-env`). Ya no hay vuelta atrás que pueda fallar callada; lo que decide es la base, nunca su respuesta | `operacion/cambiar-clave-de-la-base.sh`, `operacion/pasos.sh` (`exigir_sin_clave_a_medias`), `levantar.sh`, `publicar.sh`, `volver.sh`; pruebas en `59-clave-de-la-base` (base de mentira que recuerda su clave; morir con kill -9 recién cambiada) — `48db61e` |
| H7: con `log_min_duration_sample` la clave nueva quedaba en el registro de PostgreSQL y de Docker | Alta | La clave llega como verificador SCRAM calculado en las herramientas (`operacion/scram.ts`, como `psql \password`): no viaja en el SQL. Además la sesión apaga sentencias, duración, muestreo y errores | `operacion/scram.ts`; prueba contra el PostgreSQL de las pruebas (entra con la clave, no con otra) — `48db61e` |

Las pruebas del cambio de clave se escribieron después de la corrección; para saber que prueban lo que
dicen, se corrieron contra el guion de antes: cuatro de cinco fallan (la quinta es la del verificador,
que es nueva). Con el guion corregido, pasan.

**Lo que dijo que está bien** se conserva: SMTPS y STARTTLS cifran antes de AUTH; un texto con
`CRLF . CRLF` no termina el mensaje ni mete encabezados; la clave del bot no sale en errores; un canal
fallido impide dar el aviso por enviado; la llave de `fuera.sh` no va como argumento ni a disco; la
limpieza integrada se comporta como se pidió.

**Limitación de su entorno** (no es hallazgo): no puede ver ni matar procesos ajenos.

Se volvió a correr el ensayo de la operación con todo esto (cambio de clave con PostgreSQL de verdad
y el paso «Desde fuera»).

## Después

- **El ensayo de la operación encontró una consecuencia de H3:** el agente compartido de Node cierra
  la conexión ociosa a los 5 segundos y la siguiente reanuda la sesión TLS, donde el certificado no
  llega; con H3, eso ya no era «bien», y todos los latidos menos el primero habrían avisado en falso.
  `estadoPorHttps` va ahora sin el agente compartido (`agent: false`), con prueba — `ad428de`.
- **La revisión automática de seguridad** señaló que `.env.nueva` no estaba en `.gitignore` ni en
  `.dockerignore` (el patrón `.env` solo cubre ese nombre) — `e416062`.
- **Codex verificó las correcciones** (encargo 37, `2026-11-03-codex-verificacion-de-la-fase-del-servidor.md`):
  H1 a H7 cerrados, con su matriz de 16 interrupciones contra PostgreSQL de verdad y los registros
  de la base encendidos. Su observación —`fuera.sh` decía «El ensayo pasó» antes de borrar la base
  desechable— se atendió: primero se borra y se comprueba, y solo después se dice cómo salió.
