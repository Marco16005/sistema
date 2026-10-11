# Respuesta a la revisión de Codex del plan de despliegue (3 de octubre de 2026)

Informe: `2026-10-03-codex-revision-del-plan-de-despliegue.md`. No aprobó la versión 1: cinco
bloqueantes, ocho importantes y dos menores. Se aceptan los quince. El plan se reescribió
(`docs/planes/2026-10-03-despliegue.md`, versión 2); aquí va qué cambió por cada hallazgo, y lo
que no se pudo resolver sin el negocio.

Todavía no hay código: es una revisión de plan.

## Bloqueantes

**B1 — Restaurar una secuencia no impide reutilizar folios emitidos después del respaldo.**
Aceptado; es el más serio, y la prueba `09-respaldo` me había dado una confianza que no merecía:
solo comprobaba el máximo que venía en el respaldo. → Decisión 10: registrar la restauración abre
un **bloque nuevo de folios** (salta al siguiente múltiplo de cien mil), de modo que ningún folio
emitido después del respaldo se puede repetir, se sepa o no cuántos fueron. Y para que no se
pueda reabrir sin ese paso, la aplicación no atiende sobre una base restaurada sin registrar: una
marca que viaja en el volcado y otra que no, que solo vuelven a coincidir al registrar. La prueba
es el cruce que Codex pide: respaldo → operaciones posteriores impresas → pérdida → restauración →
operación nueva. La conciliación de lo perdido queda en la decisión 11 y en la guía; depende de
una respuesta del negocio (si conserva copia de los comprobantes).

**B2 — La restauración omitía los roles y el caso de la restauración a medias.** Aceptado. →
Decisión 9: una sola secuencia para ensayo y emergencia: roles mínimos → base aparte, en una sola
transacción → auditoría → renombrar solo si pasó → migrar y dejar el usuario de conexión →
registrar. Una restauración que falla no deja nunca una base `feruga` incompleta. No se quitan los
permisos del volcado para «hacerlo pasar».

**B3 — Se podía migrar con la versión anterior atendiendo, y la vuelta atrás podía borrar trabajo
válido.** Aceptado. Preferí que lo impida la base y no un procedimiento: → Decisión 5: con
migraciones pendientes, el migrador se niega si la aplicación tiene conexiones, le cierra la
entrada antes de la primera, y solo se la devuelve el paso que corre cuando todas entraron. Si
una falla a la mitad, la aplicación queda cerrada durante la recuperación. → Decisión 6: el
respaldo previo se toma con la aplicación ya detenida, así que restaurarlo no pierde nada. Las
peticiones en el aire quedan como envíos sin respuesta, que las pantallas ya resuelven.

**B4 — «Solo escribe», listar, verificar y no sobrescribir no eran compatibles.** Aceptado: había
escrito una propiedad («el servidor no puede borrar la historia») y un mecanismo que no la da. →
Decisión 15: la historia la protege el almacenamiento —versiones y retención con candado—, no la
credencial. Dos credenciales: la del servidor sube, lista y lee lo cifrado; la de recuperación
solo lee. → Decisión 13: nombres únicos por corrida, y la verificación baja el objeto y compara su
huella en vez de fiarse de la que reporte el almacenamiento. Los permisos se prueban de verdad:
contra MinIO en la batería y contra el proveedor contratado en la tarea 7.

**B5 — La comprobación dependía del archivo cuya ausencia debía detectar.** Aceptado. → Decisiones
1 y 2: el Compose base ya no trae valores por omisión; los de desarrollo viven en un archivo
aparte que se declara como tal; y cada proceso crítico valida su entorno al iniciar. El servicio
`comprobacion` queda como aviso temprano, no como garantía. El orden completo y los reinicios
están en la tarea 4.

## Importantes

**I1 — «Se muestra una vez» no evita que el secreto quede en los registros.** Aceptado. → Decisión
3: el entorno lo genera un guion de consola directo a un archivo `0600`, sin pasar por Docker ni
por la pantalla. La llave privada del respaldo se genera fuera del servidor y nunca lo toca. Al
restaurar entra por la entrada estándar, y la prueba mira procesos y registros **mientras** la
operación está retenida y cuando falla. → Decisión 4: que las variables se vean con `docker
inspect` se acepta y se dice; quien puede usar Docker ya es administrador.

**I2 — No estaba definido el ensayo de los respaldos reales.** Aceptado, y corrijo la promesa: lo
automático es el programa, probado en la batería. El ensayo con respaldos de verdad no puede ser
automático porque la llave privada no vive en ningún servidor. → Decisión 18: lo hace una persona,
desde otra máquina, con un comando, y un segundo vigilante avisa si pasan 35 días sin hacerlo. El
paquete de recuperación y quién lo guarda, en la guía y en la pregunta 4.

**I3 — Faltaba el segundo objetivo de recuperación, y la recaptura desde tickets prometía de
más.** Aceptado. → Decisión 11 dice lo que de verdad se pierde. Las preguntas 1 y 2 piden los dos
números y si el negocio conserva copia de los comprobantes. Codex tiene razón en que no todo puede
esperar: esas respuestas van antes de la tarea 3.

**I4 — Estados del respaldo, exclusión y frescura.** Aceptado. → Decisiones 13, 14, 16 y 17:
identificador por corrida, candado compartido entre el programado y el manual, plazos, manifiesto
como única prueba de que el respaldo existe, señales de inicio y fin, y recuperación del respaldo
perdido por una caída.

**I5 — El proxy podía estar arriba sin certificado.** Aceptado. → Decisiones 19 y 20: volumen para
los certificados, disponibilidad medida con una petición HTTPS validada, y el ensayo local
confiando en la autoridad de Caddy en vez de ignorar errores. Esto último me toca de cerca: ayer
los recorridos pasaban por el camino equivocado justamente por una bandera de ese tipo.

**I6 — Red y guion del servidor.** Aceptado. → Decisiones 21 y 22: comprobación positiva de lo que
se publica, por IPv4 e IPv6 desde otra máquina; el usuario que usa Docker descrito como lo que es;
la llave verificada antes de quitar contraseñas.

**I7 — El retrato y `/api/salud` no acreditaban que lo restaurado funcione.** Aceptado. →
Decisiones 7 y 12: retrato ampliado a identidad, impresiones, envíos y bitácora; uso real por la
aplicación con su usuario de conexión; y la aplicación sabe qué versión del esquema espera. Las
sesiones se cierran al registrar la restauración. Que lo dado de baja después del respaldo
reaparezca queda como riesgo declarado y como paso de la guía.

**I8 — Cruces y mutaciones.** Aceptado. La tabla de Codex está repartida en las tareas 1 a 5. La
prueba existente de los dos migradores se rehace con barrera en la tarea 1.

## Menores

**M1 — «Versión fijada» no era publicación reproducible.** Aceptado. → Decisión 8 e imágenes base
por huella. Y se dice que el servidor necesita Git además de Docker.

**M2 — Arranque sin base ni entorno, y rotación.** Aceptado. → Decisión 3 (el guion no depende de
Compose ni de la base) y la guía de rotación, que distingue cambiar el archivo de cambiar la clave
de una base que ya existe.

## Lo que tenía bien, según Codex, y no se toca

El volcado en formato propio con la aplicación escribiendo; el volcado completo, sin restringirlo
a un esquema; el cifrado a llave pública con la privada fuera; el mismo programa para ensayo y
emergencia; la vigilancia externa; HTTPS, cookie segura, origen explícito y sin marcos.

Su precisión también queda, como riesgo declarado: el cifrado protege los respaldos, no la base
viva.

## Lo que no se puede cerrar sin el negocio

Las diez preguntas del final del plan. Cuatro cambian el diseño y van antes de la tarea 3:
cuánto se puede perder y en cuánto hay que volver; si se conserva copia de los comprobantes; dónde
van los respaldos y por cuánto tiempo; quién guarda la llave y quién lo suple.

## El orden de trabajo

Se adopta el que propone: primero endurecer lo que existe (tarea 1), después restaurar (2), luego
respaldar (3), proxy (4), publicar (5) y la guía (6). La tarea 7, en el servidor real, es
condición para operar con datos de verdad.
