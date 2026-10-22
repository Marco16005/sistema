#!/bin/sh
# Prepara Ubuntu 24.04 desde el repositorio ya clonado.
#   sudo sh operacion/servidor.sh [--quitar-contrasenas]
# ENSAYO_SERVIDOR=1 solo sirve dentro de un contenedor desechable sin systemd.
set -eu
umask 022
PATH=/usr/sbin:/usr/bin:/sbin:/bin
export PATH LC_ALL=C

falla() { echo "No se pudo preparar el servidor: $*" >&2; exit 1; }
cambio() { cambios=$((cambios + 1)); echo "Hecho: $*"; }
quitar=0
case $# in
  0) ;;
  1) [ "$1" = --quitar-contrasenas ] || falla "uso: sh operacion/servidor.sh [--quitar-contrasenas]"; quitar=1 ;;
  *) falla "uso: sh operacion/servidor.sh [--quitar-contrasenas]" ;;
esac
[ "$(id -u)" = 0 ] || falla "debe correr como root o con sudo."
# shellcheck source=/dev/null
. /etc/os-release
if [ "$ID" != ubuntu ] || [ "$VERSION_ID" != 24.04 ]; then falla "hace falta Ubuntu 24.04 LTS."; fi
ensayo=${ENSAYO_SERVIDOR:-0}
case "$ensayo" in 0|1) ;; *) falla "ENSAYO_SERVIDOR debe ser 0 o 1." ;; esac
if [ "$ensayo" = 1 ]; then
  if [ ! -f /.dockerenv ] || [ -d /run/systemd/system ]; then falla "el ensayo requiere un contenedor sin systemd."; fi
else
  [ -d /run/systemd/system ] || falla "no hay systemd; dentro de un contenedor usa ENSAYO_SERVIDOR=1."
fi
# util-linux forma parte del Ubuntu base; el listado de paquetes también lo exige.
command -v flock >/dev/null 2>&1 || falla "falta flock: instala util-linux y vuelve a correr el guion."
exec 9>/run/lock/feruga-servidor.lock
flock -n 9 || falla "ya hay otra preparación del servidor en curso."
trabajo=$(mktemp -d /tmp/feruga-servidor.XXXXXX) || falla "no se pudo crear la carpeta temporal."
chmod 700 "$trabajo"
cambios=0
ssh_pendiente=0
ssh_archivo=/etc/ssh/sshd_config.d/00-feruga.conf
limpiar() {
  resultado=$?
  trap - 0
  if [ "$ssh_pendiente" = 1 ]; then
    rm -f "$ssh_archivo"
    echo "Se retiró el cambio de SSH; se conserva la configuración anterior." >&2
    if [ "$ensayo" = 0 ]; then
      /usr/sbin/sshd -t && systemctl reload ssh || echo "No se pudo recargar SSH; conserva esta sesión y revisa desde la consola del proveedor." >&2
    fi
  fi
  rm -rf "$trabajo"
  exit "$resultado"
}
trap limpiar 0
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

# Nunca se sigue un enlace ni se pisa un archivo de configuración ajeno.
compatible() {
  [ ! -L "$2" ] || falla "$2 es un enlace; revísalo a mano."
  if [ -e "$2" ]; then
    if [ ! -f "$2" ] || ! cmp -s "$1" "$2"; then falla "$2 ya existe con otro contenido; no se pisa."; fi
  fi
}
escribir() {
  compatible "$1" "$2"
  if [ ! -e "$2" ]; then
    install -D -m 0644 "$1" "$2" || falla "no se pudo escribir $2."
    cambio "se escribió $2."
  fi
}
cat > "$trabajo/daemon.json" <<'JSON'
{
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "10m",
    "max-file": "3"
  }
}
JSON
# Antes de instalar o cambiar cualquier configuración.
compatible "$trabajo/daemon.json" /etc/docker/daemon.json
reiniciar_docker=0
if [ "$ensayo" = 0 ] && [ ! -e /etc/docker/daemon.json ] && systemctl is-active --quiet docker.service; then
  reiniciar_docker=1
fi
cuenta=${SUDO_USER:-root}
id "$cuenta" >/dev/null 2>&1 || falla "no existe la cuenta $cuenta."
casa=$(getent passwd "$cuenta" | cut -d: -f6)
[ -n "$casa" ] || falla "no se encontró la carpeta de $cuenta."
if [ "$quitar" = 1 ]; then
  if ! command -v ssh-keygen >/dev/null 2>&1 || ! command -v sshd >/dev/null 2>&1; then
    falla "falta OpenSSH del servidor; instálalo y prueba primero una conexión con llave."
  fi
  if [ ! -f "$casa/.ssh/authorized_keys" ] || ! ssh-keygen -l -f "$casa/.ssh/authorized_keys" > /dev/null 2>&1; then
    falla "$cuenta no tiene una llave válida en $casa/.ssh/authorized_keys; no se quitan las contraseñas."
  fi
  # StrictModes: dueño root o la cuenta, y nadie más puede escribir estos caminos.
  for ruta in "$casa" "$casa/.ssh" "$casa/.ssh/authorized_keys"; do
    dueno=$(stat -c %u "$ruta")
    [ "$dueno" = 0 ] || [ "$dueno" = "$(id -u "$cuenta")" ] || falla "$ruta tiene otro dueño; SSH podría rechazar la llave."
    [ -z "$(find "$ruta" -maxdepth 0 -perm /022 -print)" ] || falla "$ruta permite escribir a otros; SSH podría rechazar la llave."
  done
fi

instalado() { [ "$(dpkg-query -W -f='${Status}' "$1" 2>/dev/null)" = 'install ok installed' ]; }
instalar() {
  faltan=""
  for paquete do
    if ! instalado "$paquete"; then faltan="$faltan $paquete"; fi
  done
  if [ -n "$faltan" ]; then
    apt-get update || falla "no se pudo actualizar el índice de paquetes."
    # La lista contiene únicamente nombres de paquetes constantes, separados por espacios.
    # shellcheck disable=SC2086
    DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends $faltan \
      || falla "no se pudieron instalar:$faltan."
    cambio "se instalaron:$faltan."
  fi
}
# No se permite que APT arranque servicios incidentalmente en el ensayo.
if [ "$ensayo" = 1 ]; then
  [ -x /usr/sbin/policy-rc.d ] && /usr/sbin/policy-rc.d docker start >/dev/null 2>&1 && falla "policy-rc.d permite arrancar servicios en el ensayo."
  if [ ! -e /usr/sbin/policy-rc.d ]; then
    printf '#!/bin/sh\nexit 101\n' > /usr/sbin/policy-rc.d
    chmod 755 /usr/sbin/policy-rc.d
    cambio "se impidió arrancar servicios en este contenedor de ensayo."
  fi
fi
instalar ca-certificates curl gnupg git ufw unattended-upgrades util-linux

huella_esperada=9DC858229FC7DD38854AE2D88D81803C0EBFCD88
mkdir -m 700 "$trabajo/gnupg"
comprobar_llave() {
  gpg --batch --homedir "$trabajo/gnupg" --show-keys --with-colons "$1" > "$trabajo/llave.datos" 2>/dev/null \
    || falla "no se pudo leer la llave de Docker."
  # Solo una llave primaria, con la huella completa esperada; no basta una subllave.
  huellas=$(awk -F: '$1 == "pub" { primaria=1; next } primaria && $1 == "fpr" { print $10; primaria=0 }' "$trabajo/llave.datos")
  [ "$huellas" = "$huella_esperada" ] || falla "la huella de la llave de Docker no coincide con $huella_esperada."
}
llave=/etc/apt/keyrings/docker.asc
[ ! -L "$llave" ] || falla "$llave es un enlace; revísalo a mano."
if [ -e "$llave" ]; then
  comprobar_llave "$llave"
else
  curl --fail --silent --show-error --location --proto '=https' --proto-redir '=https' \
    --connect-timeout 20 --max-time 120 --retry 3 https://download.docker.com/linux/ubuntu/gpg -o "$trabajo/docker.asc" \
    || falla "no se pudo descargar la llave oficial de Docker."
  comprobar_llave "$trabajo/docker.asc"
  escribir "$trabajo/docker.asc" "$llave"
fi
cat > "$trabajo/docker.sources" <<FUENTE
Types: deb
URIs: https://download.docker.com/linux/ubuntu
Suites: noble
Components: stable
Architectures: $(dpkg --print-architecture)
Signed-By: /etc/apt/keyrings/docker.asc
FUENTE
escribir "$trabajo/docker.sources" /etc/apt/sources.list.d/docker.sources
# Los paquetes de Ubuntu que chocan con Docker oficial no se desinstalan a ciegas.
for paquete in docker.io docker-compose docker-compose-v2 docker-doc docker-buildx podman-docker containerd runc; do
  instalado "$paquete" && falla "está instalado $paquete, incompatible con Docker oficial; resuélvelo antes de continuar."
done
escribir "$trabajo/daemon.json" /etc/docker/daemon.json
instalar docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
docker --version || falla "Docker no está instalado correctamente."
docker compose version || falla "no está disponible el plugin de Compose."
dockerd --validate --config-file=/etc/docker/daemon.json || falla "Docker rechazó daemon.json."
if [ "$cuenta" != root ]; then
  if ! id -nG "$cuenta" | tr ' ' '\n' | grep -qx docker; then
    usermod -aG docker "$cuenta" || falla "no se pudo agregar $cuenta al grupo docker."
    cambio "$cuenta entró al grupo docker."
  fi
  echo "El grupo docker hace a $cuenta administrador del servidor. Vuelve a entrar para usarlo."
fi

# No se borran reglas preexistentes: si permiten algo distinto se requiere revisión humana.
for reglas in /etc/ufw/user.rules /etc/ufw/user6.rules; do
  [ -f "$reglas" ] || falla "falta $reglas."
  if ! awk '/^### tuple ###/ && $0 !~ /^### tuple ### allow (tcp (22|80|443)|udp 443) (0.0.0.0\/0|::\/0) any (0.0.0.0\/0|::\/0) in$/ { mal=1 } END { exit mal }' "$reglas"; then
    falla "$reglas contiene reglas adicionales; revísalas antes de limitar la entrada a 22/tcp, 80/tcp, 443/tcp y 443/udp."
  fi
done
# El guion permite SSH por 22: no cierra un acceso que esté usando otro puerto.
if command -v sshd >/dev/null 2>&1; then
  mkdir -p /run/sshd
  sshd -t || falla "la configuración actual de SSH es inválida; no se activa ufw."
  sshd -T > "$trabajo/ssh.actual" || falla "no se pudo comprobar el puerto de SSH."
  [ "$(sed -n 's/^port //p' "$trabajo/ssh.actual")" = 22 ] || falla "SSH no usa solamente el puerto 22; no se cambia el cortafuegos."
fi
for regla in '22 tcp' '80 tcp' '443 tcp' '443 udp'; do
  puerto=${regla% *}
  protocolo=${regla#* }
  if ! grep -Fqx "### tuple ### allow $protocolo $puerto 0.0.0.0/0 any 0.0.0.0/0 in" /etc/ufw/user.rules \
    || ! grep -Fqx "### tuple ### allow $protocolo $puerto ::/0 any ::/0 in" /etc/ufw/user6.rules; then
    ufw allow "$puerto/$protocolo" || falla "no se pudo permitir $puerto/$protocolo."
    cambio "se permitió $puerto/$protocolo en ufw."
  fi
done
if ! grep -qx 'IPV6=yes' /etc/default/ufw; then
  falla "ufw no tiene IPV6=yes; revísalo antes de activar el cortafuegos."
fi
for politica in 'INPUT DROP deny incoming' 'OUTPUT ACCEPT allow outgoing' 'FORWARD DROP deny routed'; do
  # Cuatro valores constantes por política.
  # shellcheck disable=SC2086
  set -- $politica
  if ! grep -qx "DEFAULT_${1}_POLICY=\"$2\"" /etc/default/ufw; then
    ufw default "$3" "$4" || falla "no se pudo poner la política de ufw: $3 $4."
    cambio "ufw: $3 $4."
  fi
done

cat > "$trabajo/20auto-upgrades" <<'APT'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
APT
escribir "$trabajo/20auto-upgrades" /etc/apt/apt.conf.d/20auto-upgrades
cat > "$trabajo/52feruga-seguridad" <<'APT'
#clear Unattended-Upgrade::Allowed-Origins;
#clear Unattended-Upgrade::Origins-Pattern;
Unattended-Upgrade::Allowed-Origins {
    "${distro_id}:${distro_codename}-security";
    "${distro_id}ESMApps:${distro_codename}-apps-security";
    "${distro_id}ESM:${distro_codename}-infra-security";
};
APT
escribir "$trabajo/52feruga-seguridad" /etc/apt/apt.conf.d/52feruga-seguridad
apt-config dump > "$trabajo/apt.config"
for opcion in Update-Package-Lists Unattended-Upgrade; do
  grep -Fqx "APT::Periodic::$opcion \"1\";" "$trabajo/apt.config" \
    || falla "otra configuración de APT desactiva $opcion."
done

if [ "$quitar" = 1 ]; then
  cat > "$trabajo/ssh.conf" <<'SSH'
# Probar una segunda conexión con llave antes de pedir este cambio.
PasswordAuthentication no
KbdInteractiveAuthentication no
PubkeyAuthentication yes
SSH
  compatible "$trabajo/ssh.conf" "$ssh_archivo"
  if [ ! -e "$ssh_archivo" ]; then
    ssh_pendiente=1
    escribir "$trabajo/ssh.conf" "$ssh_archivo"
  fi
  sshd -t || falla "sshd -t rechazó el cambio; se retira antes de recargar."
  # Examina también los Match de la conexión usada para administrar el servidor.
  direccion=127.0.0.1
  local_dir=127.0.0.1
  if [ -n "${SSH_CONNECTION:-}" ]; then
    direccion=${SSH_CONNECTION%% *}
    resto=${SSH_CONNECTION#* }
    resto=${resto#* }
    local_dir=${resto%% *}
  fi
  sshd -T -C "user=$cuenta,host=$direccion,addr=$direccion,laddr=$local_dir,lport=22" > "$trabajo/ssh.efectiva" \
    || falla "no se pudo consultar la configuración efectiva de SSH."
  for ajuste in 'passwordauthentication no' 'kbdinteractiveauthentication no' 'pubkeyauthentication yes'; do
    grep -qx "$ajuste" "$trabajo/ssh.efectiva" || falla "otra directiva de SSH impide aplicar: $ajuste."
  done
  grep -Eq '^authorizedkeysfile (.* )?(\.ssh/authorized_keys|%h/\.ssh/authorized_keys)( |$)' "$trabajo/ssh.efectiva" \
    || falla "SSH no lee .ssh/authorized_keys para $cuenta."
  grep -Eq '^authenticationmethods (any|publickey)$' "$trabajo/ssh.efectiva" \
    || falla "SSH exige otros métodos además de la llave; no se quitan las contraseñas."
  if [ "$cuenta" = root ]; then
    grep -Eq '^permitrootlogin (yes|without-password|prohibit-password)$' "$trabajo/ssh.efectiva" \
      || falla "SSH no permite entrar a root con esta llave."
  fi
  if [ "$ensayo" = 1 ]; then
    echo "Ensayo: se omite recargar sshd."
  elif [ "$ssh_pendiente" = 1 ]; then
    systemctl reload ssh || falla "no se pudo recargar SSH; se restaura la configuración anterior."
  fi
  ssh_pendiente=0
  echo "SSH: entrada por contraseña desactivada; se conserva la entrada con llave."
else
  echo "SSH no se modificó. Falta probar una segunda conexión con llave y correr --quitar-contrasenas; conserva la sesión actual y la consola del proveedor."
fi

servicio() {
  if ! systemctl is-enabled --quiet "$1"; then
    systemctl enable "$1" || falla "no se pudo habilitar $1."
    cambio "se habilitó $1."
  fi
  if ! systemctl is-active --quiet "$1"; then
    systemctl start "$1" || falla "no se pudo encender $1."
    cambio "se encendió $1."
  fi
}
if [ "$ensayo" = 1 ]; then
  echo "Ensayo: se omite encender servicios, activar ufw y recargar sshd; se comprobaron paquetes y archivos."
else
  if [ "$reiniciar_docker" = 1 ]; then
    systemctl restart docker.service || falla "no se pudo reiniciar Docker con la rotación de registros."
    cambio "se reinició Docker para aplicar daemon.json."
  fi
  servicio docker.service
  servicio unattended-upgrades.service
  servicio apt-daily.timer
  servicio apt-daily-upgrade.timer
  servicio ufw.service
  if ! ufw status | grep -qx 'Status: active'; then
    ufw --force enable || falla "no se pudo activar ufw."
    cambio "se activó ufw."
  fi
fi
if [ "$cambios" = 0 ]; then
  echo "No hay nada que cambiar."
elif [ "$cambios" = 1 ]; then
  echo "Servidor preparado: 1 cambio, el de arriba."
else
  echo "Servidor preparado: $cambios cambios; arriba se detalla cada uno."
fi
echo "El repositorio ya está clonado. Sigue con sh operacion/entorno.sh <dominio> y la sección 2.4 de docs/operacion.md."
echo "Docker publica puertos por fuera de ufw: solo debe publicar el proxy; operacion/comprobar.ts ya lo comprueba al publicar."
