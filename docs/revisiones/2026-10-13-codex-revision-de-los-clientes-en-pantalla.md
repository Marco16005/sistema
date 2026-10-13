# Codex revisa: los clientes desde la pantalla

> **13 de octubre de 2026.** Una pasada de revisión de Codex (`gpt-6-astra`, esfuerzo alto) sobre la migración
> 0033, su dominio, sus rutas y la parte de Clientes de la pantalla de Ajustes. No lo escribió él.
> **Terminó completa.** Encargo: `encargo-23` (al final).
> No encontró carreras ni cómo usar las entradas nuevas sin ser responsable. Encontró dos «importantes», los dos
> sobre los nombres, y un «menor» de la pantalla; lo que se hizo con cada uno está en «Respuesta».

## El informe de Codex, tal cual

1. Copia: sin hallazgos. Comparación literal: iguales salvo las dos sustituciones; ninguna redefinición en 0028–0032. Catálogo PostgreSQL: dueño feruga, SECURITY DEFINER, search_path=public, pg_temp, EXECUTE solo feruga/feruga_app.

2. Carreras: sin hallazgos. `sh qa/node.sh qa/sonda23.ts`: cuatro órdenes baja/precio por id/nombre con bloqueo verificado (baja primero → RC005; precio primero → baja espera); alta/precio en ambos órdenes → un cliente, sin 23505/40P01; cambios opuestos → estado final y bitácora coherentes.

3. Nombres:

### [importante] Se admiten clientes invisibles y duplicados a la vista

Dónde: db/migraciones/0033_clientes_en_pantalla.sql:31; db/migraciones/0025_precio_especial.sql:37
Escenario: dar de alta U+200B (ancho cero) → cliente invisible; «Ana Paz» (U+00A0) y «Ana Paz» → dos clientes; «José» y «JOSÉ» (acento descompuesto) → dos clientes. `texto()` admite todos estos caracteres; el formulario también deja pasar U+200B.
Confirmado con: `sh qa/node.sh qa/sonda23.ts` — `NOMBRE {"entrada":"​","ruta":true,"mostrador":"​","ajustes":"​","alta":"​"}`; ambas variantes de Ana y José se insertan.
Corrección sugerida: centralizar normalización Unicode NFC y blancos, rechazar nombres sin caracteres visibles y aplicar la misma regla en ambas altas y en la unicidad; resolver duplicados existentes antes de cambiar el índice.

### [importante] El mostrador admite un nombre en blanco o devuelve 23514 con blancos Unicode iniciales

Dónde: db/migraciones/0033_clientes_en_pantalla.sql:100; db/migraciones/0025_precio_especial.sql:37
Escenario: precio especial con cliente nuevo U+2003 → guarda « »; con U+2003 + «Empresa» → viola el CHECK (23514). Ajustes rechaza el primero y limpia el segundo. Alcanzable por la API: `texto()` permite U+2003; el formulario normaliza antes de enviar. Con tabulador ocurre solo por SQL, pues la ruta lo rechaza.
Confirmado con: `sh qa/node.sh qa/sonda23.ts` — `DAR NOMBRE {"entrada":" ","guardado":" "}` y `DAR NOMBRE {"entrada":" Empresa","error":"23514"}`.
Corrección sugerida: recortar después de convertir blancos en el normalizador compartido y exigir explícitamente nombre no nulo/no vacío en el CHECK; sanear nombres en blanco que ya existan.

4. Quién: sin hallazgo nuevo. Rutas usan persona.id de sesión; roles revisados en código y pruebas existentes, sin repetirlas. `sh qa/node.sh qa/sonda23-rutas.ts`: responsable sin facultad OK, usuario falso del cuerpo ignorado, sesión dada de baja → 401 en ambas entradas. Catálogo SQL: INSERT/UPDATE/DELETE y las tres funciones de consola → false. Límite confirmado: con credenciales SQL de feruga_app se puede pasar el id de otro responsable; es la confianza en el servidor documentada en 0011_permisos.sql:5, no una protección de identidad ofrecida por estas funciones ni un acceso encontrado por HTTP.

5. Pantalla: sin fallo demostrado en doble toque, orden de respuestas o traslado del mensaje; botones deshabilitados durante POST, descarte de GET anteriores y mensaje asociado al id en ambas listas. Revisión estática, sin navegador.


### [menor] Un nombre válido sin espacios puede desbordar el teléfono

Dónde: src/componentes/ajustes/Clientes.tsx:86; src/componentes/ajustes/Clientes.tsx:100; src/estilo/ajustes.css:7
Escenario: a 360 px, pegar 80 «W», revisar el botón de alta, guardar y abrir la confirmación de baja → el nombre carece de puntos de corte y puede salir del botón y del renglón, obligando a desplazarse horizontalmente.
Confirmado con: Sin confirmar: para correr aquí. Ejecutar esos pasos y comprobar `document.documentElement.scrollWidth > document.documentElement.clientWidth`; no hay regla de corte para estos nombres en el CSS revisado.
Corrección sugerida: permitir corte de palabras largas en nombres, mensajes y etiqueta del botón (`overflow-wrap:anywhere`), conservando el nombre completo.
6. Otros graves: sin hallazgos adicionales en el alcance. CSV comprobado con comillas, coma, punto y coma y fórmulas (`sh qa/node.sh qa/sonda23-rutas.ts`); se escapan/protegen. La bitácora conserva el nombre como dato; los nombres invisibles quedan incluidos en el punto 3.

## Respuesta

1. **[importante] Clientes invisibles y duplicados a la vista** — *cierto, corregido*. La regla de
   nombres de la migración 0025 solo recortaba espacios comunes. Ahora hay una sola regla
   (`nombre_de_cliente`, reescrita en la 0033) para los ajustes, el mostrador y la consola: la misma
   letra escrita de dos maneras queda de una (NFC); lo que no se ve —ancho cero, marcas de dirección,
   guion opcional, selectores— se quita; todo blanco, sea el que sea, es un espacio, sin dos seguidos
   ni a las orillas; y lo que queda vacío no es un nombre. «Jose» y «José» siguen siendo dos, como
   decidió la 0025. Prueba: «nombres: lo que se ve igual es el mismo cliente…»
   (`pruebas/46-clientes-en-pantalla`).

2. **[importante] El mostrador admitía un nombre en blanco o devolvía un error crudo (23514)** —
   *cierto, venía de la 0025, corregido con lo mismo*. `dar_precio_especial` usa la misma regla, así
   que un cliente nuevo hecho de puros blancos ya no es nadie (se rechaza antes de mirar la clave) y
   el que trae blancos raros alrededor queda limpio. Además la tabla lo exige diciéndolo completo:
   la restricción comparaba el nombre contra «nada» cuando la regla lo dejaba vacío, y eso no la
   violaba. **Los clientes que ya existían** pasan por la regla nueva al migrar: al que quedaría sin
   nombre se le pone «Cliente sin nombre (número)», y al que quedaría igual a otro, su nombre con su
   número; ninguno se pierde ni se junta con otro, y se corrigen renombrándolos por la consola.
   Pruebas: «nombres, en el mostrador…» y «al migrar, los clientes que ya existían…». En la
   demostración ningún nombre cambia.

3. **[menor] Un nombre sin espacios puede desbordar el teléfono** — *cierto, corregido en la pantalla
   de Clientes de los ajustes*. Se reprodujo primero: con ochenta «W», a 360 px la página medía 762.
   Ahora el nombre se parte donde haga falta en su renglón, en el botón que lo nombra, en lo que se
   pregunta y en lo que se contesta. La medida de patio de los ajustes usa ese nombre en los tres
   tamaños. **No se revisó en las demás pantallas** que enseñan el nombre de un cliente (la hoja de
   precio especial del mostrador, la cuenta, el comprobante, Clientes del panel): un nombre así ya
   se podía dar de alta desde el mostrador antes de este cambio, y no es de esta pieza.

Además, el aviso de «quedó dado de alta» dice ahora el nombre como quedó guardado, no como se tecleó.

Lo que Codex confirmó sin hallazgos: la copia de `dar_precio_especial` es la de la 0027 letra por
letra salvo el mensaje; las carreras (baja contra precio, en los dos órdenes, por número y por
nombre; alta contra precio con el mismo nombre; dos cambios opuestos) terminan bien; las rutas toman
a la persona de la sesión, y la aplicación sigue sin escribir la tabla ni llamar las funciones de la
consola.

### Aparte: lo que señaló la revisión de seguridad del guardado

Al guardar lo anterior (`1f6f489`), la revisión automática de seguridad del guardado señaló en la
migración 0033 una diferencia entre lo que la regla de nombres deja y lo que la tabla comprueba,
con la que alguien podía hacerse pasar por otro cliente. El aviso llegó sin el detalle, así que se
buscó y se comprobó contra la base:

- La regla quitaba lo invisible **después** de juntar cada letra con su acento. Un invisible entre
  la «e» y su acento impedía juntarlos, y al quitarlo quedaba una «é» en dos piezas: distinta de
  «José» para la base, igual a la vista. Ni siquiera era estable —aplicada otra vez daba otra
  cosa—: la tabla la rechazaba con un error crudo y el mostrador contestaba 500.
- No conocía lo invisible de fuera del plano básico (selectores de variación del plano 14,
  etiquetas, marcas de formato), ni los caracteres de control, ni el blanco braille: «Don Chuy»
  con uno de esos era otro cliente.

*Corregido en la migración 0034* (aparte, porque la 0033 ya estaba aplicada en la demostración):
primero se quita todo lo que Unicode manda no pintar y los caracteres de control, después los
blancos, y al final se juntan las letras con sus acentos; en ese orden la regla aplicada a su
propio resultado no cambia nada. Los clientes que ya existían vuelven a pasar por ella. Las pruebas
se escribieron primero y fallaron como se esperaba («nombres, sin resquicios…», tres pruebas en
`pruebas/46-clientes-en-pantalla`).

**Lo que no se cierra, a propósito:** letras de otro alfabeto que se dibujan igual (una «а»
cirílica por una «a») y las formas de compatibilidad (la ligadura «ﬁ», las letras de ancho
completo). Juntarlas cambiaría también lo que alguien sí quiso escribir («Nº» pasaría a «No»), o
pediría una tabla de parecidos. Un cliente en la lista no da nada por sí solo —cada precio especial
pide la clave de quien autoriza, que lee el nombre antes de teclearla—; lo que un nombre parecido
puede hacer es repartir en dos renglones lo que se le dio a uno, y eso se ve en Clientes.

## El encargo

```
Revisión de control de calidad, UNA sola pasada y corta: LOS CLIENTES DESDE LA PANTALLA (migración
0033 y lo que cuelga de ella) y su parte en la pantalla de Ajustes. No lo escribiste tú. Revisa
como quien quiere romperlo.
Proyecto: gestión de una recicladora (Next.js, PostgreSQL, Docker Compose).
TU COPIA DE TRABAJO: /tmp/feruga-codex-qa12/   (al día con el proyecto, 13 de octubre de 2026)
EL INFORME: /tmp/feruga-codex-informe-23.md

CÓMO VA ESTA PASADA
Tu cuota puede cortarse a los pocos minutos. Gasta en pensar y en confirmar con una sonda; no en
leer de más. Crea el informe al empezar con la lista de los puntos y GUÁRDALO después de cada punto.
NO TE DETENGAS A PREGUNTAR: ante una duda, decide, anótalo y sigue. Los puntos van en orden de
importancia: si se corta, que haya quedado lo primero.

YA ESTÁ PREPARADO — no lo rehagas
- La copia, sin node_modules. OJO: tu plantilla feruga_plantilla_codex tiene 32 migraciones; la
  copia ahora trae también la 0033. Antes de cualquier sonda: `sh qa/plantilla.sh` (deja 33).
- Comandos (ver qa/LEEME.md):
    sh qa/plantilla.sh
    sh qa/prueba.sh <archivo de pruebas> ['parte del nombre']
    sh qa/sql.sh "<SQL>"
    sh qa/node.sh <programa.ts>          (tus sondas van en qa/)
- NO corras la batería completa, ni los recorridos del navegador, ni los simulacros: aquí ya se
  corren. Si para confirmar algo hace falta un recorrido, escribe el caso exacto y márcalo
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
  Por punto sin hallazgos: un renglón. Sin introducciones. En español. No reportes estilo ni gustos.

LA DECISIÓN QUE SE IMPLEMENTÓ (del dueño, 13 de octubre de 2026)
Un «cliente» es alguien a quien se le da precio especial (0025, 0027). Hasta hoy solo nacía en el
mostrador, al darle su primer precio (dar_precio_especial con p_cliente_nuevo, ya con la clave de
quien autoriza), y darlo de baja, reactivarlo o renombrarlo era SOLO de la consola. Ahora:
  · Cualquier RESPONSABLE (rol responsable, tenga o no puede_autorizar) da de alta a un cliente, lo
    da de baja y lo reactiva desde la pantalla. SIN teclear su clave otra vez (igual que el catálogo
    de materiales, 0030): tener a un cliente en la lista no le da nada, porque cada precio especial
    sigue pidiendo la clave de quien autoriza.
  · Queda anotado en la bitácora a nombre de quien lo hizo: alta/baja/reactivar cliente.
  · Renombrar sigue siendo solo de la consola. No se borra a nadie.
  · A PROPÓSITO: la baja NO toca lo ya dado. Una cuenta abierta que ya lleva precio especial para
    ese cliente se cobra como está. Lo que la baja impide es darle OTRO precio. No lo reportes como
    hallazgo; sí reporta si encuentras cómo darle un precio NUEVO a un cliente dado de baja.

QUÉ LEER
- db/migraciones/0033_clientes_en_pantalla.sql   LO PRINCIPAL: alta_cliente, cambiar_cliente, y
                                         dar_precio_especial copiada de 0027 con un mensaje cambiado.
- db/migraciones/0025_precio_especial.sql (clientes: líneas ~30-55; consola: ~620-670) y
  db/migraciones/0027_precio_especial_en_orden.sql (precio_especial_nace ~95-125; dar ~190-295).
- src/servidor/dominio/clientes.ts (al final: altaDeCliente, cambiarCliente),
  src/app/api/clientes/route.ts, src/app/api/clientes/[cliente]/route.ts
- pruebas/46-clientes-en-pantalla.test.ts   lo que ya se probó (12 pruebas): no repitas eso; busca lo que NO cubre.
- src/componentes/ajustes/Clientes.tsx y src/app/panel/ajustes/page.tsx   la pantalla.

LOS PUNTOS, en este orden
1. LA COPIA DE dar_precio_especial. En 0033 está entera, copiada de 0027. Confirma que es IGUAL
   letra por letra salvo el mensaje «se reactiva por la consola» → «lo reactiva un responsable en
   Ajustes» (dos renglones), que no hubo otra versión más nueva de esa función en 0028–0032 que la
   copia haya pisado, y que conserva dueño, SECURITY DEFINER, search_path y permisos.
2. CARRERAS. Con dos conexiones (mira cómo lo hacen pruebas/44-materiales.test.ts al final y
   pruebas/26-precio-especial.test.ts): (a) cambiar_cliente(baja) a la vez que dar_precio_especial
   para ese cliente, en los dos órdenes, por su número y por su nombre como «nuevo»: ¿puede quedar
   un precio especial NUEVO confirmado para un cliente que ya estaba dado de baja cuando ese precio
   se confirmó? (b) alta_cliente a la vez que dar_precio_especial con ese mismo nombre como cliente
   nuevo: ¿queda uno solo, sin error crudo de la base (23505) y sin interbloqueo (40P01)? (c) dos
   cambiar_cliente opuestos a la vez: ¿la bitácora queda coherente con el estado final?
3. NOMBRES. alta_cliente junta blancos antes de llamar a nombre_de_cliente; el mostrador
   (dar_precio_especial) no. ¿Hay un nombre que por un camino dé un cliente y por el otro, otro
   distinto pero «igual a la vista» (espacios raros U+00A0/U+2003, de ancho cero, mayúsculas con
   acento, «ß», I turca), o que viole el CHECK de la tabla, o que deje un nombre vacío o de puros
   blancos? ¿Algo que rompa el CSV de exportar (src/servidor/dominio/exportar.ts) o la bitácora?
   Recuerda que las rutas pasan el nombre por `texto()` (src/servidor/forma.ts), que rechaza
   caracteres de control: di si el problema se alcanza por la ruta o solo llamando la función.
4. QUIÉN. Que ninguna de las dos entradas nuevas la pueda usar quien no es responsable activo:
   por la función con otro p_usuario (la aplicación pasa el de la sesión: revisa que las rutas no
   lo tomen del cuerpo), por las rutas con cada rol, con una sesión de alguien dado de baja. Y que
   feruga_app siga sin poder escribir la tabla cliente ni llamar renombrar_cliente, baja_de_cliente
   y reactivar_cliente.
5. LA PANTALLA (Clientes.tsx). Doble toque en «Dar de alta» o en «Sí, dar de baja»; una respuesta
   vieja que llega después de una nueva; el mensaje que se queda junto a un cliente que ya cambió
   de lista; un nombre de 80 letras sin espacios en un teléfono de 360 px. Solo lo que sea un error
   real para quien la usa.
6. Cualquier otra cosa grave que veas en esos archivos. Nada de estilo.
```
