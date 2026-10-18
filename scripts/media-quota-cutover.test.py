"""Offline safety checks: never call a real canister."""
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
ROOT = Path(__file__).resolve().parents[1]
class CutoverSafety(unittest.TestCase):
    def run_phase(self, *args):
        return subprocess.run(['node', str(ROOT / 'scripts/media-quota-cutover.mjs'), *args], cwd=ROOT, capture_output=True, text=True)
    def test_default_only_prints_commands(self):
        with tempfile.TemporaryDirectory() as directory:
            stub = Path(directory) / 'icp'
            stub.write_text('#!/bin/sh\nexit 91\n')
            stub.chmod(0o755)
            env = {**os.environ, 'PATH': f'{directory}:{os.environ["PATH"]}'}
            result = subprocess.run(['node', str(ROOT / 'scripts/media-quota-cutover.mjs'), 'register'], env=env, capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn('register_media_quota_store', result.stdout)
            self.assertNotIn('icp deploy', result.stdout)
    def test_freeze_requires_explicit_all_store_acknowledgement(self):
        result = self.run_phase('freeze', '--apply')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('EVERY store', result.stderr)
    def test_activate_requires_explicit_all_store_acknowledgement(self):
        result = self.run_phase('activate', '--apply')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('EVERY store', result.stderr)
    def test_activation_checks_authority_before_opening_stores(self):
        result = self.run_phase('activate')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertLess(result.stdout.index('activate_media_quota'), result.stdout.index('enable_shared_media_quota'))
    def test_storage_migration_is_explicit_and_one_call_per_store(self):
        denied = self.run_phase('migrate-storage', '--apply')
        self.assertNotEqual(denied.returncode, 0)
        self.assertIn('EVERY store', denied.stderr)
        preview = self.run_phase('migrate-storage')
        self.assertEqual(preview.returncode, 0, preview.stderr)
        self.assertIn('migrate_legacy_blob', preview.stdout)
        self.assertNotIn('icp deploy', preview.stdout)
    def test_stable_enable_is_separate_from_quota_activation(self):
        preview = self.run_phase('enable-storage')
        self.assertEqual(preview.returncode, 0, preview.stderr)
        self.assertIn('enable_stable_media_storage', preview.stdout)
        self.assertNotIn('activate_media_quota', preview.stdout)
if __name__ == '__main__': unittest.main()