# Revisión de Codex al bloque de servidor — **incompleta**

**Revisor:** Codex, modelo `gpt-6-astra`, esfuerzo alto. **Fecha:** 1 de octubre de 2026.
**Objeto:** las correcciones a sus nueve hallazgos del bloque de base, y las tareas 4 a 7 (día,
comprobante, cierre, sesión, puerta de las rutas, dominio, 28 rutas, consola y sus pruebas).

## Qué pasó

**Codex agotó su cuota de uso antes de escribir el informe.** El turno terminó con error y sin
entrega. No hay, por tanto, una revisión de este bloque: hay lo que alcanzó a hacer y las notas
sueltas que dejó por el camino. Sí limpió sus bases, roles y archivos temporales.

## Lo que alcanzó a comprobar

- **La batería completa: 476 pruebas, 476 aprobadas, sin omisiones.** Los tipos también.
- La matriz de roles de `17-rutas` «coincide en lo esencial con la especificación: patio arma y pesa,
  mostrador confirma e imprime, consulta lee históricos y administración no registra operaciones».
- No dejó constancia de haber terminado la verificación, uno por uno, de sus nueve hallazgos anteriores.

## Las pistas que dejó, y qué se hizo con cada una

Son frases de sus notas de avance, no hallazgos redactados. Cada una se investigó aparte, se
reprodujo con una prueba que falló, y se corrigió.

| Pista de Codex | Lo que resultó ser | Corrección | Prueba |
|---|---|---|---|
| «Confirmé un interbloqueo al guardar dos listas de cambios de precios en orden inverso» | Dos responsables guardando los mismos materiales en orden contrario se trababan; Postgres mataba a uno y la pantalla veía una falla interna | `fijar_precio` y `quitar_precio` toman primero la lista entera: pasan uno tras otro | `10-entradas`: «dos que guardan precios en orden contrario…» (tardaba un segundo y fallaba; ahora pasa) |
| «pertenencia de la línea a la cuenta» | Quitar, descontar o pesar por segunda vez recibían el material en el cuerpo y la cuenta en la dirección, sin comprobar que uno fuera de la otra: se cambiaba una cuenta y se devolvía otra | El dominio comprueba que el material sea de esa cuenta antes de tocarlo | `15-cuentas`: «desde una cuenta no se toca el material de otra» |
| «alcance de la autorización puntual» | Con la clave de un responsable se podía terminar **a su nombre** cualquier cuenta abierta, no solo la de otra jornada | `terminarVehiculo` rechaza una cuenta de hoy, y lo hace antes de mirar la clave: no gasta un intento | `15-cuentas`: «la clave de un responsable no sirve para terminar a su nombre una cuenta de hoy» |
| «salida desde una pestaña desactualizada» | «Salir» era la única escritura que no decía como quién actuaba: desde una pestaña vieja sacaba a quien atendía ahora | `sesion/salir` exige lo mismo que las demás | `13-sesion`: «"Salir" desde una pestaña que se quedó atrás…» |
| «identificadores válidos…» (la frase quedó cortada) | Se dedujo: un número con buena forma pero que no cabe en su columna (material, báscula, revisión) reventaba en la base y salía como falla interna | Topes por tipo en `forma.ts`; kilos y precios con el mismo tope que la base | `17-rutas`: «lo que llega mal formado…», con ocho casos nuevos |

Además, al escribir los recorridos en navegador apareció un defecto de uso que ninguna prueba de
servidor podía ver: al entrar otra persona en el equipo, la pantalla se quedaba donde estaba la
anterior. Ahora quien llega va a su pantalla y quien vuelve tras vencer la sesión se queda donde estaba.

## Lo que queda debiendo

- **La revisión completa de este bloque**, con informe. Hay que repetirla cuando Codex tenga cuota.
- **La revisión del bloque de pantallas** (tareas 8 a 11), que no se pudo ni empezar.
- No se sabe si la frase cortada sobre identificadores se refería a lo que se corrigió o a otra cosa.

Mientras tanto, lo que respalda al bloque son sus pruebas: 480 del núcleo y del servidor, y 17
recorridos en un navegador real.
