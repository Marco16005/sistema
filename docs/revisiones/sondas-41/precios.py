import json,subprocess
from pathlib import Path
p=Path(__file__).parent;cases=json.loads((p/'visual-casos.json').read_text());assert len(cases)==3
ids=','.join(str(int(x['material']['id'])) for x in cases)
sql=f"BEGIN; SET LOCAL session_replication_role=replica; INSERT INTO precio (lista_id,material_id,compra,venta) SELECT l.id,m.id,1,2 FROM lista_precios l JOIN jornada j ON j.id=l.jornada_id CROSS JOIN material m WHERE j.cerrada_en IS NULL AND m.id IN ({ids}) ON CONFLICT DO NOTHING; COMMIT;"
(p/'visual-precios-fixture.sql').write_text(sql)
r=subprocess.run(['docker','exec','-i','codex-seguridad-db-40','psql','-U','feruga','-d','feruga','-v','ON_ERROR_STOP=1'],input=sql,capture_output=True,text=True);(p/'visual-precios-fixture.txt').write_text(r.stdout+r.stderr);assert r.returncode==0
