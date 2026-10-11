# Respuesta a la décima revisión de Codex — 7 al 9 de octubre de 2026

La décima pasada fue en cinco partes, porque la cuota de Codex no alcanza para una sola
(se corta a los tres o cinco minutos de trabajo, cada cinco horas):

| Parte | De qué | Informe | Verificación de las correcciones |
|---|---|---|---|
| A | Precio especial (tareas 1 y 2) | `2026-10-07-codex-decima-revision-parte-a.md` | `2026-10-09-codex-decima-verificacion-a-y-b.md` y `…-verificacion-c.md`: **cerrada** |
| B | Publicar: la lógica | `…-parte-b.md` | las mismas: **cerrada** |
| C | Publicar: los guiones | `…-parte-c.md` | `2026-10-09-codex-decima-verificacion-c.md`: dejó cuatro cosas; tres corregidas **sin verificar**, una **sin corregir** |
| D | Respaldo diario | `…-parte-d-incompleta.md` y `2026-10-09-…-parte-d-segunda-vuelta-incompleta.md` | la segunda vuelta dejó cinco hallazgos, corregidos **sin verificar**; **los puntos 8, 9 y 10 nunca se revisaron** |
| E | Rediseño (tareas 0, 1 y 2) | `2026-10-09-codex-decima-revision-parte-e.md` | seis hallazgos corregidos, **sin verificar** |

Todo hallazgo confirmado se corrigió con su prueba, salvo uno, que se dice abajo con su razón.
«Roturas a propósito» quiere decir: se rompe el programa en ese punto y se comprueba que una
prueba se entera.

## Lo que queda abierto, dicho primero

1. **El respaldo que baja del almacenamiento no está autenticado** (verificación de C, bloqueante).
   Quien pudiera escribir en el depósito podría sustituir un respaldo y su manifiesto, y al
   instalar o volver desde él se ejecutaría lo que traiga. **No se corrigió.** La corrección
   pensada: un sello (HMAC) del manifiesto con una clave derivada de la llave privada de age —el
   servidor guarda solo el sello, quien restaura lo deriva de la llave que ya tiene—, comprobado
   antes de descifrar. Toca respaldar, restaurar, el diario, la instalación y la guía. Se deja
   para antes del servidor de verdad (tarea 7), que es cuando existe un depósito que alguien
   pueda tocar; hoy los depósitos son los de pruebas. **Es condición para operar con datos reales.**
2. **De la parte D nunca se revisaron** restaurar del diario (8), las precisiones del diseño
   (9; solo tocó la c) y el veredicto (10).
3. **Sin verificar por Codex:** las correcciones de la segunda vuelta de D, las tres de los
   guiones y las seis del rediseño (todo lo del 9 de octubre por la tarde).
4. El 9 de octubre el usuario pidió salir del ciclo de revisar lo revisado. Lo de arriba se
   revisa en una sola pasada antes del servidor de verdad, no antes de seguir construyendo.

## A · Precio especial — cerrada

| Hallazgo | Qué se hizo |
|---|---|
| Recrear un renglón permitía reutilizar su autorización | Un identificador de renglón que ya tuvo precio especial no vuelve a nacer (`linea_nace`, migración 0027). Al verificar, Codex mostró que con dos sesiones a la vez aún se podía: el nacimiento del evento y el del renglón apartan ahora el identificador (`apartar_renglon`) y toman la cuenta. Cerrado en la segunda verificación. |
| Un envío cancelado gastaba intentos de clave; un duplicado a la vez contestaba «clave» | Orden nuevo en dar y quitar: cuenta → envío → lo que no procede → clave. `precio_ya_enviado` mira también el envío en curso. |
| (verificación) Orden de candados con el resto del sistema | Sin hallazgos: cerrado por lectura. |

Se apartó de la sugerencia: Codex proponía un «identificador de nacimiento»; se prefirió que el
identificador con historia no renazca, que no cambia el modelo. Roturas a propósito: 14 de 14.

## B · Publicar: la lógica — cerrada

| Hallazgo | Qué se hizo |
|---|---|
| Se aceptaba un cierre contradictorio | `porQueNoCierra`, una sola regla para cerrar y para entender lo escrito. |
| La primera publicación podía «abrir un conjunto anterior» que no existe | `decidir` se detiene; la primera publicación solo va hacia adelante. |
| La carpeta que contiene a la de publicaciones no se mandaba a disco | `crear` la asegura siempre, exista o no (reabierto y cerrado). |
| Un reintento daba por durable una marca cuyo fsync falló | Cada lectura asegura archivo, carpeta y raíz (reabierto y cerrado). |
| Una publicación antigua podía volver a cerrar la operación | Registro en la base de las que ya cerraron (migración 0028). |
| Un servicio de más quedaba fuera del manifiesto y de la comprobación | `imagenesDe` rechaza servicios que no conoce; `--nada-mas` al comprobar qué corre; `Object.hasOwn` (reabierto y cerrado). |

Roturas a propósito: 43 de 43.

## C · Publicar: los guiones

| Hallazgo | Qué se hizo | Estado |
|---|---|---|
| Los tres del candado (relevo atrasado, relevo que muere, entrada sin dueño) | El candado es ahora del sistema operativo (`flock`; `perl` en macOS) sobre un archivo que el guion tiene abierto. No hay relevo. | Cerrado |
| Primera publicación interrumpida con la migración empezada, sin salida | Recuperar la termina hacia adelante. | Cerrado |
| Repetir `--abrir` dejaba apagado el respaldo | Repone el servicio y comprueba el conjunto completo. | Cerrado |
| Dos restauradores sobre la misma base | Turno por base en el servidor; quien retoma espera lo que quedó corriendo. | Cerrado |
| Imágenes bajadas del almacenamiento sin autenticar | Se quitó el camino: instalar desde un respaldo construye las imágenes del commit. Ya no se guardan imágenes fuera. | Cerrado lo de las imágenes; **abierto el respaldo mismo** (arriba, 1) |
| Migrar a mano elegía el conjunto antes del candado | El candado va primero. | Cerrado |
| `compose.sh` dejaba alterar servicios | Solo consulta; `run` y `exec` piden el candado. | Reabierto: aceptaba `-d` |
| Lecturas que al fallar pasaban por respuesta | Cada lectura decisoria se comprueba. | Cerrado |
| La llave privada quedaba en disco | Va por la entrada estándar y vive en memoria. | Cerrado |
| «Lo asentado» solo miraba una tabla | El simulacro compara todas las del negocio. | Cerrado |
| Volver no esperaba al migrador; proyecto equivocado | Espera, detiene y comprueba, por el proyecto de la configuración guardada. | Reabierto: el migrador que arranca tarde |
| Git limpio no garantizaba las imágenes | Se construyen de `git archive` del commit. | Reabierto: la de la base se leía de la carpeta |

**Lo que dejó la verificación (9 de octubre), y lo que se hizo — sin verificar todavía:**

- **El migrador que arranca tarde** (bloqueante). Se lanzaba sin el candado; un cliente de Docker
  detenido antes de crear el contenedor podía crearlo después de que otro entrara. Ahora se crea
  y arranca con el candado en las manos (`run -d`), y se le sigue ya sin él (`logs`, `wait`,
  `rm`): mientras el cliente que crea viva, nadie entra; cuando ya no, el migrador o está creado
  —y quien retoma lo encuentra— o no lo va a crear nadie. Quien retoma quita también los
  creados sin arrancar y los terminados. Se eligió esta, de las dos que Codex sugirió.
- **`compose.sh run -d`.** Las opciones de `run` y `exec` se miran una por una hasta el servicio:
  desacoplado se rechaza (también pegado a otras: `-dT`, `-Td`), y una opción desconocida no pasa.
  Lo que va después del servicio no se toca (`psql -d` sigue sirviendo).
- **La imagen de la base, de la carpeta.** `imagen_de_la_base` la lee del commit (`git show`).
- Los tres casos están en `pruebas/36-guiones.test.ts`, y en los simulacros: el de operación
  rechaza órdenes desacopladas; el de publicación deja un migrador creado sin arrancar y
  comprueba que volver lo quita.

Roturas a propósito: 60 de 60 la primera vuelta; 22 de 22 las tres de la segunda.

## D · Respaldo diario

Primera vuelta (7 de octubre), doce hallazgos: el programa se rehízo (versión 3). Segunda vuelta
(9 de octubre): Codex cerró D1, D2, D5, D6, D10, D11 y D12, y dejó cinco hallazgos.

| Hallazgo de la segunda vuelta | Qué se hizo |
|---|---|
| Preguntar por el turno no protege una escritura que ya salió (bloqueante) | **La elección de cada día se decide en la base** (tabla `respaldo_diario`, migración 0029): una fila por día, que se escribe una vez y no se cambia ni se borra; quien llega segundo recibe la del primero. Lo que se escribe en el depósito sale de esa fila, así que una escritura atrasada escribe lo mismo. Si la base vuelve de un respaldo anterior, la elección se toma de la que quedó escrita en el depósito. |
| El repaso consumía el aviso de un diario dañado aunque no llegara | Los dañados quedan anotados y se avisan en cada corrida hasta que el vigilante lo recibe, sin volver a bajar el archivo. |
| El tiempo de la corrida no valía dentro de un día | Cada subida, bajada y listado recibe lo que queda; con el tiempo vencido no se empieza nada grande. Lo que quedó subido a medias se completa (se baja, se compara, y solo se le pone su manifiesto). Si a un mismo día se le acaba el tiempo en dos corridas seguidas, se dice como falla. |
| Las elecciones viejas no ampliaban el recorrido | Se recorre de corrido desde el primer día del que se sabe algo (respaldo, elección o diario) hasta hoy; el que ya tiene diario y no tiene original no es hueco. |
| Un diario viejo ilegible acaparaba el repaso | Van por turnos (por fecha de intento); del que no se deja leer se sigue diciendo hasta que salga. |

Se apartó de la sugerencia en una cosa: lo chico (una elección, un manifiesto) lleva un minuto de
plazo y no «lo que queda»: si no pasa en un minuto es que el depósito no contesta, y se dice como
falla, no como «pendiente».

Las pruebas de esta segunda vuelta se escribieron junto con el programa, no antes; por eso se
rompió a propósito: 33 de 33 (una sobrevivió a la primera —la cuenta de corridas sin tiempo no
volvía a empezar— y de ella salió una prueba). La primera vuelta: 26 de 26.

**Sin prueba propia:** que el plazo llegue a `rclone` al subir y al listar (`destino.ts`; al bajar
ya lo llevaba); `PRESUPUESTO_AL_ARRANCAR`; que la tabla nueva rechace cambios se prueba, pero no
se rompió a propósito.

## E · Rediseño (tareas 0, 1 y 2)

| Hallazgo | Qué se hizo |
|---|---|
| Enter sobre «Más contraste» enviaba la clave | El teclado en pantalla respeta Enter sobre un control al que se llegó con Tab (enlace, botón, interruptor). Con el foco donde lo dejó un toque, Enter sigue siendo «terminar»: quien toca el material y teclea el peso en el teclado del equipo no cambia de costumbre. Recorridos nuevos en la clave y en el mostrador. |
| El aro del foco del enlace actual desaparecía en claro | En ese enlace el aro va del color de su letra. El par está en el cálculo de contraste, en los cuatro modos. |
| Guardado fallido con cambio del equipo: el interruptor contradecía la pantalla | Al fallar, el interruptor dice lo que se ve. Recorrido nuevo. |
| El retrato del papel podía aprobar un papel que ya no se ve igual | Se confirmó en el navegador (era «sin confirmar»). La guardia compara ahora también **una imagen de la hoja** (`recorrido/papel/*.png`), y tiene su propia prueba: se le quita la tinta, se le pinta algo encima y se recorta, y tiene que notarlo. |
| El medidor no medía en diagonal | Mide de esquina a esquina. Con prueba propia. |
| Letra de 15 px donde el contrato dice 17 | El medidor pide 17, y deja 15 solo a los rótulos, que son una lista (`ROTULOS`, en `recorrido/apoyo.ts`). Al apretarlo encontró dos avisos a 15 px —el de un código que no sirve y el de «no se pudo guardar»—: van ya a 17. |

Los tres recorridos nuevos se vieron fallar contra una versión con la corrección apagada. Las
guardias nuevas del papel y del medidor se rompieron a propósito: 3 de 3.

**Límite declarado:** la imagen del papel es de la hoja como la pinta el navegador con los estilos
de imprimir, no del PDF vuelto imagen; se tomó en esta máquina (en otra arquitectura hay que
volver a tomarla, con `PAPEL=guardar`).

## Lo que cambió para quien opera

- Instalar en una máquina nueva desde un respaldo **construye la versión de su código** en vez de
  bajar imágenes guardadas: hace falta la carpeta en el commit de esa publicación y salida a
  internet para construir. A cambio, publicar ya no sube unos 500 MB cada vez.
- El candado de la instalación pide `flock` (viene con Linux).
- Una migración nueva (0029) y otra de antes (0027, 0028): la base de la demostración local sigue
  en la 0026 y no se ha tocado.

## Verificado (10 de octubre de 2026)

Con todo lo de arriba, y antes de construir nada más: tipos y **865 pruebas**, cero fallos;
**159 recorridos en Chromium** y **153 en WebKit** (los que se saltan son los de capturas y los
que son solo de un navegador); **el simulacro de operación**, completo. **El de publicación** se
detuvo la primera vez en una comprobación suya que dependía de un tiempo —un contenedor de
mentira que duraba 8 segundos tenía que seguir vivo después de esperar a otro de 6, y con el
migrador nuevo ya no alcanzaba—; se le dio 25 segundos y **pasó completo** (28 casos), ya con la
pantalla del precio especial dentro.
