# Caja y ganancia, y lo que falta antes del servidor

> **Estado (15 de octubre de 2026):** el usuario contestó el cuestionario el 14
> (`2026-10-12-caja-y-ganancia-preguntas.md`, al final) y el 15 decidió los dos puntos que quedaban:
> **el permiso del corte lo da el responsable a cada persona**, y **el aviso de un corte que no cuadró
> sale dentro del sistema** mientras no haya servidor; con servidor, también por Telegram y correo.
> Pidió avanzar con todo lo pendiente, **dejar el servidor para el final** y repartir el trabajo con
> Codex. Este plan es el orden.
>
> **Estado (21 de octubre de 2026):** las partes 1 a 5 están hechas, con sus pruebas y recorridos
> (migraciones 0038 a 0042). Codex escribió la base del cajón, del costo, de corregir lo cobrado y
> del fiado (informes 26 a 29 en `docs/revisiones/`; el 27 y el 29 se cortaron por cuota y Claude
> terminó de integrarlos); Claude, la base de los gastos, el servidor, las pantallas y los
> recorridos. Sigue la parte 6: que Codex revise todo esto. La demo del usuario sigue en 0037 hasta
> actualizarla.
>
> **Revisada por Codex el 21 de octubre** (informe 31, cortado por cuota en la parte 7 de 8): diez
> hallazgos, nueve corregidos en la migración **0043** —la ganancia cuenta las correcciones y el
> redondeo; una venta fiada se corrige sobre lo que debe el cliente; un cobro repetido con otros
> datos se rechaza; un solo orden de candados; el resumen del cierre de una sola lectura; y tres de
> pantalla— y uno que no aplica: el recálculo histórico de 0039 ordena por identificador, y no corre
> sobre ninguna base que tenga historia anterior (ver
> `docs/revisiones/2026-10-21-respuesta-a-la-revision-de-caja-y-ganancia.md`).
>
> **Verificado por Codex el 22 de octubre** (informe 33): cerró seis de esas correcciones y dejó
> siete hallazgos más, todos corregidos (migración **0044** para el orden de candados de contar y
> corregir inventario y la firma al terminar un vehículo; y en pantalla, un fiado o cobro sin
> respuesta ya no deja cambiar nada y su comprobante se recupera aunque falle la primera vez):
> `docs/revisiones/2026-10-22-respuesta-a-la-revision-de-pantallas-y-recipiente.md`.

## El orden

| # | Parte | Quién |
|---|---|---|
| 1 | **El cajón**: contarlo al abrir, sacar y meter, efectivo o transferencia, el corte al cerrar, los avisos y el permiso del corte | Codex la base; Claude el servidor, las pantallas y los recorridos |
| 2 | **Corregir lo ya cobrado**: liquidar solo la diferencia, con clave | por decidir al cerrar la 1 |
| 3 | **Costo y ganancia**: costo promedio por material, margen, patio a lo que costó | Codex la base; Claude lo demás |
| 4 | **Fiado**: ventas a crédito a clientes conocidos, quién debe y sus abonos | ídem |
| 5 | **Gastos**: capturados a mano, y escoger cuáles se ven | ídem |
| 6 | **Revisiones pendientes de Codex** (entre una construcción y otra): las correcciones del 9 de octubre sin verificar, el respaldo diario puntos 8–10, las tareas 3–7 del rediseño, lo corregido de los intentos y el sello, el recipiente (0037) y lo que se construya aquí | Codex |
| 7 | ~~`publicar.sh --corregida`~~ — **no se hace** (21 de octubre): volver al respaldo previo no pierde nada en ese caso; ver el plan de despliegue | — |
| — | **Al final, el servidor**: `operacion/servidor.sh` y todo lo que solo se prueba ahí (sección 10 de `docs/operacion.md`) | — |
| — | **Del usuario**: probar en los equipos de verdad; placas de las básculas; inventario con el personal | usuario |

## 1. El cajón

### Lo que se ve

- **Al abrir el día**, antes de atender, alguien del mostrador o un responsable **cuenta el cajón** y
  teclea lo que hay. La pantalla propone lo que se dejó en el último corte. Si no coincide, se anota
  la diferencia con quién contó y a qué hora, y **sale un aviso**.
- **Al pagar o cobrar** una cuenta se dice si fue en **efectivo** —lo de siempre, ya marcado— o por
  **transferencia** (cargas grandes; cheques no hay). Lo de transferencia no pasa por el cajón. El
  ticket lo dice.
- **Sacar o meter dinero** (la tienda, un mandado; el dueño que mete para pagar): cuánto, para qué, y
  la **clave de un responsable**. Queda quién lo registró y quién autorizó.
- **El cajón ahora**, en la pantalla del cierre: con cuánto se abrió, lo pagado y cobrado en
  efectivo, lo metido y sacado, y cuánto **debería** haber.
- **El corte, al cerrar el día**: se cuenta el cajón y se teclea; el sistema dice si cuadró y cuánto
  falta o sobra. Se dice **cuánto se queda para mañana** (lo demás se lo lleva quien hace el corte, y
  queda anotado). Lo firma **con su clave** una persona **con permiso de corte**: un responsable, o
  alguien del mostrador a quien un responsable se lo dio. El día se cierra aunque no cuadre; la
  diferencia queda escrita con quién, a qué hora y cuánto, y **sale un aviso**.
- **Los avisos** —corte que no cuadró, cajón que abrió distinto de como se dejó— se ven en el Panel y,
  al entrar, en la barra de quien es responsable, hasta que un responsable los marca como vistos.
  Con servidor, además, por Telegram y correo (parte del servidor).
- **El permiso del corte** se da y se quita en Ajustes → Personas, a personas de mostrador, como lo
  demás de personas: un responsable facultado con su clave.
- **En el Panel**, cada día de «Días» trae su cajón; el Resumen, en «Para vigilar», los cortes que
  no cuadraron y cuánto faltó o sobró en el periodo.

### Decisiones

| # | Decisión | Por qué |
|---|---|---|
| 1 | Contar el cajón al abrir es requisito para atender (lo pide la pantalla), no para la base | Sin el fondo de la mañana no hay corte; pero la base no detiene una cuenta por eso |
| 2 | Lo propuesto al abrir es «lo que se quedó» en el último corte | Lo pidió el usuario (respuesta 1) |
| 3 | Sacar y meter piden la clave de cualquier responsable activo | Respuesta 2: «son los responsables los que lo sacan» |
| 4 | El corte lo firma con su clave quien tiene permiso; el permiso lo da un responsable facultado | Respuestas 3 y del 15 de octubre |
| 5 | Lo que se lleva quien hace el corte es «lo contado menos lo que se queda»; no pide otra clave | Ya firmó el corte; queda anotado como retiro |
| 6 | Si el día se reabre y se vuelve a cerrar, el segundo corte espera lo de antes menos lo retirado en el primero | El dinero que se llevó ya no está en el cajón |
| 7 | Efectivo y transferencia, en compras y en ventas | Respuesta 4; las compras grandes también se pagan así |
| 8 | Cantidades en pesos con hasta dos centavos | El cajón puede tener monedas aunque se pague en pesos cerrados |
| 9 | El fiado no entra aquí: es la parte 4 | Respuesta 5; mientras, una venta fiada no se registra como efectivo |

### Cómo está hecho (lo escribe quien construye; aquí, solo la forma)

- Migración **0038** (Codex): `usuario.hace_corte`; `operacion.forma_de_pago`; `caja_apertura`,
  `caja_movimiento`, `caja_corte`, `aviso`; `confirmar_cuenta` y `terminar_vehiculo` con la forma de
  pago (por omisión, efectivo); `abrir_el_cajon`, `mover_caja`, `cerrar_el_dia` con el corte,
  `permiso_de_corte`, `ver_aviso`.
- Servidor (Claude): `src/servidor/dominio/caja.ts` y sus rutas (`/api/caja`, `/api/caja/abrir`,
  `/api/caja/movimientos`, `/api/avisos`), y los cambios en el cierre, confirmar y personas.
- Pantallas (Claude): contar al abrir, la forma de pago al cobrar, el cajón y el corte en el cierre,
  el permiso en Ajustes, los avisos en la barra y en el Panel, el cajón de cada día.

## 2. Corregir lo ya cobrado (respuesta 6)

Si se dan cuenta a tiempo, la cuenta abierta se corrige ahí mismo (ya se puede: quitar, volver a
pesar, el recipiente). Si ya se cobró, es una corrección administrativa:

- Se busca el comprobante por su folio y se corrige un material: los kilos que de verdad eran, o el
  material que de verdad era (al precio de lista de ese día). El comprobante original no se toca.
- El sistema dice la diferencia en kilos y en dinero, y si a quién le toca pagar o devolver.
- Se dice cómo se liquidó: en efectivo hoy (entra o sale del cajón de hoy), por transferencia, o
  que no se liquidó (solo queda escrito).
- Lo autoriza un responsable con su clave; queda quién, cuándo y por qué.
- El patio se ajusta solo con la diferencia de kilos, como las correcciones de inventario.

## 3. Costo y ganancia (respuestas 8 a 11)

- Costo promedio por material; lo que se vende sale a ese promedio, y la ganancia de cada venta es
  lo cobrado menos lo que costó.
- Separar reparte el costo entre las partes según su precio de compra de ese día; la basura no
  lleva costo. Compactar, empacar, cortar o desoldar no cambian nada.
- Lo dado de baja es pérdida del día; los ajustes de conteo, a favor o en contra, aparte.
- Lo que ya había en el patio, al precio de compra del primer día.
- En el Panel, **Ganancia**: por día, semana o mes, a escoger; por material; y el patio valuado a
  lo que costó junto a lo que valdría a precio de lista.

## 4. Fiado (respuesta 5)

- Una venta se puede cobrar **a crédito**: a nombre de un cliente, con la clave de un responsable,
  y con fecha en que debe pagar si se pactó. No pasa por el cajón.
- Los **abonos** se registran cuando llegan, en efectivo (entra al cajón de ese día) o por
  transferencia.
- En el Panel: quién debe cuánto, desde cuándo, y lo vencido. No hay adelantos ni compras a crédito.

## 5. Gastos (respuesta 7)

- Se capturan a mano: fecha, de qué tipo (sueldos, renta, luz, fletes, gasolina, mantenimiento u
  otro), concepto e importe, y si salió del cajón (entonces cuenta en el corte) o de otro lado.
- Cada tipo se marca si cuenta o no para la utilidad; en el Panel, la ganancia del material menos
  los gastos que se quiera ver.

Decisiones al construirla (21 de octubre):

- Los gastos los registra un responsable con su propia sesión, en el Panel. Uno que sale del cajón
  queda también como un «sacar» autorizado por él mismo: no se le vuelve a pedir la clave, porque
  ya entró con ella. Quien consulta los ve, sin escribir.
- Anular un gasto que salió del cajón no regresa el dinero (ya se sacó): solo deja de contar como
  gasto, y solo mientras ese día siga abierto. Lo que se sacó vuelve a quedar por clasificar, para
  que se le ponga el tipo correcto: un «sacar» tiene a lo más un gasto vivo.
- Que un tipo se reste o no es del tipo, no de cada gasto: cambiarlo cambia también lo de periodos
  anteriores, y la pantalla lo dice.
