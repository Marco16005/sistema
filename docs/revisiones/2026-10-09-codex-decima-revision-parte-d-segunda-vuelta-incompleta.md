> Informe de Codex (`gpt-6-astra`, esfuerzo alto, con ejecución), tal como lo dejó en
> `/tmp/feruga-codex-informe-10d2.md` (9 de octubre, 14:06). Es la **segunda vuelta de la parte D**
> (el respaldo diario): verificar las correcciones y terminar los puntos 8, 9 y 10. **Quedó
> incompleta otra vez:** a los tres minutos se le acabó la cuota («You've hit your usage limit…
> try again at 6:30 PM»). Verificó D1 a D12 —dejó abiertos D3, D4, D7, D8 y D9, con cinco
> hallazgos— y **siguen sin revisar el 8 (restaurar del diario), el 9 (las precisiones del diseño;
> solo tocó la c) y el 10 (el veredicto)**. Esos tres no cuentan como revisados.
> Lo que se hizo con cada hallazgo está en `2026-10-07-respuesta-a-la-decima-revision.md`.

# Décima pasada de calidad, parte D — segunda vuelta — 2026-10-09 (incompleta)

D1. CERRADO (sonda candidatos: «D1_D2: salta .100 dañado, elige .200 antes de .900 pese al UUID»): traer valida manifiesto y huella antes de escribir; YaNoSirve salta al siguiente y la elección persistida se conserva (diario.ts:230,280,293).
D2. CERRADO (misma sonda candidatos): enSuOrden consulta instantáneas de grupos que incluyen nombres antiguos, con desempate por objeto (diario.ts:248).
D3. NO CERRADO: perder la sesión entre consultar pg_locks y completar la escritura todavía permite sobrescribir la elección ganadora; confirmado con sesión PostgreSQL real en base desechable.
D4. NO CERRADO del todo: revalidación semanal y repaso mensual implementados; el repaso pierde avisos no entregados y un objeto ilegible impide revisar todos los posteriores (sondas aviso y repaso).
D5. CERRADO para el caso original por lectura: la nota válida solo suprime el aviso; no excluye resolver el día; sin candidato hoy no se marca hueco (diario.ts:193,303).
D6. CERRADO por lectura: incorpora elecciones sin par aun fuera de la ventana del origen (diario.ts:175).
D7. NO CERRADO en el repaso: un objeto ilegible bloquea los posteriores (sonda repaso); corregido para los días del recorrido: captura por día y acumula fallas; pasoDiario emite fallo por su propia señal (diario.ts:392; respaldar.ts:177).
D8. NO CERRADO: solo corta entre días; listados y subidas conservan 30 minutos por operación, y dentro de un día no se vuelve a exigir presupuesto. Sonda plazo: 5 minutos permiten 87 minutos simulados.
D9. NO CERRADO: el aviso ordinario se reintenta, pero un diario antiguo dañado queda en repasados antes de entregar el aviso; no vuelve a avisarse hasta 30 días después (sonda aviso).
D10. CERRADO para las diagonales finales: senal normaliza origen y ruta antes de comparar (entorno.ts:112).
D11. CERRADO por lectura: entorno y vigiaHttp rechazan usuario/contraseña; el error de transporte solo expone clase/código (entorno.ts:128; respaldar.ts:57).
D12. CERRADO para dos alias con igual tipo, endpoint normalizado y cubo (entorno.ts:90); la identidad ante endpoints alternativos requiere comprobación en el proveedor.
8. Pendiente: restauración y credenciales.
9. Pendiente: precisiones del diseño (a–f).
10. Pendiente: veredicto y orden de pendientes.

### [bloqueante] La consulta del turno no protege una escritura que ya empezó
Dónde: operacion/diario.ts:184; operacion/respaldar.ts:165
Escenario: A comprueba el turno y empieza subir elección; se termina su sesión; aparece un candidato anterior; B toma turno, fija ese candidato y completa su diario; llega la escritura atrasada de A → pisa la elección de B. A falla en el siguiente guard, pero deja elección y par completo distintos. El candado de retención conserva versiones; no impide una nueva versión vigente.
Confirmado con: `sh qa/node.sh qa/sonda-10d2.ts turno` → `D3: sesión real terminada después del guard; segunda termina bien; primera sobrescribe elección ganadora y luego falla; elección != par completo`. Depósito simulado y terminación real de sesión en base desechable; no se simuló el guard de producción.
Corrección sugerida: persistir la elección inmutable bajo exclusión transaccional y usarla como autoridad, o usar una operación condicional/fencing efectiva en el almacenamiento. Volver a preguntar antes de subir reduce la ventana, pero no garantiza exclusión.

### [importante] El repaso consume el aviso de corrupción aunque no llegue al vigilante
Dónde: operacion/diario.ts:387; operacion/respaldar.ts:189
Escenario: diario de junio sin original, archivo alterado del mismo tamaño → el repaso devuelve hueco y guarda repasados; falla el envío al vigilante, sin anotarAvisados; siguiente hora → cero huecos y cero fallas, por lo que pasoDiario envía éxito. El aviso pendiente se pierde durante 30 días mientras viva el proceso.
Confirmado con: `sh qa/node.sh qa/sonda-10d2.ts aviso` → `D4_D9: diario antiguo dañado, primer aviso no entregado; siguiente corrida huecos=0 fallas=0 avisados=0 (silencio de 30 días)`.
Corrección sugerida: separar el resultado del repaso del aviso pendiente y reenviar este último hasta confirmación, sin necesitar otra descarga del archivo.

### [importante] El presupuesto no limita el tiempo dentro de un día
Dónde: operacion/diario.ts:393; operacion/diario.ts:188; operacion/destino.ts:49
Escenario: arranque con presupuesto de 5 minutos y un diario pendiente; las tres subidas (elección, archivo, manifiesto) tardan 29 minutos cada una, dentro del plazo individual de 30 → completa después de 87 minutos, retiene el turno y retrasa el respaldo horario. Los listados tampoco reciben el tiempo restante; varios candidatos del mismo día siguen intentándose después de agotarlo.
Confirmado con: `sh qa/node.sh qa/sonda-10d2.ts plazo` → `D8: presupuesto=5 min; tres subidas de 29 min (< plazo rclone 30 min); transcurrido=87 min; pendientes=0`. Reloj y demoras simulados, sin esperar 87 minutos.
Corrección sugerida: propagar una fecha límite cancelable a listar/subir/bajar y comprobarla entre candidatos y pasos; conservar elección pendiente y liberar el turno al agotarla.

### [importante] Las elecciones antiguas no amplían el recorrido continuo de días
Dónde: operacion/diario.ts:174
Escenario: queda una elección del 1 de octubre sin par, ya no hay originales de ese día y los respaldos actuales comienzan el 9 → revisa el 1 y el 9, pero no avisa de los días 2–8 sin respaldo. Tampoco recorre hasta ayer si solo quedan elecciones y ningún original. Contradice 9c («respaldos —o elección—»).
Confirmado con: `sh qa/node.sh qa/sonda-10d2.ts intervalo` → `9c: elección 01-oct y origen 09-oct; huecos=[01-oct]; omite 02–08-oct`.
Corrección sugerida: calcular el inicio con las fechas de origen y elecciones y recorrer hasta ayer; reconocer los pares diarios existentes para no inventar huecos en días ya cubiertos.

### [importante] Un diario antiguo ilegible monopoliza todos los repasos
Dónde: operacion/diario.ts:373; operacion/diario.ts:385
Escenario: dos diarios sin original; leer el manifiesto del primero falla siempre por un permiso específico y el segundo está dañado → cada corrida elige al primero; la excepción impide actualizar su fecha; el segundo nunca se comprueba, aunque pasen meses. La corrida sí avisa fallo genérico, pero no detecta el otro daño.
Confirmado con: `sh qa/node.sh qa/sonda-10d2.ts repaso` → `D4_D7: tres corridas repasan siempre el primero ilegible; segundo dañado nunca se comprueba`.
Corrección sugerida: rotar por fecha de intento separada de la fecha de comprobación satisfactoria; mantener el fallo pendiente sin impedir revisar los demás.
