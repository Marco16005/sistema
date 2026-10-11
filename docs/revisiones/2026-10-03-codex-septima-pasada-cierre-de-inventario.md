# Séptima pasada de Codex: cierre del bloque de inventario (3 de octubre de 2026)

Modelo `gpt-6-astra`, esfuerzo alto, con ejecución. Se le pidió no modificar archivos del proyecto.
Es la primera parte de una corrida con dos encargos; la segunda, la revisión del plan de
despliegue, está en `2026-10-03-codex-revision-del-plan-de-despliegue.md`. Verifica lo que se
cambió en respuesta a su sexta pasada (`2026-10-03-respuesta-a-la-sexta-pasada.md`). Informe
completo, tal como lo entregó.

**Veredicto: da el bloque de inventario por cerrado para pasar al despliegue.**

La respuesta está en `2026-10-03-respuesta-a-la-septima-pasada.md`.

---

**PARTE 1 — Cierre del bloque de inventario**

**1. Qué ejecuté y con qué resultado**

| Ejecución | Resultado |
|---|---|
| Batería con el comando indicado y `PG_PLANTILLA=feruga_plantilla_codex` | **535 aprobadas; cero fallidas** |
| `docker compose --profile recorrido run --rm recorrido npx playwright test` | **104 aprobados; uno omitido**, el de capturas |
| Siete exploraciones propias, con Chromium y la bandera de origen seguro indicada | **Siete aprobadas** |

Las exploraciones se ejecutaron después de terminar los recorridos, sin compartir simultáneamente su base. Una primera invocación exploratoria no encontró pruebas por un filtro demasiado restrictivo; corregí el filtro y ejecuté las siete.

No modifiqué archivos dentro de `feruga`, instalé dependencias ni reconstruí imágenes. Eliminé los guiones temporales y mi plantilla. Las pruebas limpiaron sus bases; restablecí la base de recorridos desde su plantilla existente.

**2. Los tres puntos**

| Punto | Estado | Reproducción y resultado |
|---|---|---|
| Error del candado interpretado como propiedad | **Corregido** | Pasó el recorrido que rechaza `LockManager.prototype.request` con `SecurityError`. Además probé un `SecurityError` síncrono y un `AbortError` rechazado antes del plazo, tanto en copia como al recargar la dueña. Tras nueve solicitudes fallidas por caso, seguían intactos almacenamiento e identificador, sin captura en Inventario ni Mostrador. Al restablecer el candado, la dueña recuperaba lo suyo y la copia descartaba lo heredado. Resultado final: **una merma y 490 kg**. |
| Marco del mismo origen que borraba el pendiente | **Corregido** | Pasaron las dos variantes con merma pendiente: cabeceras presentes y cabeceras retiradas para ejercitar la defensa interna. El identificador y la captura permanecieron intactos. Retirar el marco y recargar permitió reintentar con **el mismo cuerpo**, dejando un solo asiento. |
| Prueba simultánea que recogía dos veces la misma página | **Corregido** | El recorrido recoge dos páginas distintas, exige tres páginas totales y tres identificadores diferentes. Ambas copias descartan la captura; la original la conserva al recargar y registra una sola vez. |

También comprobé:

- Dos errores pasajeros seguidos de adquisición automática, conservando el identificador.
- Una copia todavía dudosa que adquiere legítimamente el candado al cerrar la original y recupera el pendiente idéntico.
- Repetir «Volver a comprobar» mientras persiste el error: no habilita captura ni borra datos.
- Impresión con ambas cabeceras: hubo un evento `beforeprint` y se generó un PDF de **58 835 bytes**. [Ticket.tsx:34] imprime la página mediante `window.print()`.

**3. Hallazgos nuevos, por gravedad**

**No encontré defectos funcionales nuevos que impidan el cierre.** En los caminos ejecutados no apareció captura habilitada durante la duda, recuperación permanentemente bloqueada después de restablecer el candado ni liberación indebida mediante el botón.

**Menor — Falta conservar el aborto ajeno al plazo como regresión permanente.** Por lectura, [inventario.spec.ts:803] induce únicamente `SecurityError`.

Reproducción adicional ejecutada: preparar Cartón, 10 kg, «Mojado», sobre 500 kg; sustituir `LockManager.prototype.request` por un rechazo inmediato con `new DOMException("prueba", "AbortError")`; abrir una copia o recargar la dueña; reintentar dos veces; restablecer la implementación original y volver a comprobar.

**Observado:** conservación y recuperación correctas. **Propuesta:** incorporar ambas variantes a la batería permanente, incluida la recuperación posterior. Es una mejora de cobertura, no un fallo actual.

**4. Veredicto de cierre**

**Sí doy por cerrado el bloque de inventario para pasar al trabajo de despliegue**, en el entorno previsto de HTTPS y navegador con Web Locks. Los tres impedimentos de la sexta pasada quedaron corregidos; la batería completa no da motivos para reabrir las correcciones anteriores de cancelación, RC012 y confirmación.

Quedan como límites anotados:

- Una copia que ya descartó la captura no ofrece transferencia posterior desde la original.
- La alternativa sin candados no garantiza exclusividad.
- El plazo de un segundo no tiene una garantía universal de liberación.
- Persisten los límites de cobertura sobre almacenamiento, navegadores y restauración de pestañas.

Cerrar inventario **no equivale a aprobar todavía la salida a producción**.

