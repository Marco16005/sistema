# Respuesta a la quinta pasada de Codex (madrugada del 3 de octubre de 2026)

Informe: `2026-10-02-codex-quinta-pasada.md`. Dio por corregidos el código `RC012`, el éxito
deducido y el orden completo de `enviar` (70 combinaciones). Dejó «a medias» la pestaña duplicada
y las pruebas, con dos hallazgos de importancia media y uno de baja. Los tres se aceptan, y cada
uno se corrigió con la prueba primero.

Estado al cerrar: **535 pruebas y 97 recorridos en verde** (antes 535 y 87).

**Después de esta respuesta** se pidió una sexta pasada, que no se realizó por cuota. Ver
`2026-10-03-codex-sexta-pasada-no-realizada.md`, que también cuenta lo que se comprobó mientras
tanto sobre la recarga (100 recorridos).

## Media — los 250 ms no daban exclusividad entre pestañas

**Aceptado.** Mi mecanismo era: la copia pregunta, y si en 250 ms nadie contesta, se queda con la
captura. Codex demoró la respuesta 800 ms y las dos pestañas se quedaron con ella: dos mermas.
Tiene razón también en el diagnóstico: alargar el plazo solo desplaza el problema. La ausencia de
respuesta no prueba nada, que es la misma lección del resto del día aplicada a otro lugar.

**Corrección** (`src/componentes/pestana.ts`): la exclusión la da ahora un **candado del
navegador** (Web Locks). El identificador de cada pestaña es un candado que esa pestaña tiene
mientras viva; es de una sola a la vez y lo decide el navegador, no un plazo. Una copia nace con
el identificador de su original, no puede tomar su candado, y suelta lo heredado. Recargar no es
copiar: el candado queda libre cuando la página anterior se va.

Queda una espera, de un segundo, pero al revés que antes: es lo que se le da al candado de la
página anterior para soltarse al recargar. Una original nunca lo suelta, así que esperar más no
puede convertir una copia en dueña. Si el plazo no alcanzara, el error sería soltar de más (una
recarga que pierde su captura), no heredar de más.

Los candados piden origen seguro (HTTPS, o la propia máquina), que es como va a operar la
aplicación. Donde no los haya, queda el mecanismo anterior de avisos, que sirve en el caso común
y no garantiza nada si la respuesta tarda; y donde no haya ni eso, la copia hereda y protege lo de
siempre: ningún envío se asienta dos veces. Los tres caminos tienen recorrido.

**Lo que encontré al probarlo.** Los recorridos corrían por HTTP entre contenedores, que no es
origen seguro: sin darme cuenta estaban probando el camino de respaldo, no los candados. La
bandera del navegador para tratar ese origen como seguro no surte efecto en el Chromium reducido
que Playwright usa por omisión; sí en el completo. `playwright.config.ts` usa ahora el completo.
De no haberlo comprobado, habría dado por probado un código que no corría.

**Pruebas** (`recorrido/inventario.spec.ts`):

- «Aunque los avisos entre pestañas tarden, la copia no se queda con la captura»: la reproducción
  de Codex. Fallaba antes.
- «Dos copias abiertas a la vez sueltan las dos la captura, y la original la conserva al recargar.»
- «En un navegador sin candados entre pestañas, la copia se entera por aviso…»: el respaldo.
- La de las dos pestañas con el mismo envío corre ahora sin candados ni avisos: el peor caso.

## Media — el mostrador conservaba el peso a medias en la copia

**Aceptado.** No había extendido la regla al mostrador porque ahí el renglón repetido se ve en la
cuenta antes de pagar. Codex señala que aun así puede pasar inadvertido y pagarse dos veces.

**Corrección:** la copia suelta también lo guardado del mostrador (el peso tecleado, el envío
pendiente, la segunda pesada a medias) y vuelve a pedir la cuenta al servidor, que es de todos.
Avisa: «Había un peso a medias: sigue en la otra pestaña, donde se empezó». El mostrador espera,
igual que el inventario, a saber si la pestaña es copia antes de leer lo guardado.

**Pruebas** (`recorrido/transiciones.spec.ts`): «una pestaña duplicada del mostrador no hereda el
peso a medias», con y sin un envío del que no se supo. Fallaban antes.

## Sobre la «transferencia de control» que propone

No se hizo. Codex considera aceptable dejar la captura en la original «si se garantiza que esa
original conserva el control»; con el candado eso ya está garantizado. Ofrecer pasarla a la
pestaña nueva es otra pantalla más para un caso raro. Si en el mostrador resulta que hace falta,
se agrega.

## Baja — las pruebas no demostraban que se espera la confirmación

**Aceptado.** Cinco recorridos nuevos retienen la cancelación y la confirmación y afirman, en cada
punto, que todavía no hay éxito ni captura suelta. Después prueban cada cosa que la confirmación
puede contestar: lo que hizo, `RC012`, otra regla, sin respuesta, y falla del servidor.

Pasaron a la primera, así que se comprobaron por mutación: anunciando el éxito sin esperar la
confirmación fallan los cinco; soltando la captura antes de conocer la cancelación, también.

No se agregó la sesión vencida como respuesta de la confirmación: es el mismo camino que la falla
del servidor (cualquier respuesta que no sea una regla deja la captura guardada), y Codex lo
ejerció en sus 70 combinaciones.

## Lo que sigue sin comprobar

- **El mecanismo de candados no lo ha visto Codex.** En particular, que al recargar el candado de
  la página anterior siempre quede libre a tiempo: los recorridos recargan una docena de veces y
  pasa, pero no hay prueba de que no pueda tardar más de un segundo.
- «Duplicar pestaña» desde el menú del navegador, y cerrar y restaurar el navegador: se probó con
  `window.open`, que es lo que Codex también usó.
- Lo ya anotado: todos los órdenes concurrentes, fallos de `sessionStorage`, y la carrera de la
  segunda pesada.
