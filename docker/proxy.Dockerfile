# El proxy, con su configuración adentro. Lo que corre lo dice la imagen, no un archivo de la
# carpeta del proyecto, que puede haber cambiado desde que se publicó.
FROM caddy:2-alpine@sha256:e70b164da81ef698b3ad19af799ea6086ce6d9e48ed4079eb9fe26f6fbf14ee5
# Lo de Alpine, al día (brotli tenía un aviso crítico ya arreglado en su serie); y sin curl, que el proxy
# no usa y traía otro (revisión de seguridad del 4 de noviembre).
RUN apk upgrade --no-cache && apk del --no-cache curl
COPY operacion/Caddyfile /etc/caddy/Caddyfile
