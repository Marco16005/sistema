#!/bin/sh
# Genera el archivo de entorno de operación, con claves al azar.
#
#   sh operacion/entorno.sh patio.ejemplo.mx
#
# Deja un archivo .env en la carpeta donde se corre, que solo puede leer quien lo creó. No necesita
# Docker ni la base: es lo primero que se hace en un servidor nuevo. No muestra ninguna clave en
# pantalla, y si ya existe un .env no lo toca.
set -eu
umask 077

dominio="${1:-}"
if ! printf '%s' "$dominio" | grep -Eq '^[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?)+$'; then
  echo "Uso: sh operacion/entorno.sh <dominio>" >&2
  echo "El dominio va solo, sin https:// ni ruta. Por ejemplo: patio.ejemplo.mx" >&2
  exit 2
fi
if [ -e .env ]; then
  echo "Aquí ya existe un .env y no se toca. Si de verdad quieres uno nuevo, guarda ese en otro lado primero:" >&2
  echo "cambiar SESION_CLAVE deja fuera a todos los equipos, y las claves de la base ya están en uso." >&2
  exit 1
fi

# Letras y números al azar: las claves de la base viajan dentro de una dirección de conexión.
clave() {
  LC_ALL=C tr -dc 'A-Za-z0-9' < /dev/urandom | head -c "$1"
}

# Con «noclobber»: si entre la comprobación de arriba y este punto alguien creó el archivo, falla en vez de pisarlo.
set -C
{
  echo "# Entorno de operación de $dominio."
  echo "# Lleva las claves del sistema: guarda una copia fuera del servidor, junto con la llave privada del respaldo."
  echo
  echo "COMPOSE_FILE=docker-compose.yml:docker-compose.operacion.yml"
  echo "MODO=operacion"
  echo
  echo "DOMINIO=$dominio"
  echo "ORIGEN=https://$dominio"
  echo "COOKIE_SEGURA=1"
  echo "NEGOCIO_NOMBRE=Recicladora"
  echo
  echo "# Administración de la base (migraciones, consola, respaldos)."
  echo "BD_CLAVE=$(clave 32)"
  echo "# Usuario con que la aplicación se conecta."
  echo "WEB_BD_CLAVE=$(clave 32)"
  echo "# Sella la cookie de cada equipo. Cambiarla deja fuera a todos los equipos."
  echo "SESION_CLAVE=$(clave 48)"
  echo
  echo "# A qué horas se toma respaldo, en la hora del patio. Aquí, cada hora de 7 de la mañana a 8 de la noche."
  echo "RESPALDO_HORARIO=07:00,08:00,09:00,10:00,11:00,12:00,13:00,14:00,15:00,16:00,17:00,18:00,19:00,20:00"
  echo
  echo "# Lo que solo tú puedes poner."
  echo "# La llave pública (empieza con age1) se genera FUERA del servidor; la privada nunca debe estar aquí."
  echo "RESPALDO_LLAVE_PUBLICA="
  echo "# El sello de los respaldos: 64 letras que se sacan de la llave privada, también FUERA del servidor:"
  echo "#   node operacion/sello.ts < llave-privada.txt"
  echo "# Con él el servidor sella cada respaldo; quien restaura lo comprueba con la llave privada, antes de"
  echo "# bajar nada. De estas 64 letras no se vuelve a la llave privada."
  echo "RESPALDO_SELLO="
  echo "# A dónde van los respaldos: respaldo:<cubo>/<carpeta>. Y cómo se llega: el servicio, y la credencial"
  echo "# del servidor, que sube y lee lo cifrado pero no puede borrar ni cambiar la retención."
  echo "RESPALDO_DESTINO="
  echo "RCLONE_CONFIG_RESPALDO_TYPE=s3"
  echo "RCLONE_CONFIG_RESPALDO_PROVIDER="
  echo "RCLONE_CONFIG_RESPALDO_ENDPOINT="
  echo "RCLONE_CONFIG_RESPALDO_REGION="
  echo "RCLONE_CONFIG_RESPALDO_ACCESS_KEY_ID="
  echo "RCLONE_CONFIG_RESPALDO_SECRET_ACCESS_KEY="
  echo "# A quién se le avisa de cada respaldo (https://…). Si deja de recibir el aviso a su hora, alerta."
  echo "RESPALDO_VIGIA_URL="
  echo "# El respaldo diario, que se guarda un año: OTRO depósito (diario:<cubo>/<carpeta>), creado con retención de"
  echo "# 365 días, con su propia credencial —sube y lee, no borra— y su propio vigilante."
  echo "RESPALDO_DESTINO_DIARIO="
  echo "RCLONE_CONFIG_DIARIO_TYPE=s3"
  echo "RCLONE_CONFIG_DIARIO_PROVIDER="
  echo "RCLONE_CONFIG_DIARIO_ENDPOINT="
  echo "RCLONE_CONFIG_DIARIO_REGION="
  echo "RCLONE_CONFIG_DIARIO_ACCESS_KEY_ID="
  echo "RCLONE_CONFIG_DIARIO_SECRET_ACCESS_KEY="
  echo "RESPALDO_VIGIA_DIARIO_URL="
} > .env

echo "Listo: se creó .env para $dominio, con claves nuevas."
echo "Falta que pongas en él lo del respaldo: la llave pública y el sello, los dos destinos (el de cada hora y el diario) con sus credenciales, y sus vigilantes."
echo "Sin eso, operación no arranca."
