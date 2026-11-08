# El proxy, con su configuración adentro. Lo que corre lo dice la imagen, no un archivo de la
# carpeta del proyecto, que puede haber cambiado desde que se publicó.
#
# Caddy se compila aquí, con el Go de hoy y sus librerías de red y de cifrado al día: el binario de la
# imagen oficial (la misma versión, 2.11.7) estaba hecho con un Go y una librería de red con avisos
# altos y uno crítico, y es la pieza que da a internet (revisión de seguridad del 4 de noviembre). Lo
# que se baja para compilar lo comprueba Go contra su registro público de huellas (sum.golang.org).
# Cuando Caddy saque una versión hecha con un Go sin avisos, esto puede volver a ser solo la imagen oficial.
FROM caddy:2-builder-alpine@sha256:95a5e7e2692b5eb9545aadc5b90a39f6f509bee59c9508a493f83ee902eaef63 AS construccion
WORKDIR /obra
RUN printf 'package main\n\nimport (\n\tcaddycmd "github.com/caddyserver/caddy/v2/cmd"\n\t_ "github.com/caddyserver/caddy/v2/modules/standard"\n)\n\nfunc main() { caddycmd.Main() }\n' > main.go \
 && go mod init caddy-del-patio \
 && go get github.com/caddyserver/caddy/v2@v2.11.7 golang.org/x/net@v0.60.0 github.com/go-jose/go-jose/v4@v4.1.6 \
 && go mod tidy \
 && CGO_ENABLED=0 go build -trimpath -ldflags "-s -w" -o /caddy .

FROM caddy:2-alpine@sha256:e70b164da81ef698b3ad19af799ea6086ce6d9e48ed4079eb9fe26f6fbf14ee5
# Lo de Alpine, al día (brotli tenía un aviso crítico ya arreglado en su serie); y sin curl, que el proxy
# no usa y traía otro (revisión de seguridad del 4 de noviembre).
RUN apk upgrade --no-cache && apk del --no-cache curl
COPY --from=construccion /caddy /usr/bin/caddy
COPY operacion/Caddyfile /etc/caddy/Caddyfile
# Lo que hace con cada petición, y la configuración para cuando va detrás de otro proxy (docker-compose.detras.yml).
COPY operacion/sitio.caddy /etc/caddy/sitio.caddy
COPY operacion/Caddyfile.detras /etc/caddy/Caddyfile.detras
