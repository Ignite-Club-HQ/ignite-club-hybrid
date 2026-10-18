"""Executable rejection tests for the read-only OQL parser (no deployed app needed)."""
import os
import shlex
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
DOMAIN = ROOT / 'backend/events_domain'
MOC = Path.home() / '.cache/mops/moc/1.16.1/moc'
SOURCES = shlex.split(subprocess.check_output(['mops', 'sources'], cwd=DOMAIN, text=True))

class OqlRejections(unittest.TestCase):
    def check_rejected(self, query, message):
        import json
        program = f'''import Oql "mo:ignite/Oql";
let entities : [Oql.Entity] = [{{name="events";fields=[{{name="id";kind="text"}}]}}];
ignore Oql.parse({json.dumps(query)}, entities);'''
        with tempfile.TemporaryDirectory(prefix='ignite-oql-') as tmp:
            path = Path(tmp) / 'reject.mo'
            path.write_text(program)
            result = subprocess.run([str(MOC), *SOURCES, '--package', 'ignite', str(ROOT / 'backend/shared'), '-r', str(path)], cwd=DOMAIN, capture_output=True, text=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('OQL: ' + message, result.stdout + result.stderr)
    def test_other_entity(self): self.check_rejected('{"entity":"secrets"}', 'Unknown entity')
    def test_private_projection(self): self.check_rejected('{"entity":"events","select":["creator"]}', 'Unknown field')
    def test_private_filter(self): self.check_rejected('{"entity":"events","filters":[{"field":"email","op":"eq","value":"x"}]}', 'Unknown field')
    def test_write(self): self.check_rejected('{"entity":"events","update":{}}', 'Unknown property')
    def test_duplicate_key(self): self.check_rejected('{"entity":"events","entity":"events"}', 'Duplicate property')
    def test_limit(self): self.check_rejected('{"entity":"events","limit":101}', 'limit must be 1..100')
    def test_offset(self): self.check_rejected('{"entity":"events","offset":10001}', 'offset exceeds 10000')
    def test_malformed(self): self.check_rejected('{broken}', 'Invalid JSON')
    def test_filter_type(self): self.check_rejected('{"entity":"events","filters":[{"field":"id","op":"eq","value":10}]}', 'Filter type mismatch')
    def test_depth(self): self.check_rejected('[' * 9 + '0' + ']' * 9, 'Query nesting exceeds 8')
    def test_length(self): self.check_rejected(' ' * 8193, 'Query exceeds 8192 characters')
    def test_aggregation(self): self.check_rejected('{"entity":"events","aggregate":"sum"}', 'Only count aggregation supported')

if __name__ == '__main__': unittest.main()
