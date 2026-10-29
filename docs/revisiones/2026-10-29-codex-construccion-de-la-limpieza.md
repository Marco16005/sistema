# Encargo 35: conservación de publicaciones y espacio en disco

Trabajo reanudado el 29 de octubre de 2026 en `/tmp/feruga-codex-qa14/`.

## Alcance y restricciones

Solo se modifica esta copia y este informe. No se instalan dependencias. No se modifican `docs/`, `src/`, `operacion/avisos.ts` ni `operacion/respaldar.ts`. No se operan los contenedores ni la base del proyecto original. Las comprobaciones se ejecutan de una en una. No se eliminan recursos Docker ajenos al ensayo.

## Seguimiento

- Informe creado desde cero al iniciar. Pendientes: revisión de recuperación, retirada del constructor separado, medición sin montajes, pruebas, tipos, ShellCheck y ensayo completo.

## Decisiones

- Se aplican las dos decisiones del encargo: construcción integrada con `docker build`, sin administrar caché; medición con `df -h /` en la imagen de herramientas sin montar el directorio de Docker.

### Paso 1: revisión de la recuperación y cambios decididos

La copia no es un repositorio Git; el ensayo crea su propio repositorio desechable. Están recuperados `limpieza.ts`, `limpieza.sh`, `limpiar.sh`, la integración final en `publicar.sh`, las etiquetas de herramientas por proyecto y las pruebas del plan. No estaba la comprobación de conservación en `ensayo-publicacion.sh`: se añadirá.

Retirados el constructor separado, su configuración local, sus opciones de carga y su limpieza de caché. `construir_del_commit` vuelve a `docker build` con el archivo de `git archive` por entrada estándar. El arnés también usa `docker build`. La limpieza ya mide con `df -h /` en un contenedor sin montajes, sin red y sin descargar imágenes. No consulta ni monta `DockerRootDir`. Ajustadas las pruebas de estas llamadas.

### Paso 2: comprobaciones del ensayo incorporadas

Se aprovecha la tercera publicación completada del ensayo existente: se comprueba que desaparecen las cinco etiquetas de la primera publicación, su imagen web exclusiva y la etiqueta de herramientas de su commit; siguen las cinco etiquetas y herramientas de la vigente y la anterior. Base y proxy pueden compartir huella entre versiones: se exige retirar el alias antiguo, no borrar una imagen aún necesaria. Se comparan inventarios de volúmenes, imágenes y sumas de los archivos de historia, y se repite `limpiar.sh` para comprobar que no retira nada más. Antes de la vuelta al respaldo se ejecuta otra limpieza con una publicación pendiente; el ensayo existente comprueba después la restauración y la reapertura.

La función de construcción se comparó con `/Users/maantora/Desktop/feruga/sistema/operacion/pasos.sh` mediante lectura: coincide de nuevo con la original. No se escribió nada en ese árbol.

Primera comprobación iniciada: `node --test --test-concurrency=1 pruebas/36-guiones.test.ts`, con salida en `pruebas-36-35.log`.

### Paso 3: primer resultado y corrección de datos de prueba

La primera corrida terminó con 22 pruebas aprobadas y una fallida: el caso recuperado que fabricaba la historia intentaba marcar la migración sin anotar antes el respaldo obligatorio. Se corrigieron esos datos usando `anotarRespaldo`, sin cambiar la validación de producción. Se separaron además las comprobaciones de la última etiqueta reservada y de la última etiqueta usada por un contenedor detenido, y se añadió cobertura de herramientas de otro commit, fallo de retirada y fallo de medición.

Pruebas corregidas: **24/24 aprobadas**, cero fallos, cero omitidas; duración 9,52 s. Salida completa: `/tmp/feruga-codex-qa14/pruebas-36-35.log`.

### Paso 4: tipos

Se ejecuta `sh qa/tipos.sh`, sin instalar dependencias, usando el contenedor efímero de pruebas de la copia.

Tipos detectó un error recuperado: TypeScript infería la lista de conjuntos como candidatos (con `esquema`) y rechazaba agregar el conjunto anterior (que no exige ese campo). Se declaró `Conjunto[]`, el tipo compartido real, sin cambiar el comportamiento ni debilitar la comprobación de tipos.

Tipos corregidos: `sh qa/tipos.sh` terminó con **código 0**, sin diagnósticos de TypeScript. Salida completa: `tipos-35.log`.

### Paso 5: ShellCheck

Se comprueban los siete archivos sh recuperados o modificados con la imagen solicitada, sin red y con el código montado solo para lectura.

ShellCheck se ejecuta con `-s sh -x`: los archivos incluidos no llevan shebang y se siguen sus inclusiones (`candado.sh` incluido). La primera ejecución señaló también una asignación deliberadamente local al subshell: se renombró a `herramientas_limpieza` para expresar esa separación y eliminar el diagnóstico. Dos guardas preexistentes `A && B || falla` tienen ahora una explicación puntual de SC2015 (fallar si falta cualquiera de los datos); la guarda nueva del ensayo usa `if`. No se silencian clases completas de advertencias en la orden de comprobación.

ShellCheck final: **código 0, salida vacía**, sin advertencias en los siete guiones. También se explicó puntualmente la guarda preexistente de la nueva marca de base en el ensayo. Orden reproducible:

```sh
docker run --rm --network none -v "$PWD/operacion:/trabajo/operacion:ro" -w /trabajo koalaman/shellcheck:v0.10.0 -s sh -x operacion/pasos.sh operacion/limpieza.sh operacion/limpiar.sh operacion/publicar.sh operacion/ensayo.sh operacion/ensayo/comun.sh operacion/ensayo-publicacion.sh
```

Se corre ahora el archivo completo de pruebas con `sh qa/prueba.sh pruebas/36-guiones.test.ts`, para verificar también el candado en Linux y los últimos ajustes de shell. Salida: `pruebas-36-linux-35.log`.

## Diseño recuperado y resultado de los cambios

- `operacion/limpieza.ts` calcula un plan a partir de manifiestos reales ordenados por su número. Reserva la vigente y su anterior, las dos últimas publicaciones cerradas como publicadas (también si quedó pendiente arrancar el respaldo), y cada publicación sin cerrar con su anterior. Reserva las huellas de sus conjuntos y las herramientas de sus commits, además de las del commit actual. Una restauración no elimina la reserva de publicaciones completadas. Una historia ilegible, un manifiesto necesario ausente, identificadores inválidos o una configuración de otro proyecto impiden limpiar.
- `operacion/limpieza.sh` solo considera repositorios exactos del proyecto y etiquetas con el formato de publicación o commit. Retira etiquetas obsoletas mediante `docker image rm <etiqueta>`, nunca por huella ni con fuerza. Antes consulta todos los contenedores, incluidos los detenidos. Si la imagen está reservada o usada, deja siempre al menos otra etiqueta. Una etiqueta manual, otro proyecto o una imagen de terceros queda fuera.
- `operacion/limpiar.sh` adquiere el mismo candado de operación, no construye ni descarga herramientas, y se puede repetir. La limpieza usa una imagen local; mantiene también esa etiqueta mientras trabaja. No borra manifiestos, configuraciones, contenedores, volúmenes, respaldos ni caché. Al final muestra `df -h /` dentro de herramientas, sin montar directorios y sin red.
- `operacion/publicar.sh` llama a la limpieza solo después de comprobar el sitio y los servicios, reponer el respaldo y cerrar el manifiesto. Conserva el candado. Un fallo de limpieza se anuncia como aviso sin convertir la publicación ya comprobada en fallida. Una operación que no terminó bien no alcanza esa llamada.
- `operacion/pasos.sh` etiqueta herramientas como `<proyecto>-herramientas:<commit corto>`, evitando mezclar instalaciones. La construcción vuelve a ser la original con `docker build` y el contenido exacto del commit.
- `operacion/ensayo/comun.sh` da al arnés su propia etiqueta dentro del proyecto de ensayo y retira únicamente etiquetas de ese proyecto al terminar. Ya no enumera herramientas globales ni decide que son suyas porque aparecieron durante la corrida. `operacion/ensayo.sh` comprueba la nueva etiqueta de herramientas.
- `.gitignore` ya no contiene `.operacion.buildx/`. No quedan órdenes de creación, uso o poda de un constructor separado.
- `pruebas/36-guiones.test.ts` mantiene completo el conjunto previo y prueba el plan, fallos, límites de propiedad, protección de imágenes y orden final de publicación. Se corrigieron los datos recuperados para cumplir las reglas reales de respaldo y la lista de conjuntos para cumplir los tipos.
- `operacion/ensayo-publicacion.sh` añade comprobaciones sobre Docker real de conservación, eliminación de la primera versión, historia, volúmenes, repetición y vuelta después de limpiar.

## Cómo usarlo

Desde la instalación del servidor, con sus archivos de entorno y manifiestos:

```sh
sh operacion/publicar.sh  # limpia automáticamente al terminar bien
sh operacion/limpiar.sh   # repetir a mano o recuperar espacio antes de otra publicación
```

La limpieza manual requiere una imagen local de herramientas y un repositorio con commit. Si no puede interpretar la historia o Docker no contesta, falla explícitamente; no interpreta el silencio como permiso para borrar. El candado impide superponer operaciones de esta instalación.

Para comprobar esta copia, una corrida a la vez:

```sh
cd /tmp/feruga-codex-qa14
sh qa/prueba.sh pruebas/36-guiones.test.ts
sh qa/tipos.sh
# ShellCheck: orden completa en el paso 5.
sh operacion/ensayo-publicacion.sh > ensayo-publicacion-35.log 2>&1
```

## Propuesta para la guía (no se modificó docs/)

### Reemplazo de «Se llenó el disco», sección 9

**Se llenó el disco.** — *La capacidad y los avisos, por probar en el servidor.* El latido avisa cuando queda menos del 10 % o menos de 5 GB. Al terminar bien una publicación, el sistema retira las etiquetas propias de versiones que ya no necesita. Conserva la vigente y su anterior, las dos últimas publicaciones completadas y cualquier publicación pendiente con su anterior, además de sus herramientas. Nunca retira la última etiqueta de una imagen reservada o usada por un contenedor, aunque esté detenido. Los manifiestos, las configuraciones y los volúmenes permanecen. Si la limpieza falla, la publicación sigue bien y aparece un aviso: desde la carpeta de la instalación, corre `sh operacion/limpiar.sh`; también puede ejecutarse antes de publicar si falta espacio. Usa el mismo candado y muestra el espacio disponible con `df -h /` dentro de herramientas, sin montar los archivos de Docker. Repetirla es seguro.

La limpieza no toca la caché de construcción: el constructor integrado de Docker tiene recolección de basura automática. Si todavía falta espacio, revisa `docker system df` **en el servidor**. Si hace falta recortar la caché a mano, en ese mismo servidor ejecuta `docker builder prune --filter 'until=168h'` y revisa su confirmación; retira caché descartable antigua, no garantiza liberar una cantidad concreta. En una máquina con otros proyectos esa caché también es de ellos: recortarla afecta sus próximas construcciones. Esta orden no forma parte de `limpiar.sh` y no se ejecutó en la máquina de desarrollo. Los respaldos no se acumulan en el servidor: se suben y se borra la copia local. Si el espacio lo ocupa la base, sus registros u otros archivos, esta limpieza de imágenes no lo resolverá: hay que identificar ese consumo y ampliar capacidad o aplicar el mantenimiento correspondiente.

### Línea para sección 11, debajo de las órdenes para cambiar

```sh
sh operacion/limpiar.sh                                    # retirar imágenes antiguas y ver el espacio libre (9)
```

La receta de caché se contrastó con la [referencia oficial de docker builder prune](https://docs.docker.com/reference/cli/docker/builder/prune/) y la [documentación de recolección de basura de Docker](https://docs.docker.com/build/cache/garbage-collection/). No se cambian políticas del constructor.

## Límites que requieren un servidor real

Quedan por medir la capacidad necesaria para las publicaciones reales, el pico de espacio durante una construcción, cuánto libera efectivamente cada retirada con capas compartidas y caché, el comportamiento de la recolección automática durante semanas y la entrega de avisos del latido al cruzar sus umbrales. No se llenó deliberadamente el disco ni se modificó el almacenamiento del servidor: el ensayo usa Docker local y sus propios servicios. Conservar imágenes evita perder la vuelta posible, pero no promete volver sin restaurar a una publicación ya abierta que pudo recibir datos nuevos; se mantienen las reglas de `volver.sh`.

## Verificación final y ensayo

- `sh qa/prueba.sh pruebas/36-guiones.test.ts`: **24 pruebas, 24 aprobadas, 0 fallidas, 0 omitidas**, 1,26 s. Código 0. Salida completa: `pruebas-36-linux-35.log`.
- `sh qa/tipos.sh`: **código 0**, sin errores. Salida: `tipos-35.log`.
- ShellCheck v0.10.0: **código 0**, archivo `shellcheck-35.log` vacío.

### Ensayo completo, iniciado

Orden: `sh operacion/ensayo-publicacion.sh > ensayo-publicacion-35.log 2>&1`. El proyecto desechable es `feruga_publicacion`; se comprobó su inventario antes de iniciar. Se seguirá registrando el avance y el resultado aquí. Ningún ensayo ni prueba se ejecuta a la vez que este.

Primer intento: código 1 antes de construir. Docker intentó actualizar `/Users/maantora/.docker/buildx/activity/…` y la restricción de escritura del entorno lo impidió (`operation not permitted`). Salida conservada en `ensayo-publicacion-35-intento-1.log`. No hubo publicaciones ni recursos del ensayo en funcionamiento.

Solución exclusiva de la comprobación: `DOCKER_CONFIG=$PWD/.operacion.trabajo/docker-cliente-35` y `DOCKER_HOST` con el socket que ya usa el contexto actual. Esta carpeta solo contiene configuración mínima del cliente (sin copiar credenciales), queda fuera de Git y fuera de la copia que construye el ensayo. No se usa `BUILDX_CONFIG`, no se crea un constructor ni se modifica el Docker de la máquina: se permite al cliente escribir su actividad dentro de la copia autorizada. El código de producción sigue llamando al mismo `docker build` original.

La configuración temporal debe conservar también la ubicación de los complementos ya instalados de Docker Desktop (`cliPluginsExtraDirs`): sin ella el primer build del arnés eligió el constructor antiguo. Se agregó la ruta de complementos existente; no se instaló ninguno. Las siguientes llamadas usan los mismos complementos de la máquina. Este ajuste solo afecta al entorno de comprobación.

Avance: construida la imagen del arnés, comprobación de red aprobada; se está preparando el almacenamiento, el vigilante y la autoridad del ensayo. La corrección de configuración del cliente permitió continuar. Los recursos usan el prefijo `feruga_publicacion`.

Avance: el arnés ya está levantado y comenzó la primera publicación. El ensayo está provocando las muertes previstas del guion alrededor de la migración para comprobar su recuperación; los mensajes `Killed: 9` de esos puntos son parte de la prueba.

Avance: recuperada la primera publicación y aprobado el recorrido por HTTPS que deja una compra real en la base desechable. Comenzó la segunda versión, con una migración nueva y pausa intermedia para comprobar que la operación permanece cerrada hasta terminar.

Avance: segunda publicación completada; siguen presentes las imágenes de la primera como versión anterior. Se recorren los rechazos previos a publicar (carpeta sucia, entorno inválido, servicio alterado y migraciones incompatibles) y se comprueba que mantienen el negocio intacto.

Avance: aprobados los rechazos previos a publicar; comenzó la serie de interrupciones antes de migrar, que deben restablecer la versión anterior sin alterar los datos del negocio.

Avance: superadas las interrupciones después del manifiesto, del cierre, del drenaje y de tomar el respaldo. Se está comprobando la interrupción tras anotar el respaldo y la recuperación que también muere a mitad del proceso.

### Conservación comprobada con Docker real

Pasó la comprobación tras tres publicaciones completadas: retiradas las cinco etiquetas de la primera versión, su imagen web exclusiva y la etiqueta de herramientas de su commit. Siguen las cinco etiquetas y herramientas de la vigente y la anterior. Se conservaron los volúmenes y los manifiestos/configuraciones; la comparación de inventarios y sumas de archivos tras repetir la limpieza no mostró cambios. El servicio siguió atendiendo y se soltó el candado.

Salida del ensayo en ese punto:

```text
Conservación de publicaciones:
  20261029T202127Z-12854f440f39-6d553a
  20261029T202852Z-3a67760c2f1c-c6ee4d
No se borró ninguna imagen ni etiqueta.
Espacio disponible en el sistema de archivos de Docker:
Filesystem                Size      Used Available Use% Mounted on
overlay                 452.1G     96.5G    332.6G  22% /
Conservación tras tres publicaciones e idempotencia: comprobadas.
```

El ensayo sigue con las demás interrupciones después de decidir abrir, la restauración y la instalación desde un respaldo en una máquina simulada nueva.

Avance: aprobadas las recuperaciones tras decidir abrir en el manifiesto y en la base, y tras abrir la operación. Continúan las interrupciones de las anotaciones finales y de la reposición del servicio de respaldo. La limpieza posterior no ha impedido las verificaciones de servicio ni ha cambiado los datos asentados.

---

## Nota de Claude al integrarlo (29 de octubre)

- **Cómo terminó:** la corrida del 22–23 se cortó por red y macOS vació /tmp; se rescató de la sesión
  de Codex y se relanzó (35b) con dos cambios decididos: sin constructor aparte (bajaba una imagen de
  BuildKit sin huella, y la recolección integrada de Docker basta) y el disco medido con `df -h /`
  sin montar la carpeta de Docker. Esta segunda corrida **se cortó por el límite de uso de Codex** a
  media verificación final; el informe de arriba es lo que alcanzó a escribir.
- **Su ensayo de publicación** pasó la conservación tras tres publicaciones y todas las
  recuperaciones hasta «Muere a media migración y el migrador sigue corriendo», donde falló con «no
  se encontró el guion de publicar para matarlo»: ese paso mata el guion desde fuera con `pkill`, y
  su corrida siguió dentro del entorno restringido de Codex, que no deja ver ni matar otros
  procesos. Se vuelve a correr completo fuera de ese entorno al integrarlo.
- **Un ajuste:** si no hay imagen de herramientas, el nombre de respaldo era `feruga-herramientas`
  fijo; ahora es el del proyecto, como todo lo demás.
- Integrado con 36-guiones (24/24), tipos y ShellCheck limpios.
