> **4 de noviembre de 2026.** Revisión de Codex (encargo 38) de la guía de operación contra los guiones. 30 hallazgos
> (9 altos, 17 medios, 4 bajos). Lo que se hizo con cada uno: `2026-11-04-respuesta-a-la-revision-de-la-guia.md`.

# Revisión 38: guía de operación contra los guiones

Fecha: 4 de noviembre de 2026. Copia revisada: `/tmp/feruga-codex-qa14/`.

## Alcance y método

Una sola pasada por `docs/operacion.md` (529 renglones) y el bloque «Operación» de `README.md` (520–621), con contraste de los guiones, programas y Compose. No se cambia la guía ni el código. No se instalan dependencias, no se ejecutan ensayos completos y no se accede a los contenedores ni a la base protegidos. Las comprobaciones de órdenes se limitan a usos incorrectos o negativas tempranas; se distingue lo ejecutado de lo comprobado por lectura. Los renglones corresponden a esta copia. El informe se guarda al terminar cada sección.

Prioridades: **Alta** impide seguir el procedimiento o da una garantía equivocada sobre recuperación; **Media** puede provocar una mala decisión o una configuración fallida; **Baja** dificulta entender o copiar la guía.

## Encabezado y sección 1. Las piezas y el paquete

**Bien:** identifica los componentes y exige dos copias externas y actualizadas de la llave, el entorno y la credencial de recuperación.

### H01 · Alta · La llave «nunca» está en el servidor, pero recuperar exige entregársela

- **Lugar:** `docs/operacion.md:23`, 31–36 y 127–128; contrastar con 295, 307 y 364–365; también `README.md:535–536`.
- **Qué falla:** la prohibición absoluta se contradice con la redirección desde un archivo local al ejecutar `volver.sh` o `publicar.sh --desde-respaldo` en el servidor. Falta explicar cómo pasar la llave desde la computadora que la guarda sin copiarla al disco del servidor.
- **Evidencia:** `fuera.sh` trabaja en la computadora externa; `volver.sh` y `publicar.sh` leen la llave de la entrada estándar en la instalación que recuperan. La entrada estándar permite enviarla por SSH.
- **Por qué importa:** durante una emergencia el operador debe improvisar o copiar al servidor una llave que la propia guía prohíbe dejar allí.
- **Texto propuesto (tabla y antes de los procedimientos 5 y 7):** «La llave privada se conserva únicamente en los paquetes de recuperación, fuera del servidor. Al recuperar, se entrega por la entrada del programa, sin guardarla en el disco del servidor. Desde la computadora que tiene la llave, usa la conexión SSH comprobada y la ruta real de la instalación:»

```sh
ssh usuario@servidor 'cd /ruta/feruga/sistema && sh operacion/volver.sh' < llave-privada.txt
# Para instalar desde un respaldo en el servidor nuevo:
ssh usuario@servidor 'cd /ruta/feruga/sistema && sh operacion/publicar.sh --desde-respaldo' < llave-privada.txt
```

«Los ejemplos con `< llave-privada.txt` suponen que la orden se lanza desde la computadora que conserva ese archivo; no copies la llave al servidor. Durante la restauración el programa necesariamente la recibe en memoria.»

### H02 · Baja · Términos necesarios sin explicación

- **Lugar:** `docs/operacion.md:18–24` (Docker, Git, proxy, HTTPS, commit, imágenes); 75–76 (700/600); 254–256 (manifiesto); 394 (fecha con `Z`).
- **Qué falla y por qué importa:** se requiere interpretar vocabulario y notación antes de ejecutar pasos que manejan claves o restauran datos.
- **Texto propuesto (tras la introducción):** «Git conserva las versiones del código; un commit es el identificador de una versión exacta. Docker ejecuta servicios aislados llamados contenedores, creados a partir de imágenes. Compose coordina esos servicios. El proxy es la puerta de entrada del sitio; HTTPS cifra la conexión y comprueba su identidad con un certificado. SSH permite entrar al servidor desde otra computadora. Un manifiesto es el registro de una publicación o de un respaldo. Los permisos 700 y 600 limitan el acceso al propietario: 700 para una carpeta y 600 para un archivo. En las fechas de cambio de llave, Z indica hora UTC, no la hora local del patio.»

## Sección 2.1. Preparar el servidor

**Bien:** existen las dos formas de `servidor.sh`; la huella completa, el usuario de `sudo`, las comprobaciones de SSH y el mensaje «No hay nada que cambiar.» coinciden con el guion.

### H03 · Alta · El salto a 2.4 omite requisitos de la instalación

- **Lugar:** `docs/operacion.md:100`, en relación con 102–148 y 181–184.
- **Qué falla:** «Sigue la sección 2.4» salta la llave, el sello, los depósitos y los vigilantes que después se exigen.
- **Evidencia:** `src/servidor/entorno.ts:80–187` exige llave, sello, destinos, credenciales, horario y dos señales distintas.
- **Por qué importa:** quien sigue el orden se encuentra con campos obligatorios que todavía no preparó.
- **Texto propuesto:** «Continúa con 2.2 en la computadora del dueño o de soporte, prepara el almacenamiento y sus vigilantes en 2.3 y decide los avisos de 2.3 bis. Después vuelve al servidor para 2.4. Conserva abierta la sesión de SSH hasta comprobar otra conexión con llave.»

### H04 · Media · La preparación no deshace todos los cambios si falla

- **Lugar:** `docs/operacion.md:70–71`.
- **Qué falla:** «sin dejar las cosas a medias» atribuye al guion una reversión general que no existe.
- **Evidencia:** `operacion/servidor.sh:128–171` instala paquetes, configura Docker y añade al grupo antes de otras comprobaciones; 177–207 puede detenerse por reglas de ufw o IPv6. Su limpieza (38–49) solo retira el cambio de SSH pendiente y los temporales.
- **Por qué importa:** un fallo tardío puede dejar paquetes y configuraciones aplicados; el operador no debe concluir que sigue ante un servidor intacto.
- **Texto propuesto:** «Se puede repetir. Si no hace cambios, dice “No hay nada que cambiar.” Si falla, se detiene e indica el motivo: los pasos ya completados pueden quedar aplicados. Corrige ese motivo y vuelve a ejecutarlo. Si falla la comprobación del cambio de SSH antes de confirmarlo, retira ese cambio.»

### H05 · Baja · Abrir 443/UDP no publica HTTP/3 en este Compose

- **Lugar:** `docs/operacion.md:62–64` y 478.
- **Qué falla:** se vincula el permiso de ufw a HTTP/3, pero el proxy solo publica puertos TCP.
- **Evidencia:** `servidor.sh` permite 443/UDP; `docker-compose.operacion.yml`, `services.proxy.ports`, solo declara `80:80` y `443:443`, sin `/udp`.
- **Por qué importa:** una comprobación externa de UDP no puede considerarse fallida por no responder con esta configuración.
- **Texto propuesto:** «El cortafuegos permite 22/TCP, 80/TCP, 443/TCP y 443/UDP. La configuración actual de Docker publica el sitio por TCP; permitir UDP en el cortafuegos, por sí solo, no habilita HTTP/3.» En la lista de pruebas: «Comprobar desde fuera los puertos TCP esperados y que no haya otros servicios expuestos; no exigir respuesta en 443/UDP con el Compose actual.»

## Sección 2.2. Llave y sello fuera del servidor

**Bien:** `fuera.sh llave`, `sello`, la entrada por archivo y la derivación alternativa con OpenSSL corresponden a las interfaces reales; el sello se valida como 64 caracteres hexadecimales.

### H06 · Alta · La orden de generar llave puede sobrescribir la única llave existente

- **Lugar:** `docs/operacion.md:110`, repetida en 501 y `README.md:529`.
- **Qué falla:** `>` trunca el archivo antes de que arranque el guion; `fuera.sh` no protege el archivo de destino y tampoco establece sus permisos desde el proceso que realiza la redirección.
- **Evidencia:** `operacion/fuera.sh:105–118` escribe la nueva llave a stdout. No conoce el nombre del archivo abierto por la terminal. La salida de uso o un fallo de Docker no evitan que la terminal ya haya truncado el archivo. Reproducido con texto ficticio: 61 bytes antes, 0 después, salida 1 «Hace falta Docker.»; no se utilizó ninguna llave.
- **Por qué importa:** repetir la instrucción puede destruir una llave que abre todos los respaldos anteriores, incluso si Docker falla. Un archivo nuevo también puede quedar legible para otros usuarios según los permisos de la terminal.
- **Texto propuesto:** «Genera cada llave con un nombre nuevo, dentro de una carpeta privada de recuperación. Desde la carpeta del sistema, esta forma se niega si el archivo ya existe y lo crea solo para su propietario (sustituye /ruta/privada por la carpeta privada ya preparada):»

```sh
(umask 077; set -C; sh operacion/fuera.sh llave > /ruta/privada/llave-privada.txt)
sh operacion/fuera.sh sello < /ruta/privada/llave-privada.txt
```

«Si falla la generación, verifica el resultado antes de conservarlo como llave. No repitas una generación sobre un archivo que ya contenía una llave. En la rotación conserva la anterior y usa otro nombre para la nueva.» Sustituir también «64 letras» por «64 caracteres: números y letras de la a a la f».

## Sección 2.3. Almacenamiento y vigilantes

**Bien:** los dos depósitos distintos y las dos señales de respaldo distintas coinciden con las exigencias del código; el latido tiene intervalo predeterminado de 300 segundos y los umbrales de disco y certificado descritos.

### H07 · Media · Faltan horarios concretos para los vigilantes de respaldos

- **Lugar:** `docs/operacion.md:139–148`, 251 y 316–318.
- **Qué falla:** solo se configura el periodo y la tolerancia del latido. No se indica cómo ajustar las otras señales al horario generado ni se explica que los guiones envían avisos pero no configuran al proveedor.
- **Evidencia:** `operacion/entorno.sh:50–51` genera 07:00–20:00; `respaldar.ts:56` y siguientes envían señales HTTP; el diario se comprueba también al arrancar y en las corridas siguientes. `restaurar.ts:334` solo envía el aviso del ensayo.
- **Por qué importa:** un vigilante horario configurado para las 24 horas alertará cada noche; un vigilante sin configurar puede no alertar cuando falte un respaldo.
- **Texto propuesto:** «Configura cuatro señales independientes en el servicio de vigilancia. La de respaldos espera una ejecución en cada hora de RESPALDO_HORARIO, en America/Mexico_City; el ejemplo generado cubre de 07:00 a 20:00, no la noche. Define y comprueba su tolerancia según la duración medida de un respaldo. La diaria debe detectar que no hubo una copia diaria correcta, sin depender de la señal horaria. La de restauración debe alertar al pasar 35 días sin aviso correcto. El latido usa 5 minutos de periodo y 15 de tolerancia. Estas reglas y sus destinatarios se configuran en el proveedor: escribir una URL en el entorno no las crea.»

## Sección 2.3 bis. Avisos del cajón

**Bien:** los cinco nombres `AVISOS_…` existen, cada canal debe configurarse completo y el correo exige cifrado; `probar-avisos` envía una prueba por cada canal configurado.

### H08 · Media · La prueba se presenta antes de la publicación y no explica el envío repetido

- **Lugar:** `docs/operacion.md:154`, 167–170.
- **Qué falla:** se pide probar tras «levantar» antes de llegar a la sección que crea el `.env` y publica. Además, si falla un canal se reintenta el aviso por todos los canales, incluso por el que ya lo recibió.
- **Evidencia:** `compose.sh` exige una publicación vigente; `operacion/avisos.ts:99–125` marca el aviso enviado solo cuando todos los canales tuvieron éxito. El bucle del servicio vuelve a revisar al minuto (`respaldar.ts:569`).
- **Por qué importa:** la orden no sirve todavía en ese punto; un correo o Telegram repetido puede confundirse con varias diferencias de caja.
- **Texto propuesto:** «Aquí reúne los datos de los canales. Después de completar 2.4 y publicar, ejecuta `sh operacion/compose.sh run --rm respaldo probar-avisos` y comprueba la recepción. Si un canal falla, el aviso pendiente se reintenta aproximadamente al minuto por todos los canales; puede repetirse por uno que ya lo recibió. Un aviso marcado como visto antes de la siguiente revisión deja de enviarse.»

### H13 · Media · «Cualquier mensaje» no garantiza que Telegram entregue el número del grupo

- **Lugar:** `docs/operacion.md:156–160` (complemento de 2.3 bis).
- **Qué falla:** un bot con privacidad activada no recibe necesariamente un mensaje común del grupo. El código tampoco exige que el identificador empiece por `-100`: acepta un número entero con signo opcional (`entorno.ts:95–96`).
- **Por qué importa:** el operador puede quedarse buscando un mensaje que no llega o descartar un identificador válido.
- **Texto propuesto:** «En el grupo, manda un comando dirigido expresamente al bot, por ejemplo `/start@NombreDelBot`. Consulta getUpdates y copia exactamente el `chat.id` correspondiente a ese grupo, incluido el signo. No añadas ni quites un prefijo. Usa un bot dedicado a estos avisos y conserva su clave como secreto.»
- **Contraste externo:** la [documentación oficial de Telegram](https://core.telegram.org/bots/faq#what-messages-will-my-bot-get) confirma que los comandos dirigidos al bot se reciben con privacidad activada. No se creó un bot ni se enviaron mensajes.

## Sección 2.4. Instalación en el servidor

**Bien:** `entorno.sh` protege un `.env` existente; los nombres exigidos coinciden con el código; `publicar.sh` y `consola arranque` existen y el HTTPS válido es condición para abrir.

### H09 · Alta · La primera publicación no certifica que ya terminó el primer respaldo

- **Lugar:** `docs/operacion.md:197–203`.
- **Qué falla:** «Publicar ya tomó un respaldo» no es cierto en la primera instalación.
- **Evidencia:** `operacion/publicar.sh:319–320` dice que no hay nada que respaldar; 347–350 solo llama a `respaldar_antes` cuando hay configuración anterior. Al terminar arranca el servicio de respaldo, cuyo trabajo es asíncrono (`respaldar.ts:420–454`, 591–601).
- **Por qué importa:** `fuera.sh version` puede no encontrar respaldo o encontrar uno anterior; la verificación inicial queda sujeta a una carrera y tampoco garantiza incluir las credenciales recién creadas por `arranque`.
- **Texto propuesto:** «Después de publicar y ejecutar el arranque, toma un respaldo explícito y espera a que termine. Conserva el nombre que imprime y comprueba ese mismo respaldo desde fuera:»

```sh
# En el servidor, después de arranque:
sh operacion/compose.sh run --rm --no-deps respaldo ahora
# En la computadora con la llave y recuperacion.env (sección 6):
# Sustituye NOMBRE_REAL por el nombre impreso tras “respaldo:”.
FUERA_ENTORNO=/ruta/privada/recuperacion.env sh operacion/fuera.sh version NOMBRE_REAL < /ruta/privada/llave-privada.txt
```

«Después de terminar la captura inicial del patio, toma otro respaldo. Ese mismo día completa el ensayo de restauración de la sección 6.»

### H10 · Media · DNS y el archivo de recuperación aparecen como requisitos después de necesitarlos

- **Lugar:** `docs/operacion.md:175–203` y 212–215; preparación de `recuperacion.env` en 334–350.
- **Qué falla:** el dominio solo se explica como diagnóstico tras intentar publicar, y el archivo necesario para acreditar la instalación se detalla varias secciones después.
- **Evidencia:** `publicar.sh` verifica HTTPS antes de abrir; `fuera.sh:88–101` exige el archivo de recuperación para `version` y `ensayo`.
- **Por qué importa:** una instalación nueva puede quedar cerrada esperando DNS o interrumpir la acreditación por no tener credenciales preparadas.
- **Texto propuesto (antes de 178):** «Antes de publicar: sustituye patio.ejemplo.mx por el dominio contratado, configura sus direcciones para que apunten a este servidor y comprueba que lleguen 80 y 443/TCP. Prepara también recuperacion.env en la computadora externa con la plantilla completa de la sección 6; no lo copies al servidor. Si preparaste Docker con sudo, sal y vuelve a entrar antes de las órdenes de Docker.»

### H11 · Media · No se enumeran los campos de almacenamiento que debe llenar el operador

- **Lugar:** `docs/operacion.md:181–186`.
- **Qué falla:** «su servicio y su credencial» no identifica las doce variables `RCLONE_CONFIG_…` que aparecen vacías o parcialmente llenas en el archivo generado; los nombres completos solo aparecen para un depósito en la sección 6.
- **Evidencia:** `entorno.sh:77–95` genera ambos grupos y `docker-compose.operacion.yml:42–58` transmite exactamente los grupos RESPALDO y DIARIO. Para `s3`, `entorno.ts:137–140` exige TYPE y ambas partes de la credencial.
- **Por qué importa:** inventar otro nombre de remoto o dejar un grupo sin configurar impide respaldar; el lector no sabe dónde poner lo entregado por el proveedor.
- **Texto propuesto:** «Usa RESPALDO_DESTINO=respaldo:NOMBRE_DEL_DEPOSITO/feruga y RESPALDO_DESTINO_DIARIO=diario:NOMBRE_DEL_OTRO_DEPOSITO/feruga. Conserva los nombres respaldo y diario. Para cada prefijo RCLONE_CONFIG_RESPALDO_ y RCLONE_CONFIG_DIARIO_, completa TYPE=s3, PROVIDER, ENDPOINT, REGION, ACCESS_KEY_ID y SECRET_ACCESS_KEY con la configuración S3 del proveedor y la credencial del servidor correspondiente. ENDPOINT es la dirección del servicio; REGION, su región; ACCESS_KEY_ID identifica la credencial y SECRET_ACCESS_KEY es su parte secreta. La credencial de solo lectura se reserva al archivo externo de recuperación. Comprueba además RESPALDO_HORARIO: el ejemplo generado respalda de 07:00 a 20:00, en America/Mexico_City.»

## Sección 2.5. Primer día en pantalla

**Bien:** la consola acepta `persona alta "Ana" responsable --autoriza`; el arranque crea al responsable con esa facultad y el código de equipo.

### H12 · Media · El código del primer equipo vence mientras se hacen las comprobaciones previas

- **Lugar:** `docs/operacion.md:194–209` y 219–220.
- **Qué falla:** entre obtener el código y usarlo se intercala la verificación externa y el primer ensayo; no se advierte su duración de 15 minutos. Tampoco se explica que volver a ejecutar `arranque` no vuelve a mostrar la clave de una persona existente.
- **Evidencia:** `consola/principal.ts:47–52`, 57–72; `consola/acciones.ts:164–175`.
- **Por qué importa:** al llegar al patio el código puede estar vencido. Repetir el arranque no recupera la clave que no se anotó.
- **Texto propuesto:** «Anota y entrega la clave del primer responsable al momento: no se muestra de nuevo. El código de equipo sirve una sola vez y vence en 15 minutos. Genera uno nuevo justo antes de dar de alta el equipo si ya venció: `sh operacion/compose.sh run --rm consola equipo codigo "Tableta del patio"`. Si se perdió la clave del responsable, cámbiala con `sh operacion/compose.sh run --rm consola persona clave "Responsable"`, sustituyendo el nombre si se eligió otro.»

## Sección 3. Lo de todos los días

**Bien:** todas las órdenes de consulta, listado horario/diario y respaldo manual corresponden al envoltorio Compose y a `respaldar.ts`; editar el entorno y aplicar con `levantar.sh`, conservando la copia del paquete, es correcto. Las consultas pasan sin candado; las acciones administrativas lo toman.

## Sección 4. Qué garantizan los respaldos

**Bien:** el cifrado, el manifiesto sellado, la copia diaria, el aviso de antigüedad y el listado del último manifiesto utilizable están implementados; listar sin sello no acredita el respaldo.

### H14 · Alta · Pedir un nombre antiguo no basta después de una intrusión

- **Lugar:** `docs/operacion.md:257–258`.
- **Qué falla:** se propone como remedio suficiente pedir un respaldo anterior por su nombre. Con la credencial de escritura y el sello robados, puede existir una versión posterior de ese mismo nombre; conservar versiones anteriores no implica leerlas por defecto.
- **Evidencia:** `operacion/destino.ts` admite `comoEstaba` para leer versiones a una fecha; `fuera.sh:134–139` y `restaurar.ts:276–281` aceptan `--como-estaba`. `publicar.sh --desde-respaldo` no expone esa opción.
- **Por qué importa:** el nombre y la fecha declarada no distinguen por sí solos un objeto limpio de uno reemplazado tras la intrusión.
- **Texto propuesto:** «Si alguien obtuvo el control del servidor, el sello ya no basta para acreditar lo que escribió desde entonces. Con soporte, identifica un respaldo y una versión del almacenamiento anteriores a la intrusión y compáralos con registros externos. El ensayo permite consultar el almacenamiento como estaba en un momento determinado, con `--como-estaba`; pedir solo un nombre no fija una versión histórica. La instalación automática `--desde-respaldo` no ofrece esa opción: este caso requiere un procedimiento de recuperación supervisado.»

## Sección 5. Publicar y volver al respaldo previo

**Bien:** para una actualización con versión anterior, el orden preparar/cerrar/respaldar/migrar/comprobar/abrir coincide; `volver.sh` conserva la base fallida, restaura con la versión anterior y exige `--abrir` por separado.

### H15 · Media · La recuperación general omite dos casos distintos

- **Lugar:** `docs/operacion.md:288–296`, también 433 y `README.md:562–568`.
- **Qué falla:** la descripción da por hecho que siempre existe una versión anterior y que una migración iniciada siempre exige volver a un respaldo. No distingue una instalación desde respaldo interrumpida.
- **Evidencia:** `publicar.sh:436–446` repite la migración de la primera publicación que nunca abrió; 405–409 exige la llave y `--desde-respaldo` para una instalación restaurada que aún no decidió abrir. `volver.sh:100` rechaza la primera publicación por no tener respaldo previo.
- **Por qué importa:** justo durante la instalación inicial el lector puede interpretar como peligrosa una recuperación prevista o buscar un respaldo inexistente.
- **Texto propuesto:** «En una actualización con versión anterior, recuperar termina la apertura si ya se decidió, repone la anterior si no empezó la migración, o deja cerrado e indica volver al respaldo previo si empezó a migrar sin decidir abrir. En la primera publicación que nunca abrió no hay versión ni respaldo previos: el guion puede repetir la migración y continuar. Si lo interrumpido fue instalar desde un respaldo, repite `publicar.sh --desde-respaldo` con la llave cuando el mensaje lo indique; mantiene el respaldo ya registrado.»

### H16 · Media · Falta fijar cuándo cambiar al código corregido

- **Lugar:** `docs/operacion.md:291–296` y 304–309.
- **Qué falla:** se menciona publicar la versión corregida sin advertir que recuperar y volver necesitan todavía el commit de la publicación fallida.
- **Evidencia:** `publicar.sh:399–401` y `volver.sh:95–97` rechazan otro commit.
- **Por qué importa:** hacer `git pull` para corregir primero impide retomar la publicación y alarga la interrupción.
- **Texto propuesto:** «Conserva la carpeta en el commit de la publicación interrumpida mientras ejecutas `--recuperar`, `volver.sh` y `volver.sh --abrir`. Solo después cambia al commit corregido y publícalo. No permitas capturas entre la reapertura y esa publicación. `--abrir` habilita realmente la aplicación: mantener el patio sin atender durante ese intervalo es una coordinación humana, no otro candado automático.»

## Sección 6. Ensayo de restauración

**Bien:** `fuera.sh ensayo` y `ensayo --diario` existen en ese orden; crean una base desechable sin puertos, leen la llave por entrada estándar y requieren la señal de ensayo.

### H17 · Alta · La plantilla de recuperacion.env no es un archivo válido para este guion

- **Lugar:** `docs/operacion.md:334–350`.
- **Qué falla:** `RCLONE_CONFIG_DIARIO_…` no es una asignación admitida. Además los comentarios al final de ACCESS_KEY_ID, SECRET_ACCESS_KEY y ENSAYO_VIGIA_URL forman parte del valor cuando Docker lee `--env-file`; no son comentarios de Compose.
- **Evidencia:** `fuera.sh:94–100` solo admite nombres completos con `=` y 130/176 pasa el archivo directamente a `docker run --env-file`. La [documentación oficial de Docker](https://docs.docker.com/reference/cli/docker/container/run/#env) distingue los comentarios que comienzan con `#` de un `#` incluido en un valor. El validador original ejecutado sobre la plantilla señala su renglón 9, que corresponde a docs/operacion.md:348 (evidencia en los anexos).
- **Por qué importa:** incluso sustituyendo los puntos suspensivos por valores reales, el archivo se rechaza o transmite una credencial/URL con texto adicional. La primera acreditación y la recuperación fallan.
- **Texto propuesto:** «Cada dato va en una línea NOMBRE=valor, sin comillas añadidas ni comentarios después del valor. Los comentarios van solos en líneas que comienzan por #. Sustituye todos los marcadores en mayúsculas por los valores reales; las credenciales son las de recuperación, solo lectura. Conserva los nombres completos:»

```dotenv
RESPALDO_DESTINO=respaldo:DEPOSITO_HORARIO/feruga
RCLONE_CONFIG_RESPALDO_TYPE=s3
RCLONE_CONFIG_RESPALDO_PROVIDER=PROVEEDOR_S3
RCLONE_CONFIG_RESPALDO_ENDPOINT=DIRECCION_S3
RCLONE_CONFIG_RESPALDO_REGION=REGION
# Credencial de recuperación del depósito horario
RCLONE_CONFIG_RESPALDO_ACCESS_KEY_ID=IDENTIFICADOR_HORARIO
RCLONE_CONFIG_RESPALDO_SECRET_ACCESS_KEY=SECRETO_HORARIO
RESPALDO_DESTINO_DIARIO=diario:DEPOSITO_DIARIO/feruga
RCLONE_CONFIG_DIARIO_TYPE=s3
RCLONE_CONFIG_DIARIO_PROVIDER=PROVEEDOR_S3
RCLONE_CONFIG_DIARIO_ENDPOINT=DIRECCION_S3
RCLONE_CONFIG_DIARIO_REGION=REGION
# Credencial de recuperación del depósito diario
RCLONE_CONFIG_DIARIO_ACCESS_KEY_ID=IDENTIFICADOR_DIARIO
RCLONE_CONFIG_DIARIO_SECRET_ACCESS_KEY=SECRETO_DIARIO
# Señal de restauración, distinta de las de respaldo y latido
ENSAYO_VIGIA_URL=https://hc-ping.com/IDENTIFICADOR_REAL
```

### H18 · Media · Los archivos secretos se piden dentro del repositorio sin advertir que no se ignoran

- **Lugar:** `docs/operacion.md:110`, 199 y 320–321.
- **Qué falla:** se ordena dejar `llave-privada.txt` y `recuperacion.env` en la carpeta del repositorio; ni `.gitignore` ni `.dockerignore` excluyen esos nombres. El Dockerfile actual no los copia a la imagen, por lo que no se afirma una filtración efectiva.
- **Evidencia:** listas completas de exclusiones de ambos archivos; `fuera.sh:80` construye usando la carpeta como contexto y 89 permite `FUERA_ENTORNO`.
- **Por qué importa:** quien agregue archivos al repositorio puede incluir secretos; además se mezclan el paquete privado y el código de trabajo.
- **Texto propuesto:** «Guarda la llave y recuperacion.env fuera del repositorio, en una carpeta privada. Desde la carpeta del sistema indica sus rutas absolutas; no los agregues a Git:»

```sh
FUERA_ENTORNO=/ruta/privada/recuperacion.env sh operacion/fuera.sh version < /ruta/privada/llave-privada.txt
FUERA_ENTORNO=/ruta/privada/recuperacion.env sh operacion/fuera.sh ensayo < /ruta/privada/llave-privada.txt
FUERA_ENTORNO=/ruta/privada/recuperacion.env sh operacion/fuera.sh ensayo --diario < /ruta/privada/llave-privada.txt
```

### H19 · Media · «Pase lo que pase» y «NO pasó» ocultan dos resultados distintos

- **Lugar:** `docs/operacion.md:330–332` y 409.
- **Qué falla:** el borrado se intenta y verifica, pero puede fallar; el mensaje final «El ensayo NO pasó» también se usa si la restauración sí terminó y falló el borrado. Hay además un resultado específico para restauración correcta sin aviso al vigilante. El aviso se envía desde `restaurar.ts` antes de la limpieza externa.
- **Evidencia:** `fuera.sh:40–58`, 182–195; `restaurar.ts:330–340` devuelve 3 si falla el aviso. El propio guion muestra la orden exacta para borrar la base desechable cuando no pudo hacerlo.
- **Por qué importa:** se puede diagnosticar como corrupto un respaldo válido o dar el ensayo por terminado solo porque llegó una señal, dejando una copia de los datos en la máquina externa.
- **Texto propuesto:** «Lee toda la salida y espera el resultado final. El guion intenta borrar la base desechable y comprueba si desapareció. Si no pudo, muestra su nombre y la orden para quitarla: no des por terminado el ensayo hasta resolverlo. “El ensayo NO pasó” puede significar un fallo de restauración o de limpieza; el mensaje anterior distingue cuál. Si dice que se restauró bien pero el vigilante no recibió el aviso, revisa ENSAYO_VIGIA_URL y la conexión. Una alerta del vigilante significa que no llegó un aviso correcto en el plazo, no demuestra por sí sola que nadie restauró.»

## Sección 7. Pérdida del servidor

**Bien:** `--desde-respaldo` y `--desde-respaldo=NOMBRE` están admitidos; el commit se obtiene de un manifiesto acreditado y las imágenes se construyen del repositorio. La guía advierte que los movimientos posteriores deben conciliarse.

### H20 · Alta · «Preparada como en la sección 2» puede crear una instalación que luego no acepta restaurar

- **Lugar:** `docs/operacion.md:359–365`.
- **Qué falla:** la sección 2 incluye generar otro `.env`, publicar una base nueva y ejecutar el arranque. Restaurar exige precisamente que aún no exista una publicación. Además se repite el clon que ya se hizo para ejecutar `servidor.sh`.
- **Evidencia:** `publicar.sh:478–479` rechaza una instalación con publicación vigente; 535–539 exige una base vacía. `entorno.sh` no sobrescribe el entorno existente.
- **Por qué importa:** seguir literalmente la referencia puede bloquear la recuperación y dejar al operador dudando si debe borrar la instalación recién creada.
- **Texto propuesto:** «Prepara únicamente el sistema operativo siguiendo 2.1: clona una vez, ejecuta servidor.sh y comprueba el acceso. No hagas la publicación normal, no ejecutes arranque ni generes otras claves. En esa misma carpeta coloca el .env del paquete, con permisos solo para su propietario. Revisa el dominio para que apunte al servidor nuevo. Obtén desde fuera la versión del respaldo, sitúa la carpeta en ese commit y ejecuta la instalación desde respaldo, entregando la llave por SSH como indica la sección 1.»

### H21 · Alta · La promesa de perder «cuando mucho una hora» no se sostiene

- **Lugar:** `docs/operacion.md:383`; relación con 251 y `entorno.sh:51`.
- **Qué falla:** el horario generado cubre 07:00–20:00; entre 20:00 y 07:00 hay once horas. La función real `siguiente` confirmó que después de las 20:00 del 4 de noviembre el siguiente instante es el 5 de noviembre a las 13:00 UTC (07:00 del patio). Tampoco se garantiza que cada ejecución termine bien ni que el último respaldo disponible sea reciente.
- **Evidencia:** `operacion/horario.ts` calcula el siguiente instante de la lista; `respaldar.ts:442–450` puede fallar y reintentar; la propia guía (259–261) admite respaldos de más de un día.
- **Por qué importa:** el dueño puede decidir atender o recuperar creyendo que solo necesita conciliar una hora, aunque falten muchas más.
- **Texto propuesto:** «Se pierde lo asentado después de la instantánea del último respaldo que se pueda restaurar. Con respaldos correctos cada hora durante toda la atención, el objetivo es aproximadamente una hora, más lo que tarde completar el respaldo. No es una garantía: aumenta si falla una ejecución, si el servicio está detenido o si se trabaja fuera del horario configurado. El ejemplo deja de respaldar de 20:00 a 07:00; ajústalo a todas las horas en que pueda haber movimientos y comprueba la antigüedad antes de recuperar.»

### H22 · Alta · La instalación automática no ofrece recuperar directamente del depósito diario

- **Lugar:** `docs/operacion.md:324–325` frente a 364–365; 22 y 253 prometen una copia anual.
- **Qué falla:** `fuera.sh ensayo --diario` prueba el depósito anual, pero el procedimiento de pérdida del servidor no explica qué hacer si solo queda allí el respaldo elegido. Nombrarlo con `--desde-respaldo=NOMBRE` no cambia de depósito.
- **Evidencia:** `version-del-respaldo.ts:94–97` consulta RESPALDO_DESTINO; `publicar.sh:515` y 559–560 usan esa consulta y `restaurar.ts --remoto`, sin opción `--diario`.
- **Por qué importa:** pasado el plazo horario o ante daño de ese depósito, el respaldo anual puede abrirse en un ensayo pero la ruta documentada de reinstalación no lo consume.
- **Texto propuesto:** «Estas dos órdenes de reinstalación buscan únicamente en RESPALDO_DESTINO, el depósito horario. `--desde-respaldo=NOMBRE` selecciona un nombre dentro de ese depósito. Si la única copia útil está en el diario, compruébala fuera con `fuera.sh ensayo --diario=NOMBRE`; la reinstalación desde ese depósito requiere un procedimiento específico de soporte que esta guía aún no proporciona. No cambies los destinos del servidor para simularlo: podrías alterar los plazos de las copias nuevas.» Marcar esta ruta completa como pendiente antes de afirmar que la recuperación anual está lista para el dueño sin asistencia.

## Sección 8. Cambiar claves

**Bien:** las consecuencias de SESION_CLAVE y WEB_BD_CLAVE coinciden con el código; la rotación de BD_CLAVE existe, admite `--la-del-env`, verifica ambas credenciales y reanuda por `.env.nueva`. Las llaves antiguas deben conservarse para los respaldos antiguos.

### H23 · Media · Agregar un sello anterior requiere concatenar solo valores

- **Lugar:** `docs/operacion.md:394`.
- **Qué falla:** se dice agregar «ese renglón» con una coma, pero el programa entrega `RESPALDO_SELLOS_ANTERIORES=valor`. Concatenar renglones completos o repetir el nombre dentro del valor no se admite. La fecha de ejemplo también debe sustituirse por el límite real del cambio.
- **Evidencia:** `sello.ts:54–55` imprime nombre y valor; `entorno.ts:87–88` y `destino.ts:65–73` esperan una lista de `sello@momento`.
- **Por qué importa:** una segunda rotación puede impedir levantar el servicio o dejar sin acreditar diarios antiguos.
- **Texto propuesto:** «Mantén un solo renglón RESPALDO_SELLOS_ANTERIORES=. Si ya tenía valores, agrega una coma y solo lo que viene después del signo = en la salida nueva; no repitas el nombre de la variable. La forma es `RESPALDO_SELLOS_ANTERIORES=SELLO_1@FECHA_1,SELLO_2@FECHA_2`. Sustituye la fecha de ejemplo de --hasta por el momento real que delimita el uso de la llave anterior, con zona horaria. Conserva las llaves anteriores mientras queden copias retenidas cifradas con ellas.»

También conviene escribir completa la alternativa de BD_CLAVE en vez de `… --la-del-env`: `sh operacion/cambiar-clave-de-la-base.sh --la-del-env`.

## Sección 9. Si algo falla

**Bien:** las consultas de registros y las comprobaciones HTTPS/certificado existen; los bloqueos de 5, 15 y 60 minutos coinciden con la base; la limpieza conserva las publicaciones descritas y no elimina volúmenes ni manifiestos.

### H24 · Media · La ausencia del latido no demuestra que los procesos estén apagados

- **Lugar:** `docs/operacion.md:411–417`.
- **Qué falla:** se afirma que, si no llegó mensaje, el servidor o el servicio de respaldo no está corriendo. También puede fallar la conexión de salida, la señal o el proveedor mientras el sistema sigue funcionando. El latido comprueba al proxy por la red interna de Docker: no certifica acceso público desde el patio.
- **Evidencia:** `respaldar.ts:586–589` llama al comprobador con `maquina: "proxy"`; los errores al avisar se registran localmente. `avisos.ts` también puede informar problemas para medir el disco o leer la vigencia, no solo los tres diagnósticos simplificados.
- **Por qué importa:** atribuirlo a una caída puede provocar reinicios innecesarios; un latido correcto tampoco descarta una falla de acceso público.
- **Texto propuesto:** «Si la señal dejó de llegar sin mensaje, revisa el servidor, el servicio de respaldos, su conexión al vigilante y la URL configurada: la ausencia del aviso no distingue esas causas. El latido comprueba el sitio a través del proxy dentro de Docker con un certificado válido; comprueba además desde otra conexión que el dominio público se pueda abrir. Lee el diagnóstico completo si no se pudo medir disco o certificado.»

### H25 · Media · Perder la llave también requiere decidir qué hacer con su sello anterior

- **Lugar:** `docs/operacion.md:442–449`, frente a 394.
- **Qué falla:** el caso de pérdida manda sustituir pública y sello sin mencionar el sello anterior. Así los diarios antiguos dejan de acreditarse y generan avisos de pérdida; el comportamiento sí se explica en la tabla de rotación. En el caso de exposición tampoco se dice expresamente retirar ese sello de la lista de anteriores.
- **Evidencia:** `respaldar.ts:502–504` carga `RESPALDO_SELLOS_ANTERIORES`; `destino.ts:79` limita cada sello viejo a su fecha.
- **Por qué importa:** aparecen alertas inesperadas tras seguir la solución, o se mantiene un sello comprometido como confiable.
- **Texto propuesto:** «Si la llave se perdió sin indicios de exposición, conserva el sello que aún está en el .env como sello anterior, con el límite del cambio y en el formato de la sección 8; esto permite seguir comprobando manifiestos, pero no vuelve recuperables los respaldos cuya llave se perdió. Si alguien pudo obtenerla, no conserves su sello como anterior y retíralo si ya estaba en esa lista. Los respaldos antiguos seguirán retenidos, pero sus alertas requieren la revisión indicada en la sección 8.»

### H26 · Baja · Hay abreviaturas y una orden partida que no se pueden copiar tal cual

- **Lugar:** `docs/operacion.md:403`, 414 y 466–467.
- **Qué falla:** `respaldo ahora` y `comprobacion certificado` son argumentos del envoltorio, no programas de la terminal. El bloque de código en línea de `docker builder prune` contiene un salto de línea sin continuación.
- **Evidencia:** los ejecutables de entrada son `compose.sh` y la CLI Docker; se comprobaron sus interfaces sin operar.
- **Por qué importa:** copiar el texto crudo puede ejecutar una limpieza sin el filtro y luego intentar ejecutar `--filter` como otra orden.
- **Texto propuesto:** usar las órdenes completas en bloques separados:

```sh
sh operacion/compose.sh run --rm --no-deps respaldo ahora
sh operacion/compose.sh run --rm --no-deps comprobacion certificado
docker builder prune --filter 'until=168h'
```

«La última orden pide confirmación y retira caché de construcción sin uso reciente, del constructor Docker de esta máquina; confirma únicamente en el servidor previsto.»

## Sección 10. Lo pendiente en el servidor real

**Bien:** mantiene separados los ensayos aislados y la comprobación de dominio, proveedor, avisos y reinicio real; la documentación de pruebas del 3 de noviembre no acredita un apagón físico ni un despliegue contratado. No se debe quitar la marca «por probar en el servidor» por esas pruebas.

### H27 · Media · El resumen omite verificaciones concretas que sí exige el plan

- **Lugar:** `docs/operacion.md:481–493`; contraste con `docs/planes/2026-10-03-despliegue.md:1240–1258` y 606–610.
- **Qué falla:** «B2 en los dos depósitos» no traslada a la guía las reglas de vencimiento para archivos, manifiestos y anotaciones; tampoco la rotación real de BD_CLAVE y los ensayos de interrupción durante migración y vuelta. El candado de retención no borra por sí mismo los objetos al vencer: los guiones no tienen una operación de borrado remoto.
- **Por qué importa:** siguiendo solo la guía se puede dar por terminado el almacenamiento con retención activada, pero sin limpieza de objetos vencidos ni acceso comprobado a versiones históricas.
- **Texto propuesto:** «En ambos depósitos comprobar el versionado, el acceso de recuperación a versiones anteriores y la retención de archivos cifrados, manifiestos y anotaciones. Configurar y verificar con el proveedor las reglas de vencimiento y limpieza a 30/365 días, sin borrar antes del candado; no basta activar versiones ni retención. Medir listado y descarga con volumen representativo. Probar la rotación de BD_CLAVE y el reinicio de sus consumidores. Probar un reinicio real durante publicación, migración y vuelta al respaldo. Registrar los resultados, la fecha y el tiempo real de recuperación.» Añadir la ruta de recuperación del diario señalada en H22.

## Sección 11. Las órdenes juntas

**Bien:** todos los guiones y servicios nombrados existen; los ejemplos de consola coinciden con su analizador de argumentos.

### H28 · Media · El recordatorio mezcla máquinas y notación que no es ejecutable

- **Lugar:** `docs/operacion.md:497–522`.
- **Qué falla:** aparecen `[--quitar-contrasenas]`, `[--diario]` y `--desde-respaldo[=<respaldo>]` dentro de un bloque que parece listo para pegar. La generación de la llave externa se intercala con órdenes del servidor. `<dominio>` y `<respaldo>` son marcadores, pero `<` también es redirección real para la terminal.
- **Evidencia:** `servidor.sh` solo acepta exactamente `--quitar-contrasenas`; `respaldar.ts:483` busca exactamente `--diario`; `publicar.sh:59–68` no admite la forma con corchetes.
- **Por qué importa:** puede rechazar la orden, listar el depósito equivocado o generar una llave en el servidor.
- **Texto propuesto:** «Estas órdenes se ejecutan una por una, en la máquina indicada. Sustituye los nombres de ejemplo; no copies signos < > ni corchetes como opciones. El signo < solo se conserva al enviar el archivo de la llave a la entrada del programa.» Separar tres bloques: computadora del dueño, servidor nuevo y servidor publicado. Dar líneas independientes para `servidor.sh` y `servidor.sh --quitar-contrasenas`, para `respaldo lista` y `respaldo lista --diario`, y para `publicar.sh --desde-respaldo` y `publicar.sh --desde-respaldo=NOMBRE_REAL`. Aplicar a ese resumen la protección de llave de H06 y el envío por SSH de H01.

## README.md, bloque «Operación»

**Bien:** la configuración resuelta, imágenes por identificador, candado, publicación y vuelta al respaldo describen la implementación actual; las órdenes administrativas nombradas existen.

### H29 · Media · Se atribuye al ensayo una restauración con imágenes externas que ya no hace

- **Lugar:** `README.md:619–620`; contradice 582–585 del mismo bloque.
- **Qué falla:** «instalar desde un respaldo con las imágenes guardadas fuera» describe una versión anterior del diseño.
- **Evidencia:** `operacion/ensayo-publicacion.sh:621–624` retira las imágenes anteriores; 654 y 659 comprueba que se reconstruyó la imagen del repositorio y que es la que está corriendo. `version-del-respaldo.ts:14–19` explica el cambio de diseño.
- **Por qué importa:** puede inducir a buscar un paquete de imágenes que no existe o confiar en ejecutables del almacenamiento.
- **Texto propuesto:** «Simula que se perdió la máquina, retira las imágenes de la aplicación y comprueba la instalación desde un respaldo, reconstruyendo las imágenes del commit acreditado por su manifiesto.»

**Correcciones compartidas:** en 527–536 separar las máquinas y los prerrequisitos como en H03/H20/H28, proteger el archivo de llave como en H06 y explicar cómo entregarla sin copiarla al servidor como en H01. En 562–568 introducir las excepciones de H15. En 581–582 dejar la orden en una sola línea dentro de un bloque y enlazar las instrucciones completas de recuperación.

## Inventario completo del entorno

### H30 · Baja · Faltan los nombres y la función de variables obligatorias generadas automáticamente

- **Lugar:** `docs/operacion.md:178–187` y 245–247.
- **Qué falla:** se explica qué completar, pero no se nombran COMPOSE_FILE, MODO, DOMINIO, ORIGEN ni COOKIE_SEGURA como parte del contrato del archivo. No faltan en el generador: falta identificarlas en la guía para quien copie, restaure o edite el entorno.
- **Evidencia:** `entorno.sh:35–40`; `entorno.ts:69–77`, 190–193; `comprobar.ts:243–246`; Compose lee COMPOSE_FILE.
- **Por qué importa:** eliminar una línea al reconstruir el archivo o confundirlo con el de desarrollo cambia la composición o impide arrancar.
- **Texto propuesto:** «El guion ya deja COMPOSE_FILE=docker-compose.yml:docker-compose.operacion.yml y MODO=operacion; consérvalos. DOMINIO lleva solo el nombre del sitio, ORIGEN lleva https:// seguido de ese mismo nombre y COOKIE_SEGURA debe permanecer en 1. También genera BD_CLAVE y WEB_BD_CLAVE diferentes, de 32 letras y números, y SESION_CLAVE de 48 caracteres. No reemplaces el entorno del paquete por el archivo de desarrollo.»

**Resultado del cotejo:** todas las variables que la guía nombra con un nombre completo tienen consumidor. Los huecos documentales son el grupo diario abreviado y las variables generadas sin explicar; no se encontró una variable obligatoria adicional que deba inventar el operador y que el generador o los guiones no suministren. Las credenciales de almacenamiento se validan después de que exista un destino bien formado, por eso el primer diagnóstico del `.env` recién generado no enumera aún todas las claves vacías.

| Variable o grupo exacto | Quién lo suministra y lee | Exigencia y resultado |
|---|---|---|
| COMPOSE_FILE | `entorno.sh:35`; Docker Compose | Selecciona el archivo base y la ampliación de operación. Generada; falta nombrarla en la guía (H30). |
| MODO | `entorno.sh:36`; procesos y `comprobar.ts` | Operación rechaza el valor desarrollo. Generada; H30. |
| DOMINIO | `entorno.sh:38`; `entorno.ts:190–193`, proxy y comprobadores | Obligatoria, sin esquema ni ruta. H30 y preparación DNS H10. |
| ORIGEN | `entorno.sh:39`; aplicación y `entorno.ts:69–77,193` | Obligatoria; en el sitio debe ser exactamente https://DOMINIO. H30. |
| COOKIE_SEGURA | `entorno.sh:40`; aplicación y `entorno.ts:75` | Obligatoria y exactamente 1. H30. |
| BD_CLAVE | `entorno.sh:44`; Compose la entrega como POSTGRES_PASSWORD o en DATABASE_URL | Administración: mínimo 20 caracteres alfanuméricos, no desarrollo. Generador da 32. Sección 8 correcta. |
| WEB_BD_CLAVE | `entorno.sh:46`; migración, aplicación y validación | Mínimo 20 alfanuméricos y distinta de BD_CLAVE; generador da 32. Sección 8 correcta. |
| SESION_CLAVE | `entorno.sh:48`; aplicación y comprobador | Mínimo 32 caracteres, no desarrollo; generador da 48. Sección 8 correcta. |
| NEGOCIO_NOMBRE | `entorno.sh:41`; Compose, aplicación y avisos | Opcional, predeterminado Recicladora. No omitirlo no impide operar; conviene personalizarlo. |
| RESPALDO_HORARIO | `entorno.sh:51`; `entorno.ts:181–182`, `respaldar.ts`, `horario.ts` | Obligatoria, HH:MM separados por comas. Generada 07:00–20:00; se debe explicar su cobertura (H11/H21). |
| RESPALDO_LLAVE_PUBLICA | `fuera.sh llave/sello`; `entorno.ts:122–124`, cifrado | Obligatoria; pública age1…; coincide el nombre. |
| RESPALDO_SELLO | Mismos comandos; `entorno.ts:82–84`, `destino.ts` | Obligatoria; 64 caracteres hexadecimales minúsculos. Coincide el nombre; va con la pública de la misma llave. |
| RESPALDO_SELLOS_ANTERIORES | `fuera.sh sello --hasta`; `entorno.ts:87`, `destino.ts:65–79` | Opcional; lista de valores sello@momento. H23/H25. |
| RESPALDO_DESTINO | Operador; Compose, validación, respaldo, consulta de versión y restauración | Obligatoria en servidor y en recuperación horaria; `respaldo:depósito/ruta` con el Compose actual. |
| RESPALDO_DESTINO_DIARIO | Operador; Compose, validación y diario/restauración | Obligatoria en servidor, necesaria en recuperación diaria; otro depósito. |
| RCLONE_CONFIG_RESPALDO_TYPE y RCLONE_CONFIG_DIARIO_TYPE | Generador fija s3; validación y rclone | TYPE obligatoria para el remoto. Ambos nombres pasan por Compose; la guía debe conservar RESPALDO/DIARIO (H11/H17). |
| RCLONE_CONFIG_RESPALDO_ACCESS_KEY_ID y RCLONE_CONFIG_DIARIO_ACCESS_KEY_ID | Operador; validación y rclone por Compose | Obligatorias cuando TYPE=s3. Servidor: escritura/lectura; recuperación: solo lectura. |
| RCLONE_CONFIG_RESPALDO_SECRET_ACCESS_KEY y RCLONE_CONFIG_DIARIO_SECRET_ACCESS_KEY | Operador; validación y rclone por Compose | Obligatorias cuando TYPE=s3. No confundir las credenciales de ambos entornos. |
| RCLONE_CONFIG_RESPALDO_PROVIDER y RCLONE_CONFIG_DIARIO_PROVIDER | Operador; Compose → rclone | Existen; el validador local no exige que sean no vacías. Configurar según el proveedor real. |
| RCLONE_CONFIG_RESPALDO_ENDPOINT y RCLONE_CONFIG_DIARIO_ENDPOINT | Operador; Compose → rclone; validador las usa para distinguir depósitos | Existen; completar según proveedor. No confundir dirección del servicio con nombre del depósito. |
| RCLONE_CONFIG_RESPALDO_REGION y RCLONE_CONFIG_DIARIO_REGION | Operador; Compose → rclone | Existen; el validador local no obliga a no vacío. La configuración efectiva depende del proveedor. |
| RESPALDO_VIGIA_URL | Operador; validación y `respaldar.ts` | Obligatoria, HTTPS completo sin credenciales en la dirección. |
| RESPALDO_VIGIA_DIARIO_URL | Operador; validación y diario | Obligatoria y distinta de la señal horaria. |
| ENSAYO_VIGIA_URL | Operador, solo recuperacion.env; `fuera.sh` → `restaurar.ts` | Obligatoria al ejecutar ensayo; no se exige para version y no pertenece al .env del servidor. H17/H19. |
| LATIDO_VIGIA_URL | Operador; validación y `respaldar.ts:580–589` | Opcional, HTTPS sin usuario/contraseña. Coincide el nombre. |
| AVISOS_TELEGRAM_TOKEN y AVISOS_TELEGRAM_CHAT | Operador; validación y `avisos.ts` | Opcionales como canal; si hay uno se exige el otro. Chat es un entero con signo opcional. H13. |
| AVISOS_CORREO_SMTP, AVISOS_CORREO_DE y AVISOS_CORREO_PARA | Operador; validación, `avisos.ts`, `correo.ts` | Opcionales como canal; deben estar los tres y tener forma válida. Coinciden los nombres. |
| LATIDO_CADA | Compose → `respaldar.ts` | Opcional, 300 segundos por defecto. No es un campo faltante para instalar. |
| TZ, PGTZ | Compose/Dockerfile | America/Mexico_City está fijada en la configuración; escribir otro TZ en .env no modifica esas entradas literales. El horario de la guía debe decir la zona. |
| DATABASE_URL, POSTGRES_USER, POSTGRES_PASSWORD, POSTGRES_DB, WEB_BD_USUARIO | Compose o `fuera.sh` construyen la conexión y el usuario | No se piden al operador en recuperacion.env; ese archivo rechaza variables ajenas al almacenamiento y al vigilante de ensayo. |
| IMAGEN_DB, IMAGEN_ADMIN, IMAGEN_WEB, IMAGEN_RESPALDO, IMAGEN_PROXY, VERSION, OPERACION_TURNO | Publicación y candado | Las suministran los guiones. No son campos pendientes del .env; explica por qué Compose directo no arranca en operación. |
| PROXY_HTTP, PROXY_HTTPS, BD_PUERTO, WEB_PUERTO | Compose, valores predeterminados | Opcionales; las excepciones de puertos/red se revisan antes de publicar. No hay que agregarlas a la guía como requisitos. |
| FUERA_ENTORNO | `fuera.sh:89` | Opcional, ruta de recuperacion.env; propuesta para dejar secretos fuera del repositorio (H18). No se escribe dentro de ese archivo. |
| FUERA_RED, ENSAYO, ENSAYO_SERVIDOR, CONSERVAR y variables del Compose de ensayo | Herramientas de ensayo | Exclusivas de ensayos o personalización de su ejecución. `CONSERVAR=1` del README existe. No faltan en la configuración de producción. |

Se revisó también `docker-compose.ensayo.yml`: sus credenciales SERVIDOR_USUARIO/CLAVE y DIARIO_USUARIO/CLAVE, MINIO_ROOT_USER/PASSWORD, NODE_EXTRA_CA_CERTS y sus destinos de prueba son del entorno aislado; no deben incorporarse al archivo del servidor real.

## Órdenes comprobadas y límites de ejecución

Las ejecuciones fueron **secuenciales**. Para los guiones se usó un PATH sin Docker; además, donde se utilizó la CLI de Docker para ayuda, se indicó un socket inexistente dentro de la copia y una carpeta de configuración local. No se ejecutó Docker contra un motor. No se crearon imágenes, contenedores, volúmenes ni bases, ni se enviaron avisos. No se utilizó ninguna llave o credencial real.

La copia no incluye `.git` y tiene `node_modules` vacío. Esas condiciones se aprovecharon para las negativas tempranas y se dejan aquí como **límites de esta revisión, no como defectos del proyecto ni de la guía**. Un rechazo temprano confirma que se invocó el guion, pero no demuestra por sí solo el comportamiento del servicio posterior: ese se contrastó por lectura.

| Orden o familia de la guía | Ejecución inofensiva y resultado | Contraste de aceptación y comportamiento |
|---|---|---|
| `sudo sh operacion/servidor.sh` y `--quitar-contrasenas` | Guion real con argumento desconocido o sobrante: salida 1 y uso exacto. Sin sudo. | Analizador al principio, antes de privilegios/archivos. APT, ufw y SSH se contrastaron por lectura; no se preparó ningún servidor. |
| `apt-get update` / `install -y git` | No ejecutadas: modificarían el sistema y este anfitrión no es Ubuntu. | Son instrucciones externas de preparación, no pruebas locales autorizadas. No se acredita su funcionamiento en el servidor real. |
| `git clone …`, `git pull`, `git checkout …` | `-h` en cada una: uso de Git, salida 129. No se clonó ni cambió una rama. | Las opciones existen; la dirección real y la estructura del repositorio contratado no se pueden comprobar porque la guía solo pone un marcador. |
| `ssh -o PreferredAuthentications=publickey -o PasswordAuthentication=no …` | `ssh -V`: cliente presente; no se abrió conexión. | Opciones estándar de OpenSSH; la entrada real con llave queda expresamente pendiente del servidor. |
| `entorno.sh DOMINIO` | Sin dominio: uso y salida 2. Con dominio en raíz de la copia: negativa a sobrescribir `.env`, salida 1. En carpeta aislada de QA: creó un `.env` nuevo, salida 0. | Se comprobaron sus 35 nombres sin imprimir las claves generadas. Validación real del entorno recién generado y después con valores ficticios completos. |
| `fuera.sh llave`, `sello`, `sello --hasta=…`, `version`, `ensayo`, `ensayo --diario` | Sin orden: uso, salida 2. Cada forma: negativa «Hace falta Docker.», salida 1. | Lectura de todos los casos y argumentos; llamada directa de `sello.ts` con argumento extra y fecha válida sin llave confirma uso/rechazo de llave; `version-del-respaldo.ts` con argumentos de más o sin entorno confirma uso/Falta RESPALDO_DESTINO. |
| `age-keygen -y` y tubería OpenSSL | No se generó una llave ni se instaló age. Se comprobó la presencia de OpenSSL con `openssl version`. | La tubería coincide con la documentada en `operacion/sello.ts`; la alternativa no valida una identidad, limitación que la guía ya explica. No se atribuye una nueva comparación criptográfica a esta pasada. |
| `publicar.sh`, `--recuperar`, `--desde-respaldo`, `--desde-respaldo=NOMBRE` | Cada forma termina en la negativa de repositorio sin commits. Opción desconocida muestra uso. | Analizador y secuencias leídos completos en los puntos de cierre, respaldo, migración, apertura y reinstalación. |
| `volver.sh` y `volver.sh --abrir` | Ambas terminan en la negativa de Git; opción desconocida muestra uso. | Coinciden el nombre de la opción y el orden; no se tocó ninguna base. |
| `levantar.sh` y `migrar.sh` (este último en README) | Negativa de Git antes de preparar herramientas. | Se contrastó el entorno guardado, la exigencia del commit y el candado. |
| `cambiar-clave-de-la-base.sh` y `--la-del-env` | Con argumentos extra: uso y salida 2. Con cada forma válida: negativa de Git, salida 1. | Contraste de `.env.nueva`, verificación de clave, reanudación y llamada final a levantar. |
| `limpiar.sh` | Argumento extra: uso y salida 1. Sin argumento: «No se pudo identificar el proyecto: no se limpia.», salida 1. | Revisión del plan de conservación y de la eliminación por etiquetas de la instalación. |
| `compose.sh ps`; `logs --tail 50/100 web`, `logs --tail 100 respaldo`, `logs --tail 200 proxy` | Todas llegaron a la negativa de Git, sin invocar Docker. | El envoltorio acepta esas consultas y pasa los argumentos; no toma candado para consultar. |
| `compose.sh run --rm consola arranque` | Negativa de Git. | `docker-compose.yml` configura el servicio consola; `consola/principal.ts` acepta arranque. |
| Consola: `persona alta "Ana" responsable --autoriza`, `persona alta "Luis" mostrador`, `persona clave "Luis"`, `persona lista`, `equipo codigo "Tableta del patio"` | Cada orden completa mediante compose.sh recibió la negativa de Git. | Nombres, posiciones y `--autoriza` coinciden con el analizador. La ejecución directa de la consola sin argumentos se detuvo por falta del paquete pg; no se instaló. |
| Respaldo: `lista`, `lista --diario`, `ahora`, `probar-avisos` | Todas las formas completas del envoltorio recibieron la negativa de Git. | `respaldar.ts` acepta esas órdenes; el servicio lleva ese punto de entrada. La ejecución directa con argumento sobrante se detuvo por falta de pg, antes de su analizador. |
| Comprobación: `https` y `certificado` | Envoltorio: negativa de Git. Programas directos sin entorno: «Falta DOMINIO», salida 1, sin red. Sin orden: uso, salida 2. | Se comprueba certificado válido; `certificado` no promete mostrar un certificado inválido como si pasara. |
| `docker system df` y `docker builder prune --filter 'until=168h'` | Ayuda de ambos, salida 0; no se consultó uso de disco ni se limpió caché. | CLI y filtro disponibles. Corregir la presentación partida (H26). |
| `ensayo-servidor.sh` | Guion sin Docker: «Falló el ensayo del servidor: hace falta Docker.», salida 1. | No llegó a crear su contenedor. |
| `ensayo.sh`, `ensayo-publicacion.sh`, `CONSERVAR=1` | Solo `sh -n`: salida 0 en ambos. | **No se ejecutaron sus cuerpos**: no tienen una salida de uso previa que garantice detenerlos, y añadir argumentos no impide que preparen una instalación. Se leyeron las entradas y el arnés; CONSERVAR=1 está implementado. No se corrieron ensayos completos. |
| `/newbot` y consulta Telegram getUpdates | Contraste con documentación oficial; sin bot ni llamadas con credenciales. | H13 corrige la instrucción que no funciona con cualquier mensaje y privacidad activada. |

**Resultados de las comprobaciones locales adicionales:**

- El `.env` generado deja seis faltas iniciales: sello, llave pública, destino horario, destino diario y sus dos señales. Al completar los campos y credenciales con valores sintéticos, `faltasDelEntorno` devuelve una lista vacía. Se comprobó además la exigencia de ACCESS_KEY_ID de cada remoto eliminándola por separado. No es una prueba de conexión al proveedor.
- El validador AWK exacto de `fuera.sh` rechaza el renglón 9 de la plantilla de recuperación, correspondiente al renglón 348 de la guía.
- La redirección de generación de llave truncó un archivo de texto ficticio de 61 a 0 bytes aunque el guion terminó con «Hace falta Docker.». H06 está reproducido sin usar una llave.
- La función de horario confirmó el salto nocturno de once horas. H21 no depende de un fallo hipotético de red.

## Evidencias conservadas

Todo el material auxiliar está en `/tmp/feruga-codex-qa14/qa/revision38/`:

- `ordenes.json` y `ordenes-adicionales.json`: argumentos, código de salida y mensajes de las negativas/ayudas de guiones.
- `programas-y-entorno.json`: comprobaciones directas de programas, ayudas de herramientas y validación de la plantilla.
- `variables.json` y `validacion-completa.json`: nombres del entorno, exigencias del validador y cálculo del horario; no contienen credenciales del negocio.
- `plantilla-recuperacion.txt`: bloque de la guía usado como entrada del validador.
- `redireccion.json` y `archivo-ficticio.txt`: evidencia de la truncación inofensiva.
- `entorno-generado/.env`: entorno artificial generado para esta revisión, sin proveedor ni credenciales reales, solo para comprobar la plantilla.
- `huellas-antes.json` e `integridad.json`: comprobación de 511 archivos originales de la copia; **0 cambiados o borrados**. La ejecución de los guiones creó su candado local vacío en la copia.

La única salida creada fuera de la copia es este informe, en la ruta expresamente solicitada. No se modificó, creó ni borró ningún archivo bajo `/Users/maantora/Desktop/feruga`. No se ejecutaron `npm ci` ni `npm install`. No se consultaron ni operaron los contenedores `feruga-web-1`, `feruga-db-1`, `feruga-db_limpia-1`, `feruga-almacen-1`, ni la base `feruga`.

## Dictamen

La guía **todavía no está lista para seguirse literalmente en el servidor nuevo**. Los fallos de mayor efecto están en el orden de preparación, la protección y entrega de la llave, la acreditación del primer respaldo, la plantilla de recuperación y las garantías/rutas de restauración. El inventario de variables confirma que el código dispone de los nombres y del generador; hace falta expresar correctamente ese contrato en la guía.

Se dejan 30 hallazgos con ubicación, evidencia, efecto operativo y texto propuesto: 9 de prioridad alta, 17 media y 4 baja. Las observaciones compartidas del README se remiten a los mismos hallazgos para no contarlas dos veces. La revisión no cambia código ni documentación y no sustituye las comprobaciones expresamente pendientes en el servidor real.
