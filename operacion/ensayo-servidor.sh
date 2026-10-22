#!/bin/sh
# Solo necesita Docker. No usa Compose, puertos publicados ni el Docker del anfitrión dentro del contenedor.
#   sh operacion/ensayo-servidor.sh
set -eu
cd "$(dirname "$0")/.."
falla() { echo "Falló el ensayo del servidor: $*" >&2; exit 1; }
paso() { printf '\n== %s\n' "$1"; }
command -v docker >/dev/null 2>&1 || falla "hace falta Docker."
docker info >/dev/null 2>&1 || falla "Docker no contesta."
contenedor=feruga-servidor-ensayo
revisor=feruga-servidor-shellcheck-$$
creado=0
limpiar() {
  resultado=$?
  trap - 0
  if [ "$creado" = 1 ]; then
    if ! docker rm -f "$contenedor" >/dev/null; then
      echo "No se pudo borrar $contenedor; bórralo con docker rm -f $contenedor." >&2
      resultado=1
    fi
  fi
  if docker container inspect "$revisor" >/dev/null 2>&1; then
    docker rm -f "$revisor" >/dev/null || resultado=1
  fi
  exit "$resultado"
}
trap limpiar 0
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM
# El nombre fijo impide dos ensayos a la vez. Si ya existe, pertenece a otra corrida y no se borra.
docker create --name "$contenedor" ubuntu:24.04 sleep infinity >/dev/null \
  || falla "no se pudo crear $contenedor; si ya existe, espera a que termine la otra corrida."
creado=1

paso "ShellCheck 0.10.0: los dos guiones nuevos deben pasar sin advertencias"
docker run --name "$revisor" --rm --network none \
  -v "$(pwd)/operacion:/trabajo/operacion:ro" -w /trabajo \
  koalaman/shellcheck:v0.10.0 operacion/servidor.sh operacion/ensayo-servidor.sh \
  || falla "ShellCheck encontró problemas en los guiones nuevos."
paso "ShellCheck del resto de operacion/*.sh (solo se informa)"
set --
for archivo in operacion/*.sh; do
  case "$archivo" in operacion/servidor.sh|operacion/ensayo-servidor.sh) ;; *) set -- "$@" "$archivo" ;; esac
done
if [ "$#" -gt 0 ]; then
  if docker run --name "$revisor" --rm --network none \
    -v "$(pwd)/operacion:/trabajo/operacion:ro" -w /trabajo \
    koalaman/shellcheck:v0.10.0 "$@"; then
    echo "Los demás guiones también pasaron."
  else
    echo "Se informaron los problemas de los otros guiones; no hacen fallar este ensayo."
  fi
fi

paso "Ubuntu 24.04 desechable, sin privilegios ni puertos publicados"
docker start "$contenedor" >/dev/null || falla "no se pudo arrancar Ubuntu."
docker exec "$contenedor" mkdir -p /trabajo/operacion || falla "no se pudo preparar la carpeta de prueba."
docker cp operacion/servidor.sh "$contenedor:/trabajo/operacion/servidor.sh" || falla "no se pudo copiar servidor.sh."
# Todo el material de prueba y las huellas quedan dentro del contenedor.
docker exec -i "$contenedor" sh <<'PRUEBAS' || falla "una comprobación dentro de Ubuntu no pasó."
set -eu
export LC_ALL=C
falla() { echo "Falló la comprobación: $*" >&2; exit 1; }
paso() { printf '\n== %s\n' "$1"; }
cd /trabajo
printf '#!/bin/sh\nexit 101\n' > /usr/sbin/policy-rc.d
chmod 755 /usr/sbin/policy-rc.d
apt-get update
DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends sudo openssh-server
useradd -m -s /bin/sh prueba
printf 'prueba ALL=(root) NOPASSWD: ALL\n' > /etc/sudoers.d/prueba
chmod 440 /etc/sudoers.d/prueba
# Se entra como el usuario de prueba y se usa sudo de verdad: SUDO_USER no se inventa.
servidor() { su -s /bin/sh prueba -c 'cd /trabajo && sudo -n env ENSAYO_SERVIDOR=1 sh operacion/servidor.sh'" $*"; }
huella() {
  # Inventario con nombres, tipos, permisos, dueños, tamaño, mtime/ctime, enlaces y contenido.
  # Se excluye atime porque leer un archivo puede actualizarlo.
  find /etc -xdev -printf '%p|%y|%m|%U|%G|%s|%T@|%C@|%l\n' | sort > "$1"
  find /etc -xdev -type f -exec sha256sum '{}' + | sort >> "$1"
}
rechaza() {
  patron=$1
  shift
  if servidor "$@" > /tmp/rechazo.log 2>&1; then cat /tmp/rechazo.log; falla "aceptó un caso que debía rechazar: $patron."; fi
  cat /tmp/rechazo.log
  grep -Fq "$patron" /tmp/rechazo.log || falla "se negó por otra razón, no por: $patron."
}

paso "Con --quitar-contrasenas y sin llave, se niega antes de cambiar /etc"
huella /tmp/sin-llave.antes
rechaza 'no tiene una llave válida' --quitar-contrasenas
huella /tmp/sin-llave.despues
cmp /tmp/sin-llave.antes /tmp/sin-llave.despues || falla "cambió /etc al negarse por falta de llave."

paso "Primera corrida: instala y configura"
if ! servidor > /tmp/primera.log 2>&1; then cat /tmp/primera.log; falla "no terminó la primera corrida."; fi
cat /tmp/primera.log
grep -q 'Servidor preparado:' /tmp/primera.log || falla "la primera corrida no informó cambios."
grep -q 'SSH no se modificó' /tmp/primera.log || falla "faltó el aviso sobre SSH."
[ ! -e /etc/ssh/sshd_config.d/00-feruga.conf ] || falla "modificó SSH sin pedirlo."
docker --version
docker compose version
dockerd --validate --config-file=/etc/docker/daemon.json
cat > /tmp/daemon.esperado <<'JSON'
{
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "10m",
    "max-file": "3"
  }
}
JSON
cmp /tmp/daemon.esperado /etc/docker/daemon.json || falla "no está la rotación json-file, 10m, 3 archivos."
for paquete in ca-certificates curl gnupg git ufw unattended-upgrades util-linux docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin; do
  [ "$(dpkg-query -W -f='${Status}' "$paquete")" = 'install ok installed' ] || falla "falta $paquete."
done
id prueba
id -nG prueba | tr ' ' '\n' | grep -qx docker || falla "prueba no está en el grupo docker."
for archivo in /etc/ufw/user.rules /etc/ufw/user6.rules; do
  grep '^### tuple ###' "$archivo"
  [ "$(grep -c '^### tuple ###' "$archivo")" = 4 ] || falla "no hay exactamente cuatro reglas en $archivo."
  for regla in 'tcp 22' 'tcp 80' 'tcp 443' 'udp 443'; do
    grep -Fq "### tuple ### allow $regla " "$archivo" || falla "falta $regla en $archivo."
  done
done
grep -qx 'DEFAULT_INPUT_POLICY="DROP"' /etc/default/ufw || falla "ufw no deniega entrada."
grep -qx 'DEFAULT_OUTPUT_POLICY="ACCEPT"' /etc/default/ufw || falla "ufw no permite salida."
grep -qx 'IPV6=yes' /etc/default/ufw || falla "ufw no cubre IPv6."
grep -qx 'ENABLED=no' /etc/ufw/ufw.conf || falla "se activó ufw en el ensayo."
grep -Fqx 'APT::Periodic::Unattended-Upgrade "1";' /etc/apt/apt.conf.d/20auto-upgrades || falla "no quedaron actualizaciones encendidas."
apt-config dump > /tmp/apt.efectivo
grep -Fqx 'APT::Periodic::Unattended-Upgrade "1";' /tmp/apt.efectivo || falla "APT no activa las actualizaciones."
grep -Fq '${distro_id}:${distro_codename}-security' /tmp/apt.efectivo || falla "faltan los orígenes de seguridad."

paso "Segunda corrida: ningún cambio en /etc"
huella /tmp/antes
if ! servidor > /tmp/segunda.log 2>&1; then cat /tmp/segunda.log; falla "no terminó la segunda corrida."; fi
cat /tmp/segunda.log
huella /tmp/despues
cmp /tmp/antes /tmp/despues || { diff -u /tmp/antes /tmp/despues; falla "la segunda corrida cambió /etc."; }
grep -qx 'No hay nada que cambiar.' /tmp/segunda.log || falla "no dijo que no había nada que cambiar."
sha256sum /tmp/antes /tmp/despues

paso "Con una llave válida, quita contraseñas y conserva la entrada por llave"
install -d -m 700 -o prueba -g prueba /home/prueba/.ssh
ssh-keygen -q -t ed25519 -N '' -f /tmp/llave
install -m 600 -o prueba -g prueba /tmp/llave.pub /home/prueba/.ssh/authorized_keys
# Mutación: texto que parece una llave pero no contiene una llave válida.
cp /home/prueba/.ssh/authorized_keys /tmp/authorized_keys.bien
printf 'ssh-ed25519 no-es-una-llave\n' > /home/prueba/.ssh/authorized_keys
rechaza 'no tiene una llave válida' --quitar-contrasenas
cp /tmp/authorized_keys.bien /home/prueba/.ssh/authorized_keys
if ! servidor --quitar-contrasenas > /tmp/ssh.log 2>&1; then cat /tmp/ssh.log; falla "no pudo quitar contraseñas con una llave válida."; fi
cat /tmp/ssh.log
sshd -t
sshd -T -C user=prueba,host=localhost,addr=127.0.0.1 > /tmp/ssh.efectiva
for ajuste in 'passwordauthentication no' 'kbdinteractiveauthentication no' 'pubkeyauthentication yes'; do
  grep -qx "$ajuste" /tmp/ssh.efectiva || falla "SSH no aplicó $ajuste."
done
huella /tmp/ssh.antes
servidor --quitar-contrasenas > /tmp/ssh.segunda.log 2>&1 || { cat /tmp/ssh.segunda.log; falla "falló repetir con SSH configurado."; }
huella /tmp/ssh.despues
cmp /tmp/ssh.antes /tmp/ssh.despues || falla "repetir con SSH cambió /etc."
grep -qx 'No hay nada que cambiar.' /tmp/ssh.segunda.log || falla "repetir con SSH no informó ausencia de cambios."

paso "Si SSH rechaza el archivo nuevo, se retira sin recargar"
rm /etc/ssh/sshd_config.d/00-feruga.conf
printf 'UnaDirectivaInexistente yes\n' > /etc/ssh/sshd_config.d/99-roto.conf
rechaza 'la configuración actual de SSH es inválida' --quitar-contrasenas
[ ! -e /etc/ssh/sshd_config.d/00-feruga.conf ] || falla "dejó el archivo con SSH inválido."
rm /etc/ssh/sshd_config.d/99-roto.conf
# Una directiva anterior al Include hace que la configuración efectiva rechace el cambio.
cp -p /etc/ssh/sshd_config /tmp/sshd_config.bien
{ printf 'PasswordAuthentication yes\n'; cat /tmp/sshd_config.bien; } > /etc/ssh/sshd_config
rechaza 'otra directiva de SSH impide aplicar' --quitar-contrasenas
[ ! -e /etc/ssh/sshd_config.d/00-feruga.conf ] || falla "no retiró el cambio rechazado por la configuración efectiva."
cp -p /tmp/sshd_config.bien /etc/ssh/sshd_config
sshd -t

paso "Un daemon.json distinto se conserva y detiene el guion sin otros cambios"
printf '{"log-driver":"local"}\n' > /etc/docker/daemon.json
huella /tmp/conflicto.antes
rechaza '/etc/docker/daemon.json ya existe con otro contenido'
huella /tmp/conflicto.despues
cmp /tmp/conflicto.antes /tmp/conflicto.despues || falla "tocó /etc al encontrar otro daemon.json."
cp /tmp/daemon.esperado /etc/docker/daemon.json

paso "Una llave de Docker falsa y una regla adicional de ufw se rechazan"
cp /etc/apt/keyrings/docker.asc /tmp/docker.asc.bien
printf 'no es una llave\n' > /etc/apt/keyrings/docker.asc
rechaza 'no se pudo leer la llave de Docker'
cp /tmp/docker.asc.bien /etc/apt/keyrings/docker.asc
ufw allow 5432/tcp
rechaza 'contiene reglas adicionales'
ufw delete allow 5432/tcp

paso "El candado impide otra preparación simultánea"
flock /run/lock/feruga-servidor.lock sh -c '
  su -s /bin/sh prueba -c "cd /trabajo && sudo -n env ENSAYO_SERVIDOR=1 sh operacion/servidor.sh" > /tmp/candado.log 2>&1 && exit 1
  grep -q "ya hay otra preparación" /tmp/candado.log
' || falla "no rechazó otra preparación simultánea."
cat /tmp/candado.log
paso "Ensayo completo: todas las comprobaciones pasaron"
PRUEBAS
paso "Se borran los contenedores propios al salir"
