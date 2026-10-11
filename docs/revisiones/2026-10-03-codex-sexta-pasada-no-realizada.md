# Sexta pasada de Codex sobre el bloque de inventario: NO SE REALIZÓ (3 de octubre de 2026, madrugada)

**Se repitió esa misma tarde:** `2026-10-03-codex-sexta-pasada.md`. Lo que sigue es el registro de
la madrugada, tal como quedó.

A Codex (`gpt-6-astra`, esfuerzo alto) se le acabó la cuota apenas empezar:
«You've hit your usage limit… try again at 3:09 AM». No hay informe ni resultado de ninguno de
los cinco puntos que se le pidieron.

Alcanzó a leer la respuesta a la quinta pasada, `pestana.ts`, `playwright.config.ts` y
`docker-compose.yml`, y a lanzar la batería y los recorridos, que terminaron solos sin que nadie
recogiera su resultado. Se borró la plantilla que dejó (`feruga_plantilla_codex`). No dejó guiones
ni registros.

## Lo que iba a verificar, y sigue sin verificar por Codex

Todo lo de `2026-10-02-respuesta-a-la-quinta-pasada.md`:

1. Que su reproducción de la respuesta demorada entre pestañas ya no deja dos mermas, y que los
   recorridos corren de verdad por el camino de candados.
2. El candado del navegador (`src/componentes/pestana.ts`): cómo acabar con dos pestañas que
   conserven lo mismo a medias, o con una pestaña que pierda lo suyo sin ser copia.
3. El mostrador: que la copia ya no hereda el peso a medias, y si soltar todo lo guardado del
   mostrador en la copia pierde algo que importe.
4. Si las pruebas de esa ronda pasarían con el código mal.
5. Su juicio sobre si el bloque queda cerrado para pasar al despliegue.

## Lo que se comprobó mientras tanto, sin Codex

No sustituye su pasada. Es lo que yo había señalado como el riesgo principal del candado: que al
recargar, la página nueva no encuentre libre el candado de la anterior, se tome por copia y suelte
su propia captura.

Tres recorridos nuevos, corridos tres veces cada uno además de la batería completa:

- **Recargar muchas veces, y salir y volver:** quince recargas seguidas con una merma a medias,
  salir a otra página y volver con atrás, adelante y atrás; después, cinco recargas más con un
  envío del que no se supo. La captura sigue ahí, el identificador de la pestaña no cambia, y el
  envío se reintenta idéntico. El recorrido afirma primero que el origen es seguro y que hay
  candados, para no volver a probar el camino equivocado.
- **La original en otra pantalla:** con la captura a medias, la original se va al mostrador; se
  abre la copia, que no hereda nada; la original vuelve a inventario y registra una sola vez.
- **Recargar el mostrador diez veces** con un peso tecleado: el peso sigue ahí.

Las veinte recargas del primer recorrido tardan dos segundos y medio en total. Si el candado no
quedara libre a tiempo, cada recarga esperaría hasta un segundo: no se está esperando.

Esto dice que en este navegador, en estas condiciones, recargar no pierde la captura. No dice que
no pueda pasar con una página más pesada o en otro navegador.

Estado: **535 pruebas y 100 recorridos en verde.**

## Para repetirla

El encargo es el de la sexta pasada, tal cual, más este documento. Comandos que no reinstalan
dependencias:

```bash
PG_PLANTILLA=feruga_plantilla_codex docker compose run --rm pruebas sh -c "node db/plantilla.ts && node --test --test-concurrency=1 pruebas/*.test.ts"
docker compose --profile recorrido run --rm recorrido npx playwright test
```

Ahora deben ser 535 pruebas y 100 recorridos (más uno omitido, el de capturas).
