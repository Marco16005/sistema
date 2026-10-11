# El candado de la instalación. Una sola operación a la vez sobre esta instalación: publicar,
# recuperar, levantar, volver y migrar a mano lo piden por igual, y dos a la vez no entran, lleguen
# como lleguen. No es un guion: lo incluye cada guion, ya parado en la carpeta de la instalación.
#
#   . operacion/candado.sh
#   tomar_candado "levantar" || exit 1     # si hay otra operación, dice cuál
#   trap soltar_candado EXIT
#
# Es un candado del sistema operativo sobre un archivo, que el guion tiene abierto (en su
# descriptor 9) mientras trabaja. Lo da el sistema a uno solo, y lo quita él mismo cuando ya nadie
# tiene abierto el archivo. De ahí sale todo lo demás:
#
#   · Un guion que muere sin soltarlo —se le mató, se apagó la máquina— no deja nada trabado ni
#     hay nada que «relevar»: al morir, el sistema ya lo soltó. El que sigue entra, y dice de quién
#     había quedado.
#   · Lo que el guion lanza hereda el archivo abierto. Si el guion muere y algo suyo sigue
#     trabajando —una restauración, un respaldo, una subida—, el candado sigue tomado hasta que
#     eso termina: nadie entra a operar junto a un proceso huérfano. La excepción es el migrador,
#     que se lanza sin él (ver pasos.sh). Y un contenedor puede seguir vivo sin el programa que lo
#     lanzó: eso lo averigua aparte quien retoma, ya con el candado (esperar_al_migrador y
#     esperar_lo_que_quedo, en pasos.sh).
#   · No se pregunta si un proceso sigue vivo, ni por su número ni por cuándo empezó: no hace falta.
#
# El archivo no se borra nunca —borrarlo y volver a crearlo es justo lo que permitiría dos dueños—
# y nadie tiene por qué borrarlo a mano. Adentro dice quién lo tiene, para poder decírselo al que
# llega; mientras nadie lo tiene, está vacío.
#
# Lo toma `flock`, que viene con todo Linux. Donde no lo hay (macOS, en los ensayos), `perl`.
#
# (Una variable pegada a una letra que no es ASCII —«$que»— va entre llaves: el sh de macOS se
# lleva el primer byte de la comilla como parte del nombre.)

CANDADO=${CANDADO:-.operacion.candado}
# El turno de este proceso, mientras tiene el candado. Vacío: no lo tiene.
candado_turno=""

# candado_dice campo: lo que el candado dice de quien lo tiene.
candado_dice() {
  sed -n "s/^$1=//p" "$CANDADO" 2>/dev/null | head -1
}

# Dice quién tiene el candado, a quien no lo consiguió. Lo que dice se lee de una sola vez; y si
# en ese instante lo están anotando —o lo acaban de soltar—, se le da un momento.
candado_ocupado() {
  candado_nota=$(cat "$CANDADO" 2>/dev/null)
  case "$candado_nota" in
    *desde=*) ;;
    *)
      sleep 1
      candado_nota=$(cat "$CANDADO" 2>/dev/null)
      ;;
  esac
  candado_campo() { printf '%s\n' "$candado_nota" | sed -n "s/^$1=//p" | head -1; }
  case "$candado_nota" in
    *desde=*)
      echo "Hay otra operación en curso sobre esta instalación: «$(candado_campo que)», desde $(candado_campo desde) (proceso $(candado_campo pid)). Espera a que termine. Si ese proceso ya no existe, sigue trabajando algo que dejó lanzado: el candado se suelta solo cuando eso termine." >&2
      ;;
    *)
      echo "Hay otra operación en curso sobre esta instalación, y en este momento no dice cuál: está tomando el candado, o lo acaba de soltar. Vuelve a intentarlo." >&2
      ;;
  esac
}

# Pide al sistema el candado sobre el descriptor 9, sin esperar.
#   0: es de este proceso · 1: lo tiene otro · 2: no hay con qué pedirlo, o falló pedirlo
candado_pedir() {
  if command -v flock >/dev/null 2>&1; then
    flock -n 9
    case $? in
      0) return 0 ;;
      1) return 1 ;;
      *) return 2 ;;
    esac
  elif command -v perl >/dev/null 2>&1; then
    perl -e 'use Fcntl qw(:flock); open(my $c, ">&=", 9) or exit 2; exit(flock($c, LOCK_EX | LOCK_NB) ? 0 : ($!{EWOULDBLOCK} || $!{EAGAIN} ? 1 : 2))'
  else
    return 2
  fi
}

# Deja dicho que el candado es de este proceso. Devuelve error si no se pudo escribir.
candado_anotar() {
  candado_nuevo="$$-$(date +%s)-$(od -An -N4 -tx4 /dev/urandom | tr -d ' \n')"
  printf 'turno=%s\npid=%s\nque=%s\ndesde=%s\n' "$candado_nuevo" "$$" "$1" "$(date '+%Y-%m-%d %H:%M:%S %Z')" > "$CANDADO" 2>/dev/null || return 1
  candado_turno=$candado_nuevo
}

# tomar_candado "qué operación": lo toma, o dice por qué no y devuelve error. Cada paso se
# comprueba aquí mismo: esta función se llama con «||», y ahí el guion no se detiene solo.
tomar_candado() {
  if [ -d "$CANDADO" ]; then
    echo "El candado de la instalación ($CANDADO) es una carpeta: quedó de una versión anterior de estos guiones. Comprueba que no haya ninguna operación en curso, y bórrala." >&2
    return 1
  fi
  # Abrirlo no es tomarlo. Se prueba antes, porque un «exec» que falla se lleva al guion entero.
  if ! (umask 077 && : >> "$CANDADO") 2>/dev/null; then
    echo "No se pudo abrir el candado de la instalación ($CANDADO)." >&2
    return 1
  fi
  exec 9>> "$CANDADO"
  candado_pedir
  case $? in
    0) ;;
    1)
      exec 9>&-
      candado_ocupado
      return 1
      ;;
    *)
      exec 9>&-
      echo "No se pudo pedir el candado de la instalación: hace falta flock (viene con Linux) o perl." >&2
      return 1
      ;;
  esac
  # Es de este proceso. Si todavía dice de otro, es que ese se interrumpió sin soltarlo.
  candado_era=$(candado_dice que)
  if ! candado_anotar "$1"; then
    exec 9>&-
    echo "No se pudo anotar quién tiene el candado de la instalación ($CANDADO): no se toma." >&2
    return 1
  fi
  [ -z "$candado_era" ] || echo "(El candado había quedado de «${candado_era}», que se interrumpió sin soltarlo.)" >&2
  return 0
}

# Lo suelta, si es de este proceso. Quien no lo consiguió puede llamarla sin riesgo.
soltar_candado() {
  [ -n "$candado_turno" ] || return 0
  # Deja de decir de quién es, si todavía dice que es de este proceso.
  if [ "$(candado_dice turno)" = "$candado_turno" ]; then
    : > "$CANDADO" 2>/dev/null || true
  fi
  exec 9>&-
  candado_turno=""
}
