# Plan de implementación: la aplicación del mostrador

> **Para quien lo ejecute:** se avanza tarea por tarea, con prueba primero. Las casillas `- [ ]`
> llevan el avance. Codex (`gpt-6-astra`, esfuerzo alto) revisó este plan antes de escribir código
> —su informe y la respuesta están en `docs/revisiones/`— y revisa cada bloque al cerrarlo:
> después de la tarea 3 (base), de la 7 (servidor) y de la 11 (pantallas).
>
> **Versión 2**, reescrita tras esa revisión (24 hallazgos, todos atendidos).

**Objetivo:** que en el mostrador se pueda trabajar un día completo sobre el núcleo ya construido:
entrar con una clave, cargar lo que ya hay en el patio, abrir la jornada, publicar precios, atender
cuentas de compra y de venta con varios materiales, pesar vehículos en dos tiempos —aunque vuelvan al
día siguiente—, sacar el comprobante y cerrar el día.

**Arquitectura:** una aplicación web (Next.js) que corre en contenedor junto a la base. El servidor
de la aplicación es el único que tiene las credenciales limitadas de la base; acredita a la persona y
llama **una función del núcleo por acción**. La pantalla nunca habla con la base. Toda regla de negocio
sigue en la base: la aplicación traduce sus códigos de error, no las repite.

**Herramientas, con versión fija:** Next.js 16.3.8, React 19.3.0, TypeScript 5.9, `pg` 8, `iron-session`
9.0.1 (solo para sellar la cookie), `pgcrypto`, Playwright 1.63.0, Node 24, PostgreSQL 17.

**Especificación:** `../ESPECIFICACION-TECNICA.md` (apartados 3.5, 10, 11, 12.4 y 15.2), el flujo validado
con el personal en `../prototipo/mostrador.html` y `../campo/REVISION-PROTOTIPO.md`, y el núcleo en
`docs/planes/2026-10-01-nucleo-de-datos.md`.

## Restricciones globales

- **Portátil.** El único requisito de una máquina es Docker. Nada depende de rutas, programas ni
  arquitectura de la máquina de desarrollo. La construcción de la imagen no necesita base ni secretos.
- **Una función del núcleo por acción, una acción por transacción**, en `READ COMMITTED`.
- **La aplicación no decide reglas.** No calcula importes, existencias, totales ni redondeos: los lee.
- **La persona sale de la sesión.** Ningún identificador de persona que venga en el cuerpo de una
  petición se usa como identidad.
- **Los errores de negocio llegan por código** (`RC001`–`RC011`) y se muestran con el mensaje de la base.
- **Los números viajan como texto decimal.** El servidor valida solo la forma; nunca usa `parseFloat`
  ni redondea.
- **El flujo de pantalla es el validado:** cuentas abiertas siempre a la vista; dentro de una cuenta,
  material → báscula → cuenta; una sola decisión por pantalla; se dice «materiales», no «renglones».
- **En esta etapa el peso se teclea.** El paso de báscula pide elegir la báscula y escribir lo que marca.
- **Controles grandes**, para dedo y para guante; legible a pleno sol; claro y oscuro.
- Textos de interfaz en español de México, sin tecnicismos. Secretos por variable de entorno.
- **En esta entrega la aplicación se publica solo en la propia máquina** (`127.0.0.1`). Abrirla a la red
  del patio exige certificado y llega con el plan de despliegue.

## Cómo se acredita a una persona

1. **El equipo.** Solo un equipo dado de alta puede usar la aplicación. Se da de alta canjeando un
   código de un solo uso que se genera **desde la consola**: diez caracteres, quince minutos de vida,
   guardado por su huella. Al canjearlo el equipo recibe un secreto largo y aleatorio en una cookie
   sellada; la base guarda solo su huella. Sin equipo vigente solo responden dos rutas: salud y alta.
2. **La persona.** Se elige en la pantalla y teclea su clave: **seis dígitos como mínimo para
   responsables y administración, cuatro para los demás**. Cinco fallos seguidos bloquean esa clave; el
   bloqueo se alarga si se repite (5, 15 y 60 minutos) y queda en la bitácora. La respuesta es la
   misma si la persona no existe, está de baja, está bloqueada o se equivocó.
3. **La sesión** vive en la base. La cookie lleva el secreto del equipo y el identificador de sesión,
   nada más. Vence a los 30 minutos sin actividad o a las 12 horas; dar de baja a la persona o al
   equipo, o cambiar la clave, la cierra. Cada petición la comprueba.
4. **Dos pestañas.** Toda acción que escribe declara como quién cree estar actuando. Si la sesión del
   equipo ya es de otra persona, se rechaza y la pestaña se recarga.
5. **Autorizar en el momento.** Terminar un vehículo que quedó de otra jornada lo hace un responsable:
   teclea su clave ahí mismo y **queda él como quien confirma**; la pantalla lo dice antes. Esa clave
   vale para esa petición y esa revisión de la cuenta, y no abre sesión.

La clave no se pide en cada operación: frenaría el registro.

**Quién puede qué en esta entrega**

| | Responsable | Mostrador | Patio | Consulta y administración |
|---|---|---|---|---|
| Saldo inicial, publicar precios, terminar vehículo de otra jornada | sí | — | — | — |
| Abrir y cerrar jornada, confirmar cuentas, imprimir | sí | sí | — | — |
| Abrir cuentas, agregar y quitar materiales, pesar | sí | sí | sí | — |
| Ver precios y cierre | sí | sí | sí | sí |

La base lo valida en cada función; el servidor además lo valida por ruta, incluidas las lecturas.

## Decisiones de diseño

1. **Un solo paquete, tres piezas en contenedor:** `web` (solo lo construido), `admin` (migraciones y
   consola, con credenciales de administración que `web` nunca recibe) y `recorrido` (navegador).
   Orden de arranque: base sana → migración terminada → web.
2. **Las entradas del mostrador son funciones del núcleo.** Una migración nueva convierte cada acción
   (precio, cuenta, material con su peso, segunda pesada, descuento, etiqueta, quitar, descartar) en una
   función que recibe a la persona, valida su rol y es repetible. A `feruga_app` se le retiran las
   escrituras directas a esas tablas.
3. **Repetir no duplica.** Cuenta, material, pesada e impresión llevan un identificador que genera la
   pantalla. Si llega de nuevo igual, la función devuelve lo ya hecho; si llega distinto, rechaza.
4. **El dominio** (`src/servidor/dominio/`) es una función TypeScript por acción, que recibe la conexión
   y a la persona ya acreditada. **Se prueba contra la base real con el rol de la aplicación.**
5. **Las rutas** acreditan, comprueban origen y forma, y llaman al dominio. **Se prueban llamándolas
   como funciones.** La sesión se lee del encabezado de la petición y se escribe en la respuesta: no se
   usa el almacén global de cookies de Next. Además, la entrada y la salida se prueban por HTTP real.
6. **La cuenta se lee de una sola consulta**, con su revisión. Esa revisión es la que se manda al
   confirmar; el dominio nunca la lee por su cuenta.
7. **Los totales de una cuenta abierta salen de una vista del núcleo**, no de la pantalla.
8. **Lo disponible es un aviso; el rechazo es el del libro.** En venta se muestra lo disponible y la
   cuenta avisa si lo apartado ya no alcanza; quien rechaza es la confirmación.
9. **Imprimir registra el intento, no el papel.** Antes de abrir el diálogo del navegador se anota la
   impresión con su consecutivo; desde la segunda pide motivo y el comprobante sale marcado. El
   comprobante se rearma del libro: pesos, precios y totales no cambian; el nombre del material es el vigente.
10. **«Pagar» y «cobrar» son lo que la persona hace enseguida**, y así se llaman los botones. El
    comprobante y el cierre dicen «a pagar» y «a cobrar»: esta entrega no registra el pago.
11. **La pantalla vuelve a pedir el estado después de cada acción.** Lo que sí guarda por su cuenta es
    en qué paso va cada cuenta y qué material tiene elegido, para que cambiar de cuenta no lo pierda.
12. **`pgcrypto` vive en su propio esquema**, para no debilitar la guarda de `search_path`.

## Alcance

**Dentro:** equipo y personas, saldo inicial, jornada, precios, cuentas con doble pesaje, comprobante,
cierre, y la consola para dar de alta y de baja personas y equipos.

**Fuera, para el plan siguiente («inventario»):** existencias en pantalla, conteo, merma, separación,
correcciones y personas desde la pantalla. El núcleo ya tiene esas funciones; falta su pantalla.
**El sistema no debe usarse con operaciones reales antes de ese plan:** un error ya confirmado no
tendría cómo corregirse desde la pantalla.

**Fuera, para después:** despliegue (dominio, certificado, respaldos automáticos), acceso desde
tabletas, lectura de básculas, trabajo sin conexión, caja y crédito.

## Estructura de archivos

```
sistema/
  docker-compose.yml             + migracion, web, admin y el perfil de recorrido
  docker/web.Dockerfile          etapas: dependencias, obra, web, admin
  docker/recorrido.Dockerfile    imagen oficial de Playwright
  tsconfig.json                  Next (pantallas y rutas)
  tsconfig.node.json             lo que Node corre directo: db, pruebas, consola, src/servidor
  db/migraciones/
    0012_mostrador.sql           entradas del mostrador como funciones; resumen de cuenta
    0013_identidad.sql           claves, equipos, códigos, sesiones
    0014_comprobante.sql         impresiones
  consola/
    arranque.ts                  usuario de conexión, primera persona, primer código
    persona.ts                   alta, baja, clave, lista
    equipo.ts                    código, baja, lista
  src/
    servidor/
      bd.ts  errores.ts  numeros.ts  sesion.ts  ruta.ts
      dominio/  identidad.ts  dia.ts  precios.ts  catalogo.ts  cuentas.ts  comprobante.ts  cierre.ts
    app/
      api/…/route.ts
      layout.tsx  page.tsx  mostrador/  precios/  cierre/  arranque/
    componentes/
    estilos/
  pruebas/                       las del núcleo, más:
    10-entradas.test.ts  11-identidad.test.ts  12-servidor.test.ts  13-sesion.test.ts
    14-dia-precios.test.ts  15-cuentas.test.ts  16-cierre.test.ts
  recorrido/                     pruebas por HTTP y en navegador
```

## Lo que cambió al implementarlo

- **El saldo inicial es una sola acción** (`terminar_arranque`): cargar todo y cerrar el arranque, o nada.
  Con llamadas sueltas, una repetida duplicaba el saldo.
- **El día lo define la base**, con la zona horaria del patio: la aplicación pide «abrir la jornada de
  hoy», «publicar la lista de hoy» y «cerrar la jornada abierta», sin escoger fecha, lista ni jornada.
- **Hay memoria de envíos** (tabla `envio`): un reintento no revive una cuenta descartada ni un material quitado.
- **Las migraciones quedaron en 0012 a 0015**: mostrador, identidad, día y comprobante.
- **Las cuentas se llaman «Compra 3», «Venta 4»**: el número lo pone la pantalla al abrirlas y no cambia.
- **El descuento en kilos no tiene pantalla todavía**: la ruta existe, pero el prototipo validado no lo mostraba.
- **Sin aviso de «valor en riesgo» por báscula**: depende de la división real de cada una, que sigue pendiente.
- **La batería final**: `10-entradas`, `11-identidad`, `12-servidor`, `13-sesion`, `13-consola`, `14-dia-precios`,
  `15-cuentas`, `16-cierre`, `17-rutas`, y cinco archivos en `recorrido/`.

## Qué vigilar al revisar, y dónde se prueba

| Qué | Prueba |
|---|---|
| Dos pestañas sobre la misma cuenta: la segunda confirma lo que ya no es | `15-cuentas`: «confirmar con la revisión de antes» · `recorrido/dos-pestanas` |
| Peso mal tecleado: coma, vacío, letras, cuatro decimales, exponente | `12-servidor`: «formas de número» · `10-entradas`: «más de tres decimales se rechaza y no queda material» |
| Clave equivocada: bloqueo, respuesta uniforme, intentos simultáneos | `11-identidad`: «cinco fallos a la vez cuentan cinco» y «no distingue por qué no entró» |
| Sesión vencida a media cuenta: al volver, la cuenta sigue ahí | `13-sesion`: «vencida responde 401» · `recorrido/sesion-vencida` |
| Sin jornada o sin precios publicados: se dice y se lleva a resolverlo | `14-dia-precios`: «estado del día» · `recorrido/dia-sin-abrir` |
| Una petición no hereda a la persona de la anterior | `12-servidor`: «la persona no se queda en la conexión» |
| Una persona de consulta o de patio llamando rutas que no le tocan | `13-sesion`: «cada rol contra cada ruta» |

## Tareas

### Tarea 1 · Armazón que corre en contenedor
Archivos: `package.json`, `tsconfig*.json`, `next.config.ts`, `docker/web.Dockerfile`,
`docker-compose.yml`, `db/migrar.ts`, `src/servidor/{bd,errores,numeros}.ts`, `src/app/api/salud/route.ts`,
`src/app/{layout,page}.tsx`, `pruebas/12-servidor.test.ts`.

Produce:
- `crearBd(url) → Bd`, con `bd.leer(sql, valores)` y `bd.enTransaccion(persona, fn)`; `bd()` global
  perezoso que lee `DATABASE_URL` al primer uso; `usarBd(otra)` para que las pruebas de rutas pongan la suya.
- `ErrorDeNegocio { codigo, message }`, `traducir(error)`.
- `kilos(texto)` y `precio(texto)`: devuelven el mismo texto si tiene forma válida; si no, lanzan `ErrorDeForma`.
- `asegurarRol(cliente, nombre, clave)` en `db/rol.ts`: el usuario con que la aplicación se conecta.
- `GET /api/salud`.

- [x] Pruebas: un error `RC0xx` sale como error de negocio con código y mensaje; uno que no es de negocio
      no revela su detalle; `enTransaccion` deshace todo si la acción falla; deja a la persona para la
      bitácora y **la siguiente transacción de la misma conexión no la hereda**; rechaza un aislamiento
      distinto; formas de número (coma, vacío, letras, cuatro decimales, exponente, negativo); la ruta de
      salud responde con la base y falla sin ella sin revelar la causa.
- [x] El migrador toma un candado: dos a la vez no se pisan.
- [x] `docker compose up` levanta base, migra y sirve; `docker compose run --rm pruebas` sigue en verde.

### Tarea 2 · Entradas del mostrador en el núcleo
Archivos: `0012_mostrador.sql`, `pruebas/10-entradas.test.ts`, ajustes en `08-permisos.test.ts` y `apoyo.ts`.

Produce (todas con `SECURITY DEFINER`, `search_path` fijo y permiso explícito):
- `fijar_precio(p_material int, p_compra numeric, p_venta numeric, p_usuario bigint) → precio` y
  `quitar_precio(p_material int, p_usuario bigint)` — responsable, sobre la lista sin publicar de la jornada abierta.
- `abrir_cuenta(p_id uuid, p_tipo text, p_etiqueta text, p_usuario bigint) → operacion`
- `agregar_material(p_cuenta uuid, p_linea uuid, p_material int, p_instrumento smallint, p_captura uuid, p_kg numeric, p_usuario bigint) → operacion_linea`
- `segunda_pesada(p_linea uuid, p_captura uuid, p_kg numeric, p_usuario bigint) → operacion_linea`
- `quitar_material(p_linea uuid, p_usuario bigint)`, `poner_descuento(p_linea uuid, p_kg numeric, p_usuario bigint) → operacion_linea`
- `etiquetar_cuenta(p_cuenta uuid, p_etiqueta text, p_usuario bigint) → operacion`, `descartar_cuenta(p_cuenta uuid, p_usuario bigint)`
- vista `cuenta_resumen(operacion_id, materiales, por_pesar, suma, ajuste_redondeo, total)`.
- A `feruga_app` se le retira escribir directo en `precio`, `operacion`, `operacion_linea`,
  `linea_pesada` y `captura_peso`, y ejecutar `quitar_renglon` y `fijar_descuento`.

- [x] Pruebas: cada función exige persona activa con rol (patio abre y pesa pero no fija precios;
      consulta nada); el mismo identificador con lo mismo devuelve lo ya hecho y con otra cosa se rechaza;
      agregar material deja renglón, pesada y peso o no deja nada; más de tres decimales se rechaza;
      segunda pesada en compra y en venta, también con la jornada de la cuenta ya cerrada; el resumen
      da suma, ajuste y total provisionales y cuántos faltan por pesar; con el rol de la aplicación ya no
      se escribe directo; el día completo con ese rol pasa por las funciones; el orden de candados
      se conserva (dos sesiones cruzadas no se interbloquean).

### Tarea 3 · Identidad en la base
Archivos: `0013_identidad.sql`, `pruebas/11-identidad.test.ts`.

Produce: tablas `credencial`, `equipo`, `codigo_alta`, `sesion` (ninguna legible para la aplicación) y
- para la aplicación: `canjear_codigo(p_codigo text, p_huella text) → uuid`,
  `equipo_vigente(p_huella text) → boolean`,
  `entrar(p_huella text, p_usuario bigint, p_clave text) → uuid` (nulo si no entra),
  `sesion_vigente(p_huella text, p_sesion uuid) → TABLE (usuario_id, nombre, rol, puede_autorizar)`,
  `salir(p_sesion uuid)`, `verificar_clave(p_huella text, p_usuario bigint, p_clave text) → boolean`;
- solo para administración: `alta_persona`, `baja_persona`, `fijar_clave`, `crear_codigo_alta`, `baja_equipo`.

- [x] Pruebas: clave buena entra y mala no; cinco fallos bloquean aunque después llegue la buena; el
      bloqueo se alarga al repetirse y queda en la bitácora; **cinco fallos a la vez cuentan cinco**; un
      acierto limpia los fallos; el fallo queda contado aunque la transacción que sigue se deshaga; no
      distingue por qué no entró; largo mínimo según rol; el código sirve una vez, vence, y **dos canjes
      a la vez dan un solo equipo**; equipo dado de baja deja de valer y cierra sus sesiones; la sesión
      vence por inactividad y por duración; cambiar la clave o dar de baja la cierra; la aplicación no
      lee huellas ni llama a las funciones de administración; el respaldo y la restauración siguen pasando.

**Revisión de Codex al bloque de base** (tareas 2 y 3), con ejecución: hecha. Nueve hallazgos, los nueve corregidos
(`docs/revisiones/2026-10-01-codex-revision-del-bloque-de-base.md`).

### Tarea 4 · Sesión en el servidor, arranque y consola
Archivos: `src/servidor/{sesion,ruta}.ts`, `dominio/identidad.ts`, rutas `api/equipo/alta`,
`api/personas`, `api/sesion`, `api/sesion/entrar`, `api/sesion/salir`, `consola/*.ts`,
`docker/recorrido.Dockerfile`, `recorrido/entrada.spec.ts`, `pruebas/13-sesion.test.ts`.

Produce:
- `acreditar(peticion, bd) → { equipo, persona | null }`.
- `ruta({ roles, sinPersona?, sinEquipo? }, manejador) → (peticion) => Response`: comprueba origen y
  método, lee el cuerpo, acredita, exige rol, compara «como quién actúo», traduce errores.
- Consola: `arranque`, `persona alta|baja|clave|lista`, `equipo codigo|baja|lista`.

- [x] Pruebas: sin equipo todo responde 401 salvo salud y alta; con equipo y sin persona solo se puede
      listar personas y entrar; cookie alterada no vale; entrar deja la sesión y la cookie con
      `HttpOnly` y `SameSite=Strict`; salir la quita; vencida responde 401; **cada rol contra cada
      ruta**; una persona en el cuerpo de la petición se ignora; petición de otro origen se rechaza;
      «actúo como» distinto de la sesión se rechaza.
- [x] `arranque` es repetible: no duplica personas ni cambia claves.
- [x] Por HTTP real, en contenedor y con base propia: alta de equipo, entrar, sesión, salir.

### Tarea 5 · El día: saldo inicial, jornada, precios, catálogo
Archivos: `dominio/{dia,precios,catalogo}.ts`, rutas `api/dia`, `api/arranque/*`, `api/jornada/abrir`,
`api/precios`, `api/precios/publicar`, `api/catalogo`, `pruebas/14-dia-precios.test.ts`.

Produce: `estadoDelDia(bd)` (fecha de hoy según la base, corte de arranque, jornada, lista, vehículos por
volver), `saldoInicial(bd)`, `cargarSaldo(bd, persona, material, kg, origen)`, `terminarArranque(bd, persona)`,
`abrirJornada(bd, persona)`, `listaDelDia(bd)`, `guardarPrecios(bd, persona, cambios)`,
`publicarLista(bd, persona)`, `catalogo(bd, tipo)`.

- [x] Pruebas: el estado del día en cada situación (sin arranque terminado, sin jornada, sin publicar,
      listo, jornada de ayer sin cerrar); el primer día la lista sale completa desde el catálogo y sin
      precios; guardar cambia solo lo enviado; abrir copia la última lista **publicada**; publicar
      congela; material sin precio aparece marcado y no se ofrece; el catálogo viene por familias, con
      frecuentes, precio según compra o venta y, en venta, lo disponible; saldo inicial contado y
      estimado, y cerrado el arranque ya no admite más.

### Tarea 6 · Cuentas y comprobante
Archivos: `dominio/{cuentas,comprobante}.ts`, `0014_comprobante.sql`, rutas `api/cuentas/*`,
`api/materiales/*`, `api/comprobantes/*`, `pruebas/15-cuentas.test.ts`.

Produce: `cuentasAbiertas(bd)` (incluye vehículos de jornadas anteriores), `abrirCuenta`, `verCuenta(bd, id)`
(una consulta: cuenta, materiales, resumen, avisos de disponibilidad, revisión), `agregarMaterial`,
`segundaPesada`, `quitarMaterial`, `ponerDescuento`, `etiquetar`, `descartar`,
`confirmar(bd, persona, cuenta, revision)`, `terminarVehiculo(bd, equipo, responsable, clave, cuenta, revision)`,
`comprobante(bd, operacion)`, `buscarPorFolio(bd, folio)`,
`registrar_impresion(p_id uuid, p_operacion uuid, p_motivo text, p_usuario bigint) → int`.

- [x] Pruebas: una compra de tres materiales de principio a fin; reintentar cada paso no duplica;
      doble pesaje en compra y en venta; dos ventas abiertas del mismo material: la cuenta avisa y la
      segunda confirmación se rechaza con `RC002`; **confirmar con la revisión de antes** tras cambiar
      etiqueta, descuento, material o segunda pesada devuelve `RC011`; un vehículo de ayer lo termina solo
      un responsable con su clave, a precio de ayer, asentado hoy, y la clave equivocada cuenta como
      fallo; el comprobante trae por material su báscula y sus pesos, y suma, ajuste y total; la primera
      impresión no pide motivo, la segunda sí y sale marcada; repetir el registro de una impresión no
      suma otra; leer el comprobante no cuenta como impresión.

### Tarea 7 · Cierre
Archivos: `dominio/cierre.ts`, rutas `api/cierre`, `api/jornada/cerrar`, `pruebas/16-cierre.test.ts`.

Produce: `resumenDelCierre(bd)` (kilos por material, a pagar, a cobrar, ajustes, **cuentas por terminar**
y **vehículos por volver**, por separado), `cerrarJornada(bd, persona)`.

- [x] Pruebas: con cuentas por terminar no cierra y dice cuántas; con solo vehículos por volver sí
      cierra; **dos jornadas**: el vehículo terminado al día siguiente no cambia los totales del cierre
      anterior y aparece en el de hoy.

**Revisión de Codex al bloque de servidor** (tareas 4 a 7), con ejecución: hecha el 2 de octubre, tras quedar
incompleta el día anterior. Siete hallazgos, los siete corregidos
(`docs/revisiones/2026-10-02-codex-revision-del-bloque-de-servidor-repeticion.md`).

### Tarea 8 · Pantalla: entrada y armazón
- [x] Alta de equipo con código; elegir persona y teclear clave en teclado en pantalla; barra con quien
      atiende, cambiar de persona y salir; destino según rol; aviso con su botón cuando falta terminar
      el arranque, abrir la jornada o publicar precios; al vencer la sesión se pide la clave y se vuelve
      a donde se estaba.

### Tarea 9 · Pantalla: mostrador
- [x] Cuentas abiertas siempre a la vista, **hasta cuatro**, con la activa inconfundible; «+ Compra» y
      «+ Venta».
- [x] Dentro de una cuenta, los tres pasos: material (frecuentes y familias, nombres cortos, sin precio
      deshabilitado, en venta lo disponible) → báscula (las tres; teclado de peso) → cuenta (materiales,
      «agregar otro material», suma, ajuste y total, avisos).
- [x] **Cambiar de cuenta recuerda en qué paso iba y qué material tenía elegido**; un peso tecleado y
      no enviado pertenece a su cuenta y nunca se va a otra.
- [x] Vehículo: «1 · cargado ✓ / 2 · vacío: falta», y su segunda pesada; el de otra jornada pide la
      clave del responsable y dice quién quedará registrado.
- [x] Pagar o cobrar → comprobante → imprimir; al terminar o descartar, pasa a la siguiente cuenta abierta.
- [x] «La cuenta cambió»: se refresca y se vuelve a preguntar; nunca se reconfirma sola.

### Tarea 10 · Pantallas: precios, cierre y arranque
- [x] Precios por familias desde el catálogo, con la última lista publicada de referencia; guardar y
      publicar; solo lectura para quien no es responsable.
- [x] Cierre: cuentas por terminar, vehículos por volver, kilos del día, a pagar y a cobrar; cerrar; y
      abrir la jornada del día. Buscar un comprobante por folio y reimprimirlo con motivo.
- [x] Arranque: lo que ya hay en el patio, material por material, contado o estimado; terminar.

### Tarea 11 · Recorrido completo en navegador
Archivos: `recorrido/*.spec.ts`. Corre con `docker compose --profile recorrido run --rm recorrido`, con base propia.
- [x] `dia-completo`: equipo, entrar, saldo inicial, abrir, publicar, compra de dos materiales, venta,
      comprobante y reimpresión, cerrar.
- [x] `cuatro-cuentas`: cuatro abiertas, la quinta no se ofrece; alternar desde el paso de báscula y volver.
- [x] `dos-jornadas`: vehículo cargado hoy, cierre, jornada siguiente, segunda pesada con clave del responsable.
- [x] `dos-pestanas`, `sesion-vencida`, `dia-sin-abrir`, y una persona de consulta que solo ve.

**Revisión de Codex al bloque de pantallas** (tareas 8 a 11), con ejecución: hecha el 2 de octubre. Siete
hallazgos, dos de ellos bloqueantes, los siete corregidos
(`docs/revisiones/2026-10-02-codex-revision-del-bloque-de-pantallas.md`).

### Tarea 12 · Máquina nueva
Archivos: `README.md`.
- [x] Desde volúmenes vacíos y siguiendo solo el README: levantar, arranque, dar de alta el equipo,
      entrar. Queda escrito cómo dar de alta y de baja personas y equipos, y cómo cambiar una clave.
