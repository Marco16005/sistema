exec(open('/zap/wrk/datos-visual.py').read().split('payloads=')[0])
cases=json.loads((p/'visual-casos.json').read_text())
for case in cases:
 id=case['cuenta']['id']
 for old in case['cuenta']['materiales']:r(f'/api/cuentas/{id}/quitar',{'linea':old['id']})
 line=str(uuid.uuid4());cuenta=r(f'/api/cuentas/{id}/materiales',{'linea':line,'captura':str(uuid.uuid4()),'material':case['material']['id'],'bascula':2,'kg':'10.00'})['cuenta']
 cuenta=r(f'/api/cuentas/{id}/precio-especial',{'id':str(uuid.uuid4()),'linea':line,'visto':None,'cliente':case['cliente']['id'],'diferencia':'0.10','autoriza':c['id'],'clave':c['clave']})['cuenta']
 case['cuenta']=cuenta;(p/'visual-casos.json').write_text(json.dumps(cases,indent=2))
