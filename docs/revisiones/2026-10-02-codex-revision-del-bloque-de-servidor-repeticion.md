# Revisión de Codex al bloque de servidor — repetición, completa

**Revisor:** Codex, modelo `gpt-6-astra`, esfuerzo alto. **Fecha:** 2 de octubre de 2026.
**Objeto:** el mismo de la revisión del día anterior, que quedó sin informe: las correcciones a sus
hallazgos del bloque de base y las tareas 4 a 7 de la aplicación.

Ejecutó la batería con su propia plantilla —**480 pruebas, 480 aprobadas**— y dos guiones propios
contra bases desechables, llamando las rutas como funciones. No modificó el proyecto y limpió lo suyo.

## Parte 1 — Las correcciones anteriores

**Los nueve hallazgos del bloque de base: corregidos.** El 5 (usuario de conexión), «para los casos
reproducidos». El 9 (pruebas con barrera), corregido en las pruebas originales pero «parcial como regla
general»: pruebas nuevas volvieron a usar solo `Promise.allSettled`.

**Las cinco pistas del día anterior:** las cinco correcciones son adecuadas. Dos con salvedad: la de
pertenencia del material deja un 500 al quitar de una cuenta inexistente, y la del alcance de
`terminarVehiculo` no cierra la otra puerta (hallazgo 1). Sobre la frase cortada «identificadores
válidos…», no pudo reconstruir qué quiso decir; los desbordamientos quedaron bien corregidos.

Comprobó además que un envío rechazado no deja reserva: cero envíos tras un `RC004` o un `RC006`.

## Parte 2 — Hallazgos nuevos (comprobados ejecutando, salvo el 7)

1. **Importante — La confirmación ordinaria se salta la clave del vehículo de otra jornada.** Con sesión
   de responsable, `POST /api/cuentas/{id}/confirmar` con solo la revisión termina el vehículo: 200, sin
   pedir ni verificar clave. *Propone:* que la confirmación ordinaria rechace un borrador de jornada
   cerrada, y que solo la vía que verificó la clave admita la excepción.
2. **Importante — Con `SESION_CLAVE` ausente o corta, el alta gasta el código y deja un equipo sin
   cookie.** Primer intento 500 con el equipo ya creado; el reintento, 409. Y `/api/salud` sigue en 200.
   *Propone:* preparar el sello antes de canjear, y que salud detecte la configuración inutilizable.
3. **Menor — Quitar un material de una cuenta inexistente devuelve 500.** También alcanzable desde una
   pestaña cuyo compañero descartó la cuenta.
4. **Menor — Un texto con el carácter nulo pasa la validación y revienta en la base** (`22021` → 500).
5. **Menor — Repetir una impresión con otro motivo se acepta en silencio**, devolviendo el motivo anterior.
6. **Menor — `catalogo` no es una sola instantánea:** materiales y básculas salen de dos consultas.
7. **Menor — Pruebas que no demuestran lo que anuncian** (por lectura): «dos arranques a la vez» sin
   barrera, y la matriz de roles, que con cuerpos vacíos prueba la puerta pero no llega a la acción.

## Lo que encontró correcto

La matriz de rechazo a roles y equipos desconocidos; que la persona del cuerpo no sustituye a la de la
sesión; cookies alteradas, de otra clave o de un equipo desconocido; atributos de la cookie;
atomicidad y repetición de `terminar_arranque` (lo reprodujo con barrera); numeración de impresiones;
que los importes no se recalculan en TypeScript; que los errores no filtran detalle.

**Sobre Host y Origin:** sin `ORIGEN` configurado, una petición con `Host` y `Origin` ajenos iguales
entre sí pasa la comprobación. No es un ataque desde un navegador —que no deja cambiar `Host`—, pero
detrás de un proxy la garantía debe basarse en orígenes explícitos.

## Lo que no comprobó

Todos los órdenes de candados, pruebas de mutación, HTTP real detrás de un proxy, construcción y
tipos, las pantallas ni los recorridos.
