# Respuesta a lo que dejó la tercera pasada de Codex, que se cortó por cuota (4 de octubre de 2026)

La pasada está en `2026-10-04-codex-tercera-pasada-incompleta.md`. **No cuenta como revisión
hecha: se repite entera cuando Codex recupere su cuota.** Aquí se atiende lo que sus registros
mostraron, que son hallazgos aunque no los haya redactado. Los cinco se reprodujeron primero con
una prueba que fallaba.

**1. La marca de la base sí viajaba con `pg_restore --create`.** Confirmado: una base restaurada
así, a mano y en otro servidor, quedaba emparejada sin registrar su restauración, con los folios
donde iba el respaldo. La decisión 10 decía que esa marca «no viaja»; era cierto solo para la
forma de restaurar que usa el programa. → Migración `0022_vida_del_servidor.sql`: la marca ya no
es una propiedad de la base (que un volcado puede traer), sino **la identidad del servidor y el
identificador que ese servidor le dio a esa base**. Lo que la tabla guarda solo coincide con la
realidad en la base donde se registró; restaurada en otro servidor, o en otra base del mismo,
deja de coincidir. Renombrarla no lo cambia. La propiedad anterior se retira.
**Límites, dichos:** una copia física del servidor entero (sus archivos, una imagen del disco)
conserva todo y pasa por buena: los respaldos de este sistema son volcados, y quien restaure una
copia física debe registrar la restauración a mano. Después de actualizar PostgreSQL de versión
mayor hay que volver a emparejar. Y quien administra la base puede emparejarla sin registrar: la
marca protege de un olvido, no de un administrador.

**2. Una fecha imposible en un nombre dejaba la búsqueda en un bucle sin fin.** Confirmado. →
Solo cuenta como respaldo un nombre que el propio programa habría puesto: una fecha de verdad, en
la carpeta de su día. Y el bucle siempre avanza, haya lo que haya en la lista. La prueba corre la
búsqueda en un proceso aparte con plazo, para que un bucle no cuelgue la batería.

**3. El tope de diez no valía dentro del grupo de nombres de antes del mismo segundo.** Corregido.

**4. Un manifiesto con una instantánea distinta de la de su nombre se daba por bueno.** Corregido:
debe ser la misma, al milisegundo; o dentro de su segundo, si el nombre es de los de antes.

**5. Con los más nuevos dañados y uno bueno más atrás, restaurar «el último» decía que no había
ninguno.** Corregido el mensaje: dice que los más nuevos están dañados, que puede haber anteriores
en orden, y que se piden por su nombre. «No hay ningún respaldo» queda para cuando no lo hay.

**Lo que su guion no alcanzó a responder** (si una sesión de volcado cuyo programa murió desiste
sola): lo probé yo. Con el plazo de espera del lado de la base, sí: la sesión desaparece al
vencerlo, sin que nadie la limpie.

Comprobado por mutación: cinco, una por arreglo; todas hacen fallar su prueba. (La que quitaría
el avance del bucle no se puede probar sola: con el filtro de nombres, la fecha imposible ya no
llega hasta ahí. Son dos defensas para lo mismo.)

Migraciones hasta la `0022`. La tarea 5 sigue sin código, a la espera de la revisión de su diseño.
