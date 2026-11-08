from pathlib import Path
import subprocess
root=Path('/tmp/feruga-codex-qa14'); out=root/'qa/r43-reanudar'; out.mkdir(exist_ok=True)
publicar=(root/'operacion/publicar.sh').read_text(); volver=(root/'operacion/volver.sh').read_text()
pubfunc=publicar[publicar.index('marca_de_la_base() {'):publicar.rindex('\npreparar_herramientas\n')]
volfunc=volver[volver.index('volver() {'):volver.index('\nabrir() {')]
fixture=out/'publicaciones/pub'; fixture.mkdir(parents=True,exist_ok=True)
common='''set -eu
falla() { echo "FALLA $*"; exit 1; }
sin_cerrar() { falla "$@"; }
paso() { :; }; punto() { :; }
commit_actual() { echo commit43; }
exigir_carpeta_limpia() { :; }
nombre_del_proyecto() { echo codex43-falso; }
esperar_al_migrador() { :; }; esperar_lo_que_quedo() { :; }
exigir_redes_de_fuera() { echo "CHECK red inexistente $*"; return 1; }
arrancar() { echo "ARRANCAR $*"; }
detener() { echo "DETENER $*"; }
esperar_el_sitio() { :; }; corre() { :; }
en_la_base() { case "$*" in *'estado abierta') echo false;; *'estado marca') echo marca-nueva;; *'estado publicacion') echo pub;; *) echo "BASE $*";; esac; }
estado_de_la_base() { echo '{}'; }
manifiesto() {
 case "$1" in
 pendiente) echo pub;; vigente) :;; decidir) echo "$DECISION";;
 dato) case "$3" in
 commit) echo commit43;; anterior.configuracion) echo anterior/conjunto.json;; anterior.publicacion) echo anterior;;
 respaldo.nombre) echo respaldo;; base.marca) echo marca-anterior;; numero) echo 2;;
 marcas.seDecidioAbrir) :;; esac;;
 *) echo "MANIFIESTO $*";; esac
}
docker() { echo "DOCKER SIMULADO $*"; }
mirar_las_bases() { hay_suya=si; hay_apartada=si; la_suya=marca-nueva; }
terminar() { echo TERMINAR; }
'''
for name, body, decision in [('recuperar-anterior',pubfunc+'\nrecuperar','3'),('recuperar-candidato',pubfunc+'\nrecuperar','1 candidato'),('instalar-retomada',pubfunc+'\ninstalar',''),('volver-retomada',volfunc+'\nvolver','')]:
 if name=='instalar-retomada': (fixture/'desde-respaldo').write_text('objeto pub-vieja remoto -\n')
 else: (fixture/'desde-respaldo').unlink(missing_ok=True)
 # Las dependencias se sustituyen DESPUÉS de cargar las funciones, como en pruebas/36-guiones.
 funcs,call=body.rsplit('\n',1)
 text=funcs+'\n'+common+f'\nPUBLICACIONES="{out}/publicaciones"\npub=""; conf=""; conf_ant=""; respaldo_pedido=""; diario=""; como_estaba=""; BASE=feruga\nDECISION="{decision}"\n'+call+'\n'
 (out/(name+'.sh')).write_text(text)
 result=subprocess.run(['sh',str(out/(name+'.sh'))],input='llave falsa\n',text=True,capture_output=True,cwd=root)
 print(name,'exit=',result.returncode); print(result.stdout,end=''); print(result.stderr,end='')
