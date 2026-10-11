# El proxy, con su configuración adentro. Lo que corre lo dice la imagen, no un archivo de la
# carpeta del proyecto, que puede haber cambiado desde que se publicó.
FROM caddy:2-alpine@sha256:d8542f48d34a9cf4e4c11a478865229840e87e4c96ea3f439101f31a5d35f75f
COPY operacion/Caddyfile /etc/caddy/Caddyfile
