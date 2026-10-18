"""Offline frontend controller-grant regressions."""
from pathlib import Path
import os
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]


class ControllerTests(unittest.TestCase):
    def test_stopped_canister_starts_before_sync_and_failed_deploy_stops(self):
        workflow = (ROOT / '.github/workflows/deploy-frontend-canister.yml').read_text()
        upload = workflow.split('- name: Upload to frontend canister', 1)[1].split(
            '- name: Commit frontend canister ID', 1)[0].split('run: |', 1)[1]
        script = '\n'.join(line[10:] for line in upload.splitlines())
        with tempfile.TemporaryDirectory() as directory:
            temp = Path(directory)
            mapping = temp / '.icp/data/mappings'
            mapping.mkdir(parents=True)
            (mapping / 'ic.ids.json').write_text('{"frontend":"proe7-kqaaa-aaaas-qg6gq-cai"}')
            mock = temp / 'icp'
            mock.write_text('#!/bin/sh\nprintf "%s\\n" "$*" >> "$CALL_LOG"\n'
                            'case "$1" in deploy) exit 42;; esac\n')
            mock.chmod(0o755)
            log = temp / 'calls'
            result = subprocess.run(['bash', '-c', script], cwd=temp,
                                    capture_output=True, text=True,
                                    env={**os.environ, 'PATH': directory + ':' + os.environ['PATH'],
                                         'CALL_LOG': str(log)})
            calls = log.read_text().splitlines()
        self.assertEqual(result.returncode, 42)
        self.assertIn('canister start frontend -e ic', calls)
        deploy = 'deploy -e ic frontend --mode auto --yes --cycles 1000000000000'
        self.assertLess(calls.index('canister start frontend -e ic'), calls.index(deploy))
        self.assertEqual(sum(call.startswith('deploy') for call in calls), 1)
        self.assertFalse(any('reinstall' in call for call in calls))
        self.assertFalse(any('settings update' in call for call in calls))

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