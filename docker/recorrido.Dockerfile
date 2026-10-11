# El navegador para los recorridos. La imagen oficial trae los navegadores de la misma versión
# que la biblioteca: si se sube una, se sube la otra.
FROM mcr.microsoft.com/playwright:v1.63.0-noble
# certutil: con él, el ensayo de operación le dice al navegador que confíe en la autoridad del
# proxy de ensayo, en vez de ignorar los errores de certificado.
RUN apt-get update && apt-get install -y --no-install-recommends libnss3-tools && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV TZ=America/Mexico_City
