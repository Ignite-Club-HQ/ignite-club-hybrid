# g2 post-upgrade live verification

Read-only, anonymous, certified `read_state` plus public `cycles_balance` queries against
`https://icp-api.io` on 2026-10-21, after the manual **Upgrade Group 2 (closed)** run
completed. No keys, environments, updates or settings were touched. Baseline hashes come
from `docs/group-2-live-verification-2026-10-21.md` (pre-upgrade).

## Result

- 13/13 modules changed from the pre-upgrade hashes → the upgrade applied to every service.
- 13/13 controllers are exactly the sole governor
  `vk34m-qhp7i-xyaaw-itwxz-uohx7-ucw52-mx2vs-alcau-3h4ga-rayrt-pae`.
- 13/13 balances ≥ 1.483 T (above the 1 T floor).

The hashes were compared only against the recorded pre-upgrade baseline, not against the
workflow's staged artifacts; the upgrade run's own journal/readback is the artifact match.

## Readings

| Service | Canister ID | Cycles (T) | Module hash (sha256) |
|---|---|---:|---|
| club_domain | `yfwyv-nyaaa-aaaal-qxpyq-cai` | 1.483 | `ac16fcb319f632bbc192d56bb5f3fd603b79f05684780d477c92238e63e900d6` |
| events_domain | `ymvtj-3qaaa-aaaal-qxpza-cai` | 1.486 | `cd6bf6136b171639f2f5adede548b2e4805fe3f7f2ebf2b33e4f2b14329ef655` |
| messaging_domain | `yluv5-wiaaa-aaaal-qxpzq-cai` | 1.486 | `629a95f8149f6e998496dd8cb36370a305ad90c8d38b52ffc2260dd3fe4b26fa` |
| vault_domain | `y6teq-xaaaa-aaaal-qxp2a-cai` | 1.496 | `386fe10c763e54ec8758683efb0265bbe437a0a62bc4dc1b8a9c99570f1fae89` |
| competition_domain | `yzsce-2yaaa-aaaal-qxp2q-cai` | 1.491 | `a5966f2c33b29f67029ddbfe3da1dccb84d40ab6b06f046d7cc26b4b2c226c80` |
| club_points_domain | `yqrjy-mqaaa-aaaal-qxp3a-cai` | 1.496 | `c743d1a8eb0bffb9fc95b5abaf62c4eef0d58b8ec717769b5936df5a249a68e1` |
| mini_league_domain | `yxqpm-biaaa-aaaal-qxp3q-cai` | 1.494 | `f57decd4b000ed493ee702f8995f136c252f4c48e2a27ba53e52df96e58e017f` |
| media_metadata | `z26lc-oaaaa-aaaal-qxp4a-cai` | 1.497 | `6f75f31a1daa9479f1cde860413a86f03f5ec196fbcff02f7686dfe4f89aab3a` |
| insights_domain | `z57nw-dyaaa-aaaal-qxp4q-cai` | 1.495 | `643c426eef6ae0bea32abd987b24c62c10ba2850cec968636c495f334987848f` |
| notification_queue | `zu4gk-vqaaa-aaaal-qxp5a-cai` | 1.495 | `7833ea2fc3894c2e384cf14ced7733353c02a5549f1eb0428ade67e751c81163` |
| pii_access_control | `zt5a6-yiaaa-aaaal-qxp5q-cai` | 1.496 | `d854d33e26b859dba9e8d7b16db06a772190e2b72b64e1f4f7f2652b6eaed0f1` |
| timer_jobs | `zg2rt-zaaaa-aaaal-qxp6a-cai` | 1.495 | `70d631b37e367b3b97f0423662843f32cd1434ca535666c351f9fa65143e1871` |
| media_blob_store | `ycx6b-aaaaa-aaaal-qxpya-cai` | 1.495 | `b46baa14e4c74d30fec3b29ee04a5fef0af65653d88003d6889cecd68c09e50f` |

Group 2 remains closed/unregistered; nothing was opened by the upgrade.
