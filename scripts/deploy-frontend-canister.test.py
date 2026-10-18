"""Offline frontend controller-grant regressions."""
from pathlib import Path
import os
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]


class ControllerTests(unittest.TestCase):
    def test_supported_command_and_failure_propagation(self):
        workflow = (ROOT / '.github/workflows/deploy-frontend-canister.yml').read_text()
        command = next(line.strip() for line in workflow.splitlines()
                       if line.strip().startswith('icp canister settings update'))
        self.assertEqual(command, 'icp canister settings update frontend --add-controller '
                         'mzzzv-taaaa-aaaal-qxlrq-cai -e ic --force')
        self.assertIn('@icp-sdk/icp-cli@1.7.0 ', workflow)
        upload = workflow.split('- name: Upload to frontend canister', 1)[1].split(
            '- name: Commit frontend canister ID', 1)[0]
        self.assertIn('set -euo pipefail', upload)
        with tempfile.TemporaryDirectory() as directory:
            mock = Path(directory) / 'icp'
            mock.write_text('#!/bin/sh\nexit 42\n')
            mock.chmod(0o755)
            result = subprocess.run(['bash', '-c', 'set -euo pipefail\n' + command +
                                     '\nprintf "SUCCESS"'], capture_output=True, text=True,
                                    env={**os.environ, 'PATH': directory + ':' + os.environ['PATH']})
        self.assertEqual(result.returncode, 42)
        self.assertNotIn('SUCCESS', result.stdout)


if __name__ == '__main__':
    unittest.main()