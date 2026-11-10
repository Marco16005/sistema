# Se incluye con pasos.sh y el candado ya tomado. El subshell no altera las variables del publicador.
limpiar_publicaciones() (
  set -eu
  [ -n "${candado_turno:-}" ] || falla "La limpieza necesita el candado de la instalación."
  proyecto_limpieza=$(nombre_del_proyecto) || falla "No se pudo identificar el proyecto: no se limpia."
  commit_limpieza=$(commit_actual)
  [ -n "$commit_limpieza" ] || falla "No se pudo identificar el commit: no se limpia."
  herramientas_limpieza=$HERRAMIENTAS
  # Se usa código de esta carpeta con una imagen ya disponible: limpiar nunca construye ni descarga.
  if [ -z "$herramientas_limpieza" ]; then
    disponibles=$(docker image ls --format '{{.Repository}}:{{.Tag}}' --filter "reference=$proyecto_limpieza-herramientas:*") || exit 1
    herramientas_limpieza=$(printf '%s\n' "$disponibles" | head -1)
    if [ -z "$herramientas_limpieza" ]; then
      herramientas_limpieza="$proyecto_limpieza-herramientas:$(printf '%s' "$commit_limpieza" | cut -c1-12)"
    fi
  fi
  docker image inspect "$herramientas_limpieza" >/dev/null || falla "No hay herramientas locales para limpiar."
  # shellcheck disable=SC2086  # los topes, una opción por palabra
  plan_limpieza=$(docker run --rm --pull never $TOPES_DE_AYUDA --network none --user "$(id -u):$(id -g)" \
    -v "$PWD:/codigo:ro" -v "$PWD/$PUBLICACIONES:/publicaciones:ro" -w /codigo \
    --entrypoint node "$herramientas_limpieza" operacion/limpieza.ts /publicaciones "$proyecto_limpieza" "$commit_limpieza") \
    || falla "No se pudo calcular qué conservar: no se borró nada."
  [ -n "$plan_limpieza" ] || falla "El plan de conservación está vacío: no se limpia."
  plan_limpieza="$plan_limpieza
herramienta $herramientas_limpieza"
  echo "Conservación de publicaciones:"
  printf '%s\n' "$plan_limpieza" | sed -n 's/^publicacion /  /p'
  inventario=$(docker image ls --format '{{.Repository}}:{{.Tag}}') || falla "No se pudo listar las imágenes: no se limpia."
  borradas=0
  for etiqueta in $inventario; do
    repositorio=${etiqueta%:*}
    version_limpieza=${etiqueta##*:}
    case "$repositorio" in
      "$proyecto_limpieza-web"|"$proyecto_limpieza-admin"|"$proyecto_limpieza-respaldo"|"$proyecto_limpieza-proxy"|"$proyecto_limpieza-db")
        printf '%s\n' "$version_limpieza" | grep -Eq '^[0-9]{8}T[0-9]{6}Z-[a-f0-9]{12}-[a-f0-9]{6}$' || continue
        if printf '%s\n' "$plan_limpieza" | grep -Fxq "publicacion $version_limpieza"; then continue; fi
        ;;
      "$proyecto_limpieza-herramientas")
        printf '%s\n' "$version_limpieza" | grep -Eq '^[a-f0-9]{12}$' || continue
        if printf '%s\n' "$plan_limpieza" | grep -Fxq "herramienta $etiqueta"; then continue; fi
        ;;
      *) continue ;;
    esac
    huella_limpieza=$(docker image inspect -f '{{.Id}}' "$etiqueta") || exit 1
    usos=$(docker ps -aq --filter "ancestor=$huella_limpieza") || falla "No se pudo consultar quién usa $etiqueta."
    protegida=no
    if printf '%s\n' "$plan_limpieza" | grep -Fxq "imagen $huella_limpieza"; then protegida=si; fi
    if [ -n "$usos" ] || [ "$protegida" = si ]; then
      etiquetas=$(docker image inspect -f '{{len .RepoTags}}' "$etiqueta") || exit 1
      case "$etiquetas" in ''|*[!0-9]*) falla "No se pudo contar las etiquetas de $etiqueta." ;; esac
      # Quitar un alias obsoleto no borra la imagen: se deja siempre otra etiqueta que la retenga.
      if [ "$etiquetas" -le 1 ]; then
        echo "Se conserva $etiqueta: su imagen sigue en uso o reservada."
        continue
      fi
    fi
    # Nunca por huella, nunca --force: Docker también protege frente a un contenedor creado entre consultas.
    docker image rm "$etiqueta" || falla "No se pudo retirar $etiqueta; se puede repetir la limpieza."
    borradas=$((borradas + 1))
  done
  if [ "$borradas" -eq 0 ]; then echo "No se borró ninguna imagen ni etiqueta.";
  else echo "Etiquetas retiradas: $borradas."; fi
  # En el contenedor, / está en el disco donde Docker guarda sus datos, también con un daemon remoto.
  echo "Espacio disponible en el sistema de archivos de Docker:"
  # shellcheck disable=SC2086  # los topes, una opción por palabra
  docker run --rm --pull never $TOPES_DE_AYUDA --network none --user "$(id -u):$(id -g)" --read-only \
    --entrypoint df "$herramientas_limpieza" -h /
)
