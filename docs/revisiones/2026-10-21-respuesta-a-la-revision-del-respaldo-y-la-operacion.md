# Respuesta a la revisión de Codex del respaldo y la operación — 21 de octubre de 2026

La revisión (`2026-10-21-codex-revision-del-respaldo-y-la-operacion.md`, encargo 32) cubrió sus seis
partes. Dio por **cerradas** las correcciones del sello (13 de octubre), las del respaldo diario y
las de los guiones de publicar (9 de octubre); revisó por primera vez restaurar del diario —cerrado
en el almacenamiento de pruebas— y aceptó cinco de las seis precisiones del diseño (la sexta es de
B2, del servidor). Dejó tres hallazgos nuevos; los tres se corrigieron con su prueba, que se vio
fallar antes.

| | Gravedad | Qué se hizo |
|---|---|---|
| **H32-2** La comprobación desde fuera aceptaba una instalación con el sello de la llave del dueño y la pública de otra: respaldos «buenos» que el dueño no podría abrir | Bloqueante | `version-del-respaldo.ts` compara además la pública del manifiesto con la de la llave privada con que se comprueba, y lo dice con todas sus letras si no son la misma. Y la guía pide, el mismo día de instalar, **restaurar** el primer respaldo desde fuera (el ensayo de la sección 6), no solo leerlo. Prueba nueva en `pruebas/35-version-del-respaldo.test.ts`. |
| **H32-3** Al cambiar la llave, el servicio avisaba como perdidos los diarios de antes, que seguían intactos | Importante | El servidor guarda, solo para comprobar, el **sello** de las llaves anteriores —nunca su llave privada— con el momento del cambio (`RESPALDO_SELLOS_ANTERIORES`, «sello@momento»): acredita manifiestos y anotaciones de antes de ese momento, y nada de después. Sella siempre con la vigente. `node operacion/sello.ts --hasta=<momento> < llave-anterior.txt` da el renglón; el entorno lo comprueba; la guía (sección 8) lo pide al cambiar la llave. Pruebas en `pruebas/28` (con y sin el sello anterior, y que el anterior no acredite algo nuevo), `pruebas/23` y `pruebas/20`. |
| **H32-1** El diario podía empezar una descarga grande con el tiempo ya vencido, y darle un minuto aunque quedara menos | Importante | El plazo de lo grande se pide justo antes de empezarlo: si ya no queda tiempo no se empieza, y si queda poco, se le da ese poco. El minuto fijo queda para las anotaciones y los listados del principio. Al repasar un diario viejo, quedarse sin tiempo no se reporta como falla: le toca otra vez en la corrida siguiente. Prueba nueva en `pruebas/28`. |

**Sobre `--corregida`:** Codex sostiene la decisión de no hacerlo, pero no la frase «no se pierde
nada» sin condiciones. Tiene razón, y la guía (sección 5) ahora dice: no se pierde ninguna operación
del negocio hecha por los caminos de la aplicación; la base restaurada cambia de marca, sesiones y
bloque de folios; el orden es volver, abrir y publicar la corregida en la misma ventana; y si el
respaldo previo no se puede restaurar no hay salida automática, se arregla con soporte, con la base
que falló apartada. También comprobó con una prueba propia que publicar después de volver funciona.

**Lo que es del servidor:** sus seis ampliaciones a la lista de la tarea 7 (alertas por separado,
renovación del certificado, cambiar `BD_CLAVE` y el disco lleno, B2 en los dos depósitos, apagón real
durante una publicación, el primer respaldo restaurado desde fuera) y los pasos exactos de la
máquina de recuperación quedaron escritos en `docs/planes/2026-10-03-despliegue.md`, tarea 7.
