"""Offline shard setup tests: never deploy or contact ICP."""
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]

class PrepareMediaShardTests(unittest.TestCase):
    def run_setup(self, args):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        root = Path(directory.name)
        (root / 'scripts').mkdir()
        shutil.copy(ROOT / 'scripts/prepare-media-shard.mjs', root / 'scripts')
        source = root / 'backend/media_blob_store'
        source.mkdir(parents=True)
        for file in ['canister.yaml', 'mops.toml']:
            shutil.copy(ROOT / 'backend/media_blob_store' / file, source)
        result = subprocess.run(['node', str(root / 'scripts/prepare-media-shard.mjs'), *args], capture_output=True, text=True)
        return root, result

    def test_default_does_not_create_or_deploy(self):
        root, result = self.run_setup(['media_blob_store_2'])
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertFalse((root / 'backend/media_blob_store_2').exists())

    def test_apply_creates_matching_recipe_and_migration_source(self):
        root, result = self.run_setup(['media_blob_store_2', '--apply'])
        self.assertEqual(result.returncode, 0, result.stderr)
        store = root / 'backend/media_blob_store_2'
        self.assertIn('name: media_blob_store_2', (store / 'canister.yaml').read_text())
        config = (store / 'mops.toml').read_text()
        self.assertIn('[canisters.media_blob_store_2]', config)
        self.assertIn('main = "../media_blob_store/src/main.mo"', config)
        self.assertIn('chain = "../media_blob_store/src/backend/migrations"', config)
        again = subprocess.run(['node', str(root / 'scripts/prepare-media-shard.mjs'), 'media_blob_store_2', '--apply'], capture_output=True)
        self.assertNotEqual(again.returncode, 0)

    def test_rejects_base_store_and_path_traversal(self):
        for name in ['media_blob_store', 'media_blob_store_1', '../club_domain', 'media_blob_store_02']:
            _, result = self.run_setup([name, '--apply'])
            self.assertNotEqual(result.returncode, 0)

if __name__ == '__main__':
    unittest.main()