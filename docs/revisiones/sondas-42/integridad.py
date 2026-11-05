from pathlib import Path
import hashlib,json
r=Path(__file__).resolve().parents[2]
original={str(x.relative_to(r)):hashlib.sha256(x.read_bytes()).hexdigest() for x in r.rglob('*') if x.is_file() and x.relative_to(r).parts[0] not in ('qa','node_modules','.git','.next')}
(r/'qa/seguridad-42/integridad-inicial.json').write_text(json.dumps(original,indent=2))
