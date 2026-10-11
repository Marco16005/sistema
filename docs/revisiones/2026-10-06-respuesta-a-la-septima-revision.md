# Respuesta a la séptima revisión de Codex (6 de octubre de 2026)

La revisión está en `2026-10-06-codex-septima-revision.md`, completa. Se aceptan todos sus
hallazgos; el importante y los dos menores se corrigieron con la prueba primero.

## Parte A — Reabrir el día: cerrado, con dos menores

- **A7-A-M1 (el aviso decía «quedó abierto» de un día que ya se había vuelto a cerrar).**
  Reproducido con dos recorridos que fallaban, uno por cada salida (reintentar, y «autoriza otra
  persona»). → Lo que la pantalla dice del día sale de cómo está **ahora**, no de lo que la
  reapertura hizo entonces: «Esa reapertura ya había quedado registrada, y después el día se
  volvió a cerrar. Sigue cerrado.» Los dos recorridos se quedan (`recorrido/reabrir-el-dia.spec.ts`).
- **A7-A-M2 (una afirmación vieja probaba el atajo de la prueba, no el servidor).** Tenía razón.
  → En `pruebas/16-cierre.test.ts`, el segundo cierre va directo al servidor con la jornada y un
  envío nuevo, y espera `RC011`.
- Lo que el plan dejaba sin probar (restaurar hoy un respaldo tomado con el día cerrado y
  reabrirlo) lo probó la revisión, sin encontrar problema: queda anotado así en el plan, como
  comprobado por Codex y no por la batería.

## Parte B — El comprobante por duplicado: cerrado

Sin hallazgos. Una nota de su ejecución que conviene tener presente: con el servidor en modo de
desarrollo el comprobante manda a imprimir dos veces al montarse (el montaje doble del modo
estricto), y eso ya pasaba antes del duplicado. Los recorridos corren contra la construcción de
producción, donde es una vez. **Para el rediseño:** la tarea 1 pide probar la hoja con el modo
estricto; el envío a la impresora al montar es el caso que hay que cuidar ahí.

## Parte C — La marca de restauración (tarea 3)

Confirmó corregidos A6-C-I1 y A6-C-I2, y halló uno más.

- **A7-C-I1 (conservar el objeto viejo con otro nombre y restaurar otro con el suyo).**
  Confirmado, con su misma secuencia (la secuencia de folios renombrada, y un volcado de solo esa
  secuencia restaurado encima): la aplicación atendía y el siguiente folio volvía a ser el 2. La
  marca pedía que lo conocido siguiera existiendo, pero no que lo que la aplicación usa fuera eso
  mismo. → De sus dos opciones se tomó la primera, que es la más simple de sostener:
  - **Fuera de una migración, el conjunto es estricto:** las tablas y secuencias de la aplicación
    tienen que ser exactamente las que la marca conoce. Ni falta una ni hay otra.
  - **Dentro de una migración, la incorporación está controlada:** el migrador agrega lo nuevo
    solo si **antes** de aplicarla el conjunto era exacto —entonces lo que hay de más lo creó esa
    migración, no una restauración— y **después** no falta nada de lo conocido. La condición de
    «antes», que en la pasada anterior era redundante, ahora es la que sostiene la regla (su
    mutación ya no sobrevive).
  - `vida_retirar` exige el conjunto exacto: sobre la base de su reproducción no hace nada.
- **Consecuencia, dicha:** crear a mano una tabla o una secuencia en el esquema de la aplicación
  deja la base sin emparejar, igual que borrarla. Quitar la que sobra la deja como estaba. Está
  en el README, en la decisión 10 y en la cabecera de la `0023`.
- **Lo que anotó de `vida_retirar`** (no sigue dependencias: la secuencia propia de una tabla se
  retira aparte) quedó dicho en la cabecera de la `0023` y en el README.
- Las pruebas: la suya («conservar con otro nombre → restaurar el nombre original», antes y
  después de migrar y de intentar retirar la vieja) y una de lo creado a mano, que se quita y
  vuelve a estar bien. Se conservan las de renombre legítimo, alta legítima y retiro declarado.

Comprobado por mutación: seis; las seis hacen fallar alguna prueba (una sobrevivía, «la
aplicación no mira si falta alguna tabla», porque esa parte solo se probaba contra la función de
la base: se agregó la comprobación con el código de la aplicación, y ya no sobrevive).

**Qué tan lejos llega esto.** Son siete vueltas sobre la misma marca, y cada una cerró una forma
real de restaurar sin registrar. Lo que queda fuera está escrito y no se va a perseguir: la copia
física del servidor, la recarga solo de datos, lo que no es tabla ni secuencia, y el
administrador que empareja a mano. Si la siguiente pasada encuentra otra forma dentro de lo que
sí se promete, se corrige; si cae en lo declarado, se queda como límite.

## Parte D — Publicar una versión: aprobado el diseño 5

Sin código todavía. Sus dos notas para implementar quedan anotadas: una recuperación que
encuentra una sucesora resuelve el relevo y aplica la tabla, sin permiso general de repetir
migraciones; y la marca de la parte C tiene que estar cerrada antes de confiar en esa señal.

## Parte E — El respaldo diario: aprobado el diseño 2

Sin código todavía. Sus dos notas para implementar quedan anotadas: «se elige una vez» pide
guardar la identidad del origen de modo que sobreviva a un reinicio, y si ese origen ya no está,
avisar del hueco en vez de elegir otro en silencio; y las llaves históricas se conservan mientras
quede algún diario que las necesite, no «un año desde que se rotaron».

## Qué se corrió después de estos cambios

Todo, completo y una cosa a la vez, sobre el estado final: **635 pruebas, cero fallos** (tipos
incluidos); **el ensayo de operación pasó**, con sus 6 recorridos por HTTPS —la aplicación
atiende, fuera de desarrollo, sobre una instalación nueva cuyo conjunto de tablas es exacto—; y
**126 recorridos** en el navegador: los 120 de antes, los 2 de A7-A-M1 y 4 nuevos del papel (la
línea base del comprobante impreso, tarea 0 del rediseño). Migraciones hasta la `0024`.

## Lo que queda para la octava pasada

Confirmar el arreglo de la marca (A7-C-I1) para cerrar la tarea 3, y revisar lo que se programe
entre tanto.
