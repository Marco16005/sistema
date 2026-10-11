> Informe de Codex (`gpt-6-astra`, esfuerzo alto, con ejecución), tal como lo dejó en
> `/tmp/feruga-codex-informe-10e.md`. **Completo:** los doce puntos, en siete minutos (9 de octubre).
> Es la parte E de la décima pasada (A precio especial; B publicar: la lógica; C publicar: los
> guiones; D respaldo diario; E rediseño): las partes B y C de su novena pasada, que se había
> cortado al empezarlas. Revisó una copia (`/tmp/feruga-codex-qa11/`) leyendo y con sondas; **no
> corrió los recorridos del navegador** (se le pidió que no): lo que pide correrlos para
> confirmarse viene marcado «Sin confirmar: para correr aquí».
> Lo que se hizo con cada hallazgo está en `2026-10-07-respuesta-a-la-decima-revision.md`.

# Décima pasada de calidad, parte E — el rediseño de la interfaz, tareas 0, 1 y 2 — 2026-10-09

1. Revisado: la corrección anterior de tinta, opacidad, rayas, fondo y elementos ajenos está presente.

### [importante] El retrato aún puede aprobar un papel cuya apariencia cambió
Dónde: recorrido/papel.spec.ts:70, recorrido/papel.spec.ts:108
Escenario: en una copia de ensayo, añadir `@media print{.papel{filter:opacity(0)}}` y ejecutar los cuatro casos de papel: las cajas, colores y opacidades calculadas de los descendientes permanecen iguales; el PDF conserva sus páginas aunque desaparezca la tinta. Tampoco se retratan `::before/::after`, imágenes de fondo, recortes ni las posiciones de los glifos dentro de cada caja.
Confirmado con: Sin confirmar: para correr aquí. Aplicar cada mutación por separado y ejecutar `npx playwright test papel`; comprobar que la comparación pasa pese al PDF distinto. No se ejecutó navegador.
Corrección sugerida: comparar también una representación visual del PDF con fecha e identificador estabilizados; conservar el retrato estructural como diagnóstico.
2. La composición alfa del cálculo y la precedencia de los cuatro modos son correctas para los pares enumerados; no cubren todos los pares reales.

### [importante] El foco del enlace actual desaparece en claro y no alcanza contraste en los otros modos
Dónde: src/estilo/sesion.css:63, src/estilo/sesion.css:65; pruebas/27-estilo.test.ts:163
Escenario: recorrer con Tab hasta la pantalla actual de la barra. El aro usa --foco y está por dentro (`outline-offset:-3px`), sobre --acento-lleno; en claro ambos son el mismo azul. La prueba solo calcula el foco sobre fondo y tarjeta.
Confirmado con: `sh qa/node.sh qa/sonda-10e.ts` — `FOCO interior de enlace actual / claro: 1.00 a 1`; oscuro: 2.13; contraste y contraste en oscuro: 2.30. Sonda numérica con las funciones y variables reales; `sh qa/prueba.sh pruebas/27-estilo.test.ts` pasa sus 12 pruebas pese a este par ausente. No se ejecutó navegador.
Corrección sugerida: dar al enlace activo un foco interior contrastante (o doble aro) y añadir este par a los cuatro modos.
3. Sin hallazgos nuevos en lectura: Hoja abre con showModal, consulta alCerrar actual y reabre al evento close solo mientras sigue montada/conectada; la limpieza retira listeners antes de close y restaura foco (también en el ciclo estricto). La corrección de foco al reaparecer está presente. CSS bloquea el scroll y oculta diálogo/velo al imprimir sin cerrar. No hay envío ni cancelación de negocio en Hoja. La conservación efectiva del desplazamiento y el teclado móvil no se ejecutaron.
4. Sin hallazgos nuevos en lectura de los cuatro usos: reabrir conserva su envío y no permite salir mientras quede incierto; conteo y corrección regresan de paso sin borrar el pendiente y resuelven antes de cambiar autorizante; vehículo conserva hacer/revision. El cierre por Escape pasa por la misma acción de cancelar y se inhibe al enviar; la clave se limpia al terminar. El cambio modal de navegación está declarado en el plan.
5. Sin hallazgos en lectura: `playwright.webkit.config.ts:19` usa WebKit sin ignorar certificados; `docker-compose.yml:249,287` sirve HTTPS e instala la CA en el almacén del sistema; `recorrido/seguro.spec.ts:8` exige contexto seguro, locks, BroadcastChannel, diálogo y UUID. No ejecuté recorridos.
6. Veredicto tarea 1: no la daría por cerrada junto con la tarea 0 hasta comprobar/cerrar el hueco del retrato del punto 1. No encontré un defecto nuevo de pérdida o duplicación de envíos atribuible a la hoja. El cálculo de color requiere añadir el par real del foco señalado en 2 antes de cerrar la base y su uso en la barra.
7. Sin hallazgos: `sh qa/prueba.sh pruebas/17-rutas.test.ts contraste` → `ℹ pass 2`, `ℹ fail 0`: solo alto/normal, rechazo de inyección/JSON inválido/origen ajeno o ausente, atributos de galleta y funcionamiento sin base. rutaSinBase conserva delMismoOrigen y leerCuerpo; el layout filtra la galleta antes de poner el atributo y usa cookies() dinámico. El recorrido existente comprueba Cache-Control private/no-store; no repetí esa comprobación HTTP. baseCaida usa DROP real en la base de recorridos, no simula una respuesta: no lo ejecuté; su aislamiento depende de PG_ADMIN_URL de Compose.
8. La corrección del almacén único entre instancias está presente. La sincronización entre pestañas se limita a la recarga, como declara el plan; no hay bloqueo entre pestañas.

### [importante] Si cambia la preferencia del equipo durante un guardado fallido, el interruptor contradice la pantalla
Dónde: src/componentes/Contraste.tsx:78
Escenario: sin galleta ni contraste solicitado por el equipo → tocar Más contraste y retener la petición → el equipo pasa a pedir más contraste → falla la petición. Se elimina el atributo (CSS sigue al equipo y muestra alto), pero se restaura el booleano viejo y el interruptor queda apagado. Otro toque vuelve a intentar alto en lugar de quitarlo.
Confirmado con: `sh qa/node.sh qa/sonda-10e.ts` — `CONTRASTE tras fallo y cambio del equipo: interruptor=false; pantalla=true; atributo=ausente`. Ejecuta el almacén real con DOM/media/fetch simulados; falta el recorrido visual.
Corrección sugerida: después de restaurar o quitar el atributo, publicar `alto: loQueSeVe()`; añadir este cruce de cambio del equipo y fallo.
9. Sin hallazgos en lectura y comprobación estática: fondos de barra opacos en alto (también sobre oscuro), menos transparencia y sin soporte de blur; los tintes CSS usan gradiente sobre superficie. `sh qa/prueba.sh pruebas/27-estilo.test.ts` → `ℹ pass 12`, `ℹ fail 0`. El velo al 60 % y controles transparentes sobre superficies sólidas siguen siendo transparentes por diseño: no equivalen a vidrio bajo el texto. El medidor vidrio() comprueba alpha del fondo y blur, pero no opacidad/filtros de ancestros; no encontré esos ancestros en la barra actual.
10. En lectura, las cajas de controles de entrada/barra tienen mínimos de 60 px (personas 76, código 64, teclado 66), y separación declarada de 8 px o más en los tres tamaños. No confirmé un control real menor de 60 px; el mostrador previo está fuera de este punto.

### [menor] El medidor omite distancias diagonales menores de 8 px
Dónde: recorrido/apoyo.ts:181
Escenario: dos botones de 60×60 con separación de 1 px horizontal y vertical (distancia entre esquinas de 1.41 px) → el medidor devuelve éxito, porque solo compara distancias si los controles se solapan en alguno de los ejes. También acepta que se toquen por una esquina.
Confirmado con: `sh qa/node.sh qa/sonda-10e.ts` — `MEDIDOR: dos botones separados 1 px en ambos ejes => []`. Ejecuta el medidor real con cajas simuladas; no demuestra una colisión actual de la barra.
Corrección sugerida: calcular la distancia entre rectángulos también en diagonal y exigir 8 px, con una tolerancia pequeña explícita.

### [menor] La tarea 2 baja el mínimo de letra de 17 a 15 px y su prueba lo permite
Dónde: src/estilo/valores.css:62; src/estilo/sesion.css:83; src/estilo/piezas.css:33; recorrido/apoyo.ts:197
Escenario: a 420×800 o 360×640, los nombres de las pantallas se pintan a 15 px; en la entrada, el rótulo Más contraste también usa 15 px. La decisión 6 exige texto de 17 px para arriba, pero el recorrido solo rechaza menos de 14.95 px. La tarea declara 15 px sin explicarlo como excepción a esa decisión.
Confirmado con: `sh qa/node.sh qa/sonda-10e.ts` — `MEDIDOR: dos botones 60x60 que se tocan por una esquina, letra 15 px => []`; reglas citadas leídas en la copia, sin medición visual.
Corrección sugerida: subir estos textos y el umbral a 17 px; si se conserva 15 px, documentar expresamente la excepción al contrato y su alcance.
11. La barra usa sticky solo en ancho, el rail descuenta su altura y html tiene scroll-padding; el diálogo queda en la capa modal y el CSS de impresión oculta lo ajeno al papel. Se conservan enlaces únicos, aria-current, botones nativos y disabled; el foco del enlace actual falla como indica 2.

### [importante] Enter sobre Más contraste puede enviar la clave en lugar de cambiar el contraste
Dónde: src/componentes/Teclado.tsx:38; src/componentes/Sesion.tsx:274
Escenario: en la entrada, elegir persona y escribir una clave completa → llevar el foco a Más contraste → Enter. El listener global del teclado llama a entrar() y cancela la activación nativa del interruptor. También afecta al interruptor de la barra cuando hay una captura con Teclado montado: Enter puede ejecutar alTerminar de esa captura.
Confirmado con: `sh qa/node.sh qa/sonda-10e.ts` — `TECLADO: Enter sobre Más contraste => alTerminar=1; preventDefault=true`. Ejecuta el manejador real con evento simulado; sin recorrido visual. El recorrido de orden de barra no monta Teclado y el de Enter de alta no prueba la pantalla de clave.
Corrección sugerida: respetar Enter en botones/enlaces/interruptores ajenos al teclado; acotar el atajo al contexto de captura y cubrir este caso en entrada y mostrador.
12. Veredicto tarea 2: no cerrar todavía. Antes de la tarea 3, en este orden:
1) Evitar que Enter en el interruptor u otros controles ajenos ejecute alTerminar de la captura (11).
2) Corregir el aro de foco del enlace activo y añadir su par al cálculo (2).
3) Recalcular el contraste efectivo al revertir un guardado fallido (8).
4) Reproducir el hueco del papel y ampliar su comparación antes de seguir cambiando estilos (1; sin confirmar en navegador).
5) Ajustar la medición de separación diagonal y resolver el mínimo de letra de 17/15 px (10).

Archivos creados en /tmp/feruga-codex-qa11/qa/: sonda-10e.ts. No quedaron contenedores de esta revisión corriendo: las ejecuciones terminaron con --rm; el contenedor de pruebas observado al final monta el proyecto original y ejecuta 31-candado.test.ts, ajeno a esta revisión, y no se tocó.
