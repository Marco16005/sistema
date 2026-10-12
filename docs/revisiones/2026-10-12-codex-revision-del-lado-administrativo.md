# Codex revisa: el lado administrativo

> **12 de octubre de 2026.** Una pasada de revisión de Codex (`gpt-6-astra`, esfuerzo alto) sobre lo que
> no escribió él: el servidor del panel, lo agregado a la historia de precios y a los clientes, las
> pantallas, imprimir y las guardas del sembrador. **Terminó completa.** Encargo: `encargo-19` (al
> final). Tres hallazgos «importante», los tres sin confirmar por él (pedían un recorrido); lo que
> se hizo con cada uno está en «Respuesta».

## El informe de Codex, tal cual

1. Números del panel contra el cierre: sin hallazgos; misma imputación por confirmada_en_jornada. Sonda: sh qa/prueba.sh pruebas/37-panel.test.ts 'la serie trae|lo anterior al periodo|trece tramos' → «pass 3; fail 0». Vehículo, descarte y reapertura revisados por lectura, sin recorrido adicional.
2. Orillas del periodo: sin hallazgos; límites inclusivos disjuntos, 13 semanas completas y hoy_en(s.id). La sonda del punto 1 confirma serie y periodo anterior; zona horaria revisada por lectura.
3. Quién lo ve: sin hallazgos; ocho rutas cerradas por rol/persona, pantallas cortan antes de pintar datos y CSV selecciona campos del negocio. Sonda: sh qa/prueba.sh pruebas/39-bitacora.test.ts 'sin revelar datos internos|ruta: responsable' → «pass 2; fail 0».
4. Control e inventario valuado: sin hallazgos por lectura; ajuste sin jornada usa creado_en en zona del patio, especiales usan la misma regla de 0025 y la valuación suma los mismos renglones redondeados (incluidos negativos; sin precio se indica y excluye). Sonda: sh qa/prueba.sh pruebas/37-panel.test.ts 'el control|inventario' → «pass 1; fail 0».
5. Historia de precios: sin hallazgos; null→null no genera cambio, veces no puede ser negativo y cero evita la división. Sonda: sh qa/node.sh qa/sonda19-precios.ts → «desde=2026-10-03», «alEmpezar:null», primer cambio 04/10 con compra 0.0001, «veces:0», variación 0.0; precio presente dos listas atrás y ausente en la inmediata anterior.
6. Pantallas, respuestas atrasadas y errores:

### [importante] Un comprobante atrasado sustituye la ficha que ya se está viendo
Dónde: src/app/panel/clientes/page.tsx:70; src/app/panel/dias/page.tsx:77
Escenario: abrir comprobante de A con red lenta → volver a la lista → abrir B → llega el comprobante de A y sustituye B. Su error tardío también se muestra en B. La ficha sí usa viendo; el comprobante no.
Confirmado con: Sin confirmar: para correr aquí; retener GET /api/comprobantes?folio=A hasta abrir la ficha B y luego soltarlo.
Corrección sugerida: invalidar la petición de comprobante al cambiar ficha o volver; verificar un contador y la ficha de origen antes de aplicar éxito o error.

### [importante] La bitácora conserva filas de otro filtro y puede mezclarlas al paginar
Dónde: src/app/panel/bitacora/page.tsx:36
Escenario: cargar Todas → cambiar Quién a B → siguen visibles filas de A; si falla la carga permanecen bajo B. Con hayMas previo, pulsar anteriores antes de que llegue B invalida la carga inicial y agrega la página filtrada a las filas anteriores.
Confirmado con: Sin confirmar: para correr aquí; retrasar GET /api/bitacora?persona=B y pulsar la paginación antes de liberarlo; repetir devolviendo 500.
Corrección sugerida: asociar filas y cursor al filtro que las produjo; al cambiar filtro vaciar/inhibir paginación hasta recibir su primera página.

6. Resto: sin hallazgos por lectura en el cambio A→B de fichas; resumen/precios conservan el rótulo de sus datos. Reportes deshabilita todos los Bajar durante la descarga y muestra el error 401 sin generar CSV.
7. Guardas del sembrador:

### [importante] Una interrupción deja la demostración parcial y bloquea el reintento
Dónde: consola/demo.ts:142; consola/demo.ts:129
Escenario: sembrar en desarrollo → confirmar la primera cuenta → interrumpir antes de desplazar sus fechas o antes de terminar los días → quedan acciones ya confirmadas; repetir «demo sembrar» rechaza con «la demostración ya tiene movimiento». No hay marca persistente que distinga siembra incompleta de datos previos ni aviso específico de recuperación.
Confirmado con: Sin confirmar: para correr aquí; en base desechable, interrumpir entre accion() y conReplica() de llevar y comprobar cuentas persistidas y rechazo al reintentar. No ejecutado: esta pasada excluye simulacros.
Corrección sugerida: sembrar en una base desechable y entregarla solo al terminar, o hacer atómica la siembra; si se mantienen commits parciales, registrar estado incompleto y dar una recuperación explícita.

7. Guardas restantes: MODO y ausencia de confirmadas se validan antes de escribir; SET LOCAL y ROLLBACK no dejan disparadores apagados fuera de su transacción. Menor, remoto: el advisory lock solo coordina sembradores; una escritura normal concurrente tras la guarda podría mezclarse y sufrir el desplazamiento (hipótesis, consola/demo.ts:122).
8. Imprimir: sin hallazgos de superposición por lectura; Días y Clientes retornan Ticket antes del contenedor imprimible, y Ticket contiene papel. Nunca montan ambas ramas a la vez; no se corrió navegador.
9. Extracción del reporte: sin diferencias internas detectadas; cierre usa los componentes compartidos Kilos, PreciosEspeciales y Dinero e inserta las acciones mediante children. Sin confirmar: equivalencia histórica de textos/condiciones/orden; esta copia no contiene .git ni la versión anterior de cierre/page.tsx para compararla.


## Respuesta

Los tres hallazgos venían «sin confirmar: para correr aquí». Se escribió el recorrido de cada uno
antes de tocar el código, y **los tres fallaron como Codex dijo**; después se corrigieron.

1. **Un comprobante atrasado sustituye lo que ya se está viendo** (días y clientes) — *cierto,
   corregido*. La ficha sí descartaba la respuesta atrasada; el comprobante, no. Ahora cada pantalla
   lleva la cuenta del último comprobante que pidió, y abrir otro día (u otro cliente) o volver a
   la lista deja sin efecto el que venga en camino. Recorridos: «en los días, un comprobante que
   llega tarde…» y «en los clientes, un comprobante que llega tarde…».
2. **La bitácora conserva filas de otra búsqueda y puede mezclarlas al pedir lo anterior** —
   *cierto, corregido*. Al cambiar lo que se busca, lo que había se quita antes de pedir: mientras
   llega lo nuevo se ve «Un momento…», no hay botón de «Ver lo anterior» que mezcle, y si la
   búsqueda falla queda el aviso solo, no las filas de antes bajo otro nombre. Recorrido: «en la
   bitácora, al cambiar lo que se busca deja de verse lo anterior…».
3. **Una siembra interrumpida deja la demostración a medias y bloquea el reintento** — *cierto; se
   dejó como está y ahora lo dice*. El sembrador es una herramienta de desarrollo: hacerlo atómico
   pediría sembrar en una base aparte y entregarla al final. No se hizo. Lo que cambió: el rechazo
   ya no dice solo «ya tiene movimiento», dice que una siembra interrumpida no se retoma y que hay
   que empezar con una base nueva (`pruebas/40-demo`, C.7). El README ya decía cómo volver a una
   base vacía.

El «menor» del punto 7 (una escritura normal que se cuele mientras se siembra) no se atendió: es
una base de desarrollo, sin nadie más escribiendo.

Del punto 9 (la extracción del reporte) Codex no pudo comparar contra la versión anterior porque su
copia no tiene Git. Aquí sí se puede: el cierre conserva sus recorridos de antes (`dos-jornadas`,
`reabrir-el-dia`, `papel`), que pasaron sin cambios después de la extracción.

### Aparte: fórmulas en los archivos para Excel

No lo encontró esta pasada (exportar lo escribió Codex y quedó fuera de su propia revisión), sino la
revisión automática de seguridad del guardado `a1b61a8`: la protección contra fórmulas miraba solo
el primer carácter de la celda. Un mismo archivo lo leen distinto varios programas: donde las listas
se separan con punto y coma, un nombre como `x;=1+1` —que aquí es una celda— allá son dos, y la
segunda empieza con `=`. Ahora, en las columnas con texto escrito por una persona, se desarma la
fórmula en cualquier lugar donde pudiera quedar al principio de una celda: tras coma, punto y coma,
tabulador o renglón; escondida tras espacios; o escrita con signos de ancho completo. Tres pruebas
nuevas en `pruebas/43-exportar` (dos se vieron fallar; la tercera comprueba que no se toca lo que
no es fórmula: «Ana-María», «correo@ejemplo.com»).

## El encargo

```text
Revisión de control de calidad, UNA sola pasada y corta: EL LADO ADMINISTRATIVO (el panel de quien
dirige), construido el 11 y el 12 de octubre de 2026. Revisa lo que NO escribiste tú.
Proyecto: gestión de una recicladora (Next.js, PostgreSQL, Docker Compose).
TU COPIA DE TRABAJO: /tmp/feruga-codex-qa12/   (al día con el proyecto, 12 de octubre de 2026)
EL INFORME: /tmp/feruga-codex-informe-19.md

CÓMO VA ESTA PASADA
Tu cuota puede cortarse a los pocos minutos. Gasta en pensar y en confirmar con una sonda; no en
leer de más. Crea el informe al empezar con la lista de los puntos y GUÁRDALO después de cada punto.
NO TE DETENGAS A PREGUNTAR: ante una duda, decide, anótalo y sigue. Los puntos van en orden de
importancia: si se corta, que haya quedado lo primero.

YA ESTÁ PREPARADO — no lo rehagas
- La copia, sin node_modules. La plantilla feruga_plantilla_codex, con las 29 migraciones.
- Comandos (ver qa/LEEME.md):
    sh qa/prueba.sh <archivo de pruebas> ['parte del nombre']
    sh qa/sql.sh "<SQL>"
    sh qa/node.sh <programa.ts>          (tus sondas van en qa/)
- NO corras la batería completa, ni los recorridos del navegador, ni los simulacros: aquí ya se
  corrieron. Si para confirmar algo hace falta un recorrido, escribe el caso exacto y márcalo
  «Sin confirmar: para correr aquí».

REGLAS (obligatorias)
- No modifiques, crees ni borres ningún archivo dentro de /Users/maantora/Desktop/feruga.
  Trabaja en /tmp/feruga-codex-qa12/ (ahí sí puedes crear sondas tuyas, en qa/). No corrijas el
  código: di qué está mal y cómo se arregla. No sustituyas su docker-compose.yml. No ejecutes npm ci
  ni npm install. Una sola corrida a la vez.
- No toques los contenedores feruga-web-1 y feruga-db-1 ni la base «feruga»: son del usuario.
- Formato, corto. Por hallazgo:
    ### [bloqueante | importante | menor] título
    Dónde: archivo:línea
    Escenario: los pasos concretos (entradas → resultado malo)
    Confirmado con: el comando y el renglón de su salida  —o—  «Sin confirmar: hipótesis» / «para correr aquí»
    Corrección sugerida: una o dos líneas
  Por punto sin hallazgos: un renglón. Sin introducciones. En español.
- Importa lo que ve quien dirige el negocio: un número que no cuadra con el cierre, un día que se
  cuenta dos veces o no se cuenta, algo que ve quien no debe. Lo remoto, en un renglón como «menor».
  No reportes estilo ni gustos.

QUÉ SE CONSTRUYÓ (lo que revisas)
- src/servidor/dominio/panel.ts — `panel(bd, { dias: 7 | 30 | 91, hasta? })`: UNA consulta que
  devuelve totales del periodo y del anterior, el cambio en por ciento, la serie por día (o por
  semana a 91 días), materiales, personas, horas, inventario valuado con la última lista publicada,
  y el «control» (mermas, ajustes, precios especiales, reaperturas). Regla: una cuenta es del día de
  `confirmada_en_jornada`, igual que el cierre (vistas cierre_resumen y cierre_material, 0010_cierre.sql).
  Ruta: src/app/api/panel/route.ts. Pruebas: pruebas/37-panel.test.ts.
- En src/servidor/dominio/historia-de-precios.ts (el resto es tuyo): lo agregado aquí son `base`,
  `variacion` y `veces` (las funciones `par` y `variacion`, y la subconsulta `x`).
- En src/servidor/dominio/clientes.ts (el resto es tuyo): `resumenDeClientes` y sus totales.
- Las pantallas: src/app/panel/page.tsx (resumen), src/app/panel/dias/, precios/, clientes/,
  bitacora/, reportes/; src/componentes/panel/ (Graficas.tsx con `Barras`, `Tira` y `Escalones`;
  Secciones.tsx; Imprimir.tsx; tipos.ts); src/estilo/panel.css (al final, lo de imprimir: `.imprimible`).
- src/componentes/cierre/Reporte.tsx — las tarjetas del reporte de un día, sacadas de
  src/app/cierre/page.tsx para compartirlas con «Días». Debe ser una extracción sin cambio de conducta.
- src/componentes/Sesion.tsx — el enlace «Panel» en la barra (DIRIGEN) y `aria-current` por prefijo.
- consola/demo.ts — el sembrador de la demostración: lo empezaste tú y se terminó aquí. Revisa solo
  sus GUARDAS (punto 7), no los datos que inventa.

LOS PUNTOS, en este orden
1. LOS NÚMEROS DEL PANEL CONTRA EL CIERRE. Busca un caso en que un día de la serie NO diga lo que
   `resumenDelCierre` de esa jornada (cuentas, pagado, cobrado), o en que la suma de la serie no sea
   el total del periodo. Piensa en: el vehículo que llega un día y se termina otro; un día reabierto
   y vuelto a cerrar; una cuenta descartada.
2. LAS ORILLAS DEL PERIODO. ¿Un día se cuenta en dos tramos, o en ninguno? El primer y el último
   día; el periodo anterior; 91 días en 13 semanas; «hoy» cuando el servidor y el patio están en
   zonas distintas (hoy_en usa sucursal.zona).
3. QUIÉN LO VE. Las rutas GET panel, historial, historial/[jornada], bitacora, precios/historia,
   clientes/resumen, clientes/[cliente] y exportar piden responsable o consulta. ¿Alguna deja pasar
   a otro rol, o a un equipo sin persona? En las pantallas: ¿algo del panel se le alcanza a pintar
   al mostrador antes del aviso «El panel es para quien dirige el negocio»? ¿La bitácora enseña algo
   que consulta no debería saber (claves, códigos de alta, secretos de equipo)? ¿El archivo de
   exportar puede traer algo que la pantalla no enseña?
4. EL CONTROL Y EL INVENTARIO VALUADO. Mermas y ajustes por la fecha de su jornada (o la del asiento
   si no tienen): ¿un ajuste hecho con el día cerrado cae en algún periodo? Precios especiales: ¿la
   misma regla que precios_especiales_del_dia (0025)? ¿Uno quitado antes de cobrar cuenta? No debe.
   El inventario: la última lista PUBLICADA, no la de hoy sin publicar; un material con existencia
   negativa o sin precio; ¿el «valor» total puede no ser la suma de los renglones que se enseñan?
5. LO AGREGADO A LA HISTORIA DE PRECIOS. `base` = lo que valía al empezar o, si no tenía precio, el
   primer cambio del periodo. La consulta supone que, sin precio al empezar, el primer cambio SIEMPRE
   trae precio (`c.cambios->0`). ¿Hay un caso en que el primer cambio del periodo sea «se quedó sin
   precio» con `alEmpezar` nulo? (Piensa en un material que tenía precio dos listas atrás, pero no
   en la inmediata anterior a `desde`.) ¿`veces` puede salir mal o negativo? ¿`variacion` divide
   entre cero o da algo absurdo con precios muy chicos?
6. LAS PANTALLAS: RESPUESTAS ATRASADAS Y ERRORES. Resumen, precios y bitácora descartan la respuesta
   que no es de su última petición (un contador `ultima`); días y clientes, la ficha que no es del
   que se está viendo (`viendo`). ¿Queda algún camino en que se pinte lo de una petición vieja
   bajo el rótulo de otra? En clientes: se abre la ficha de A, se vuelve a la lista y se abre B
   antes de que llegue A. En reportes: dos «Bajar» seguidos; un 401 a media descarga. ¿Qué se ve si
   una petición falla a media vida de la pantalla (el aviso se queda para siempre, o tapa datos buenos)?
7. LAS GUARDAS DEL SEMBRADOR (consola/demo.ts). Solo debe correr con MODO=desarrollo y sobre una
   base sin ninguna cuenta confirmada. Recorre marcas de tiempo como dueño de la base, con los
   disparadores apagados (`SET LOCAL session_replication_role = replica`) dentro de una transacción.
   ¿Hay forma de que corra, entero o a medias, sobre una base con datos de verdad? ¿Si se interrumpe
   a la mitad deja los disparadores apagados o la base a medias sin decirlo?
8. IMPRIMIR. src/estilo/panel.css, al final: en papel se ve solo `.imprimible`. El comprobante se
   imprime por su lado (src/estilo/comprobante.css: solo `.papel`). ¿Hay alguna pantalla en que
   estén a la vista a la vez `.imprimible` y `.papel`, de modo que el comprobante salga con el panel
   encima, o al revés? Lee src/app/panel/dias/page.tsx y src/app/panel/clientes/page.tsx (ahí se
   abre un comprobante) y src/componentes/mostrador/Ticket.tsx.
9. LA EXTRACCIÓN DEL REPORTE. Compara src/componentes/cierre/Reporte.tsx con lo que tiene
   src/app/cierre/page.tsx. ¿Cambió algún texto, alguna condición, o el orden de lo que se pinta?
```
