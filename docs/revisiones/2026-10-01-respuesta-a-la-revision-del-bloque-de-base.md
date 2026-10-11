# Respuesta a la revisión de Codex al bloque de base

Los nueve hallazgos proceden. Cada uno se corrige con su prueba primero: la prueba reproduce lo que
Codex observó, se ve fallar, y después se corrige. Como nada está desplegado, las migraciones se
corrigen en su lugar y la base de desarrollo se rehace.

| # | Veredicto | Qué se hace |
|---|---|---|
| 1 | **Procede** | `enTransaccion` escucha el evento de error del cliente mientras lo tiene reservado: la acción se rechaza, la conexión se destruye y el proceso sigue. Prueba en un proceso hijo: se le mata la conexión a media acción y debe sobrevivir y atender la siguiente |
| 2 | **Procede** | Tabla `envio`: cada cuenta y cada material que llega deja registrado su identificador con el contenido original, y ese registro no se borra. El mismo envío igual devuelve lo que hay; con otro contenido se rechaza; y si lo que creó ya se descartó o se quitó, se rechaza con un mensaje estable en vez de volver a crearlo |
| 3 | **Procede** | `entrar` bloquea el equipo antes de comprobar la clave. Prueba con barrera: la segunda entrada espera, y al pasar hace el relevo |
| 4 | **Procede, en el núcleo** | `linea_nace` (0005) toma la jornada `FOR SHARE` antes de mirar si cerró. Es el mismo orden que ya sigue confirmar: cuenta, luego jornada. Prueba en los dos órdenes |
| 5 | **Procede** | Un usuario de conexión que ya existía solo se reutiliza si es exactamente lo que debe ser: sin atributos de más, miembro solo de `feruga_app`, sin objetos ni permisos propios. Si no, se rechaza diciendo qué le sobra |
| 6 | **Procede, por la vía de 2** | El registro de envíos serializa a quien llega con el mismo identificador, sea de la cuenta que sea, y compara contenidos. Para la pesada y la huella del equipo se atrapa su restricción concreta y se contesta con el rechazo de negocio |
| 7 | **Procede** | Tope de 999 999 kg por pesada y de 99 999.9999 pesos por kilo, y rechazo de infinitos, antes de tocar una columna. Con esos topes un importe siempre cabe |
| 8 | **Procede** | Índice único sobre el nombre de las personas activas; la colisión se contesta con el rechazo de negocio |
| 9 | **Procede** | Se quita el `catch` y se comprueba que la cuenta reabierta conserva sus materiales. Las pruebas concurrentes de abrir, agregar, fallos de clave y canje se rehacen con barrera verificada |

## Lo que esto dice de las pruebas

Las 356 pasaban y aun así había nueve defectos. El patrón común: **probé cada función sola y en orden,
y los defectos estaban en el cruce** —dos sesiones, un reintento después de borrar, una conexión que se
cae—. Dos reglas quedan para lo que sigue:

- Toda acción repetible se prueba también **después de deshacer lo que creó**.
- Toda prueba de concurrencia **demuestra que hubo espera**; `Promise.all` solo no cuenta.
