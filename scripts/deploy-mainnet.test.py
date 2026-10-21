"""Offline deployment safety regressions; never contact a live canister."""
import json
import os
from pathlib import Path
import subprocess
import tempfile
import shutil
import unittest

ROOT = Path(__file__).resolve().parents[1]
GOVERNOR = "gwyap-pqop5-msidu-vlkov-zuejr-7gqjr-dwvkx-2yhgy-mdaxt-2giwn-cae"


class DeploySafetyTests(unittest.TestCase):
    def run_deploy(self, modern, deployed=False, key_safe=True, scope="all", push_worker=False):
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
  deploy*) if [ "$DEPLOYED" = 1 ]; then exit 0; else exit 42; fi ;;
  canister?call*) echo '(variant { Ok })' ;;
  *) exit 99 ;;
esac
''')
            executable.chmod(0o755)
            preflight = temp / "node"
            preflight.write_text('''#!/usr/bin/env bash
if [[ "$1" == *push-worker-principal.mjs ]]; then
  test "$1" = "$TEST_REPO/scripts/push-worker-principal.mjs" && test -f "$1" || exit 44
  test "$PUSH_WORKER_NODE_PATH" = "$TEST_REPO/frontend/node_modules" || exit 45
  printf 'worker-helper resolved\n' >> "$CALL_LOG"
  printf '%s\n' "$TEST_GOVERNOR"
  exit 0
fi
if [[ "$1" == -e && "$2" == *require.resolve* ]]; then
  [[ "$2" == *"$TEST_REPO/frontend/node_modules"* ]] || exit 46
  exit 0
fi
if [[ "$1" != *media-key-deploy-preflight.mjs ]]; then exec "$REAL_NODE" "$@"; fi
printf 'key-preflight %s\n' "$2" >> "$CALL_LOG"
if [ "$KEY_SAFE" != 1 ]; then exit 43; fi
if [ "$2" = before ]; then mkdir -p "$(dirname "$4")"; printf '{}' > "$4"; fi
exit 0
''')
            preflight.chmod(0o755)
            environment = dict(os.environ, PATH=f"{temp}:{os.environ['PATH']}", REAL_NODE=shutil.which("node"),
                               CALL_LOG=str(log), MODERN=str(int(modern)), DEPLOYED=str(int(deployed)),
                               ICP_PUSH_WORKER_SEED=("00" * 32 if push_worker else ""), TEST_REPO=str(ROOT),
                               TEST_GOVERNOR=GOVERNOR, GOVERNOR=GOVERNOR,
                               KEY_SAFE=str(int(key_safe)),
                               DEPLOY_TARGET="mainnet", ICP_ENV="ic", DEPLOY_SCOPE=scope)
            result = subprocess.run(["bash", str(ROOT / "scripts/deploy-mainnet.sh")],
                                    env=environment, capture_output=True, text=True)
            return result, log.read_text().splitlines()

    def test_push_worker_helper_resolves_from_repo_after_entering_deploy_directory(self):
        result, calls = self.run_deploy(True, deployed=True, push_worker=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("worker-helper resolved", calls)
        grant = f'canister call notification_queue grant_worker (principal "{GOVERNOR}") -e ic'
        self.assertIn(grant, calls)
        self.assertLess(calls.index("worker-helper resolved"), calls.index(grant))
        self.assertTrue(any(c.startswith("canister call media_blob_store set_club_domain_canister") for c in calls))

    def test_league_parent_authorities_are_wired_reciprocally(self):
        result, calls = self.run_deploy(True, deployed=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        ids = json.loads((ROOT / "deploy/mainnet/.icp/data/mappings/ic.ids.json").read_text())
        self.assertIn(f'canister call events_domain set_mini_league_domain_canister (principal "{ids["mini_league_domain"]}") -e ic', calls)
        self.assertIn(f'canister call mini_league_domain set_events_domain_canister (principal "{ids["events_domain"]}") -e ic', calls)

    def test_old_cli_is_rejected_before_deploy(self):
        result, calls = self.run_deploy(False)
        self.assertEqual(result.returncode, 1)
        self.assertFalse(any(call.startswith("deploy") for call in calls))

    def test_competition_participant_authorities_are_wired_reciprocally(self):
        result, calls = self.run_deploy(True, deployed=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        ids = json.loads((ROOT / "deploy/mainnet/.icp/data/mappings/ic.ids.json").read_text())
        self.assertIn(f'canister call club_domain set_competition_authorities (vec {{ principal "{ids["competition_domain"]}" }}) -e ic', calls)
        self.assertIn(f'canister call competition_domain set_participant_club_authorities (vec {{ principal "{ids["club_domain"]}" }}) -e ic', calls)

    def test_eop_aware_cli_uses_state_preserving_auto_mode(self):
        _, calls = self.run_deploy(True)
        self.assertIn("deploy -e ic -y --mode auto --cycles 1000000000000", calls)
        self.assertLess(calls.index("key-preflight before"), calls.index("deploy -e ic -y --mode auto --cycles 1000000000000"))

    def test_unverified_original_photo_key_blocks_every_upgrade(self):
        result, calls = self.run_deploy(True, key_safe=False)
        self.assertEqual(result.returncode, 43)
        self.assertFalse(any(call.startswith("deploy") for call in calls))
        self.assertFalse(any(call.startswith("canister call") for call in calls))

    def test_failed_upgrade_stops_without_destructive_retry_or_wiring(self):
        result, calls = self.run_deploy(True)
        self.assertEqual(result.returncode, 42)
        self.assertEqual(sum(call.startswith("deploy") for call in calls), 1)
        self.assertFalse(any("reinstall" in call or "replace" in call for call in calls))
        self.assertFalse(any(call.startswith("canister call") for call in calls))

    def test_history_scope_only_upgrades_two_existing_canisters(self):
        result, calls = self.run_deploy(True, deployed=True, scope="history")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual([c for c in calls if c.startswith("deploy")], ["deploy competition_domain events_domain -e ic -y --mode upgrade --no-create"])
        mutations = [c for c in calls if c.startswith("canister call")]
        self.assertEqual(len(mutations), 4)
        self.assertTrue(all(c.startswith(("canister call events_domain ", "canister call competition_domain ")) for c in mutations))

    def test_history_failure_never_falls_back_to_install(self):
        result, calls = self.run_deploy(True, scope="history")
        self.assertEqual(result.returncode, 42)
        self.assertEqual(sum(c.startswith("deploy") for c in calls), 1)
        self.assertFalse(any(c.startswith("canister call") for c in calls))


if __name__ == "__main__":
    unittest.main()