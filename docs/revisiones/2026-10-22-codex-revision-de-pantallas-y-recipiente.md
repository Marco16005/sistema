# Codex revisa: lo corregido de la caja, el recipiente y las pantallas del rediseño

> **22 de octubre de 2026.** Revisión de calidad de Codex (`gpt-6-astra`, esfuerzo alto), en su copia
> (encargo 33, al final). Terminó completa. Verificó lo corregido de su revisión de la caja (cerró
> H2, H4, H5, H7, H8 y H9), revisó por primera vez el recipiente (sin defectos), las seis
> correcciones de su revisión del rediseño (cinco cerradas) y las tareas 3 a 7 del rediseño, y
> alcanzó la demostración. Dejó siete hallazgos: uno alto, tres medios y tres bajos. Lo que se
> hizo con cada uno está en `2026-10-22-respuesta-a-la-revision-de-pantallas-y-recipiente.md`.

# Informe 33 — calidad del rediseño y el recipiente

**22 de octubre de 2026. Revisión terminada, una sola pasada.** Copia examinada: `/tmp/feruga-codex-qa14/`. Todos los archivos y líneas citados son relativos a esa copia, salvo la ruta de este informe.

## Resultado

**Siete hallazgos actuales: uno alto, tres medios y tres bajos.** El alto es que Fiar permite soltar/cambiar una autorización cuyo resultado sigue siendo incierto. Hay además un bloqueo mutuo de inventario/caja, un reintento de vehículo que acepta otra firma y pérdida de recuperación de comprobantes. El recipiente pasó las verificaciones de dinero, patio, límites y cuenta cobrada. No encontré una conciliación incorrecta de Ganancia al cambiar de material ni saldo negativo en los cruces de correcciones/abonos ejecutados.

- **Caja H1–H10:** cerrados H2, H4, H5, H7, H8 y H9 en el alcance indicado; **no cerrados H1, H3, H6 y H10**. H6 conserva una excepción de despliegue documentada y no se cuenta como hallazgo nuevo.
- **Parte E:** cinco puntos cerrados; **no cerrado completamente el mínimo de letra fuera de la lista de rótulos**.
- **Rediseño tareas 3–7:** no dar el conjunto por cerrado mientras persistan los hallazgos y los límites señalados. No se certificó la fidelidad visual del papel mediante una nueva corrida.

## Método y restricciones

Se leyó el código y se ejecutaron pruebas seleccionadas y sondas nuevas, de una en una mediante `qa/prueba.sh`, contra bases desechables de `feruga_plantilla_codex`. No se modificó código de aplicación, no se instaló software ni se sustituyó Compose. No se escribió dentro de `/Users/maantora/Desktop/feruga`, ni se intervino directamente en los contenedores o la base del usuario. No se ejecutaron batería completa, recorridos de navegador ni simulacros. El informe se guardó al comenzar y después de cada parte.

«Demostrado por código/callback» no significa reproducción visual. Las sondas de callbacks ejecutan el código original transpileado con dobles mínimos de entorno, sin montar React ni navegador. Las pruebas de contraste calculan colores y composición alfa de las reglas reales. Los cruces de base usan conexiones y candados reales; sus prefijos administrativos solo fijan la intercalación en una base desechable.

## 0. Revisión de las correcciones de caja

Se leyeron el informe 31, su respuesta del 21 de octubre, 0043, ganancia, instantánea, Correcciones, cierre, Mostrador y Fiar. `pruebas/56-revision-de-caja.test.ts`: **8 aprobadas**, `qa/revision33-56.log`.

| Hallazgo anterior | Estado | Evidencia y límite |
|---|---|---|
| H1, orden de candados | **NO CERRADO** | El cruce original vehículo/corrección pasa en 56. La nueva sonda demuestra contar contra mover caja: **contar=40P01; mover=pasó**. Contar toma patio → clave → jornada, en conflicto con jornada → clave. R33-1. |
| H2, foto del cierre | **CERRADO** | `src/servidor/bd.ts:87` y `src/servidor/dominio/cierre.ts:75`: una conexión, REPEATABLE READ READ ONLY, ambas lecturas en esa instancia. Prueba 56 cierra realmente el día entre consultas y no mezcla estados. |
| H3, reintento cambiado | **NO CERRADO** | 56 rechaza cambiar forma, cliente y plazo. La sonda termina un vehículo con A y repite con B: devuelve éxito y firmante A. R33-2. |
| H4, correcciones en Ganancia | **CERRADO en los casos revisados** | 56 reproduce los resultados $8 y $0 del informe 31. La sonda cambia Cartón a PET en compra y venta: resultado **$0 y $21**, idéntico a caja + patio − apertura. Suma por material + redondeo = total. `ganancia.ts:104–120` separa costo del ajuste y dinero anterior/nuevo con su material. |
| H5, redondeo | **CERRADO** | Rubro independiente, signo de compra/venta, en total y serie. Caso de compra $2.10 pagada a $2 y venta $2.50 cobrada a $3: resultado **$1.00**, conciliado. |
| H6, migración histórica 0039 | **NO CERRADO técnicamente; excepción documentada** | `db/migraciones/0039_el_costo.sql:124` sigue recorriendo por ID, y su valoración histórica usa IDs anteriores. La respuesta dice que no existe una base que deba migrar esa historia. No se inspeccionó la base real para certificarlo. El defecto original es de gravedad alta si se aplica a esa historia; el arreglo sigue siendo reconstruir orden real por creado_en y dependencias. Reproducción ya documentada en el informe 31: dos compras asentadas antes de una venta pero IDs intercalados provocan RC002 o costo de $30 frente a $33.33. No se repitió esa migración histórica. |
| H7, saldo del fiado | **CERRADO en saldo agregado y cruces revisados** | 56 verifica corrección, vencido, tope, devolución y rechazo de pendiente. Dos ventas de $250, abono $300 y dos correcciones concurrentes de −$125: una entra, otra RC004, saldo **$75**. Corrección −$125 contra abono $200, ambos órdenes: solo pasa el primero, saldo **$125 o $50**. `0043:120,175,243,247` usa el candado de cliente antes de leer/reducir saldo. No se probó exhaustivamente toda combinación. |
| H8, cambiar firmante en corrección/corte | **CERRADO** | `Correcciones.tsx:146` y `cierre/page.tsx:175` esperan cancelar antes de borrar. Las dos sondas de callback con fallo de red conservan pendiente. El defecto análogo de Fiar es R33-3. |
| H9, buscar otra cuenta con corrección incierta | **CERRADO por inspección** | `Correcciones.tsx:55,156,207` consulta pendiente global, bloquea la otra cuenta y guarda folio. `cierre/page.tsx:377` permite volver al folio pendiente. Recorrido específico de respuesta perdida/recarga/otra cuenta leído, no ejecutado. |
| H10, conservar cobro/fiado | **NO CERRADO** | Se conserva la selección, pero no un pedido inmutable con firmante antes de salir; Fiar aún permite soltarlo/cambiarlo y el cobro normal deja cambiar forma. La recuperación de comprobante elimina su referencia si falla el GET. R33-3 y R33-4. |

**Concurrencia complementaria:** `qa/revision33-caja-concurrencia.log`, cinco sondas aprobadas (tres cruces de saldo y dos demostraciones de defecto). Las dos conciliaciones de cambio de material constan en `qa/revision33-caja.log`. La sospecha anterior de Gastos quedó atendida por `SoloEnSuPestana` (`src/app/panel/gastos/page.tsx:60`), comprobado por lectura.

**Orden anunciado:** no se cumple universalmente jornada → cliente → patio → clave. Además del deadlock demostrado, corregir_movimiento llega tarde al candado de jornada y fiar con cliente nuevo resuelve su alta después de patio/clave. Estos últimos caminos se distinguen en la sección de sospechas; no se presentan como deadlocks ejecutados.

### R33-1 — Media — sigue habiendo inversión de candados entre inventario y caja (demostrado en PostgreSQL)

**Dónde:** `db/migraciones/0043_lo_que_encontro_la_revision_de_caja.sql:570` (contar toma patio antes de llamar a `asentar_conteo`); `db/migraciones/0017_inventario.sql:132` (la llamada interna toma jornada); `db/migraciones/0038_el_cajon.sql:433,441` (mover toma jornada y luego clave). El mismo patrón tardío de jornada aparece en corregir_movimiento, cuyo INSERT llega al guardián de movimiento después de tomar patio y clave; este segundo cruce se señala por lectura, no por ejecución.

**Reproducción:** `sh qa/prueba.sh pruebas/90-revision-33-caja.test.ts 'H1:'`. B toma el prefijo real de mover (`jornada FOR UPDATE`). A entra por `contar_material`, toma patio y credencial, y espera jornada. B llama a `mover_caja` con la misma firma: espera credencial. Salida **contar=40P01; mover=pasó**. El prefijo administrativo solo detiene una intercalación posible en la base desechable; las funciones son las del producto.

**Arreglo:** tomar y comprobar la jornada antes de patio y credencial en las entradas de inventario, incluidas contar/corregir, y después dejar que los auxiliares repitan candados ya adquiridos. Revisar también la creación concurrente de un cliente nuevo en fiar: el camino de alta toma su cliente después de patio/clave (`0043:475–477`), de modo que el orden anunciado no es universal. No se demostró un bloqueo por ese último camino.

### R33-2 — Media — el reintento de terminar vehículo acepta una firma distinta (demostrado)

**Dónde:** `db/migraciones/0043_lo_que_encontro_la_revision_de_caja.sql:507` (retorno anticipado compara solo forma); `src/componentes/mostrador/Mostrador.tsx:1085` (la hoja dice que quien ponga su clave queda registrado).

**Reproducción:** `sh qa/prueba.sh pruebas/90-revision-33-caja.test.ts 'H3:'`. Terminar con firma A y repetir con firma B y la misma forma. Devuelve éxito, `confirmada_por=A`. El reintento ni siquiera llega a comprobar la clave de B. No duplica el cobro; da por bueno un pedido diferente. La respuesta a H3 prometía rechazar también otra firma.

**Arreglo:** comparar el firmante original (y el contenido que defina el mismo pedido) antes del retorno, rechazando la discrepancia con RC011. Conservar el reintento idéntico como lectura sin exigir otra escritura.

### R33-3 — Alta — Fiar permite soltar y cambiar una autorización de resultado incierto (demostrado por código y ejecución del callback)

**Dónde:** `src/componentes/mostrador/Fiar.tsx:67–68,121`; `src/componentes/mostrador/Mostrador.tsx:734,990`.

**Reproducción:** enviar fiado y perder la respuesta. «Autoriza otra persona» ejecuta únicamente `poner({ sinSaber: null })`, sin consultar/cancelar el pedido. «Regresar» (también Escape vía Hoja) vuelve a datos editables; «No fiar» borra lo guardado. Se puede cambiar cliente/plazo o volver a la cuenta y elegir otra forma. En cobro normal, `cobrando` es un indicador para recuperación, no bloquea los chips ni guarda un cuerpo inmutable. Si el primer pedido aún está en vuelo, el resultado depende de cuál llegue primero. H3 impide algunos falsos éxitos, pero no resuelve el envío ni conserva la intención original.

**Arreglo:** persistir el cuerpo completo y la persona antes de enviar (sin clave), bloquear toda edición mientras esté incierto y resolver por una entrada que serialice confirmación/cancelación; hasta resolver, Escape/Regresar solo pueden volver a un estado que preserve e impida cambiar ese pedido. AutorizarVehiculo también necesita persistir el firmante.

### R33-4 — Media — al fallar recuperar el comprobante se pierde la recuperación pendiente (demostrado por código y callback)

**Dónde:** `src/componentes/mostrador/Mostrador.tsx:187–207`.

**Reproducción:** cobro confirmado con respuesta perdida; recargar; GET de cuentas abiertas funciona (ya no contiene esa cuenta), GET de su comprobante falla por red/500. El `catch` lo silencia y el filtrado posterior elimina el lugar de toda cuenta no abierta, incluido `cobrando`. En la siguiente recarga ya no se intenta recuperar ese comprobante. Si hay varias cuentas cobradas pendientes, solo se intenta la primera y se eliminan las demás.

**Arreglo:** separar cuentas cerradas por recuperar de borradores activos; eliminar cada referencia solo cuando se recuperó el comprobante o una respuesta definitiva acredita otro estado. Ante red/500 conservarla y mostrar reintento; procesar todas las pendientes. No se ejecutó la secuencia en navegador.

## 1. — recipiente y nombre de cuenta

**Resultado:** sin defecto financiero nuevo encontrado en el alcance ejecutado. `pruebas/48-recipiente.test.ts`: **11 aprobadas** (`qa/revision33-recipiente.log`). Se verifican compra y venta, patio sin recipiente, octava entrada y compatibilidad de siete entradas, igualdad/superación del bruto rechazadas, negativos/NaN/infinito/precisión, rechazo en báscula grande, repetición con contenido distinto, edición/quitar antes del cobro, revisión vieja rechazada, cuenta cobrada inmutable, descuento y pertenencia del renglón a la cuenta.

`pruebas/37-panel.test.ts recipiente`: **1 aprobada**, `qa/revision33-panel-recipiente.log`: tres renglones, compras 0.600 kg, ventas 1.500 kg, atribución a quien cobró y exclusión de la tara del vehículo. La consulta (`panel.ts:152–189,279–281`) y la pantalla (`src/app/panel/page.tsx:355,380–382`) coinciden con el plan.

`pruebas/10-entradas.test.ts` selección de etiqueta: **2 aprobadas**, `qa/revision33-nombre.log`: etiqueta (poner/limpiar/longitud de 40 y revisión) y rechazo de agregar a cuenta inexistente o cobrada. La pantalla (`Mostrador.tsx:1025–1064`) usa formulario para Enter, recorta espacios, limita a 40 y muestra el nombre en la tira. La pantalla no permite vaciar una etiqueta ya puesta, aunque el servidor sí; el plan no exige una acción de quitar nombre, por lo que no lo cuento como defecto.

**Ticket:** inspección de `Ticket.tsx:51–59`: imprime «marcó» y «Recipiente», junto a kilos liquidables, y conserva el tratamiento de tara del vehículo. No lee `etiqueta`; solo `comprobante.cliente`, como pide el plan. Los cinco recorridos de `recorrido/recipiente.spec.ts` cubren captura, edición/quitar, grande, nombre ausente del papel y nombre largo; **leídos, no ejecutados**. No se afirma haber impreso ni medido el ticket en esta pasada.

**Matiz correcto:** con descuento, puede quedar importe/peso liquidable cero si todo el material recibido se descuenta; el recipiente sigue siendo estrictamente menor al bruto y no supera bruto menos descuento. La prueba lo exige; no es una cuenta con peso recibido negativo ni una tara que alcance al bruto.

**Límite:** el cambio de recipiente desde una cuenta usa un setter sin UUID, a diferencia de agregar un renglón. Después de perder la respuesta permite editarlo otra vez; no demostré un cobro incorrecto por ello (el servidor bloquea la operación y controla su revisión y estado). Conviene una prueba de respuestas invertidas para esa edición, pero se deja como cobertura pendiente, no hallazgo.

## Ampliación de evidencia de la parte 0

`pruebas/90-revision-33-pantalla.test.ts`: **6 aprobadas**, `qa/revision33-pantalla.log`. Ejecuta callbacks originales transpileados con dobles mínimos de entorno; **no monta React ni navegador**. H8 conserva el pendiente cuando cancelar falla en ambos componentes. R33-3 queda demostrado también ejecutando el callback: **firmante pendiente borrado; consultas de resolución=0**.

## 2. — seis correcciones del rediseño (respuesta E)

Criterio: «CERRADO» indica que el defecto concreto tiene arreglo y evidencia en el alcance permitido. No equivale a certificar todos los navegadores ni el papel físico. No se ejecutó ningún recorrido.

| Punto | Veredicto | Evidencia |
|---|---|---|
| Enter en control alcanzado con Tab | **CERRADO** | `Teclado.tsx:7–14,42–51`: seguimiento de Tab/puntero y respeto de Enter propio fuera del teclado. Sonda del manejador original: Tab + Enter sobre control no llama alTerminar ni cancela la acción nativa; después de puntero conserva el atajo. Recorridos de entrada y mostrador leídos (`barra.spec.ts:182,212`). |
| Aro del foco del enlace actual en claro | **CERRADO** | `sesion.css:68` usa `--sobre-acento` para el aro interior del enlace actual. `27-estilo` incluye ese par en los cuatro modos y exige también la regla: pasa. |
| Más contraste cuando guardar falla | **CERRADO** | `Contraste.tsx:76–81` restaura atributo y publica `loQueSeVe()`. Sonda: cambia la preferencia del equipo durante petición fallida; interruptor=true, atributo ausente, pantalla siguiendo contraste alto. Recorrido correspondiente leído. |
| Imagen de la hoja como guardia del papel | **CERRADO para el hueco señalado** | `recorrido/papel.spec.ts:120,133,163`: captura `.papel` bajo medios print, compara los PNG guardados, normaliza fecha/operación y detecta dimensiones o píxeles distintos. Tiene prueba adversarial de filtro que borra tinta, pseudo-elemento que tapa y recorte (`:222`). Es inspección del mecanismo, no una corrida nueva. Se conserva el límite declarado: captura del navegador con CSS print, no PDF rasterizado ni impresora real. |
| Medidor diagonal | **CERRADO** | `recorrido/apoyo.ts:225` compara `Math.hypot(lado, alto) < 7.5`; la tolerancia es 0.5 px respecto a 8. Sonda del evaluador real detecta dos controles separados 1 px en ambos ejes; el recorrido incluye también contacto por esquina. |
| Letra de 17 px excepto lista de rótulos | **NO CERRADO completamente** | El medidor ya pide 17 y limita 15 a `ROTULOS`; la sonda confirma que rechaza 15 fuera de esa lista. Sin embargo `.cta .otro` sigue a 15 y no pertenece a ella: R33-5. Los dos avisos originales sí quedaron a 17. |

`pruebas/27-estilo.test.ts`: **14 aprobadas**, `qa/revision33-estilo.log`. Las tres sondas de E están dentro de las seis de `qa/revision33-pantalla.log`.

### R33-5 — Baja — «De otro día» sigue en 15 px fuera de la lista de rótulos (demostrado por código)

**Dónde:** `src/estilo/pantallas.css:47`; `src/componentes/mostrador/Mostrador.tsx:415`; `recorrido/apoyo.ts:194` (ROTULOS).

**Reproducción:** dejar un vehículo abierto al cerrar una jornada y atender en la siguiente. La tarjeta incluye `<span className="otro">De otro día</span>`, dentro de un botón `.cta`; la regla fija `--letra-chica=15px`. No es `small`, `.lbl`, `.interruptor`, enlace de navegación, `th` ni `.phead span`. El medidor actual lo marcaría por debajo de 17. No se midió visualmente en navegador.

**Arreglo:** subir este aviso a 17 px. Si el negocio decide considerarlo rótulo, documentar expresamente esa excepción y actualizar la lista y su caso de prueba, en vez de mantener dos contratos distintos.

## 3. — tareas 3 a 7 del rediseño

**Veredicto general: NO dar por cerrado el conjunto.** Las superficies y los flujos principales están implementados y no encontré un cambio de cálculo causado por CSS. Persisten R33-3 (una hoja sí permite soltar un fiado incierto), R33-4 (recuperación incompleta), R33-5 y R33-6. No atribuyo todos a la fecha del rediseño: algunos pertenecen a funciones posteriores. Esta copia no tiene repositorio `.git`, de modo que la afirmación histórica «ningún estado ni efecto se tocó» no se pudo verificar con diff; se revisó el estado actual y las reglas del plan.

| Tarea / pantalla | Lo comprobado | Límite o incumplimiento |
|---|---|---|
| 3. Mostrador | Cuentas a la vista, grupos normal/en espera, tres pasos con restricciones, captura por báscula, teclado y cuerpo de agregar material persistido; recipiente probado aparte. Precio especial conserva el pendiente al regresar y deshabilita edición; su cambio de autorizante espera cancelación. | Cobro/fiado/vehículo no tienen la misma disciplina completa: R33-3 y R33-4. El texto secundario de la tarjeta activa pierde contraste: R33-6. No se probaron giro, zoom, importes enormes ni cambios de tamaño/modo con envío incierto. |
| 4. Comprobante en pantalla | `comprobante.css` conserva tipografía y composición propias; el resto de la pantalla usa los estilos nuevos. `Ticket` usa el mismo cuerpo para ambas copias y la copia del negocio se oculta en pantalla. | La igualdad visual actual con los PNG/PDF no se ejecutó. Las adiciones posteriores autorizadas de recipiente/forma de pago no son un defecto del rediseño. |
| 5. Arranque, precios y cierre | Arranque conserva captura/revisión/envío; precios separa guardar de publicar y mantiene edición por responsable; cierre usa instantánea, corte autorizado y memoria de pendientes. Reabrir/cerrar no descartan pendiente por Escape. | No hay una nueva hoja para cada confirmación, y el plan declara que buena parte se resolvió mediante CSS compartido. El formulario de precios deja campos editables mientras guarda, aunque los botones se deshabilitan; riesgo consignado abajo sin atribuirlo al rediseño. |
| 6. Inventario | `SoloEnSuPestana` antes de leer memoria; guardar sin esperar redibujado; contar y corregir regresan de autorización manteniendo pendiente, con campos bloqueados; cambiar firmante resuelve primero. Merma y separar usan `enviar` y su estado incierto. | No se convirtió cada acción en hoja: el plan lo reconoce. Contar/corregir presentan el bloqueo de servidor R33-1. Merma/separar/corregir no tienen medición individual del rediseño; compartir piezas no demuestra toda su composición. |
| 7. Limpieza | Imports de CSS ordenados, comprobante al final; no se encontró `globals.css`, Barlow ni uso directo de `--ios27-*` fuera de valores. Versión de tokens fijada; cuatro modos del cálculo y guardias de CSS pasan. | No hay certificación de toda combinación visual ni de rendimiento de vidrio en tabletas reales. |

**Hoja y seguridad del envío:** `Hoja.tsx` usa `showModal`, previene cierre nativo, consulta el callback actual, reaparece si el navegador la cierra y devuelve foco al desmontar. No cancela transacciones por sí misma. El defecto R33-3 está en su dueño Fiar, que sí proporciona una salida hacia datos editables; la implementación correcta de Hoja no lo impide. Contar, Corregir, PrecioEspecial, reapertura y corte mantienen su protección al volver de la hoja. Leídos `diseno.spec.ts`, `mostrador-medidas.spec.ts`, `pantallas-medidas.spec.ts`, barra y contraste; ninguno ejecutado.

**Lo pedido y omitido por el propio plan:** pulgar animado de pasos; hojas en cada acción de inventario; orientación girada, texto agrandado, datos extremos y preservación del envío/pestaña al cambiar tamaño y modo. No se presentan como hechos. La tarea 8 sigue pendiente del usuario en iOS, Android y Windows, con teclado, lector e impresión reales.

### R33-6 — Baja — texto de la cuenta activa con contraste inferior al contrato (demostrado por cálculo)

**Dónde:** `src/estilo/pantallas.css:49` (`opacity:.86` en `small` y `.otro` de la cuenta seleccionada); `pruebas/27-estilo.test.ts:139` y siguientes (pares no incluyen esta opacidad).

**Reproducción:** seleccionar una cuenta en claro u oscuro. Texto blanco sobre `#0a66e4`, rebajado a opacidad 0.86: **4.26:1**, menor que 4.5 exigido para ese texto de 15 px. La sonda lee la regla y los valores reales, compone alfa y calcula contraste: `sh qa/prueba.sh pruebas/90-revision-33-estilo.test.ts`. Log `qa/revision33-estilo-pares.log`: claro 4.26, oscuro 4.26, alto 7.15 y alto sobre oscuro 7.15. No se requiere suponer una captura visual para obtener esa razón.

**Arreglo:** quitar/reducir esa transparencia hasta cumplir 4.5 (y conservar 7 en alto), y agregar el par con opacidad real a la guardia. El foco corregido de la barra sí cumple; este es otro selector.

## 4. — estilos compartidos y textos

Se leyeron `src/estilo/{valores,base,piezas,pantallas,sesion,comprobante,panel,ajustes}.css` y el orden de importación en `layout.tsx`. **No se encontró una colisión nueva demostrada entre hojas.** Las correcciones anteriores acotan `.compra`, `.venta` y `.b` del panel y usan `.administrado` en ajustes en vez de reutilizar `.ajuste` del contraste. `27-estilo` pasa su guardia de nombres, aunque esta solo vigila clases solas definidas por panel/ajustes; no es un análisis completo de cascada de todos los selectores. Los usos compartidos restantes de `.exrow`, `.btn`, `.dos`, `.top` y `.rn` son extensiones o reglas contextuales, sin un choque nuevo identificado.

Se calcularon pares adicionales de texto secundario, alerta y acento sobre relleno en los cuatro modos (`qa/revision33-estilo-pares.log`); no se atribuye aprobación universal a esa muestra. El defecto demostrado adicional es la opacidad de la cuenta activa, R33-6. El papel sigue con CSS propio y ambos modos de contraste, pero comprobar que la impresión actual no cambió exige la comparación visual no ejecutada.

### R33-7 — Baja — publicar precios anuncia que ya se puede atender aunque falte contar el cajón (demostrado por código)

**Dónde:** `src/app/precios/page.tsx:83`; `src/componentes/mostrador/Mostrador.tsx:253`; `src/componentes/Sesion.tsx:41,382`.

**Reproducción:** abrir una jornada nueva sin apertura del cajón; publicar la lista. Precios muestra «Lista publicada. Ya se puede atender.»; al ir al mostrador se bloquea para contar el cajón. Publicar no crea `caja_apertura`. El estado `dia.listo` solo exige jornada/lista (`src/servidor/dominio/dia.ts:57`); el requisito del cajón se comprueba aparte. No se ejecutó navegador para esta contradicción de texto.

**Arreglo:** decir «Lista publicada» y, si falta, «Falta contar el cajón antes de atender», usando el estado devuelto y la misma condición del mostrador.

Otros textos cotejados sin un defecto nuevo: corrección de inventario aclara que no cambia el comprobante/dinero; corrección de cuenta dice que liquida la diferencia; fiado se presenta como deuda y no efectivo; recipiente distingue material recibido de descuento; nombre de cuenta se declara interno y no se imprime. El texto de fiado «con los mismos datos» no está garantizado por la pantalla (R33-3), y «quien ponga su clave queda registrado» no se cumple para reintento cambiado de vehículo (R33-2).

## Demostración — parte opcional alcanzada

Leída la rama de caja en `consola/demo.ts:295–309,352–357,462–508`: usa las entradas de negocio para apertura/movimiento/corte, toma como fondo sugerido lo dejado, limita contado a no negativo y lo que se queda al mínimo entre contado y $3,000, y marca como vistos los avisos antiguos. La reubicación temporal usa `llevar`/`conReplica` y ajusta fechas de gastos y plazos al día inventado.

`sh qa/prueba.sh pruebas/40-demo.test.ts 'C.9'`: **1 aprobada**, 21 días, semilla 71, base desechable (`qa/revision33-demo.log`). Cada jornada cerrada tiene apertura y un único corte; esperado = saldo calculado después del corte + retirado; deudas no negativas; hay fiado/abonos/gastos; fechas válidas y utilidad = resultado − gastos. **No se ejecutó la consola contra la demostración del usuario.** No se hizo una comprobación adicional exhaustiva de cada aviso ni de otras semillas; su coherencia se revisó por lectura de los caminos de apertura/corte. No apareció un hallazgo nuevo en este caso.

## Pruebas complementarias de las pantallas y cierre de evidencia

- Arranque/precios, selección de `14-dia-precios`: **7 aprobadas**, `qa/revision33-arranque-precios.log`: saldos y atomicidad, arranque repetido/concurrente, precios parciales, rechazo atómico y publicación inmutable.
- Inventario, selección de `19-dominio-inventario`: **4 aprobadas**, `qa/revision33-inventario.log`: conteo, merma/separación por rutas, corrección con otro material y cancelación que resuelve si entró. Son pruebas de dominio/rutas, no recorridos de UI.
- Recuperación de comprobante, callback original: **1 demostración aprobada**, `qa/revision33-recuperacion.log`: falla GET, desaparece el pendiente y no se vuelve a consultar en la siguiente carga. Completa R33-4 sin navegador.

## Sospechas y cobertura pendiente (no son hallazgos demostrados adicionales)

1. **Precio editable durante guardado:** `src/app/precios/page.tsx:47–48,78,135–140` deja inputs activos y `recibir` reemplaza todo lo escrito al contestar. Una edición hecha mientras espera podría perderse; no se ejecutó esa secuencia, ni se atribuye al rediseño. Propuesta si se confirma: congelar campos durante envío o preservar cambios posteriores mediante una revisión local.
2. **Alta de cliente en fiar:** rama tardía de `0043:475–477`, después de patio/clave. No cumple literalmente el orden anunciado si crea/resuelve un cliente en carrera. No se demostró un deadlock por este camino. Revisar serialización de nombres antes de patio y el resto de altas/autorizaciones.
3. **Corrección de inventario y jornada tardía:** comparte el patrón señalado en R33-1; el deadlock ejecutado fue contar contra mover. No se completó la matriz de todas las funciones/roles/candados.
4. **Setter de recipiente:** falta prueba de respuestas invertidas al editar tara; no se demostró dinero ni kilos incorrectos por esta vía.
5. **No ejecutado por instrucción:** batería completa, recorridos de navegador, simulacros, impresión/PDF visual ni equipo real. Por tanto no se certifican geometría, foco real, scroll móvil, teclado virtual, giro, zoom, lectores de pantalla, rendimiento de vidrio ni fidelidad física de impresión.
6. **Sin historia Git en la copia:** no se puede atribuir cada línea actual al cambio del 10 de octubre. La revisión evalúa el producto presente y la cobertura documentada, no demuestra ausencia absoluta de cambios históricos de comportamiento.
7. **H6:** no se examinó ni alteró la base real para confirmar la excepción documentada de no tener historia anterior a 0039. El defecto del algoritmo histórico permanece; se mantiene separado de los siete hallazgos actuales de esta pasada.

## Ejecuciones y archivos de esta pasada

Todas las pruebas se lanzaron de una en una mediante `qa/prueba.sh`, con la plantilla de Codex y bases desechables. No hubo `npm ci/install`, sustitución de Compose ni escrituras en el proyecto del Escritorio. No se corrigió código de aplicación. Se crearon únicamente tres archivos de prueba (`pruebas/90-revision-33-{caja,pantalla,estilo}.test.ts`), los logs `qa/revision33-*.log` en la copia y este informe en la ruta solicitada. No hizo falta rehacer la plantilla: la suite 56 confirmó que 0043 ya estaba aplicada.

Las ejecuciones válidas cubren **64 casos distintos aprobados**, incluidos los que aprueban al demostrar un defecto: 8 de 56; 7 sondas de caja (2 conciliaciones y 5 de la segunda corrida); 7 sondas de pantalla (6 + recuperación); 11 recipiente; 1 panel; 2 entradas/nombre; 14 estilo; 2 pares adicionales; 7 arranque/precios; 4 inventario; 1 demo. No son 64 pruebas de regresión que certifiquen que todo esté bien. La corrida inicial de la sonda de caja tuvo cuatro fallos de instrumentación (PID consultado detrás de la sentencia bloqueada); quedó conservada en `qa/revision33-caja.log`, se corrigió solo la sonda y se repitieron los casos afectados. No se ocultaron fallos del producto.


---

## El encargo

```text
REVISIÓN DE CALIDAD, una sola pasada: las pantallas que quedaron sin revisar (el rediseño y el recipiente).
Proyecto: gestión de una recicladora (Next.js 16, React 19, PostgreSQL 17, Docker Compose). Todo en español.
TU COPIA DE TRABAJO: /tmp/feruga-codex-qa14/   (al día)
TU INFORME: /tmp/feruga-codex-informe-33.md

REGLAS (obligatorias)
- No modifiques, crees ni borres ningún archivo dentro de /Users/maantora/Desktop/feruga.
  Trabaja SOLO en /tmp/feruga-codex-qa14/. No ejecutes npm ci ni npm install. No sustituyas su
  docker-compose.yml. Una sola corrida a la vez.
- No toques los contenedores feruga-web-1 y feruga-db-1 más allá de lo que hacen los guiones de
  qa/, ni la base «feruga»: son del usuario.
- NO TE DETENGAS A PREGUNTAR: ante una duda, decide, anótalo en el informe y sigue.
- Tu cuota puede cortarse. Crea el informe al empezar y GUÁRDALO después de cada parte.

HERRAMIENTAS: las de qa/ (ver qa/LEEME.md). Puedes correr pruebas existentes una por una
(pruebas/27-estilo y las del recipiente, entre otras) y escribir pruebas nuevas en tu copia
(pruebas/90-revision-*.test.ts). NO corras la batería completa, los recorridos del navegador ni los
simulacros (comparten una base): lee los recorridos de recorrido/ para saber qué cubren. NO corrijas
el código: anota el arreglo que propones.

QUÉ REVISAR, EN ESTE ORDEN
0. LO QUE SE CORRIGIÓ DE TU REVISIÓN DE LA CAJA (informe 31): la migración
   db/migraciones/0043_lo_que_encontro_la_revision_de_caja.sql, src/servidor/dominio/ganancia.ts,
   src/servidor/bd.ts (instantanea), src/componentes/cierre/Correcciones.tsx, src/app/cierre/page.tsx,
   src/componentes/mostrador/Mostrador.tsx y Fiar.tsx; lo que se hizo con cada hallazgo está en
   docs/revisiones/2026-10-21-respuesta-a-la-revision-de-caja-y-ganancia.md, y sus pruebas en
   pruebas/56-revision-de-caja.test.ts. Para cada H1–H10: ¿cerrado o no? Mira en especial: que «a lo
   fiado» no deje el saldo del cliente negativo por ningún camino (dos correcciones a la vez, una
   corrección contra un abono); que el orden jornada → cliente → patio → clave se respete en todas
   las funciones; y que Ganancia siga cuadrando con caja + patio cuando una corrección cambia de
   material. Si te sobra, la parte 8 que no alcanzaste: la demostración (consola/demo.ts).
1. EL RECIPIENTE EN LA BÁSCULA CHICA Y EL NOMBRE DE CADA CUENTA (14 de octubre; plan
   docs/planes/2026-10-14-recipiente-y-nombre-de-cuenta.md; migración 0037 «poner_recipiente» y la
   octava entrada de agregar_material; la pantalla en src/componentes/mostrador/; el ticket). Lo que
   pesa vacío el costal o la carretilla se teclea y va a la tara: ¿baja lo que se paga y lo que entra
   al patio, nunca más que lo pesado, solo en la báscula chica, y no cambia una cuenta ya cobrada?
   ¿Aparece en el ticket y en «Para vigilar» del panel como se dice? Cambiar el nombre de una cuenta
   no sale en el ticket.
2. LO CORREGIDO EL 9 DE OCTUBRE DE TU REVISIÓN DEL REDISEÑO (parte E; ver
   docs/revisiones/2026-10-07-respuesta-a-la-decima-revision.md, sección E): Enter sobre un control
   al que se llegó con Tab; el aro del foco del enlace actual en claro; el interruptor de «más
   contraste» cuando falla guardar; la imagen de la hoja impresa como guardia; el medidor en
   diagonal; letra de 17 px salvo la lista de rótulos. Para cada uno: ¿cerrado o no?
3. LAS TAREAS 3 A 7 DEL REDISEÑO, hechas juntas el 10 de octubre y nunca revisadas (plan
   docs/planes/2026-10-04-rediseno-de-la-interfaz.md: lo que pedía cada tarea, cómo se hizo y qué no
   se hizo; y «Lo que hay que mirar con lupa», al final). El mostrador, el comprobante en pantalla,
   el arranque, los precios, el cierre, el inventario y la limpieza. Sobre todo: que rediseñar no
   haya cambiado lo que hace cada pantalla; que una hoja (el <dialog>) nunca sirva de atajo para
   soltar un envío del que no se sabe si entró; las tres apariencias (claro, oscuro, más contraste);
   y que el papel impreso no cambió.
4. SI ALCANZA: estilos que choquen entre hojas (src/estilo/*.css; pruebas/27-estilo) y textos de
   pantalla que digan algo distinto de lo que hace el servidor.

AL TERMINAR: el informe completo en /tmp/feruga-codex-informe-33.md. Para cada punto de 2: CERRADO
o NO CERRADO, con la evidencia. Para cada hallazgo: gravedad (alta: datos o dinero mal, o una
pantalla que suelta algo que no debe; media: falla que alguien puede encontrar; baja: claridad o
estilo), dónde (archivo y línea), cómo reproducirlo y el arreglo que propones. Separa lo demostrado
de lo sospechado, y di qué no alcanzaste. En tu respuesta final, solo tres renglones y la ruta del informe.

```
