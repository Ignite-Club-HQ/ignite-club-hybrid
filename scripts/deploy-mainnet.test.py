"""Offline deployment safety regressions; never contact a live canister."""
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
GOVERNOR = "gwyap-pqop5-msidu-vlkov-zuejr-7gqjr-dwvkx-2yhgy-mdaxt-2giwn-cae"


class DeploySafetyTests(unittest.TestCase):
    def run_deploy(self, modern):
        with tempfile.TemporaryDirectory() as directory:
            temp = Path(directory)
            log = temp / "calls"
            executable = temp / "icp"
            executable.write_text('''#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$CALL_LOG"
case "$*" in
  'canister install --help')
    if [ "$MODERN" = 1 ]; then echo '--wasm-memory-persistence keep'; fi ;;
  '--version') echo 'icp 1.7.0' ;;
  'identity principal') printf '%s\\n' "$TEST_GOVERNOR" ;;
  deploy*) exit 42 ;;
  *) exit 99 ;;
esac
''')
            executable.chmod(0o755)
            environment = dict(os.environ, PATH=f"{temp}:{os.environ['PATH']}",
                               CALL_LOG=str(log), MODERN=str(int(modern)),
                               TEST_GOVERNOR=GOVERNOR, GOVERNOR=GOVERNOR,
                               DEPLOY_TARGET="mainnet", ICP_ENV="ic")
            result = subprocess.run(["bash", str(ROOT / "scripts/deploy-mainnet.sh")],
                                    env=environment, capture_output=True, text=True)
            return result, log.read_text().splitlines()

    def test_old_cli_is_rejected_before_deploy(self):
        result, calls = self.run_deploy(False)
        self.assertEqual(result.returncode, 1)
        self.assertFalse(any(call.startswith("deploy") for call in calls))

    def test_eop_aware_cli_uses_state_preserving_auto_mode(self):
        _, calls = self.run_deploy(True)
        self.assertIn("deploy -e ic -y --mode auto --cycles 1000000000000", calls)

    def test_failed_upgrade_stops_without_destructive_retry_or_wiring(self):
        result, calls = self.run_deploy(True)
        self.assertEqual(result.returncode, 42)
        self.assertEqual(sum(call.startswith("deploy") for call in calls), 1)
        self.assertFalse(any("reinstall" in call or "replace" in call for call in calls))
        self.assertFalse(any(call.startswith("canister call") for call in calls))


if __name__ == "__main__":
    unittest.main()