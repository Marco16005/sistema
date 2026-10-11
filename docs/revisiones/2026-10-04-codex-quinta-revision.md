# Quinta revisión de Codex: los planes, el rediseño, publicar y respaldos (4 de octubre de 2026)

Modelo `gpt-6-astra`, esfuerzo alto. Partes A, E y D por lectura; parte C con ejecución (una
batería y reproducciones dirigidas), sobre una copia en `/tmp/feruga-codex-qa5/`.

**Quedó incompleta: se le acabó la cuota al empezar la parte B** (la cuenta activa a la vista),
que **hay que repetir**, igual que su comprobación final de que no cambió ningún archivo. Las
partes A, E, D y C sí las terminó y las guardó. Es el informe tal como lo entregó.

Esa comprobación final la hice yo con las huellas que Codex tomó al empezar
(`/tmp/feruga-codex-qa5-inicio-huellas.json`, 714 archivos): solo cambiaron los tres planes que
yo mismo ajusté mientras él seguía trabajando; ninguno más, y no falta ninguno.

**Veredictos.** A: los dos planes resolvieron sus bloqueantes; piden cuatro precisiones antes de
codificar. E: el plan del rediseño no se codifica como estaba; hay que cerrar tres contratos (la
hoja, lo impreso, cómo se comprueba). D: la versión 3 de publicar va por buen camino, con un
bloqueante en cómo se decide la recuperación. C: lo señalado en la cuarta revisión quedó
corregido, pero **la tarea 3 sigue sin cerrarse**, por dos huecos nuevos en la marca de
restauración.

La respuesta está en `2026-10-04-respuesta-a-la-quinta-revision.md`.

---

# Quinta revisión de calidad — Feruga

Orden y estado:
- [x] Parte A: planes precio especial y reapertura, versión 2.
- [x] Parte E: plan de rediseño.
- [x] Parte D: despliegue, tarea 5, versión 3.
- [x] Parte C: respaldo y restauración, ejecución.
- [ ] Parte B: cuenta activa.
- [ ] Verificación final de huellas y contenedores.

Trabajo exclusivamente en `/tmp/feruga-codex-qa5/`, copia sin `node_modules` ni `.next`. Huellas iniciales SHA-256 de todos los archivos regulares de `/Users/maantora/Desktop/feruga` en `/tmp/feruga-codex-qa5-inicio-huellas.json`. No se autoriza escribir en el original ni operar los contenedores del usuario. Pruebas con `PG_PLANTILLA=feruga_plantilla_codex`.

## Parte A — Planes versión 2 (completa; solo lectura)

Se contrastaron los dos planes, la respuesta y las migraciones 0003, 0005–0007, 0010–0018 y 0021–0023, además de dominio/dia, dominio/cierre, dominio/envios y la ruta de cierre. Los escenarios de esta parte son deducciones del contrato propuesto, no pruebas de una implementación que todavía no existe.

### Seguimiento de la cuarta pasada

| Hallazgo | Estado en versión 2 | Evidencia / pendiente |
|---|---|---|
| A-PE-B1 | Sí | Decisión 5: envío de quitar, resultado ligado al evento y evento observado. El reintento de quitar P1 no quita P2. |
| A-PE-I1 | A medias | Decisiones 1/3 y pruebas incluyen precios protegidos, relleno, cliente y cambios como propietario. Falta proteger explícitamente autorización/evento vigente y precisar la prueba del guardián (ver A5-PE-I1). |
| A-PE-I2 | Sí | Decisión 8: jornada de confirmación, kilos liquidables, diferencia entre importes redondeados, compras/ventas separadas, ajuste de cuenta excluido. |
| A-PE-I3 | Sí | Decisiones 2–5: resultado histórico independiente del renglón, nombre normalizado, baja, nombre congelado y vínculo del evento de quitar. |
| A-PE-I4 | A medias | Decisión 7 elige jornada abierta hoy y conserva lista del vehículo; decisión 6 fija un orden. Falta la revalidación temporal después de las esperas, no cubierta por usar jornada_abierta (ver A5-PE-I2). |
| A-PE-I5 | A medias | Clave mala sin excepción, repetición sin clave, reserva y relectura quedan bien; falta incluir explícitamente el evento observado en el contenido inmutable y aclarar que quitar no pasa por clave (ver A5-PE-I3). |
| A-PE-M1 | A medias | Significado de “hubo” y alcance del comprobante resueltos; lista ampliada, pero propone 0023, ya ocupada. |
| A-RE-B1 | Sí para reabrir | Jornada+cierre observado+envío impiden reabrir C2 por una orden de C1. Queda el problema simétrico del cierre actual, A5-RE-I1. |
| A-RE-I1 | Sí en el contrato | Unicidad por cierre, misma transacción, todos los demás campos iguales y nuevo número al recerrar. Al implementar, el número debe aumentar bajo candado y no poder retroceder; migrar cierres preexistentes y probar el registro aislado. |
| A-RE-I2 | Sí | La explicación ya distingue libros de borradores; la prueba incluye segunda pesada, descuento y descarte con día cerrado. |
| A-RE-I3 | Sí | Reloj real después del candado, zona de sucursal y clave fallida que confirma el contador. El instante de aceptación es esa comprobación, no la hora posterior del commit. |

### Hallazgos y ajustes antes de codificar

**A5-RE-I1 · Importante — La orden antigua de cerrar sí puede cerrar la reapertura.** Secuencia: A manda cerrar, se confirma C1 y se pierde la respuesta; B reabre C1; llega un segundo intento de A (o una orden atrasada de otra pestaña) y cierra C2. Evidencia: `src/app/api/jornada/cerrar/route.ts` no recibe jornada ni generación ni envío; `dominio/cierre.ts` llama `cerrar_jornada_abierta(usuario)`; `0014_dia.sql:33–39` elige la abierta en ese momento. La versión 2 protege solo reabrir. Puede cerrar incluso una jornada posterior si una solicitud queda retenida. No desaparecen cobros, pero se revierte una reapertura autorizada y se vuelve a parar la atención. Cambiar también cerrar: envío y resultado original, jornada y generación abierta observada, comprobados bajo candado; no elegir “la que esté abierta” al ejecutar una petición vieja. Añadir cerrar → respuesta perdida → reabrir → reintentar y dos pestañas. Precisar que un mismo envío de reapertura devuelve su éxito original incluso tras C2; una petición NUEVA dirigida a C1 se rechaza: las dos frases actuales de las tareas no deben hacer fallar la idempotencia.

**A5-PE-I1 · Importante — El permiso excepcional del guardián sigue siendo demasiado resumido.** La decisión 1 acepta un evento del mismo renglón y precio en la misma transacción. Secuencia a ensayar como propietario sin apagar reglas: dar P1 → dar P2 → actualizar directamente a P1 reutilizando el evento anterior de esta transacción; o modificar solo `precio_autorizado_por`/el indicador de evento vigente, sin tocar el importe. El contrato actual no exige consumo ni que coincidan precio anterior, evento anterior, cliente y autorizante. Pedir una transición exacta y de un uso, proteger los metadatos que determinan qué precio está vigente y quién lo autorizó, y probar UPDATE directo e inserción de evento aislado. El importe y la subida de revisión existentes deben conservarse.

**A5-PE-I2 · Importante — “Hoy” no lo garantiza el auxiliar actual.** `0003_jornada_precios.sql:19–29` devuelve cualquier jornada abierta, sin fecha ni candado. Una solicitud puede esperar en reserva/jornada/cuenta hasta después de medianoche. El plan nombra ese cruce como prueba, pero no fija la regla de aceptación como sí hace reapertura. Pedir fecha real en zona de sucursal tras las esperas y releer cierre bajo candado. Especificar modo de candado: las rutas actuales toman cuenta antes de jornada (`0005:137–145`, `0007` y movimiento de `0006:97`); si precio toma jornada FOR UPDATE antes de cuenta, puede formar un interbloqueo con ellas. FOR SHARE puede coordinarse con las lecturas actuales y excluir cierre, pero hay que justificar el orden completo y probarlo con barreras, no afirmar que ya es el orden de todas las funciones.

**A5-PE-I3 · Importante — Completar el contenido de los dos envíos.** La decisión 6 enumera cliente/diferencia/renglón/cuenta/autorizante, pero omite el evento observado de la decisión 5. Debe incluirlo, junto con la clase de acción: reutilizar el mismo UUID con otro evento visto es otro contenido. La secuencia genérica “comprueba la clave” debe aplicarse solo a dar; quitar no pide autorización nueva y conserva la original en su evento. Al consultar un resultado existente se valida primero todo su contenido, sin depender de que aún exista el renglón. Añadir las variantes de contenido distinto y cancelación que gana a una solicitud todavía en camino.

**A5-A-M1 · Menor — Numeración y actualización de contratos compartidos.** Precio propone `0023_precio_especial.sql`, pero ya existe `0023_vida_de_las_tablas.sql`: usar el siguiente número libre y ordenar la otra detrás. Los ejemplos de `RC012` tampoco coinciden con `reservar_envio` de 0018 (cancelado/contenido distinto: `RC005`): decidir si se conserva el contrato o se cambia con toda la matriz, no modificarlo de paso. Reapertura debe enumerar también cerrar, tipos/reporte, clases y resultados de envío, permisos y retrato.

### Cruces, restauración y orden

Los modelos monetarios no se contradicen: precio especial usa la lista fijada del renglón y exige hoy abierto; reapertura conserva esa lista y vuelve a habilitar la misma jornada. Un cambio en vehículo pendiente no reescribe lo ya confirmado del cierre. Si gana cerrar, precio se rechaza; si gana precio, su cambio y revisión quedan confirmados antes del cierre. Si después gana reabrir, una petición NUEVA de precio puede operar; no se reinterpreta el resultado de una antigua.

Restaurar debe invalidar las sesiones previas antes de evaluar envíos, pues el respaldo puede no contener un evento que el navegador recuerda. El retrato incluye clientes, nombre congelado de cuenta, eventos, resultados, número de cierre y reaperturas. La reapertura restaurada no autoriza otra transición por coincidir accidentalmente el identificador de transacción: además debe ser del cierre vigente y este no debe retroceder. El registro conserva la historia del respaldo, no los hechos posteriores.

No existe dependencia funcional que obligue a precio antes de reapertura. Conviene cerrar primero el contrato común de jornada/generación/envíos y el cierre dirigido, implementar reapertura y luego precio; renumerar y revisar cada reemplazo de funciones para no sobreescribir el trabajo del otro plan. Las pantallas esperan la base visual de E.

**Veredictos:** precio especial **no codificar literalmente todavía** (precisar los tres contratos importantes); reapertura **no codificar literalmente todavía** (incluir el cierre antiguo). Los bloqueantes originales están resueltos en el diseño; estos ajustes no piden un subsistema nuevo.

## Parte E — Rediseño (completa; solo lectura)

Se leyó el prototipo local, el plan, layout/globals, Mostrador/Ticket/Autorizar/SoloEnSuPestana/pestana, ruta y recorridos; los paquetes se leyeron directamente en `/Users/maantora/node_modules/@ios27_design_system/`. Para /react se inspeccionaron el código distribuido y las fuentes incluidas en `dist/index.js.map`, no solo las fichas. Se usaron como apoyo las guías locales emil-design-eng y mobile-native. No se instalaron paquetes ni se renderizó una interfaz rediseñada inexistente.

**Veredicto: no codificar el plan literalmente todavía.** La intención y la separación de tareas sirven; hay que cerrar los contratos de modal, impresión y comprobación antes. No hace falta cambiar el flujo de negocio ni introducir una biblioteca de gestos.

### Hallazgos

**E-I1 · Importante — “Solo marcas y clases” no garantiza conservar el comportamiento.** Secuencia: una captura pendiente vive en el árbol de Mostrador/Autorizar; se abre o cierra una hoja, se cambia contraste o breakpoint, el contenedor sustituye/remonta sus hijos y se pierde estado local, o se vuelve a ejecutar un efecto. `SoloEnSuPestana` no monta la captura hasta acreditar propiedad; debe seguir envolviéndola incluso si se pinta por portal. `Ticket` llama `window.print()` al montar con una impresión y al cambiarla: un remontaje puede volver a imprimir. Mantener identidad de componentes/keys y un solo árbol para ancho/angosto, sin mover estados ni montar capturas detrás de una barrera meramente visual. Una hoja debe recibir del dueño el estado de cierre permitido, distinguiendo ocupado de envío incierto; Escape, botón, velo, navegación y cambios de tema no pueden liberar el envío. “Cancelar/resolver” debe ejecutar el mecanismo actual, no solo ocultar. Verificar memoria y UUID, no solo que se vea el mismo texto.

**E-I2 · Importante — La evaluación de /react ya tiene resultados, y no cumple por defecto lo que se le atribuye.**

| Pieza / antes | Después propuesto | Evidencia y motivo |
|---|---|---|
| Sheet 1.0.0 como hoja del negocio | Hoja propia; o adaptación explícita probada, sin gestos ni cierre implícito | `close()` llama `setOpen(false)` y `onClose` incluso si el padre no acepta cerrar; backdrop y Escape lo invocan. `grabber=false` solo oculta la pastilla: los handlers siguen en `.ios27-sheet-handle`. El desplazamiento con transform ocurre antes de aceptar o vetar el cierre. No basta ignorar `onChange`. |
| Alert 1.0.0 para autorizar/cobrar | No usar directamente para una operación pendiente | `handleAction` llama la acción y luego `close()`, sin esperar una promesa; `AlertAction` no ofrece disabled/loading. Se puede controlar open desde fuera, pero aún hay que bloquear cada acción y todos los caminos de cierre. |
| SegmentedControl para los pasos | Conservar botones de pasos y sus disabled/aria-current, restilados | Solo recibe textos e índice, selecciona al mover flechas y no tiene disabled por segmento. El actual `.prog` bloquea materiales/báscula/cuenta según jornada y envío pendiente. Cambiarlo por tabs cambia teclado, papel accesible y navegación. |
| Toggle para contraste | Es candidato viable, controlado y agrandado; un botón propio equivalente es más pequeño | Usa botón nativo, role=switch, aria-checked y disabled, admite nombre. Su geometría propia requiere sobrescritura; probar etiqueta, teclado y error de guardado. |
| useFocusTrap como garantía completa de modalidad | Verificar foco inicial, retorno, fondo inerte y desplazamiento | Atrapa Tab y restaura foco; no vuelve inerte el fondo ni bloquea su scroll; sin controles no da tabIndex al contenedor. Varias trampas escuchan Escape a nivel document. No basta aria-modal para impedir acceso por lector de pantalla ni interacción programática con el fondo. |

El paquete declara compatibilidad con React 18/19, que incluye el React 19.3 del proyecto; eso no acredita SSR/hidratación. Portal devuelve null en servidor y usa document.body en cliente; probar hoja inicialmente abierta tras recuperar una captura, StrictMode y disparador que desaparece. Envolver desde una frontera `use client`; no inferir compatibilidad completa de peerDependencies. `styles.css` de /react define también variables globales propias (`--color-blue`, `--bg-*`, etc.), tipografía y materiales: no se alimenta automáticamente de la capa `--ios27-*` del paquete tokens. Su material thick aplica vidrio a hoja/alerta, contrario a la superficie de lectura sólida elegida. Añadir otro puente y toda esa CSS por un interruptor tiene poco beneficio.

**Decisión 2 recomendada:** usar los valores de tokens 1.0.2 detrás de la capa del negocio y metadata como referencia. Para esta aplicación, componentes nativos/propios pequeños son preferibles a Sheet/Alert/SegmentedControl 1.0.0. No encontré en las piezas inspeccionadas una operación de dinero o red escondida; el riesgo demostrado es de interacción y de estilos, no una acusación al autor. Una copia pequeña y atribuida de los valores usados (versión, procedencia y licencia MIT) reduce aún más dependencias, pero se debe explicar ese ajuste al pedido de usar los paquetes: tampoco conviene copiar toda la biblioteca. Mantener tokens como dependencia CSS exacta también es razonable y respeta literalmente ese pedido. Fijar versión/lock no sustituye verificar el artefacto ni sus estilos. No instalar /react entero solo porque ya estaba disponible fuera del proyecto.

**E-I3 · Importante — La promesa de impresión idéntica contradice retirar sus fuentes.** `globals.css:185–192` usa `--f-num` (Roboto Mono) en `.ticket`; `@media print:262–267` cambia posición/ancho 72 mm, pero hereda fuente, tamaños y composición. Retirar Roboto Mono y cambiar la base altera saltos, longitud y papel aunque los importes sean idénticos. Decidir: conservar una fuente local y CSS de impresión aislados, o aceptar expresamente un cambio de presentación impresa con datos idénticos; lo segundo cambia el alcance aprobado. Capturar línea base de impresión ANTES de tarea 1, también cierre, ticket largo, venta, descuento y reimpresión. Probar que una hoja/portal/transform/overflow no recorta ni desplaza la impresión, que nunca se imprimen clave o velos y que contraste/tema no cambia el papel. Comparar contenido y geometría del PDF/vista de impresión, no solo pantalla.

**E-I4 · Importante — Faltan contratos verificables para el contraste recordado.** La cookie de primera parte puesta por servidor es una opción correcta; la ruta sin sesión no necesita permisos comerciales si solo modifica esa preferencia. Definir cookie separada de autenticación, persistente (Max-Age/Expires), host-only, Path=/, SameSite y Secure en HTTPS; HttpOnly es posible si toda escritura pasa por servidor. Validar enum, JSON y origen configurado incluso sin sesión; no aceptar nombre de cookie, CSS o ruta arbitrarios. No firmar ni guardar esta preferencia en la base de dinero: no otorga privilegios. Cookies ausentes/malformadas equivalen a “sin elección”. Tres estados: ausente sigue prefers-contrast; normal explícito gana al equipo; alto explícito fuerza superficie clara sólida incluso bajo dark. La página debe variar por cookie sin una caché compartida de HTML que imponga la elección de otro navegador.

Secuencia faltante: activar → falla la respuesta de red → tocar otra vez → llegan respuestas invertidas. Serializar la escritura o bloquear brevemente el interruptor y reconciliar; no mostrar “recordado” si solo cambió CSS local. Actualizar el atributo raíz sin recargar/desmontar capturas ni reiniciar la pestaña dueña. La preferencia es por navegador/perfil/origen, no por todo el equipo físico. Cerrar sesión no debe borrarla. La ruta común `ruta({acceso:'publico'})` hoy exige baseApta antes de todo: decidir si contraste debe funcionar también cuando la base está indisponible/mantenimiento; si se hace independiente, conservar comprobación de origen/forma.

Safari no impone universalmente siete días desde cada guardado: WebKit documenta siete días de uso de Safari SIN interacción con ese sitio para almacenamiento escrito por script. LocalStorage sería más simple y sobrevive normalmente a cerrar sesión/app/reiniciar, pero no ofrece la misma permanencia tras inactividad ni SSR sin parpadeo. Para conservar ambos requisitos, la cookie del servidor es proporcionada. Tampoco es garantía perpetua: limpieza de datos, navegación privada y políticas contra terceros disfrazados pueden eliminar/limitar almacenamiento. No hace falta añadir otro sistema para eso. Fuentes primarias: [WebKit: prevención de seguimiento](https://webkit.org/tracking-prevention/) y [alcance de los siete días](https://webkit.org/blog/10218/full-third-party-cookie-blocking-and-more/).

**E-I5 · Importante — Conservar clases no conserva por sí solo el significado de 109 recorridos.** `.cta[aria-pressed=true]`, grupos con nombre, `.flag[role=alert]`, botones deshabilitados, orden de elementos y ámbitos de búsqueda son parte de las afirmaciones actuales. Un portal puede sacar un control de su scope; duplicar vista móvil y escritorio puede duplicar localizadores; sustituir buttons por tabs cambia getByRole; pointer-events:none no equivale a disabled para teclado. Mantener contratos semánticos y unicidad además de clases; cambiar un selector solo con una explicación de equivalencia, sin ampliar regex, añadir first(), force o esperas para tapar regresiones. Los 109 prueban ejemplos funcionales, no foco modal, orden de lectura, todos los modos ni impresión. Añadir pruebas dirigidas de esas invariantes.

**E-M1 · Menor — Resolver dos ambigüedades antes de repartir tareas.** Decisión 6 debe decir “respuesta VISUAL al apoyar el dedo”: registrar/cobrar sigue ocurriendo en click/activación válida, no en pointerdown (arrastrar para cancelar un toque no debe cobrar). Decisión 8 permite fundido con movimiento reducido y tarea 7 dice que no se anima: elegir una sola expectativa. El prototipo tiene botones de 44–54 px y textos de 13–16 px; es referencia de lenguaje, no geometría para copiar literalmente contra los mínimos de 60/17.

### Pruebas y orden

1. Tarea 1: primero línea base visual e impresa; pruebas de contrato de Botón/Hoja (type=button, disabled, refs, Tab/Shift+Tab, Escape permitido/prohibido, fondo inerte, retorno si el disparador ya no existe), contrastes calculados con alfa compuesto y estilos efectivos. Verificar foco/bordes/estados de error/selección, no solo texto normal; alto bajo SO oscuro y ausencia de backdrop-filter. El CSS de materiales “menos transparencia” reduce una variable, no demuestra barra completamente sólida: comprobar el resultado.
2. Tarea 2: añadir origen ajeno, cookie persistente, cierre y reapertura de contexto conservando perfil, normal explícito frente a prefers-contrast, cambio del SO, red fallida y dos pestañas. No afirmar que una recarga acredita un reinicio real.
3. Tarea 3: validar toda superficie táctil, incluido quitar, pasos, autoriza otra persona y navegación; 360 px, rotación, zoom/texto aumentado, números extremos/nombres largos y 10 cuentas de ambos grupos. Comprobar activa geométricamente y teclado accesible, conservando envío/propiedad al cambiar tema.
4. Tarea 4: lo impreso y el efecto print se comprueban desde la tarea 1 y al integrar; no esperar a tarea 4 para descubrir que la fuente ya cambió.
5. Tareas 5/6: no dejar pruebas en blanco: cierre, vehículo pendiente, lista publicada, validaciones, respuesta perdida/502, cancelación que compite y autorización incierta en hoja. Capturas de estados de error y pendiente, no solo pantallas limpias.
6. WebKit debe entrar temprano, al validar la hoja y la propiedad de pestaña. `playwright.config.ts` actual usa channel=chromium y una bandera de origen seguro que WebKit no admite: crear configuración por motor y usar HTTPS fiable, sin degradar los candados para que pase. Un humo al final no cubre teclados, envío incierto, recarga ni pestaña duplicada. Añadir esos pocos cruces críticos en WebKit; Chromium no sustituye Edge/Chrome Windows ni Safari real.
7. Tarea 8: guion breve y registrable en iOS, Android y Windows con versiones: teclado abierto, retrato/paisaje, barra del navegador y safe areas, zoom, toque cancelado/doble toque, sol/contraste, lector de pantalla/foco, scroll de hoja sin mover fondo, salida/entrada y reinicio conservando preferencia, impresión real. No doy esos equipos por verificados.

La batería completa de recorridos tras cada entrega integrada es razonable; no hace falta repetirla por cada variable CSS ni ejecutar todos los casos en todas las combinaciones de modo/tamaño/motor. El cálculo de contraste no sustituye inspección de composiciones, y las capturas no sustituyen aserciones. Adelantar la hoja y la adaptación de Autorizar desde tarea 6 a tarea 1 (al menos su contrato probado): precio/reapertura dependen de ambas, no solo de una caja vacía. Después pueden implementarse las pantallas nuevas con estas piezas; base/servidor de A no dependen de E. Integrar por tareas, no editar simultáneamente los mismos Mostrador, Cierre y Autorizar.

## Parte D — Publicación, diseño versión 3 (completa; solo lectura)

**Veredicto: la simplificación es buena, pero todavía no codificar literalmente la recuperación.** No hace falta regresar al diario complejo de versión 2. Faltan una tabla de decisión excluyente, un contrato breve de activación y el cierre de las salidas operativas. Son defectos de especificación; no se ejecutó un publicador que todavía no existe.

### Seguimiento

| Hallazgo anterior | Estado | Evidencia / pendiente |
|---|---|---|
| D-B1 | A medias | B7 marca intención antes de abrir y D prohíbe volver desde ahí; falta prioridad explícita entre casos solapados, conciliación base/archivo y apertura SQL condicionada (D5-B1). |
| D-B2 | Sí en su regla principal | Marca previa a arrancar; reconoce hijo vivo, efectos no reversibles y prohíbe repetir a ciegas. Falta especificar cómo termina ese hijo antes de una salida deliberada (D5-I1). |
| D-B3 | A medias | Identidad de base/restauración, manifiesto remoto y base aparte resuelven el concepto. Sigue sin definir activación interrumpida ni cómo iniciar recuperación sin manifiesto local frente a la prohibición general de C (D5-I2). |
| D-I1 | Sí en el diseño | H separa primera instalación y versión mínima; A/B6 distinguen lista/abierta e incluyen escritura válida sin efecto. |
| D-I2 | Sí | G sella desde vigente, declara confianza inicial y revalida bajo candado. Coordinar toda entrada manual de migración con el mismo exclusor operativo, para que ese candado no sea la única coordinación. |
| D-I3 | A medias | Manifiesto vincula configuración/imágenes y conserva copias externas; falta comprobación inicial del conjunto realmente vigente y exigir la copia de Compose/entorno, no solo su huella (D5-I3). |
| D-M1 | Sí | Decisión 6 ya separa CONNECT de apertura comercial y elimina levantar/abrir antes de comprobar. |

### Hallazgos

**D5-B1 · Bloqueante del contrato de recuperación — Los tres casos no son excluyentes y falta reconciliar la doble marca.** En una publicación normal que llegó a abrir, son ciertas “empezó migración” y “se decidió abrir”. El segundo caso de D permite restauración deliberada y el tercero la prohíbe como vuelta sin pérdida; el texto no da prioridad ni excluye apertura del segundo. Secuencia: B5 → B7 → B8 abre → se cobra → muere antes de cerrar el archivo → `--recuperar` entra por la primera condición verdadera de migración y ofrece el respaldo previo. Una implementación literal en ese orden perdería el cobro. Escribir una tabla excluyente: (3) intención/apertura probada en CUALQUIERA de base/manifiesto => solo adelante; (2) sin ninguna evidencia de apertura y con migración iniciada => cerrado, recuperación deliberada; (1) sin ambas => anterior. Discrepancias de identidad o falta de evidencia no se resuelven eligiendo el caso más permisivo.

Además, B7 modifica dos soportes sin transacción común. Definir orden durable y respuesta perdida: escribir intención de archivo, confirmar intención en base y solo después abrir mediante SQL que comprueba publicación, base/vida y conjunto autorizado. Si muere entre marcas, nunca volver; reconciliar hacia adelante bajo exclusión. “Escrito atómicamente” evita leer medio JSON, pero no promete persistencia tras corte eléctrico: fijar archivo temporal+sincronización+rename+sincronización del directorio, o declarar otra fuente durable de decisión que gobierne. Una base ya abierta con archivo incompleto nunca debe abrirse de nuevo genéricamente ni restaurarse por inferencia.

**D5-I1 · Importante — Las salidas deliberadas aún no tienen entrada admitida y exclusión de procesos.** C prohíbe `publicar.sh` mientras haya manifiesto sin cerrar, pero D2 ofrece “publicar versión corregida”. Definir que recuperación toma exclusión, confirma que padre/hijo migrador y sesión han terminado (esperar o detener y comprobar), y entrega explícitamente la publicación a una candidata corregida conservando identidad/historia/respaldo. No basta detectar que el hijo sigue vivo para empezar otra versión o apartar la base. El mismo exclusor debe cubrir dos recuperaciones, publicación, levantar y migración manual admitida; comprobar existencia de un archivo y luego crearlo no basta para dos procesos que llegan a la vez. No inferir que PID ausente del padre significa SQL terminado. Restaurar/reintentar una migración fallida no es una salida automática.

**D5-I2 · Importante — Apartar/restaurar/comprobar/abrir no define la activación.** Hoy `operacion/restaurar.ts` restaura con nombre nuevo y se niega si el definitivo existe. E debe decir qué nombre/URL usa la candidata, cuándo se cambia el destino efectivo del servicio, cómo se conserva la fallida y qué evidencia recupera una muerte entre renombrar/cambiar destino/comprobar. Una prueba HTTPS contra la conexión antigua no acredita la base nueva. Guardar identidad anterior y restaurada y el destino esperado; comprobar base+vida detrás de HTTPS antes de decidir abrir. La restauración crea una historia nueva: invalidar/sustituir deliberadamente el manifiesto viejo, nunca continuar sus fases. Para máquina perdida, dar entrada expresa de recuperación con respaldo+manifiesto externo y reconstrucción de estado local; C dice correctamente que ausencia no equivale a “libre”, pero debe distinguir esa entrada del publicador ordinario. Las versiones anteriores al mantenimiento no sirven para esta recuperación automática. No borrar la base fallida por rutina.

**D5-I3 · Importante — Reconciliar el vigente real y la configuración antes de cerrar.** B1 comprueba archivos/migraciones pero no exige que contenedores, destino de base, vida y configuración actuales coincidan con el anterior del manifiesto. Antes de publicar y de cada apertura, comprobarlos. Una huella sola no permite reconstruir el Compose anterior si el checkout ya cambió: conservar archivo/configuración efectiva privada y secretos requeridos por referencia o custodia, y verificar variables/montajes/comandos/red pertinentes. No reconfigurar PostgreSQL ordinariamente por reconstruir el mismo commit. Restaurar el servicio de respaldo tras recuperación/éxito, y registrar qué hacer si no arranca: B3 lo detiene pero B8 no lo repone explícitamente. La imagen y manifiesto remotos deben estar realmente disponibles, no solo figurar como IDs locales.

**D5-M1 · Menor — Acotar “ante cualquier interrupción se queda cerrado”.** Muerte en B1/B2 antes de mantenimiento deja atendiendo la versión anterior (el propio ensayo lo pide). Muerte después de abrir deja potencialmente abierto; una marca no ejecuta un cierre al morir el proceso. La promesa correcta es: antes del cierre no se altera lo vigente; desde cierre hasta apertura permanece cerrado; desde intención de abrir no se retrocede, y una apertura confirmada puede seguir atendiendo. No introducir un monitor solo para sostener esa frase.

### Fronteras antes/después del efecto

| Frontera | Estado que debe reconocer --recuperar |
|---|---|
| Preparar / escribir manifiesto | Antes: vigente atendiendo. Después del archivo y antes de cerrar: también puede atender. Caso 1 debe cerrar/drenar si necesita restablecer, comprobar y abrir con protocolo propio; no suponer que mantenimiento ya ocurrió. |
| Mantenimiento SQL, stop web, stop respaldo, drenaje | Respuesta perdida se resuelve consultando identidad+estado. Una solicitud admitida antes del cierre puede terminar: el respaldo se toma solo después del drenaje comprobado. Stop parcial no autoriza migrar. |
| Volcado/verificación y escritura de nombre | Objeto sin nombre registrado no demuestra B4 completado. Sin marca migración se puede volver al conjunto anterior conservando datos actuales; no hace falta restaurar. Si no se pudo registrar el respaldo, B5 no empieza. |
| Marca “empezó migración” / arrancar hijo / commit SQL | Antes de marca: caso 1; después de marca, incluso sin hijo: caso 2 conservador. Hijo vivo, commit con respuesta perdida y efecto no reversible permanecen en caso 2 hasta diagnóstico/salida expresa. No exigir distinguir estados indistinguibles para repetir SQL. |
| Levantar/comprobar candidata | Cerrado. Fallo o muerte sigue en caso 2; ningún HTTP 200 sustituye identidad/versión/vida y cerrada. |
| Intención archivo / intención base | Necesita D5-B1. Desde la primera intención durable: solo adelante; no dejar que “empezó migración” prevalezca. |
| Abrir SQL / respuesta / manifiesto cerrado | Confirmación perdida se consulta en la base. Si pudo cobrarse, se preserva esa base y se finaliza adelante. Validar que no cambió instalación/historia/conjunto desde comprobación. |
| Recuperación al anterior / abrir / cerrar registro | También necesita registrar la decisión y resultado propios antes de abrir; repetir recuperación no debe revivir una publicación vieja ni cambiar una base con actividad nueva. |
| Apartar/restaurar/activar | Contrato pendiente D5-I2. Archivo ausente/ajeno no autoriza automatización ni apertura. |

La versión 3 sí contiene las barreras necesarias para evitar pérdidas: cierre durable, drenaje, respaldo nombrado, migración conservadora y decisión irreversible. El agujero es cómo se decide/reconcilia/activa en recuperación, no que haga falta un orquestador mayor. Con la tabla excluyente y un registro mínimo de activación basta para un servidor pequeño. No añadir repetición universal de fases, reversión SQL automática ni alta disponibilidad. Mantener las pruebas de muerte real y compra posterior a apertura; son las que verifican la garantía económica.

## Parte C — Respaldo y restauración (completa; con ejecución)

**Veredicto: no se cierra todavía la tarea 3.** C-I1, C-I2, C-I3 y C-M1 de la cuarta pasada quedan corregidos en sus reproducciones concretas. Quedan dos límites adicionales reproducidos que el texto actual no cubre: restauración parcial que conserva `vida`, y adopción automática de una restauración del esquema 0022 sobre la misma base al migrar a 0023.

### Ejecución y alcance real

Una sola batería completa, secuencial, desde la copia y con `PG_PLANTILLA=feruga_plantilla_codex`: `docker compose --profile pruebas run --rm pruebas`. Se creó un proyecto **feruga_codex_qa5**, dos PostgreSQL 17 efímeros y almacenamiento de pruebas propio, sin puertos del usuario; dependencias existentes montadas en solo lectura. Comando interno `npm run tipos && npm test`, sin npm ci/install, sin construcción de Docker que los ejecute. Ninguna conexión a feruga-db-1 ni a su base feruga.

**Resultado exacto: tipos correctos; 608 pruebas ejecutadas, 607 aprobadas, 1 fallida; 87,93 s.** El fallo fue de mi preparación de QA: había sustituido el Compose de la COPIA por el aislado, y `pruebas/20-entorno.test.ts:188` inspecciona precisamente ese archivo para exigir `${BD_CLAVE:?...}` y otras variables. No fue un defecto del producto. Moví la configuración aislada a `qa5/compose.yml`, restauré byte por byte el Compose de la copia y ejecuté únicamente esa prueba: **1/1 aprobada**, 126 ms. No volví a correr la batería y no presento la corrida completa como 608/608 en verde. Evidencia: `qa5/bateria.log`, `qa5/compose-dirigida.log`, configuración final `qa5/compose.yml` (usar `COMPOSE_FILE=qa5/compose.yml`).

Después, reproducciones dirigidas secuenciales en bases desechables, sin ejecutar otro ensayo ni recorridos en paralelo. Guion `qa5/reproducciones.ts`, resultados estructurados `qa5/reproducciones.json` y registro `qa5/reproducciones.log`. Todas las bases de esas reproducciones se borraron en finally. Los volcados quedan solo como evidencia de datos sintéticos.

### Las tres reproducciones anteriores

| Reproducción | Resultado medido | Estado |
|---|---|---|
| pg_restore --clean --if-exists sobre la misma base, esquema 0023 | Dos operaciones antes; una tras volver al respaldo. OID de vida 17173 → 26297; marca guardada 17173; vida_vigente=false y baseApta=false en modo operación. | C-I1 corregido para la restauración completa que recrea vida. |
| Volcado 0021 con una compra/folio usados; --create en otro servidor; migrar 0022/0023 | Se aplican ambas; sistema/base/tabla quedan NULL, vida_vigente=false, baseApta=false y cero registros de restauración. | C-I2 corregido. La 0022 ya no adopta por sí sola esa base. |
| Cien manifiestos válidos de nombre antiguo en el mismo segundo, milisegundos distintos | ultimoUtilizable lee exactamente 10 y lanza “No se pudo determinar cuál es el último”; traer también lee 10 y pide nombre explícito. | C-I3 corregido. No elige arbitrariamente uno de los diez. |

C-M1 también queda corregido: el mensaje de `traer` dice “se revisaron hasta 10”. El presupuesto cubre lecturas válidas e inválidas; el listado completo no está limitado a diez objetos, lo cual es distinto del número de manifiestos descargados. Un fallo de transporte no se disfraza de manifiesto dañado. No se ensayaron cien descargas reales en S3: se usó un Destino instrumentado que entrega JSON válido y contabiliza las llamadas al código real; la batería sí cubre la integración de almacenamiento.

### Variantes de restauración

| Variante ejecutada | ¿Pasa por válida sin registrar? | Evidencia / interpretación |
|---|---|---|
| Volcado SQL de texto con --clean --if-exists, cargado por psql | No | 2 → 1 operaciones; vida actual 27910 y marca 17173; vida_vigente/baseApta=false. El formato de texto por sí solo no evade la marca. |
| Restauración por pre-data, data y post-data sobre esquemas recreados | No | Las tres secciones completan; vida actual 31164, guardada 17173, vigente=false. Se reconstruyó public vacío como espera el volcado. |
| CREATE DATABASE … TEMPLATE de una emparejada | No | Conserva el OID de la tabla, pero cambia el OID de base; vigente/baseApta=false. |
| --data-only de la secuencia de folios sobre la misma base | Sí | last_value 2 → 1, vigente/baseApta=true. Es una demostración acotada del límite de recarga de datos/secuencias ya admitido, sin alterar vida. No se afirma haber recargado todas las tablas por esta vía. |
| Volcado que excluye public.vida y --clean del resto del esquema/datos | **Sí** | 2 → 1 operaciones confirmadas, folio 2 → 1, tabla vida permanece 17173, cero restauraciones y vigente/baseApta=true. No es una recarga solo de datos. |
| Respaldo 0022 de esa misma base, --clean y después migración 0023 | **Sí, después de migrar** | Vida recreada 29921 → 30321; 0022 solo valida servidor/base; 0023 adopta 30321. Folio vuelve de 2 a 1, cero restauraciones, baseApta vuelve a true. |

El primer guion de secciones encontró un fallo de preparación (extensiones ya existía); el siguiente dejó de crear public que pg_dump da por preexistente. No son rechazos de la protección del producto. Corregida la preparación, las tres secciones completaron y se comprobó el rechazo real. Se conservan `qa5/secciones-preparacion-fallida.log`, el intento inicial en reproducciones.json y el resultado final en `qa5/secciones.log`/`qa5/secciones.ts`.

**C5-I1 · Importante — La identidad de una sola tabla no acredita la identidad de las demás.** Secuencia reproducida: emparejar 0023 → compra folio 1 → pg_dump -Fc --exclude-table=public.vida → compra folio 2 → pg_restore --clean --if-exists → consultar aptitud. Se recrean las tablas del negocio y se pierden la segunda operación y su folio, pero no se tocó ni falsificó la marca. El sistema atiende. Evidencia: `V_excluir_vida_recrea_resto` del JSON, vida y base idénticas; operaciones 2 → 1, baseApta=true. Una restauración seleccionada por tablas/lista de objetos que conserve vida pertenece a la misma clase. Corregir la afirmación “identidad de sus tablas”: actualmente solo se registra la de vida. Como mínimo declarar restauraciones parciales/selectivas que conservan esa tabla como límite adicional, prohibirlas en el procedimiento admitido y exigir registrar restauración. Si se quiere detectarlas, ampliar el diseño con identidad de objetos críticos; eso tampoco detecta una recarga pura de datos. No hace falta prometer detectar SQL administrativo arbitrario; sí decir el alcance exacto de la protección existente.

**C5-I2 · Importante — La adopción de 0023 convalida una restauración 0022 sobre su mismo destino.** Secuencia reproducida: instalación en 0022 anterior y emparejada con un folio → respaldo → aplicar 0023 y consumir otro folio → restaurar aquel respaldo completo --clean sobre la misma base → migrar. La restauración recupera la función 0022 y su historia de migraciones: sistema/base coinciden; `0023_vida_de_las_tablas.sql:14` fija el OID nuevo porque vida_vigente() de 0022 devuelve true. Se adopta la restauración sin cerrar sesiones ni saltar folios. No requiere UPDATE manual de la marca ni copia física. Antes de migrar, baseApta rechaza por versión; después la acepta, justo cuando debería seguir exigiendo registrar. Cambiar la transición para no adoptar automáticamente una base operada en 0022 sin evidencia externa fiable; una adopción explícita de la instalación legítima es la alternativa mínima. Si se decide conservar adopción automática, documentar este límite de respaldos 0022 y exigir recuperación registrada antes de migrar. Con la información de 0022 no se puede distinguir por sí sola actualización legítima de restauración sobre la misma base.

### Compatibilidad solicitada: 0022 con texto anterior ya aplicada

Se obtuvo el texto anterior real de la copia de la cuarta revisión (`/tmp/feruga-codex-qa4/sistema/db/migraciones/0022_vida_del_servidor.sql`), conservado como `qa5/0022-texto-anterior.sql`. Se migró una desechable hasta 0021, se asentó una compra, se aplicó esa 0022 anterior y se comprobó emparejamiento. Luego se ejecutó el migrador con la carpeta actual.

**Resultado: correcto para actualización legítima.** Se aplicó únicamente 0023. El UUID de vida siguió `29de8496-cc62-4b2a-a159-9151cb0f4470`; base 29134; tabla 29921 antes y después; la nueva columna contiene 29921. Conservó compra, folio y cero restauraciones; vida_vigente=true y baseApta=true. Un segundo migrar devolvió `[]`: no se reaplica la 0022 editada. `db/migrar.ts` actual registra nombres, no hashes; editar el archivo no modifica una base que ya lo aplicó. Por ello la de desarrollo del usuario no queda estropeada por esa edición, y no se tocó para comprobarlo. Una instalación que ya operó y aplica por primera vez la 0022 NUEVA sí necesita adopción expresa: es intencional, no la misma transición.

Límite de mantenimiento: cuando D introduzca huellas, no usar el SQL nuevo como prueba retrospectiva de que se ejecutó ese mismo texto. Guardar/documentar la variante anterior en el sellado de confianza. La compatibilidad de actualización demostrada no elimina C5-I2: ambas historias son indistinguibles para ese UPDATE automático.

**Cierre de tarea 3:** quedan verificados los arreglos pedidos y la compatibilidad de actualización, pero hay que resolver o aceptar/documentar expresamente C5-I1 y C5-I2, con sus pruebas de regresión, antes de dar por cubierta la barrera de restauración que promete el plan.

