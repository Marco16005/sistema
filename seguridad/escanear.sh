#!/bin/sh
# Los escaneos de seguridad, todos en contenedores (solo pide Docker). Se corren antes de publicar una
# versión, o cuando se quiera saber si apareció algo nuevo en lo que usa el sistema.
#
#   sh seguridad/escanear.sh
#
# Lo que mira, y con qué (cada herramienta en la versión con que se revisó; cambiarla es decisión):
#   · secretos en todo el historial de Git ............................ gitleaks
#   · librerías con avisos publicados (package-lock.json) ............. OSV-Scanner y npm audit
#   · el código: patrones peligrosos de TypeScript, Node, React, Next .. semgrep
#   · los Dockerfile ................................................... hadolint y Checkov
#   · las imágenes de operación, ya construidas de esta carpeta ........ Trivy y Grype
# Lo que se ataca en marcha (OWASP ZAP, nmap, testssl) va aparte: docs/seguridad.md.
#
# Lo que ya se revisó y se decidió aceptar está dicho en docs/seguridad.md; aquí solo se enseña. Las
# salidas completas quedan en seguridad/informes/ (fuera de Git). Termina con 1 si algo nuevo de
# gravedad alta o crítica tiene arreglo publicado.
set -eu
cd "$(dirname "$0")/.."
falla() { printf '\n%s\n' "$1" >&2; exit 1; }
paso() { printf '\n== %s\n' "$1"; }
if ! command -v docker >/dev/null 2>&1 || ! docker info >/dev/null 2>&1; then falla "Hace falta Docker, encendido."; fi

GITLEAKS=zricethezav/gitleaks:v8.30.1
OSV=ghcr.io/google/osv-scanner:v2.7.0
SEMGREP=semgrep/semgrep:1.182.1
HADOLINT=hadolint/hadolint:v2.15.1
CHECKOV=bridgecrew/checkov:3.4.3
TRIVY=aquasec/trivy:0.76.1
GRYPE=anchore/grype:v0.121.1

salida=seguridad/informes
mkdir -p "$salida"
hay=0
atender() { hay=1; printf '   → %s\n' "$1"; }

paso "Secretos en el historial de Git (gitleaks)"
if docker run --rm --network none -v "$PWD:/repo:ro" "$GITLEAKS" git /repo --redact --no-banner -c /repo/.gitleaks.toml \
    --report-format json --report-path /dev/stdout >"$salida/gitleaks.json" 2>/dev/null; then
  echo "   sin secretos"
else
  atender "gitleaks encontró algo: $salida/gitleaks.json"
fi

paso "Librerías con avisos publicados (OSV-Scanner)"
if docker run --rm -v "$PWD:/src:ro" "$OSV" scan source --lockfile /src/package-lock.json >"$salida/osv.txt" 2>&1; then
  echo "   sin avisos"
else
  sed -n '/^+--/,$p' "$salida/osv.txt" | head -20
  atender "OSV-Scanner encontró avisos: $salida/osv.txt"
fi

paso "Librerías con avisos publicados (npm audit, en el contenedor de pruebas)"
if docker compose --profile pruebas run --rm --no-deps -T pruebas sh -c 'npm audit --audit-level=high' >"$salida/npm-audit.txt" 2>&1; then
  echo "   sin avisos altos ni críticos"
else
  tail -5 "$salida/npm-audit.txt"
  atender "npm audit: $salida/npm-audit.txt"
fi

paso "El código (semgrep)"
docker run --rm -v "$PWD:/src:ro" -w /src "$SEMGREP" semgrep scan --metrics=off --quiet \
  --config p/default --config p/typescript --config p/nodejs --config p/react --config p/nextjs \
  --config p/secrets --config p/dockerfile --config p/sql-injection \
  --exclude node_modules --exclude .next --exclude test-results --exclude pruebas --exclude recorrido \
  --json >"$salida/semgrep.json" 2>/dev/null || true
n=$(docker run --rm -i --network none --entrypoint node "$(sed -n 's/^FROM \(node[^ ]*\).*/\1/p' docker/respaldo.Dockerfile)" -e 'let t="";process.stdin.on("data",d=>t+=d).on("end",()=>{const d=JSON.parse(t);console.log(d.results.filter(r=>r.extra.severity==="ERROR"&&!/almacen\.Dockerfile$/.test(r.path)).length)})' <"$salida/semgrep.json")
if [ "$n" = 0 ]; then echo "   nada de gravedad alta en el código del sistema (pruebas y recorridos aparte)"; else atender "semgrep: $n de gravedad alta: $salida/semgrep.json"; fi

paso "Los Dockerfile (hadolint y Checkov)"
for f in docker/*.Dockerfile; do
  docker run --rm -i "$HADOLINT" hadolint --no-fail --format tty - <"$f" | sed "s|^-|$f|"
done >"$salida/hadolint.txt"
echo "   hadolint: $(grep -c . "$salida/hadolint.txt") observaciones (las aceptadas, en docs/seguridad.md)"
docker run --rm -v "$PWD:/src:ro" "$CHECKOV" -d /src --framework dockerfile --skip-path node_modules --skip-path .next --compact --quiet -o cli \
  >"$salida/checkov.txt" 2>&1 || true
echo "   Checkov: $(grep -c 'FAILED for resource' "$salida/checkov.txt") observaciones (las aceptadas, en docs/seguridad.md)"

paso "Las imágenes de operación (Trivy y Grype)"
base=$(sed -n 's/^FROM \([^ ]*\).*/\1/p' docker/db.Dockerfile | head -1)
docker build -q -f docker/web.Dockerfile --target web -t feruga-escaneo-web . >/dev/null
docker build -q -f docker/web.Dockerfile --target admin -t feruga-escaneo-admin . >/dev/null
docker build -q -f docker/respaldo.Dockerfile -t feruga-escaneo-respaldo . >/dev/null
docker build -q -f docker/proxy.Dockerfile -t feruga-escaneo-proxy . >/dev/null
for imagen in feruga-escaneo-web feruga-escaneo-admin feruga-escaneo-respaldo feruga-escaneo-proxy "$base"; do
  nombre=$(printf '%s' "$imagen" | sed 's/@.*//; s/[^a-z0-9-]/_/g')
  docker run --rm -v /var/run/docker.sock:/var/run/docker.sock -v feruga-trivy:/root/.cache "$TRIVY" image --quiet \
    --scanners vuln --severity HIGH,CRITICAL --ignore-unfixed --format table "$imagen" >"$salida/trivy-$nombre.txt" 2>&1 || true
  docker run --rm -v /var/run/docker.sock:/var/run/docker.sock -v feruga-grype:/.cache/grype "$GRYPE" "$imagen" \
    --only-fixed -o table >"$salida/grype-$nombre.txt" 2>/dev/null || true
  altos=$(grep -cE 'HIGH|CRITICAL' "$salida/trivy-$nombre.txt" || true)
  altos_g=$(grep -cE ' High | Critical ' "$salida/grype-$nombre.txt" || true)
  if [ "$altos" = 0 ] && [ "$altos_g" = 0 ]; then
    echo "   $imagen: sin avisos altos ni críticos con arreglo"
  else
    echo "   $imagen: Trivy $altos, Grype $altos_g renglones altos o críticos con arreglo"
    case "$imagen" in
      feruga-escaneo-proxy|postgres*) echo "     (los de Caddy y gosu se revisaron: docs/seguridad.md)" ;;
      *) atender "$imagen: $salida/trivy-$nombre.txt y $salida/grype-$nombre.txt" ;;
    esac
  fi
done
docker image rm feruga-escaneo-web feruga-escaneo-admin feruga-escaneo-respaldo feruga-escaneo-proxy >/dev/null 2>&1 || true

if [ "$hay" = 0 ]; then
  printf '\nNada nuevo que atender. Las salidas completas, en %s/.\n' "$salida"
else
  printf '\nHay algo que atender (arriba). Las salidas completas, en %s/.\n' "$salida"
  exit 1
fi
