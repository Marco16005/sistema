# Sexta pasada de Codex sobre el bloque de inventario: el candado entre pestañas (3 de octubre de 2026)

Modelo `gpt-6-astra`, esfuerzo alto, con ejecución. Se le pidió no modificar archivos del proyecto.
Es la pasada que no se pudo hacer en la madrugada por cuota
(`2026-10-03-codex-sexta-pasada-no-realizada.md`). Verifica lo que se cambió en respuesta a su
quinta pasada (`2026-10-02-respuesta-a-la-quinta-pasada.md`). Informe completo.

La respuesta está en `2026-10-03-respuesta-a-la-sexta-pasada.md`.

---

**Las dos reproducciones de la quinta pasada quedaron corregidas. No daría todavía el cierre: encontré dos fallos adicionales en `pestana.ts` y una prueba que no verifica las dos copias que anuncia.**

## 1. Ejecución y resultados

- Batería con el comando indicado y `PG_PLANTILLA=feruga_plantilla_codex`: **535 aprobadas, cero fallidas**.
- Recorridos con el comando exacto indicado: **100 aprobados, uno omitido**.
- Exploraciones propias: demora de avisos, copias, congelación, recarga, bfcache, restauración del navegador, errores del candado, `iframe` y mostrador. Resultados abajo.
- Dos diagnósticos propios necesitaron ajustar la espera de navegación y una consulta SQL; repetí los casos afectados.

No modifiqué archivos dentro de `feruga`, instalé dependencias ni reconstruí imágenes. Eliminé mis guiones, perfil de navegador y plantilla; las bases de pruebas quedaron eliminadas y la base de recorridos, restablecida desde su plantilla.

## 2. Los cinco puntos

| Punto | Estado | Reproducción y resultado |
|---|---|---|
| **1. Avisos demorados** | **Corregido** | Demoré únicamente `viva` **800 ms**, abrí la copia y esperé 1400 ms. Original: podía registrar. Copia: sin captura ni botón para hacerlo. Resultado: **una merma, 490 kg**. Comprobé `isSecureContext === true`, `typeof navigator.locks === "object"` y candados exclusivos realmente adquiridos mediante `locks.query()`. |
| **2. Candado y ciclo de vida** | **A medias** | Recargas, navegación interna, congelación, copias y restauración funcionaron en los casos ejecutados. **Un rechazo del candado permite duplicación; un `iframe` borra la captura de la original.** Detalles debajo. |
| **3. Mostrador** | **Corregido, con límite operativo** | Repetí Compra, Cartón, Báscula 2, **10 kg**, `window.open('/mostrador')`, con y sin envío fallido. La copia no ofreció agregar ni reintentar; la original dejó **un solo renglón de 10 kg**. |
| **4. Pruebas de esta ronda** | **A medias** | Pasaron todas las solicitadas, incluidas las cinco confirmaciones retenidas. Pero «dos copias abiertas a la vez» obtiene **la misma página en ambas variables**: puede pasar sin comprobar una segunda copia. |
| **5. Cierre para despliegue** | **A medias: aún no lo cerraría** | Corregiría el tratamiento de errores del candado y protegería el arranque dentro de marcos antes del cierre. La prueba simultánea debe ajustarse para acreditar esa corrección. No encontré motivo para reabrir las correcciones anteriores de RC012, cancelación y confirmación. |

Precisiones del **punto 2**:

- **a) Recarga:** pasaron las veinte recargas de inventario y diez de mostrador. Además, conservé captura e identificador con un `beforeunload` ocupado **1400 ms**, CPU ralentizada seis veces y regreso efectivo desde **bfcache** (`pageshow.persisted === true`). La recarga de 1453 ms no consumió indebidamente el plazo: el trabajo previo a abandonar la página no equivale a esperar el candado desde la página nueva. No reproduje pérdida por superar los 1000 ms. La especificación dispone liberar candados al descargar el documento, pero no establece esa cota temporal; por tanto, estos resultados no prueban un máximo universal. (Web Locks, terminación: https://www.w3.org/TR/web-locks/#termination)
- **b) Otra pantalla o segundo plano:** Mostrador pasó en el recorrido; comprobé Precios y congelación mediante CDP. El candado continuó adquirido y la original recuperó su formulario.
- **c) Tres pestañas:** dos páginas distintas, cargadas simultáneamente con el almacenamiento heredado, descartaron la captura y adquirieron identificadores diferentes. También pasó una copia de otra copia que ya tenía una captura propia.
- **d) Restauración:** cerré Chromium con un perfil persistente y lo reabrí con restauración de sesión. Recuperó **el mismo identificador, formulario y candado**. No ejecuté Ctrl+Shift+T.
- **e) Error:** un `SecurityError` inducido dejó registrar en ambas pestañas. Un `AbortError` inducido se interpretó como copia aunque no procediera del temporizador propio.
- **f) Ventana emergente:** funcionó. **`iframe` del mismo origen:** eliminó el almacenamiento compartido con la original.

Sobre **soltar todo el mostrador**: la cuenta y lo ya asentado siguen en el servidor. Por lectura, se pierde la selección local y puede elegirse otra cuenta abierta. Comprobé que una segunda pesada de **3400 kg** quedó únicamente en la original; cerrarla no transfirió esa captura a la copia. Lo mismo limita la recuperación de un envío pendiente: si no llegó, su contenido no puede recuperarse del servidor; si todavía viaja, la copia ya no conserva su UUID. Es un límite operativo que debe quedar anotado, no una transferencia de control garantizada.

Las cinco pruebas de confirmación ahora comprueban pendiente, cuerpo idéntico, ausencia de éxito mientras se retiene la confirmación y su desenlace. Por lectura, cubren el defecto anterior de anticipar éxito o liberar la captura. **No repetí las mutaciones** descritas en la respuesta.

## 3. Hallazgos nuevos, por gravedad

### Media — Un error al pedir el candado se trata como adquisición satisfactoria. Comprobado ejecutando con fallo inducido.

Archivo: `src/componentes/pestana.ts:113`.

Reproducción:

1. Preparar merma de Cartón, **10 kg, Mojado**, sobre 500 kg.
2. Antes de cargar la copia, hacer que `LockManager.prototype.request` devuelva `Promise.reject(new DOMException("prueba", "SecurityError"))`.
3. Abrir `/inventario` desde la original y registrar en ambas.

**Observado:** mismo identificador de pestaña, dos formularios habilitados, solo la original tenía el candado. Resultado: **dos mermas y 480 kg**. No provoqué ese error mediante una configuración real del navegador.

**Corrección propuesta:** distinguir adquirido, ocupado e indeterminado. Un error inesperado debe conservar los datos **sin habilitar su envío como propietario confirmado**, ofrecer recuperación y reintentar la adquisición. Identificar además el aborto del temporizador propio, en vez de clasificar cualquier `AbortError` como prueba de copia.

### Media, condicionada a uso en marcos — El `iframe` borra el pendiente de su propia pestaña. Comprobado ejecutando.

Archivo: `src/componentes/pestana.ts:116`, con eliminación en `src/componentes/pestana.ts:69`.

Reproducción:

1. Preparar la merma anterior y abortar su POST para dejar un pendiente.
2. Insertar en esa página un `iframe` con `src="/inventario"`.
3. Esperar a que cargue, retirar el marco y recargar la original.

**Observado:** el marco compartía `sessionStorage`, pero competía por el candado como otro documento. Borró `feruga.inventario`, cambió `feruga.pestana` y la original perdió el pendiente al recargar. Quedaron **cero mermas y ninguna opción de reintentar**.

**Corrección propuesta:** si no se admite operar dentro de marcos, impedirlo antes de inicializar sesión/capturas y mediante `frame-ancestors 'none'`. Si se admite, compartir la coordinación con la ventana superior; no tratar el marco como copia independiente.

### Baja — La prueba simultánea verifica dos veces la misma copia. Comprobado ejecutando.

Archivo: `recorrido/inventario.spec.ts:782`.

Reproduje exactamente sus dos llamadas concurrentes a `abrirCopia`: **`una === otra` dio `true`**; en esa ejecución solo existían original y una copia. Ambas esperas de `context.waitForEvent("page")` recibieron el mismo evento.

**Corrección propuesta:** recoger dos páginas distintas, exigir tres páginas totales y `una !== otra`, y comprobar captura e identificador de cada una. Actualmente pasaría aunque la segunda apertura no ocurriera o una segunda copia conservara la captura.

## 4. Lo que no comprobé

No ejecuté duplicación desde el menú, Ctrl+Shift+T, recuperación tras caída del navegador ni otros motores. La restauración real cubrió una captura sin envío pendiente. No reproduje naturalmente una liberación del candado que excediera un segundo, ni fallos de `sessionStorage`. Tampoco agoté todas las intercalaciones concurrentes ni hice una revisión nueva del bloque.
