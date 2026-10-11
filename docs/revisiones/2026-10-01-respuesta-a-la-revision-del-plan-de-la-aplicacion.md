# Respuesta a la revisión de Codex al plan de la aplicación

Cada hallazgo se contrastó con las migraciones. Los 24 son reales; ninguno se descarta. Cuatro se
resuelven de una forma distinta a la propuesta, y se dice por qué. El plan quedó reescrito (versión 2).

Además de la revisión, se construyó una **sonda desechable** fuera del proyecto: Next 16.3.8 construye
en `node:24-alpine` con salida `standalone`, una ruta se llama como función desde `node --test`, la
cookie sellada va y vuelve por encabezados, y las variables se leen al ejecutar. Eso respalda las
respuestas a 18, 19 y 20.

## La decisión que cambia el plan: las entradas del mostrador pasan a ser funciones del núcleo

Los hallazgos 1, 9, 10 y 14 tienen la misma raíz: el núcleo dejó a la aplicación varias **escrituras
directas** (precios, cuentas, renglones, pesadas) sin persona ni rol, y la aplicación tendría que
componerlas, autorizarlas y hacerlas repetibles por su cuenta. Codex propone resolverlo con una matriz
en el servidor. Se hace eso **y** algo más firme: una migración nueva convierte cada acción del mostrador
en una función del núcleo que recibe a la persona, valida su rol, hace la acción completa y es
repetible; y le retira a `feruga_app` las escrituras directas. Queda así:

- la regla «una función de negocio por transacción» vuelve a ser literal;
- ninguna acción entra sin persona con rol, aunque una ruta se equivoque;
- agregar un material con su peso es atómico en la base, no por disciplina del servidor;
- repetir un envío devuelve lo ya hecho.

## Hallazgo por hallazgo

| # | Veredicto | Qué se hace |
|---|---|---|
| 1 | **Procede, y se va más lejos** | Funciones de entrada con persona y rol (`0012`); se retiran las escrituras directas. En el servidor, la persona sale siempre de la sesión y nunca del cuerpo. Matriz de roles por ruta, también para lecturas. Pruebas de suplantación y de cada rol |
| 2 | **Procede** | Contenedor de administración con sus propias credenciales. `arranque` migra, crea el usuario de conexión, la primera persona y un código de equipo; es repetible. Excepciones al requisito de equipo: salud y alta de equipo, nada más |
| 3 | **Procede, contrato mínimo** | No se amplía el núcleo. Para terminar un vehículo de otra jornada, el responsable teclea su clave en ese momento y **confirma él**: la pantalla dice quién quedará registrado. La clave vale para esa petición y esa revisión; no deja sesión |
| 4 | **Procede** | `verificar_clave` bloquea la credencial, cuenta el intento y devuelve el resultado sin lanzar error; se confirma en su propia transacción antes de responder. El código de equipo se canjea en una sola instrucción. Pruebas concurrentes |
| 5 | **Procede** | Seis dígitos como mínimo para responsables y administración, cuatro para los demás. Huella con sal y costo. Bloqueo que se alarga con cada reincidencia (5, 15, 60 minutos) y queda en la bitácora. Códigos de equipo de 50 bits, 15 minutos, un uso, guardados por huella; con esa entropía y esa vida no hace falta además un tope de canjes. Respuesta uniforme |
| 6 | **Procede** | Tabla `sesion` en la base. La cookie sellada lleva solo el secreto del equipo y el identificador de sesión. Vence por inactividad (30 min) y por duración (12 h). Dar de baja, o cambiar la clave, cierra las sesiones. Cada mutación declara como quién cree estar actuando; si la sesión ya es de otra persona, se rechaza |
| 7 | **Procede** | Mutaciones solo por POST con JSON; se comprueba el origen; cookies `HttpOnly`, `SameSite=Strict` y `Secure` cuando haya HTTPS. En esta entrega el puerto se publica solo en la propia máquina; el acceso por red llega con el certificado, en el plan de despliegue |
| 8 | **Procede** | Cada migración nueva concede lo suyo de forma explícita. Las tablas de identidad no son legibles para la aplicación; se consulta por funciones. Prueba con el rol real |
| 9 | **Procede, por la vía de 1** | Cada acción es una función. `enTransaccion` reserva un cliente, abre en `READ COMMITTED`, fija la persona con `set_config(..., true)`, y siempre lo devuelve o lo destruye. Prueba de que una petición no hereda la persona de la anterior |
| 10 | **Procede, por la vía de 1** | El cliente genera los identificadores de cuenta, renglón, pesada e impresión. La función devuelve lo ya hecho si llega igual y rechaza si llega distinto. Pruebas de reintento y de doble toque |
| 11 | **Procede** | `verCuenta` es una sola consulta. La revisión que se confirma es la que vino con lo mostrado; el dominio nunca la lee por su cuenta. Ante `RC011` se refresca y se vuelve a preguntar |
| 12 | **Procede** | El editor de precios sale del catálogo, tenga o no precio cada material. Un material sin precio se muestra como tal y no se ofrece en el mostrador. No se exige completar la lista |
| 13 | **Procede** | En venta, cada material muestra lo disponible y la cuenta avisa cuando lo apartado ya no alcanza. Es aviso; el rechazo es el del libro al confirmar. Se prueba con dos ventas abiertas |
| 14 | **Procede** | Vista `cuenta_resumen` en el núcleo: materiales, pendientes, suma, ajuste y total provisionales. Los pesos viajan como texto decimal; el servidor valida solo la forma y la base rechaza más de tres decimales en vez de redondearlos |
| 15 | **Procede** | El cierre separa «cuentas por terminar» (bloquean) de «vehículos por volver» (no bloquean). Las cuentas abiertas incluyen los vehículos de jornadas anteriores. La fecha la da la base en la zona del patio. Prueba de dos jornadas |
| 16 | **Procede** | `registrar_impresion` anota el intento antes de abrir el diálogo, con identificador repetible y consecutivo por operación; desde la segunda pide motivo y el comprobante sale marcado. Búsqueda por folio. **Límite declarado:** el comprobante se rearma del libro; pesos, precios y totales son inmutables, pero el nombre del material es el vigente |
| 17 | **Procede** | Los botones conservan el texto validado, que describe lo que la persona hace enseguida. El comprobante y el cierre dicen «a pagar» y «a cobrar», no «pagado». La caja sigue fuera |
| 18 | **Procede** | La sesión se lee del encabezado y se escribe en la respuesta, sin el almacén global de Next; comprobado en la sonda. El contenedor de recorrido se adelanta a la tarea 3 para probar por HTTP real la entrada y la salida |
| 19 | **Procede** | Tres piezas: `web` (solo lo construido), `admin` (migraciones y consola) y `recorrido` (navegador). Orden: base sana → migración terminada → web. El migrador toma un candado. La construcción no toca la base |
| 20 | **Procede en parte** | Dos configuraciones de tipos, una para Next y otra para lo que corre Node directo. Versiones exactas. Imagen oficial de Playwright. **Se conserva TypeScript 5.9**, que es el instalado y probado; pasar a la 7 no aporta nada a este plan |
| 21 | **Procede** | Cada punto de «qué vigilar» tiene ahora su prueba con nombre. `pgcrypto` se instala en un esquema aparte para no debilitar la guarda |
| 22 | **Procede** | Consola completa y auditada para personas y equipos. Destino por rol definido. **Se agrega el saldo inicial a este plan**: sin él no se puede vender el primer día lo que ya está en el patio. Las correcciones posteriores a confirmar siguen en el plan de inventario: el núcleo ya las tiene, falta su pantalla |
| 23 | **Procede** | Los criterios del personal vuelven a la tarea del mostrador y al recorrido, uno por uno |
| 24 | **Procede** | El arranque va inmediatamente después de identidad. Dar de alta un equipo desde otro equipo se pospone: por ahora, consola |

## Lo que queda como decisión del negocio

- **Largo de la clave.** Seis dígitos para quien autoriza, cuatro para el mostrador. Se puede cambiar
  sin tocar código; si en la práctica estorba, se revisa.
- **Inactividad de treinta minutos.** También es configuración.
