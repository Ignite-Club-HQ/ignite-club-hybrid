# g2 read-only live verification

Observation window: 2026-10-21T02:19:43.775Z to 2026-10-21T02:19:47.474Z.

## Result and scope

13/13 canisters answered both public health queries; 13/13 module hashes and 13/13 controller sets were verified using certified read_state against the installed frontend agent’s pinned IC mainnet root key, with certificate time verification enabled. Anonymous HTTPS only; no fetchRootKey, updates, management calls, workflows, top-ups, private keys, or environments accessed. No repository files edited.

All 13 balances are below the repository health script’s 1,000,000,000,000-cycle low-fuel threshold (approximately 0.983–0.997 T); therefore this is NOT an all-healthy verdict. All reported memory totals are below its 3 GB advisory threshold.

Health readings are replica-signature-verified ordinary queries, not consensus-certified balances or memory. Hash/controller readings are certified state evidence. They do not establish activation, configuration correctness, service authorization, durable exclusivity, or application safety.

## Exact health readings

All memory columns are bytes, exactly as returned; memory_bytes is not recomputed.

| Service | Canister ID | Cycles | memory_bytes | heap_bytes | stable_bytes |
|---|---|---:|---:|---:|---:|
| club_domain | `yfwyv-nyaaa-aaaal-qxpyq-cai` | 982886534526 | 5898240 | 5857312 | 0 |
| events_domain | `ymvtj-3qaaa-aaaal-qxpza-cai` | 987662363016 | 5636096 | 5604752 | 0 |
| messaging_domain | `yluv5-wiaaa-aaaal-qxpzq-cai` | 987277658492 | 5636096 | 5576240 | 0 |
| vault_domain | `y6teq-xaaaa-aaaal-qxp2a-cai` | 996034386155 | 5373952 | 5315232 | 0 |
| competition_domain | `yzsce-2yaaa-aaaal-qxp2q-cai` | 992542370249 | 5439488 | 5417592 | 0 |
| club_points_domain | `yqrjy-mqaaa-aaaal-qxp3a-cai` | 996327282763 | 5373952 | 5308960 | 0 |
| mini_league_domain | `yxqpm-biaaa-aaaal-qxp3q-cai` | 994916603250 | 5373952 | 5346016 | 0 |
| media_metadata | `z26lc-oaaaa-aaaal-qxp4a-cai` | 997053948248 | 5308416 | 5302808 | 0 |
| insights_domain | `z57nw-dyaaa-aaaal-qxp4q-cai` | 995308841843 | 5373952 | 5345608 | 0 |
| notification_queue | `zu4gk-vqaaa-aaaal-qxp5a-cai` | 995789780937 | 5373952 | 5347256 | 0 |
| pii_access_control | `zt5a6-yiaaa-aaaal-qxp5q-cai` | 996274013016 | 5373952 | 5323920 | 0 |
| timer_jobs | `zg2rt-zaaaa-aaaal-qxp6a-cai` | 994785133159 | 9699328 | 1245184 | 8454144 |
| media_blob_store | `ycx6b-aaaaa-aaaal-qxpya-cai` | 994871740526 | 5373952 | 5345704 | 0 |

## Certified metadata — complete coverage

Each of the 13 canisters had exactly this sole controller at the time sampled:

`vk34m-qhp7i-xyaaw-itwxz-uohx7-ucw52-mx2vs-alcau-3h4ga-rayrt-pae`

| Service | Certified module_hash (hex) |
|---|---|
| club_domain | `2011d83f63dfa8890ae13ea9731e72f4de4e849964e5da262960e68208458ae5` |
| events_domain | `d43c9d96d62f276eeee549762ef77ab334f241b135353f592385ad09e8455608` |
| messaging_domain | `3ea3b67066749b9ee65667205e94da6b21b5c9d201a6afde6829ced4d6b28e13` |
| vault_domain | `231452c589a0260d89752a9e7fc76700b19245b7ef1315dafc1a02c707c2b84a` |
| competition_domain | `b0c845bfa4c37f6301447f214ac6ebc278d8edfcfd0f2fedb29bb43764113176` |
| club_points_domain | `b3d9d8fa5b38859f6dad292512c18c4448f48f945a1e9c1629a57c1c5941a4fd` |
| mini_league_domain | `2d5070299cb3f2bbc2ee1657bfb8c32971b87a4909e38ff29be21c0755d7583b` |
| media_metadata | `c6bd946ec56e907f9fa53b4f7e87061b8820b6d9d92158567ea3ed5b3767ac47` |
| insights_domain | `707fb65033394d2f4c7364285b013f02b3f007e5a6a5fd2f6ebf5c837572e379` |
| notification_queue | `2bbe66d081d42f82df9bad0c8ba0e7875523f47c9a440693bbc9c9d5af4a9606` |
| pii_access_control | `9c2ef62cc9606ea624dc88c60117cf85dfc4e6d1e996edda6de38ba4a058497a` |
| timer_jobs | `4bf941f854780286433020d6e6742c8582d448bf0fc16a15af889a39095b9c6a` |
| media_blob_store | `7d2580f558c5f32d40a6dc29097caed7fd06a7f7b73c0bcfadc051d2250eefb2` |

Hashes attest installed modules, not a match to an independently approved build: no reference artifact comparison was performed. Separate reads are a short-window sample, not an atomic fleet snapshot or a future controller fence.

## Inventory, shared mappings, and closed state

`deploy/groups/g2/provision.json` identifies mainnet g2, phase `checked`, expectedRevision `0`, with 12 domain canisters plus the dedicated media_blob_store: 13 unique IDs, no overlap with any of the 18 mainnet shared/base mapping IDs below. Its installedDomains covers all 12 listed domains; dedicatedBlobStore.installed is true. These are local inventory assertions, not independent proof of live wiring.

Inventory subnet (all observedSubnets entries and dedicated store agree): `e66qm-3cydn-nkf4i-ml4rb-4ro6o-srm5s-x5hwq-hnprz-3meqp-s7vks-5qe`. Live subnet placement was not separately extracted/verified.

Shared router `jcdfe-vqaaa-aaaal-qxloq-cai`: `list_groups` is a query in the checked Candid interface, but the anonymous live reply was `Err: Forbidden`; public `version` query returned `0`. Consequently the live g2 registry entry, accepting/closed flag, assigned-club count, placement record, and domain/photo-store mapping cannot be confirmed anonymously. `read_group_registry` and `read_group_registry_page` are updates in that interface and were deliberately NOT invoked. Closed state is UNOBSERVABLE in this permitted scope, not proven closed or open. No group was opened.

| Shared/base service | ID |
|---|---|
| club_domain | `mzzzv-taaaa-aaaal-qxlrq-cai` |
| club_points_domain | `itj33-nyaaa-aaaal-qxlla-cai` |
| competition_domain | `jqfs5-zaaaa-aaaal-qxlnq-cai` |
| events_domain | `m6y7b-6yaaa-aaaal-qxlra-cai` |
| identity_access | `mq2sj-fiaaa-aaaal-qxlqa-cai` |
| insights_domain | `mf5de-eaaaa-aaaal-qxltq-cai` |
| media_blob_store | `jlaoy-dyaaa-aaaal-qxlpa-cai` |
| media_metadata | `mc4fq-jyaaa-aaaal-qxlta-cai` |
| messaging_domain | `mx3u5-iqaaa-aaaal-qxlqq-cai` |
| migration_coordinator | `jmbim-oaaaa-aaaal-qxlpq-cai` |
| mini_league_domain | `jzgzb-piaaa-aaaal-qxlma-cai` |
| notification_queue | `jfcdq-yiaaa-aaaal-qxloa-cai` |
| pii_access_control | `iui5p-aaaaa-aaaal-qxllq-cai` |
| placement_registry | `ml7om-7qaaa-aaaal-qxlsq-cai` |
| secret_workload_identity | `mm6iy-siaaa-aaaal-qxlsa-cai` |
| shard_router | `jcdfe-vqaaa-aaaal-qxloq-cai` |
| timer_jobs | `j6h7v-cqaaa-aaaal-qxlmq-cai` |
| vault_domain | `jxeuj-uyaaa-aaaal-qxlna-cai` |

The dedicated g2 photo store differs from the base media_blob_store; the binding references shared identity_access `mq2sj-fiaaa-aaaal-qxlqa-cai`, consistent with that base mapping. No exhaustive cross-group inventory audit was performed. No private configuration was read to validate authority/worker wiring.

## Guidance and method limitations

Read root/scripts AGENTS, backend safeguards, provision inventory, existing health implementation, checked router Candid/bindings, and installed agent certificate implementation; fetched the authoritative skills index and certified-variables guidance. Did not execute the stock health main because its frontend cycles proxy is an update: reused only its public health query schema and thresholds in a temporary read-only runner with updates/root-key fetching explicitly blocked.

Activation is NOT verified or authorized: anonymous health and certified public metadata cannot replace all-service fences, authenticated inventories, drain/mirror/history recovery, approved deployment artifacts, or operator-controlled activation evidence.
