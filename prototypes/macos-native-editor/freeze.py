"""Read-only fixture export. Private note content stays outside the repository."""
import collections
import hashlib
import json
import os
from pathlib import Path
import sqlite3
import sys

out = Path(sys.argv[1])
out.mkdir(parents=True, exist_ok=True)
source = Path(os.environ.get('STASH_BENCH_LIBRARY', str(Path.home() / 'Library/Application Support/local.upnote2.prototype/library.sqlite3')))
note_id = os.environ.get('STASH_BENCH_NOTE', '8ee5405e-0fb1-4509-b15a-76c9aa23f11b')
db = sqlite3.connect(source.as_uri() + '?mode=ro', uri=True)
db.execute('BEGIN')
row = db.execute('SELECT id,title,body,plain_text,document_version FROM notes WHERE id=? AND trashed_at IS NULL', (note_id,)).fetchone()
if row is None:
    raise SystemExit('Benchmark note missing. Set STASH_BENCH_NOTE to the intended note ID.')
appearance = db.execute('SELECT appearance FROM preferences WHERE id=1').fetchone()[0]
body = json.loads(row[2])
nodes, marks = collections.Counter(), collections.Counter()
def walk(n):
    nodes[n['type']] += 1
    for m in n.get('marks', []):
        marks[m['type']] += 1
    for child in n.get('content', []):
        walk(child)
walk(body)
fixture = {'id': row[0], 'title': row[1], 'content': body, 'text': row[3], 'documentVersion': row[4], 'appearance': json.loads(appearance)}
def private_write(name, value):
    path = out / name
    with path.open('w') as f:
        json.dump(value, f, ensure_ascii=False)
    path.chmod(0o600)
private_write('fixture.json', fixture)
private_write('manifest.json', {'noteID':row[0], 'bodySHA256':hashlib.sha256(row[2].encode()).hexdigest(), 'fixtureSHA256':hashlib.sha256((out/'fixture.json').read_bytes()).hexdigest(), 'characters':len(row[3]), 'nodes':dict(nodes), 'marks':dict(marks)})
db.rollback()
db.close()
print(json.dumps({'fixture': str(out/'fixture.json'), 'characters':len(row[3]), 'nodes':dict(nodes)}))
