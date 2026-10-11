# Respuesta a la segunda revisión de Codex (4 de octubre de 2026)

Informe: `2026-10-04-codex-segunda-revision-verificacion-y-diseno-de-publicar.md`. Dos partes.
Parte 1: el bloqueante quedó corregido, pero las tareas 3 y 4 no se cierran: cinco importantes y
dos menores. Parte 2: el diseño de la tarea 5 no se aprueba: tres bloqueantes y cuatro
importantes. Se aceptan todos.

## Parte 1 — Lo que faltaba en las tareas 3 y 4

**P1-I1 — Los respaldos con el nombre de antes desaparecían del lector.** Aceptado: al pasar el
nombre a milisegundos dejé fuera, sin darme cuenta, los que ya existieran con el nombre al
segundo; y no se pueden renombrar, para eso es el candado. → Se leen los dos formatos. El orden es
por el momento; y si en el último segundo hay alguno que solo lo trae al segundo, el orden entre
ellos lo dice el manifiesto de cada uno. Pruebas: los dos formatos listados y ordenados, el empate
resuelto por el manifiesto, y un respaldo real guardado con el nombre de antes que se trae y se
comprueba por su nombre.

**P1-I2 — Las conexiones ya abiertas seguían viendo la marca vieja después de registrar una
restauración.** Aceptado. La aplicación no se abría de más —se quedaba cerrada—, pero se quedaba
cerrada hasta reiniciarla: la salud sondea cada pocos segundos y no deja vencer las conexiones. →
Migración `0021_vida_sin_reconectar.sql`: `vida_vigente()` ya no lee un valor que la conexión
recibe al abrirse, sino la propiedad de la base en el catálogo, igual para todas en cuanto se
confirma. Sigue sin viajar en el volcado. Pruebas: una conexión de la aplicación abierta antes de
registrar ve el cambio sin reconectarse; y la prueba de las rutas ya no recrea el pozo.

**P1-I3 — Buscar el último respaldo utilizable no tenía tope.** Aceptado. → No poder leer un
manifiesto (el destino no contesta, o niega la lectura) ya no se trata como «está dañado»: la
búsqueda **se detiene y lo dice**, y el servicio, al no poder saber, respalda. Los manifiestos
dañados de verdad se saltan, pero a lo más diez: después se contesta que no hay. Y cada manifiesto
tiene un plazo de un minuto, no de media hora. Restaurar «el último» tampoco declara dañado lo que
no pudo leer, ni recomienda otro. Prueba con cien candidatos: una sola lectura cuando el destino
no contesta; a lo más diez cuando están dañados.

**P1-I4 — Un manifiesto con datos imposibles seguía acreditando el respaldo.** Aceptado. → El
manifiesto debe traer todos sus campos, con su forma, un tamaño mayor que cero **e igual al del
objeto que hay en el destino**, y la corrida de su nombre. Ajusto también lo que digo: es «el
último con su manifiesto validado»; que el respaldo esté entero lo comprueba `traer` al bajarlo.

**P1-I5 — La limpieza de la sesión del volcado dependía de la conexión que pudo haber muerto.**
Aceptado. → Se termina desde una conexión propia, y se comprueba que ya no está; si no se puede
confirmar, la corrida lo dice. Además el volcado lleva un plazo de espera del lado de la base, para
que desista solo. Prueba: se mata la conexión del turno con el volcado detenido en un candado; la
corrida falla y no queda ninguna sesión del volcado.

**P1-M1 — La base caída daba 500 en las rutas y 503 en la salud.** Corregido: 503 en las dos.

**P1-M2 — Un fallo al crear la carpeta privada dejaba el candado huérfano.** Corregido: la
limpieza se instala en cuanto se toma el candado.

**Lo que señaló sin pedir cambio, y queda dicho:** con SIGKILL no hay limpieza posible (quedan el
candado y la configuración resuelta, privados): la recuperación manual va en la guía. Dos copias
de la instalación con el mismo proyecto de Docker tendrían candados distintos: el estado de una
publicación, en la tarea 5, es por instalación.

Comprobado por mutación: ocho mutaciones, una por arreglo (la marca leída de la sesión; solo
nombres al milisegundo; no poder leer contado como dañado; buscar sin tope; no comparar el tamaño;
no exigir los demás campos; limpiar por la conexión del turno; la base caída como error interno).
Todas hacen fallar su prueba.

## Parte 2 — El diseño de la tarea 5

No se escribió código. El diseño se rehízo en el plan («Diseño, versión 2»), y vuelve a revisión.

**P2-B1 — Abrir antes del punto de éxito.** Aceptado, y es el que más me importa: yo daba por
buena «la vuelta atrás que no pierde nada» porque el respaldo se toma con la aplicación detenida,
y no vi que la candidata, una vez arriba, ya puede aceptar una compra que ese respaldo no trae. →
A: la operación se cierra y se abre **en la base**, de forma durable; la candidata se comprueba
por HTTPS estando cerrada; se registra el éxito y solo entonces se abre.

**P2-B2 — «La última migración es la misma» no acredita nada.** Aceptado; sus dos contraejemplos
ejecutados lo dejan claro. → B: vuelta automática solo si la candidata no trae migraciones
pendientes; si las trae, desde que el migrador arranca ya no hay vuelta automática. Y el migrador
guarda huellas, se niega ante una migración aplicada que cambió o una pendiente que va antes de la
última, y sabe revisar sin aplicar.

**P2-B3 — Sin registro durable no hay cómo recuperar una publicación a medias.** Aceptado. → C: un
archivo de fases escrito antes de cada paso, con los conjuntos de imágenes por su identificador y
el nombre del respaldo previo; `levantar` y `publicar` se niegan mientras exista; `--continuar` y
`--volver`.

**P2-I1 a P2-I4.** Aceptados. → D (la versión vigente la dice un archivo con identificadores
inmutables; imágenes por instalación; el proxy con su configuración dentro; publicar lo ya vigente
no hace nada; un commit anterior se rechaza antes de detener si no conoce el esquema), E (el
conjunto completo, con el respaldo coordinado y su aviso por separado; con qué imagen se restaura),
F (esperar a que no quede ninguna sesión de la aplicación en la base) y G (el ensayo, con la tabla
de casos que propuso y las interrupciones provocadas de verdad).

**Lo que no acepto tal cual, y por qué:** el reinicio del motor de Docker a media publicación no
lo voy a ensayar en esta máquina, porque el motor es compartido con otras cosas del usuario. Queda
para el servidor (tarea 7). Lo que lo cubre mientras tanto es que el cierre vive en la base.

**Menores de redacción.** Las decisiones 5, 7 y 9 del plan ya dicen lo que hace el código (la
puerta es el permiso de conectarse, la aptitud se pregunta en cada ruta, la restauración renombra
al final).

## Estado

Las tareas 3 y 4 vuelven a verificación con estas correcciones. La decisión 18 sigue abierta
(tarea 6). La tarea 5 no empieza hasta que el diseño versión 2 tenga el visto bueno.
