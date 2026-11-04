# Respuesta a la revisión de la guía (Codex, 4 de noviembre de 2026)

La revisión (`2026-11-04-codex-revision-de-la-guia.md`, encargo 38) leyó `docs/operacion.md` y el
bloque «Operación» del README como los seguirá alguien en un servidor nuevo, y contrastó cada orden
con los guiones. Dictamen: «todavía no está lista para seguirse literalmente». Se corrigió entera.

**En el código** (porque la guía no podía arreglarlo sola):

| Hallazgo | Qué se hizo |
|---|---|
| H06 (alta): `fuera.sh llave > archivo` podía borrar la única llave (la terminal vacía el archivo antes de que arranque el guion) | `fuera.sh llave <archivo>`: lo crea el guion, solo para su dueño, y se niega si ya existe; la llave no sale en pantalla — `4f43a8d` |
| H18: la llave y `recuperacion.env` se pedían dentro de la carpeta del sistema, sin estar ignorados | La guía los manda a una carpeta privada fuera del repositorio, y `llave*.txt` y `recuperacion*.env` van en `.gitignore` y `.dockerignore` por si acaso — `4f43a8d` |
| H22 y H14 (altas): instalar desde un respaldo solo sabía del depósito de cada hora, y no podía leer el almacenamiento como estaba antes de una intrusión | Lo construyó Codex (encargo 39): `publicar.sh --desde-respaldo` y `version-del-respaldo.ts` aceptan `--diario` y `--como-estaba=MOMENTO`, se recuerdan al retomar y se niegan si se cambian; con pruebas (35: 5/5, 36: 26/26). `fuera.sh version` las pasa igual. Su paso en el simulacro de publicación lo dejó escrito al acabarse su cuota; se corrió entero aquí y pasó (`afb696f`) |
| — | Los comentarios del `.env` que genera `entorno.sh` todavía decían `node operacion/sello.ts`: ahora `fuera.sh sello` |

**En la guía** (`docs/operacion.md`) y el README, todos los demás:

- H01: la llave no se guarda en el servidor, y la guía dice cómo pasarla por SSH a `volver.sh` y a
  `publicar.sh --desde-respaldo` (sección 1, y en 5, 7 y 11).
- H02, H26, H28: «cómo leer las órdenes» y «palabras que aparecen» al principio; cada bloque dice en
  qué máquina va; sin corchetes ni signos que no se teclean; órdenes completas; la 11 separada por máquina.
- H03, H10, H11, H30: el orden de la instalación (2.1 → 2.2 → 2.3 → 2.3 bis → 2.4); el dominio y
  `recuperacion.env` antes de publicar; la lista de lo que hay que llenar en el `.env` y lo que ya
  llena `entorno.sh`.
- H04, H05: `servidor.sh` deja hecho lo que alcanzó antes de detenerse; 443/UDP permitido pero sin
  HTTP/3 publicado.
- H07: las cuatro señales y sus reglas en Healthchecks (horario cron del patio, gracia).
- H08, H13: los avisos se prueban al final de 2.4; uno puede llegar dos veces si otro canal falló;
  el número del grupo de Telegram, con `/start@BOT` y copiado con su signo.
- H09, H12: la primera publicación no toma respaldo: se toma uno después del arranque y se comprueba
  ese por su nombre; la clave del primer responsable no se vuelve a enseñar, y el código del equipo
  vence en 15 minutos (y cómo pedir otro).
- H15, H16: los tres casos de `--recuperar`; la carpeta se queda en el commit que falló hasta
  terminar de recuperar o volver.
- H17, H19: la plantilla de `recuperacion.env` es un archivo que sirve tal cual (nombres completos,
  sin comentarios después del valor); los cuatro resultados del ensayo, cada uno con qué hacer.
- H20, H21: en un servidor perdido se prepara solo como en 2.1 (sin publicar ni arranque); cuánto
  se pierde ya no se promete «una hora»: depende del horario de respaldos (07:00–20:00) y de que
  hayan salido bien.
- H23, H25: cómo juntar `RESPALDO_SELLOS_ANTERIORES`; qué hacer con el sello al perder la llave o
  si alguien pudo tenerla.
- H24: que la señal del latido deje de oírse no prueba que el servidor esté caído.
- H27: la sección 10 enumera todo lo que el plan pide comprobar en el servidor.
- H29: el README ya no habla de «imágenes guardadas fuera».
