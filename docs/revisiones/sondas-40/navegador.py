import subprocess,requests,time,json,platform,os,shutil
from pathlib import Path
p=Path('/zap/wrk');base='https://patio.test';log=(p/'geckodriver.txt').open('w');arch='arm64' if platform.machine() in ['aarch64','arm64'] else '64'
shutil.copy(f'/root/.ZAP/webdriver/linux/{arch}/geckodriver','/tmp/codex-geckodriver');os.chmod('/tmp/codex-geckodriver',0o755)
def usuario():
 os.setgid(1000);os.setuid(1000)
proc=subprocess.Popen(['/tmp/codex-geckodriver','--host','127.0.0.1','--port','4444'],stdout=log,stderr=subprocess.STDOUT,preexec_fn=usuario,env={**os.environ,'MOZ_DISABLE_CONTENT_SANDBOX':'1'})
api='http://127.0.0.1:4444';sid=None;result=[]
def call(method,path,data=None):
 r=requests.request(method,api+path,json=data,timeout=60);r.raise_for_status();return r.json()['value']
try:
 for _ in range(40):
  try:
   requests.get(api+'/status',timeout=1);break
  except Exception:time.sleep(.5)
 opt={'capabilities':{'alwaysMatch':{'browserName':'firefox','acceptInsecureCerts':True,'moz:firefoxOptions':{'args':['-headless'],'prefs':{'network.prefetch-next':False,'browser.safebrowsing.malware.enabled':False,'browser.safebrowsing.phishing.enabled':False,'network.http.speculative-parallel-limit':0,'app.update.auto':False,'toolkit.telemetry.enabled':False}}}}}
 ses=call('POST','/session',opt);sid=ses['sessionId'];root='/session/'+sid;result.append({'capabilities':ses['capabilities']})
 call('POST',root+'/url',{'url':base+'/'})
 value=json.loads((p/'sesiones.json').read_text())['responsable']['cookie'].split('=',1)[1]
 call('POST',root+'/cookie',{'cookie':{'name':'feruga','value':value,'domain':'patio.test','path':'/','secure':True,'httpOnly':True,'sameSite':'Strict'}})
 for path in ['/panel/clientes','/panel/materiales']:
  call('POST',root+'/url',{'url':base+path});time.sleep(3)
  state=call('POST',root+'/execute/sync',{'script':"return {url:location.href,text:document.body.innerText,images:Array.from(document.querySelectorAll('img')).map(x=>({src:x.getAttribute('src'),onerror:x.getAttribute('onerror')})),payloadTags:document.querySelectorAll('[onerror]').length}",'args':[]})
  result.append({'path':path,**state})
 (p/'navegador.json').write_text(json.dumps(result,indent=2,ensure_ascii=False));print(json.dumps(result,ensure_ascii=False)[:10000])
finally:
 if sid:
  try:call('DELETE','/session/'+sid)
  except Exception:pass
 proc.terminate();proc.wait(timeout=15)
