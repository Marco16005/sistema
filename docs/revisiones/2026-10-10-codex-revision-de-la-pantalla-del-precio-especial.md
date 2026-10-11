> Informe de Codex (`gpt-6-astra`, esfuerzo alto, con ejecución), tal como lo dejó en
> `/tmp/feruga-codex-informe-11.md` (10 de octubre de 2026). **Completo:** los siete puntos, en una
> sola pasada corta. Revisó la pantalla del precio especial (tarea 3 de
> `docs/planes/2026-10-04-precio-especial.md`) leyendo y con una sonda; no corrió recorridos del
> navegador (se le pidió que no). Un hallazgo importante y tres recorridos que faltaban.
> Lo que se hizo con ello está al final de este mismo archivo.

# Revisión de la pantalla del precio especial — 2026-10-10

1. Dinero mostrado: sin hallazgos por lectura; suma en diezmilésimas dentro de enteros seguros, formato de hasta cuatro decimales y signo correcto. Usa la lista del renglón (contrato ya cerrado: inmutable), no el catálogo actual. Confirmado con `sh qa/node.sh qa/sonda-precio-pantalla.ts`: `PRECIO OK 1.0049 + 0.0002 => $1.0051`; también pasan resta de 0.0001 y límite 99999.9999. La sonda ejecuta las funciones extraídas del código de pantalla; no reabre servidor/base.
2. Dar: sin hallazgos en captura, identificador y clave por lectura. El pendiente conserva cuerpo y autorizante; volver a la forma oculta la edición; cambiar autorizante resuelve antes el envío; RC011 sale tras resolverlo. La clave va aparte y solo vive en Autorizar, que la vacía al terminar.
3. Quitar: la limpieza de refrescar suelta el pendiente si desaparece el material o su especial; si hay otro especial, el reintento resuelve el identificador. No se encontró un bloqueo permanente ni un camino confirmado de cobro con total viejo.

### [importante] La pestaña Material permite saltarse el bloqueo de Quitar
Dónde: src/componentes/mostrador/Mostrador.tsx:386
Escenario: dar precio especial → perder la respuesta de quitar → «Agregar otro material» queda desactivado → pulsar la pestaña superior «Material» → elegir material y capturar peso mientras quitar sigue pendiente. Esa pestaña solo mira el pendiente de pesada, no Lugar.quitando; tampoco agregar comprueba quitando.
Confirmado con: Sin confirmar: para correr aquí. Interceptar POST …/precio-especial/quitar y abortar antes de enviarlo; pulsar «Material», elegir otro material, báscula, 1 kg y agregar. Comprobar que no debe salir POST de pesada mientras quitando exista.
Corrección sugerida: bloquear las pestañas Material/Báscula mientras haya quitando y comprobar ese estado también al agregar.

4. Sin hallazgos de cruce por lectura: vista exige cuenta.id === activa, PasoCuenta tiene key por cuenta, el lugar se guarda por id y el cuerpo pendiente fija la línea. Refrescar elimina lugares de cuentas cerradas y paneles de materiales ausentes. Sin confirmar: para correr aquí, capturar en A → cambiar a B → recargar → volver a A; cobrar/descartar A desde otro equipo con su panel abierto → autorizar; verificar que ninguna petición cambia de cuenta/material.
5. Sin hallazgos: Ticket.tsx:47 muestra cliente y precio aplicado, sin lista ni condición especial. Confirmado el signo/letrero ejecutando las funciones de cierre con `sh qa/node.sh qa/sonda-precio-pantalla.ts`: `CIERRE +$50.00 En compras se pagó de más`, `CIERRE −$50.00 En compras se pagó de menos`, `CIERRE +$50.00 En ventas se cobró de más`, `CIERRE −$50.00 En ventas se cobró de menos`. Papel revisado por lectura; sin repetir impresión/navegador.
6. Huecos de recorridos (lectura de recorrido/precio-especial.spec.ts; no ejecutados):
- El escape por la pestaña Material del hallazgo: solo se comprueba el botón Agregar, no la navegación superior (líneas 281–283).
- Perder diezmilésimas al mostrar/autorizar: los precios probados usan centavos; agregar lista 1.0049 + 0.0002 y comprobar 1.0051 antes/después y en papel.
- Mezclar o conservar indebidamente una captura al cambiar/cerrar cuentas: agregar el caso A/B y cierre remoto descrito en punto 4; no hay ese recorrido específico del panel.
Estos son casos pendientes de navegador («Sin confirmar: para correr aquí»), no tres defectos demostrados.
7. Veredicto: no daría todavía el visto bueno al bloqueo de la pantalla; no encontré error de dinero en esta pasada corta.
Falta, en orden: confirmar y corregir el escape por Material; añadir su recorrido; cubrir diezmilésimas y cambio/cierre de cuenta.

Creé únicamente qa/sonda-precio-pantalla.ts en /tmp/feruga-codex-qa12/qa/; no dejé contenedores de esta pasada corriendo (node.sh usa --rm; docker ps filtrado por servicio pruebas: sin salida). Los contenedores preexistentes siguen intactos. No modifiqué archivos del proyecto original.

---

# Lo que se hizo (10 de octubre de 2026)

- **La pestaña «Material» permitía saltarse el bloqueo de «quitar» — confirmado y corregido.** Con
  un precio especial en el aire —quitarlo, o darlo— los pasos «Material» y «Báscula» quedan
  desactivados, y agregar un material comprueba lo mismo antes de mandar nada
  (`Mostrador.tsx`). El recorrido de «quitar» con la respuesta perdida mira ahora también esos
  dos pasos, y el de «dar», el de «Material».
- **Los tres recorridos que faltaban**, agregados a `recorrido/precio-especial.spec.ts`:
  una diferencia de media diezmilésima (lista $2.10 + $0.0005 → $2.1005, en la pantalla, en la
  cuenta y en el papel); cambiar de cuenta con el panel a medio llenar (no se lleva a la otra, y
  al volver —también tras recargar— sigue ahí); y la cuenta descartada desde otro lado con el
  panel abierto.
- **De ese último salió un cambio más:** un rechazo que quiere decir que la cuenta ya no es la que
  se ve —se cobró, se descartó, se cerró el día, o le cambiaron el precio a ese material— saca del
  panel, lo dice y vuelve a pedir la cuenta. Antes solo lo hacía cuando había cambiado el precio;
  con los demás el aviso se quedaba dentro de la hoja de autorizar, sobre una cuenta que ya no
  existía. La clave equivocada y «no puede autorizar» se quedan en la hoja, como antes.
- Lo que Codex dio por bueno: el dinero que se enseña (probó hasta la diezmilésima y el tope), la
  regla del envío pendiente al dar, que la clave no se guarda, el comprobante y los cuatro
  letreros del cierre.

No se le pidió otra pasada para verificar esto: es un cambio chico, con su recorrido.
