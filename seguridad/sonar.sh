#!/bin/sh
# SonarQube sobre el código guardado en Git: levanta un servidor desechable en esta máquina, lo
# analiza con el escáner y enseña lo que marcó, regla por regla. Va aparte de escanear.sh porque es
# pesado: unos 3.5 GB de memoria libre mientras corre, y 4 GB de imágenes.
#
#   sh seguridad/sonar.sh            (con CONSERVAR=1 deja el servidor en http://127.0.0.1:9100)
#
# Solo pide Docker y Git. Analiza lo guardado (git archive), no lo que esté a medias. La clave de
# administración del servidor se inventa en cada corrida y no se guarda ni se enseña: el servidor se
# borra al terminar. Lo que marca y ya se revisó está dicho en docs/seguridad.md; las salidas
# completas quedan en seguridad/informes/sonar-*.json (fuera de Git).
set -eu
cd "$(dirname "$0")/.."
falla() { printf '\n%s\n' "$1" >&2; exit 1; }
paso() { printf '\n== %s\n' "$1"; }
if ! command -v docker >/dev/null 2>&1 || ! docker info >/dev/null 2>&1; then falla "Hace falta Docker, encendido."; fi

SONARQUBE=sonarqube:26.10.0.133078-community
ESCANER=sonarsource/sonar-scanner-cli:12.3.1.4302_8.3.1
NODE=$(sed -n 's/^FROM \(node[^ ]*\).*/\1/p' docker/respaldo.Dockerfile)
SERVIDOR=feruga-sonar
RED=feruga-sonar-red
salida=seguridad/informes
mkdir -p "$salida"
copia=$(mktemp -d)
clave="$(LC_ALL=C tr -dc 'A-Za-z0-9' </dev/urandom | head -c 24)Aa1-"

recoger() {
  if [ -z "${CONSERVAR:-}" ]; then
    docker rm -f "$SERVIDOR" >/dev/null 2>&1 || true
    docker network rm "$RED" >/dev/null 2>&1 || true
  fi
  rm -rf "$copia"
}
trap recoger EXIT
# api <método> <ruta> [<renglones de configuración de curl>…]: con la clave por la entrada, no en la orden.
api() {
  metodo=$1; ruta=$2; shift 2
  { printf 'user = "admin:%s"\n' "$clave"; for r in "$@"; do printf '%s\n' "$r"; done; } |
    docker exec -i "$SERVIDOR" curl -sf -K - -X "$metodo" "http://127.0.0.1:9000$ruta"
}

paso "El servidor, desechable ($SONARQUBE)"
docker rm -f "$SERVIDOR" >/dev/null 2>&1 || true
docker network inspect "$RED" >/dev/null 2>&1 || docker network create "$RED" >/dev/null
publicar=""
[ -z "${CONSERVAR:-}" ] || publicar="-p 127.0.0.1:9100:9000"
# shellcheck disable=SC2086  # vacío o una sola opción
docker run -d --name "$SERVIDOR" --network "$RED" $publicar -e SONAR_ES_BOOTSTRAP_CHECKS_DISABLE=true "$SONARQUBE" >/dev/null
intentos=0
until docker exec "$SERVIDOR" curl -sf http://127.0.0.1:9000/api/system/status 2>/dev/null | grep -q '"status":"UP"'; do
  intentos=$((intentos + 1))
  [ "$intentos" -lt 120 ] || falla "SonarQube no arrancó en 10 minutos: docker logs $SERVIDOR"
  sleep 5
done
printf 'user = "admin:admin"\ndata-urlencode = "login=admin"\ndata-urlencode = "previousPassword=admin"\ndata-urlencode = "password=%s"\n' "$clave" |
  docker exec -i "$SERVIDOR" curl -sf -K - -X POST http://127.0.0.1:9000/api/users/change_password >/dev/null \
  || falla "No se pudo poner la clave de administración del servidor."
ficha=$(api POST /api/user_tokens/generate 'data-urlencode = "name=escaner"' 'data-urlencode = "type=GLOBAL_ANALYSIS_TOKEN"' |
  sed -n 's/.*"token":"\([^"]*\)".*/\1/p')
[ -n "$ficha" ] || falla "El servidor no dio una ficha para el escáner."
echo "   arriba"

paso "El análisis, de lo guardado en Git ($ESCANER)"
git archive HEAD | tar -x -C "$copia"
# Con poca memoria libre, el analizador de TypeScript se cae («bridge server is unresponsive»): se le pone tope.
if ! docker run --rm --network "$RED" -v "$copia:/usr/src" -e SONAR_HOST_URL="http://$SERVIDOR:9000" -e SONAR_TOKEN="$ficha" \
    -e SONAR_SCANNER_JAVA_OPTS="-Xmx768m" "$ESCANER" \
    -Dsonar.projectKey=feruga -Dsonar.projectName=feruga -Dsonar.sourceEncoding=UTF-8 \
    -Dsonar.sources=src,operacion,consola,db,docker,seguridad -Dsonar.tests=pruebas,recorrido \
    -Dsonar.exclusions='**/*.sql' -Dsonar.javascript.node.maxspace=1536 \
    -Dsonar.qualitygate.wait=true -Dsonar.qualitygate.timeout=600 >"$salida/sonar-escaner.txt" 2>&1; then
  grep -E 'ERROR|QUALITY GATE' "$salida/sonar-escaner.txt" | head -5
  falla "El análisis no terminó: $salida/sonar-escaner.txt"
fi
grep -o 'QUALITY GATE STATUS: [A-Z]*' "$salida/sonar-escaner.txt" | sed 's/^/   /'

paso "Lo que marcó"
api GET "/api/issues/search?componentKeys=feruga&ps=500&resolved=false" >"$salida/sonar-problemas.json"
api GET "/api/hotspots/search?project=feruga&ps=500" >"$salida/sonar-puntos.json"
docker run --rm -i --network none --entrypoint node "$NODE" -e '
  let t = "";
  process.stdin.on("data", (d) => (t += d)).on("end", () => {
    const { issues } = JSON.parse(t);
    const porRegla = new Map();
    for (const i of issues) porRegla.set(i.rule, [...(porRegla.get(i.rule) ?? []), i]);
    console.log(`   ${issues.length} avisos, en ${porRegla.size} reglas`);
    for (const [regla, lista] of [...porRegla].sort((a, b) => b[1].length - a[1].length)) {
      console.log(`   ${regla} (${lista[0].severity}, ${lista.length}): ${lista[0].message.slice(0, 110)}`);
      for (const i of lista) console.log(`      ${i.component.replace(/^feruga:/, "")}:${i.line ?? "-"}`);
    }
  });' <"$salida/sonar-problemas.json"
puntos=$(grep -o '"total":[0-9]*' "$salida/sonar-puntos.json" | head -1 | cut -d: -f2)
echo "   puntos de seguridad por revisar: ${puntos:-?}"
printf '\nLo ya revisado, con su razón, está en docs/seguridad.md. Las salidas completas, en %s/.\n' "$salida"
