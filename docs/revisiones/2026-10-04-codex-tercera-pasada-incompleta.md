# Tercera pasada de Codex: incompleta por cuota (4 de octubre de 2026)

Modelo `gpt-6-astra`, esfuerzo alto, con ejecución, sobre una copia en `/tmp/feruga-codex-qa3/`.
Se le pidió verificar las correcciones a su segunda revisión (parte 1) y revisar el diseño
versión 2 de la tarea 5 (parte 2). **Se quedó sin cuota a las 12:16, antes de entregar informe**
(«You've hit your usage limit… try again at 2:01 PM»).

**Esta revisión no cuenta como hecha y hay que repetirla entera.** No hay veredicto de ninguna de
las dos partes. La parte 2 (el diseño) no se empezó.

## Lo que alcanzó a dejar escrito

De su informe parcial (`/tmp/feruga-codex-informe-3.md`):

- Batería: tipos correctos, **600 de 600 pruebas**.
- Ensayo de operación: **aprobado**, con sus seis recorridos por HTTPS.
- Interrupciones de `levantar.sh`: el fallo de `mktemp` ya no deja el candado; error normal y
  SIGTERM limpian; SIGKILL deja candado y carpeta privada, como es de esperarse.
- Dos «observaciones de lectura pendientes de reproducción»: que la rama de nombres antiguos en el
  mismo segundo no respeta el límite de diez, y que una fecha imposible aceptada por la expresión
  regular puede dejar el momento sin valor y hacer que el grupo no retire candidatos.

## Lo que dicen sus registros, y no alcanzó a redactar

Leídos por mí en `/tmp/feruga-codex-qa3/` (`reproducciones.log`, `vida.log`, `bordes.log`) junto
con sus guiones. Una prueba que ahí falló o dio un resultado inesperado es un hallazgo aunque no
esté redactado.

**Confirmado como corregido por sus reproducciones:** la base caída contesta 503 en ruta y salud;
los respaldos con nombre anterior se listan y se restauran por nombre; cien fallos de red se
detienen al primer intento; los manifiestos con tamaño imposible o distinto del objeto no se
aceptan; con la conexión del turno terminada no queda sesión del volcado; una conexión del pozo
abierta antes de registrar una restauración ve el cambio; el plazo del volcado con la instantánea
abierta vence y limpia. La función `vida_vigente()` la puede leer el usuario de la aplicación, no
puede alterar la propiedad de la base, una propiedad puesta a mano con otro valor no la da por
buena, y sobrevive a renombrar la base.

**Defectos:**

1. **`restore_create_servidor_distinto`: `vigente: true`, `registros: 0`.** Un volcado restaurado
   **en otro servidor** con `pg_restore --create` queda emparejado sin haber registrado ninguna
   restauración. La propiedad de la base (`ALTER DATABASE … SET feruga.vida`) **sí viaja** en el
   volcado cuando se restaura con `--create` (su `marca_en_archivo_custom` lo muestra:
   `sqlCreateTieneAlterDatabase: true`). La decisión 10 decía que esa marca «no viaja»: es falso
   para esa forma de restaurar. El programa de restauración no usa `--create`, pero «restaurar a
   mano no basta» dejaba de ser cierto.
2. **`fecha_imposible_bucle`: el proceso tuvo que matarse por tiempo.** Un objeto con una fecha
   imposible en el nombre (`2026/99/04/…`) pasa la expresión regular, su momento no es una fecha,
   y `ultimoUtilizable` se queda en un bucle sin fin.
3. **`cien_viejos_mismo_segundo`: 100 lecturas.** En el grupo de nombres antiguos del mismo
   segundo no se aplica el tope de diez.
4. **`instantanea_discrepa_dos_horas`: aceptado, y el servicio no respaldó.** Un manifiesto cuya
   instantánea no es la del nombre de su objeto se da por bueno, y con eso se puede dar por
   tomado un respaldo que no es de esa hora.
5. **`limite_con_anterior_valido`:** con los diez más nuevos dañados y uno anterior bueno,
   restaurar «el último» dice que no hay ninguno con su manifiesto en orden. Sí lo hay, más atrás:
   el mensaje engaña (por nombre sí se trae).

**Sin resultado:** su caso `plazo_base_sin_limpieza_cliente` (si el plazo de espera del lado de la
base retira la sesión de un volcado cuyo cliente murió) falló por su propia barrera («no hubo
barrera»): no dice nada del proyecto. `admin_empareja_a_mano` muestra que quien administra la base
puede emparejarla sin registrar una restauración: es cierto y se declara como límite.

La respuesta a estos cinco está en `2026-10-04-respuesta-a-la-tercera-pasada-incompleta.md`.
