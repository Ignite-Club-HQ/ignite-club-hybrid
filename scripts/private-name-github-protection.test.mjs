import {test} from 'node:test';
import assert from 'node:assert/strict';
import {verifyNameApprovalGithubSetup} from './private-name-github-protection.mjs';
const pins={repository:'Ignite-Club-HQ/ignite-club-hybrid',sourceCommit:'a'.repeat(40),sourceRef:'refs/heads/reviewed',receiptBranch:'name-receipts',reviewerId:42};
const fixture=()=>({'':{private:true},'git/ref/heads/reviewed':{object:{sha:pins.sourceCommit}},'environments/private-name-approval-delivery':{can_admins_bypass:false,protection_rules:[{type:'required_reviewers',prevent_self_review:true,reviewers:[{type:'User',reviewer:{id:42}}]}],deployment_branch_policy:{custom_branch_policies:true,protected_branches:false}},'environments/private-name-approval-delivery/deployment-branch-policies?per_page=100':{total_count:1,branch_policies:[{name:'reviewed',type:'branch'}]},'branches/reviewed/protection':{enforce_admins:{enabled:true},allow_force_pushes:{enabled:false},allow_deletions:{enabled:false},required_pull_request_reviews:{required_approving_review_count:1,dismiss_stale_reviews:true,require_last_push_approval:true}},'branches/name-receipts/protection':{enforce_admins:{enabled:true},allow_force_pushes:{enabled:false},allow_deletions:{enabled:false},lock_branch:{enabled:true}},'git/ref/heads/name-receipts':{object:{sha:'b'.repeat(40)}}});
const check=async f=>verifyNameApprovalGithubSetup(pins,{read:async p=>structuredClone(f[p])});
test('verified protections never manufacture writable append-only admission',async()=>{const r=await check(fixture());assert.equal(r.deliveryReady,false);assert.equal(r.reviewerId,42);assert.equal(r.receiptHead,'b'.repeat(40));});
for(const [name,mutate] of [
  ['public repository',f=>f[''].private=false],
  ['source drift',f=>f['git/ref/heads/reviewed'].object.sha='c'.repeat(40)],
  ['wrong reviewer',f=>f['environments/private-name-approval-delivery'].protection_rules[0].reviewers[0].reviewer.id=43],
  ['team reviewer substitution',f=>f['environments/private-name-approval-delivery'].protection_rules[0].reviewers[0].type='Team'],
  ['self review',f=>f['environments/private-name-approval-delivery'].protection_rules[0].prevent_self_review=false],
  ['admin bypass',f=>f['environments/private-name-approval-delivery'].can_admins_bypass=true],
  ['wildcard branch',f=>f['environments/private-name-approval-delivery/deployment-branch-policies?per_page=100'].branch_policies[0].name='*'],
  ['partial branch pagination',f=>f['environments/private-name-approval-delivery/deployment-branch-policies?per_page=100'].total_count=101],
  ['source without reviews',f=>delete f['branches/reviewed/protection'].required_pull_request_reviews],
  ['force push',f=>f['branches/name-receipts/protection'].allow_force_pushes.enabled=true],
  ['ordinary receipt replacement',f=>f['branches/name-receipts/protection'].lock_branch.enabled=false],
])test(`${name} cannot pass setup verification`,async()=>{const f=fixture();mutate(f);await assert.rejects(check(f));});
test('API permission failure remains unverified',async()=>{await assert.rejects(verifyNameApprovalGithubSetup(pins,{read:async()=>{throw Error('403');}}),/403/);});