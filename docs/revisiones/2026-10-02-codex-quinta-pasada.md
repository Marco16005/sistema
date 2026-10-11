# Quinta pasada de Codex sobre el bloque de inventario: RC012, la confirmación y las pestañas (2 de octubre de 2026, noche)

Modelo `gpt-6-astra`, esfuerzo alto, con ejecución. Se le pidió no modificar archivos del proyecto.
Verifica lo que se cambió en respuesta a su cuarta pasada
(`2026-10-02-respuesta-a-la-cuarta-pasada.md`). Informe completo, tal como lo entregó.

La respuesta está en `2026-10-02-respuesta-a-la-quinta-pasada.md`.

---

**RC012 y la confirmación de `enviar` quedaron corregidos. La protección contra pestañas duplicadas quedó a medias:** comprobé duplicación con una respuesta tardía del canal y también con un peso heredado en mostrador.

**1. Qué ejecuté**

- Batería con el comando indicado y `PG_PLANTILLA=feruga_plantilla_codex`: **535 aprobadas, cero fallidas**.
- `docker compose --profile recorrido run --rm recorrido npx playwright test`: **87 aprobados y uno omitido**.
- **Cinco recorridos propios:** UUID ocupado; original en Mostrador; original en Precios; respuesta entre pestañas demorada; peso heredado en mostrador. Todos completaron sus comprobaciones; los últimos dos confirmaron defectos.
- **70 combinaciones de `enviar`**, ejecutando su código extraído y transpilado con respuestas controladas: primer intento y reintento, errores iniciales, cancelación y errores de confirmación.

No modifiqué archivos del proyecto, instalé dependencias ni reconstruí imágenes. Eliminé los guiones temporales y mi plantilla; las pruebas eliminaron sus bases y dejé la base de recorridos restaurada desde su plantilla existente.

**2. Los cinco puntos**

| Punto | Estado | Reproducción y resultado |
|---|---|---|
| **1. UUID reutilizado y éxito deducido** | **Corregido, con la excepción declarada** | Reproducción propia: merma de **20 kg «Otra captura»**, formulario de **10 kg «Mojado»**, UUID forzado. Recibió RC012, mostró el rechazo, **no anunció éxito ni pidió cancelar**. Quedaron 480 kg. Registrar nuevamente produjo otro UUID, una sola merma «Mojado» y **470 kg**. |
| **2. Clasificación RC012 y mostrador** | **Corregido** | Pasaron los casos de contenido distinto, material enviado a otra cuenta, identificador de material quitado y cancelación concurrente. No encontré dependencia rota de RC005. Soltar sin cancelar es seguro respecto de **ese identificador**: su ocupación o cancelación ya está persistida. |
| **3. Orden completo de `enviar`** | **Corregido en los caminos examinados** | Las 70 combinaciones conservaron o soltaron el pendiente según correspondía y repitieron idéntico cuerpo al confirmar. Los recorridos comprobaron recuperación real y ausencia de doble asiento con el mismo UUID. No encontré liberación insegura ni bloqueo irreversible en este flujo. |
| **4. Pestaña duplicada y mostrador** | **A medias** | Pasaron las dos variantes existentes con `window.open` y mis casos con original en Mostrador/Precios y tres pestañas. **Demorar `viva` 800 ms permitió dos mermas**. En mostrador, duplicar un peso todavía no enviado permitió **dos renglones en la misma cuenta**. |
| **5. Pruebas de esta ronda** | **A medias** | Las nuevas afirmaciones detectan las omisiones anteriores de cancelación y confirmación. Sin embargo, no prueban que se espere y utilice realmente la respuesta de confirmación; tampoco cubren la carrera de inicialización ni el vencimiento de los 250 ms. |

Precisiones sobre **RC012**:

- `reservar_envio` solo cambia los dos rechazos previstos: cancelado y ocupado con clase/contenido diferente. Las reglas de kilos, báscula, permisos, cuenta inexistente y pesada reutilizada siguen siendo reglas del negocio.
- Material quitado, repetido **idéntico**: sigue recibiendo RC005 con su explicación específica. Reutilizado **con otros datos**: RC012. Ambos caminos son seguros; el primero consulta cancelación y obtiene que aquel envío entró.
- Lo mismo aplica a una cuenta descartada: conservar su rechazo específico no abre una reutilización del UUID.
- El servidor reconoce genéricamente los códigos `RCnnn`; no encontré una lista que excluyera RC012.
- Con dos pestañas, el registro inmutable del envío y la unicidad del UUID impiden que una respuesta RC012 deje ese mismo identificador disponible. **Esto no impide generar dos UUID nuevos para una captura heredada.**

El orden comprobado de **`enviar`** es:

| Resultado | Comportamiento |
|---|---|
| Acción exitosa | Devuelve su respuesta; la pantalla termina la captura. |
| RC012 inicial | Suelta el pendiente, muestra rechazo y no cancela. |
| Sin respuesta, fallo del servidor o sesión vencida | Conserva el mismo pendiente. |
| Otra regla; cancelación fallida o inválida | Conserva el pendiente y muestra el rechazo original. |
| Otra regla; cancelación «cancelado» | Suelta el pendiente y muestra el rechazo. |
| Otra regla; cancelación «entró» | Repite la acción con el mismo UUID y cuerpo. |
| Confirmación exitosa | Solo entonces devuelve éxito. |
| Confirmación RC012 | Suelta y muestra rechazo. |
| Confirmación con otra regla, red, servidor o sesión | Conserva el pendiente; permite reintentar. |

Una indisponibilidad o denegación persistente puede mantener la captura pendiente hasta recuperar conexión, sesión o permisos. No encontré un estado interno que impidiera recuperarla una vez restablecidos.

La explicación de **«Autoriza otra persona» se sostiene como excepción deliberada**, no como confirmación equivalente. Para el envío auténtico ya asentado, la base puede devolver el resultado sin comprobar nuevamente la clave; pero, si el UUID perteneciera a otra operación, la ruta puede llegar a comprobarla y contabilizar una clave de relleno fallida. Evitar ese intento tiene sentido. Permanece la confianza declarada en el UUID generado por la pantalla; eliminarla exigiría una consulta de resultado que verifique identidad y contenido sin volver a autorizar. No encontré otra deducción equivalente de éxito en las cuatro acciones.

**3. Hallazgos nuevos, por gravedad**

**Media — Los 250 ms no establecen exclusividad entre pestañas. Comprobado ejecutando.**

Archivo: [pestana.ts:62], especialmente la condición de la línea 63 y el temporizador de la 71.

Reproducción exacta:

1. Preparar una merma de Cartón, **10 kg, «Mojado»**, con 500 kg iniciales, sin enviarla.
2. En la original, interceptar `BroadcastChannel.prototype.postMessage` y demorar únicamente los mensajes `tipo: "viva"` **800 ms**.
3. Abrir `/inventario` mediante `window.open`.
4. Esperar también a que llegue la respuesta demorada.
5. Registrar desde ambas pestañas.

**Observado:** ambas conservaron el mismo identificador de pestaña y el formulario. La respuesta tardía se ignoró porque la copia ya estaba «establecida». Cada formulario generó un UUID de envío diferente: **dos mermas y 480 kg finales**. `BroadcastChannel` estaba disponible y funcionando.

Por lectura, también existe la carrera de arranque simultáneo: mientras ambas están averiguando, ninguna responde a `hay`. Esto afecta potencialmente a original recargando, copia que arranca antes y restauración simultánea de pestañas. No ejecuté esas variantes reales.

**Corrección propuesta:** sustituir la ausencia de respuesta durante 250 ms como prueba de propiedad por exclusión mutua —por ejemplo, un bloqueo por identificador de captura— y resolver explícitamente quién conserva el control. Contemplar pérdida y transferencia del propietario. Aumentar el plazo solamente desplaza el problema.

Durante la espera, `Inventario` monta «Un momento…» y todavía no lee ni ofrece enviar la captura: **esa barrera está bien por lectura**. El problema empieza cuando el plazo vence indebidamente.

**Media, mitigada por revisión antes de pagar — El mostrador conserva el peso heredado y permite agregarlo dos veces. Comprobado ejecutando.**

Archivos: [pestana.ts:76] y [Mostrador.tsx:210].

Reproducción exacta:

1. Abrir una compra.
2. Elegir Cartón, Báscula 2 y teclear **10 kg**, sin agregar.
3. Abrir `/mostrador` con `window.open`.
4. Pulsar «Agregar a la cuenta» en la original y después en la copia.

**Observado:** la copia conservó `feruga.mostrador`; cada pestaña generó sus propios identificadores. La cuenta mostró **dos materiales**, con dos filas reales en base.

No es doble ejecución del mismo envío ni una regresión causada por RC012. Sí es una duplicación operativa relevante: puede terminar pagándose dos veces el mismo peso si pasa inadvertida. Que los dos renglones aparezcan antes de pagar permite detectarla y corregirla, y reduce la gravedad.

**Corrección propuesta:** aplicar la propiedad de captura también a los pesos a medias del mostrador, manteniendo acceso a la cuenta compartida y recuperando del servidor los envíos ya asentados.

El aviso de inventario se entiende. Considero aceptable conservar la captura en la original sin ofrecer transferencia inmediata **si se garantiza que esa original conserva el control**. Con la coordinación actual, la frase «sigue en la otra pestaña» expresa más certeza de la que ofrece el mecanismo. Para trabajo de mostrador convendría una opción explícita de recuperación o transferencia.

**Baja — Las pruebas comprueban que se pide confirmar, pero no completamente que se espera esa confirmación. Visto por lectura; sin mutaciones ejecutadas.**

Archivos: [inventario.spec.ts:487] y [transiciones.spec.ts:242].

- Los cuatro recorridos de inventario ahora exigen cancelación, tercer envío idéntico y resultado correcto. Pero podrían pasar si una implementación mandara ese tercer envío y anunciara inmediatamente éxito sin esperar su respuesta: el primer asiento ya existe y los datos esperados coinciden.
- `cancelacionesPedidas` prueba **petición e identificador**, no que se consuma su respuesta. Corrige la omisión anterior, pero no demuestra por sí sola todo el protocolo.
- El añadido del mostrador comprueba la respuesta real `{ entro: true }`; aun así, una implementación que la ignorase podría recuperar la cuenta mediante `refrescar`.
- Los RC012 de base sí exigen el código exacto y, en los casos revisados, comprueban efectos. No encontré una afirmación vacía allí.
- Las dos pruebas de pestaña cubren el caso favorable de una original ya establecida; pasan con el defecto temporal demostrado.

**Corrección propuesta:** retener la respuesta de confirmación y exigir que todavía no haya éxito; después probar RC012, otra regla, pérdida de respuesta, fallo del servidor y sesión vencida. Retener también la cancelación para comprobar que no se libera antes de conocerla. Añadir arranque simultáneo y respuesta del canal posterior al plazo.

**4. Lo que no comprobé**

No ejecuté «Duplicar pestaña» desde la interfaz del navegador ni cierre y restauración real del navegador. Tampoco reproduje congelación real de una pestaña, recarga simultánea o copia que termina de cargar antes que la original: esas carreras se analizaron por lectura; la demora de 800 ms fue inducida.

Las 70 combinaciones usaron respuestas controladas sobre `enviar`, no 70 recorridos completos. No ejecuté mutaciones de código, fallos de almacenamiento ni todas las intercalaciones concurrentes. No hice una revisión nueva del bloque.

