import subprocess, shlex
from pathlib import Path
root = Path('c:/Users/gongz/Downloads/agent-team-v2/agent-team-v2')
def load():
    out = {}
    for fname in ('.env.local', '.env'):
        p = root / fname
        if not p.exists():
            continue
        for line in p.read_text(encoding='utf-8').splitlines():
            line = line.strip()
            if not line or line.startswith('#') or '=' not in line:
                continue
            k, v = line.split('=', 1)
            k, v = k.strip(), v.strip().strip(chr(34)).strip(chr(39))
            if k in ('DASHSCOPE_API_KEY', 'ADMIN_PASSWORD') and k not in out and v:
                out[k] = v
    return out
vals = load()
for k in ('DASHSCOPE_API_KEY', 'ADMIN_PASSWORD'):
    if k not in vals:
        print('SKIP', k)
        continue
    print('ADD', k)
    cmd = 'npx --yes vercel env add ' + k + ' production --value ' + shlex.quote(vals[k]) + ' --yes --force --sensitive'
    r = subprocess.run(cmd, cwd=str(root), shell=True)
    print('EXIT', k, r.returncode)
