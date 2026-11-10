#!/bin/sh
set -eu
set -o pipefail
publica=$(age-keygen -y /trabajo/llave.txt)
pg_dump --format=custom | age --recipient "$publica" --output /trabajo/tuberia.dump.age
age --decrypt --identity /trabajo/llave.txt --output /trabajo/anual.dump /trabajo/tuberia.dump.age
ls -l /trabajo/tuberia.dump.age /trabajo/anual.dump
