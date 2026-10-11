# Verificación de Codex a las correcciones del bloque de inventario (2 de octubre de 2026)

**INCOMPLETA. Se repitió esa misma noche, completa:**
`2026-10-02-codex-verificacion-de-las-correcciones-de-inventario-repeticion.md`. La regla que aquí
se describe (en un reintento, `RC008` y `CLAVE` no sueltan el envío) se reemplazó después por la
cancelación en el servidor; ver `2026-10-02-respuesta-a-la-verificacion-de-inventario.md`.

Lo que sigue es el registro de la mañana, tal como quedó. A Codex (`gpt-6-astra`, esfuerzo alto, con ejecución) se le
acabó la cuota a media verificación y no entregó informe. No hay tabla de los cinco puntos que se
le pidieron ni hallazgos redactados por él. Lo que sigue separa tres cosas: lo que Codex dijo, lo
que sus guiones dejaron demostrado, y lo que se hizo con eso.

Se le pidió verificar: (1) la merma duplicada, (2) el límite del conteo, (3) los recorridos de
transiciones, (4) la matriz de rutas con cuerpos bien formados, y (5) el cambio en el mostrador.

## Lo que Codex dijo, con sus palabras

> La batería terminó con **524 aprobadas** y los recorridos con **56 aprobados y 1 omitido**. La
> merma original queda en **490 kg**, con un solo asiento tras recargar; la corrección con
> timestamps idénticos también se rechaza correctamente. Estoy cerrando la verificación con cruces
> de sesión y navegación y una prueba del orden entre autorización y recuperación del envío.

Eso cubre sus reproducciones originales de los hallazgos 1 y 2. De los puntos 3, 4 y 5 no dijo nada.

## Lo que sus guiones dejaron demostrado

Codex no llegó a borrar sus guiones ni sus registros. Se leyeron antes de borrarlos. **Esta es mi
lectura de sus registros, no una conclusión suya.**

Su guion de base corrió siete pruebas y las siete pasaron. Cada una afirmaba un comportamiento que
buscaba, así que «pasó» quiere decir «lo encontró»:

1. **«No te toca» llega aunque el envío sí había entrado.** En las cuatro acciones: se asienta un
   envío, a quien lo mandó se le cambia el rol, y el reintento idéntico recibe `RC008`. La base
   revisa el rol antes de buscar si el envío ya existía. La pantalla, tal como la dejé, soltaba el
   envío con cualquier `RCnnn`.
2. **«La clave no pasó» llega aunque el primer intento termine asentado.** En conteo y corrección:
   con el primer intento todavía en camino, un reintento con la clave que ya no vale espera, y al
   terminar el primero contesta que no. La pantalla soltaba el envío con `CLAVE`.
3. **La lectura y la base no coincidían en qué se puede corregir.** Una compra de cartón que se
   corrigió a PET, y después se contó el cartón: la pantalla decía que ya no se podía corregir, y la
   base aceptaba corregirla. La lectura miraba el material original; la base, el material donde el
   movimiento cuenta hoy.

Su guion de navegador corrió cinco recorridos:

- **Dos pestañas con el mismo envío pendiente:** pasó. Las dos reintentan y queda uno solo.
- **Navegación, sesión vencida y otra persona, en las cuatro acciones:** falló en las cuatro. El
  fallo era del guion, no de la aplicación: vencía la sesión antes de que la pantalla terminara de
  cargar, y esperaba el aviso donde ya estaba la entrada de personas.

## Lo que se hizo con eso

Los tres comportamientos son reales y se corrigieron, con la prueba primero.

**1 y 2 — la regla de cuándo soltar un envío** (`seSabeQueNoEntro`, en `src/componentes/cliente.ts`).
Ahora distingue el primer intento del reintento. En el primer intento, cualquier regla dice que no
entró: ese identificador no había salido nunca. En un reintento —cuando de un intento anterior no
se supo— `RC008` y `CLAVE` ya no sueltan el envío. Vale para inventario y para el mostrador.

- `pruebas/18-inventario.test.ts`: dos pruebas que fijan lo que hace la base en esos dos casos (son
  las de Codex, reescritas). Pasan con el código como estaba: describen la base, no la corrigen.
- `recorrido/inventario.spec.ts`: seis recorridos. Cuatro con «no te toca» en el reintento y dos con
  la clave mal en el reintento. Los seis fallaban antes del cambio.

**3 — qué se puede corregir** (`src/servidor/dominio/inventario.ts`). La lectura decide ahora por
el material donde el movimiento cuenta hoy, igual que la base. Una prueba en
`pruebas/19-dominio-inventario.test.ts` cubre los dos sentidos: contar el material original ya no
bloquea, y contar el material actual sí. Fallaba antes del cambio.

**El cruce de sesión que el guion no logró probar** se reescribió sin la carrera, para las cuatro
acciones: se pierde la respuesta, se va al mostrador y se vuelve con el botón de atrás, la sesión
vence, el reintento no pasa, entra otra persona en el mismo equipo y manda ese mismo envío. Queda
uno solo asentado. Los cuatro pasaron a la primera, con el código como estaba; se comprobaron por
mutación: haciendo que la sesión vencida suelte el envío, fallan los cuatro.

Estado al cerrar: **527 pruebas y 66 recorridos en verde.**

## Lo que queda sin verificar por Codex

Todo esto sigue pendiente de una verificación completa:

- Los puntos 3, 4 y 5 de lo que se le pidió: que las afirmaciones de los recorridos no pasen con el
  código mal, la matriz de cuerpos bien formados, y el cambio en el mostrador.
- Las correcciones de este mismo documento, que Codex no ha visto.
- Si el límite inclusivo del conteo bloquea de más en algún caso legítimo.
- Si el límite declarado —el reintento de un conteo o corrección lo autoriza la misma persona—
  deja a alguien sin salida de forma que importe.
- Botón atrás y dos pestañas en conteo, separación y corrección (solo los probó en merma).

## Para repetirla

La cuota de Codex se restablecía a las 2:47 p. m. del 2 de octubre. El encargo es el mismo, más
este documento. Comandos que no reinstalan dependencias:

```bash
PG_PLANTILLA=feruga_plantilla_codex docker compose run --rm pruebas sh -c "node db/plantilla.ts && node --test --test-concurrency=1 pruebas/*.test.ts"
docker compose --profile recorrido run --rm recorrido npx playwright test
```

Sus guiones, sus registros (`/tmp/feruga-codex-*`) y su plantilla (`feruga_plantilla_codex`) se
borraron después de leerlos.
