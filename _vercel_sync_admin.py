import subprocess, shlex
from pathlib import Path
root = Path('c:/Users/gongz/Downloads/agent-team-v2/agent-team-v2')
k='ADMIN_PASSWORD'
v=None
for fname in ('.env.local', '.env'):
 p=root/fname
 if not p.exists(): continue
 for line in p.read_text(encoding='utf-8').splitlines():
  if line.strip().startswith('ADMIN_PASSWORD='):
   v=line.split('=',1)[1].strip().strip(chr(34)).strip(chr(39)); break
 if v: break
print('MISSING' if not v else 'ADD')
if v:
 cmd='npx --yes vercel env add ADMIN_PASSWORD production --value '+shlex.quote(v)+' --yes --force --sensitive'
 r=subprocess.run(cmd,cwd=str(root),shell=True)
 print('EXIT',r.returncode)
