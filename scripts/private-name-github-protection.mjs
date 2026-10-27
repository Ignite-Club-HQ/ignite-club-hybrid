// Read-only setup verification; no governor, signer, canister or Git writes.
export async function verifyNameApprovalGithubSetup({repository,sourceCommit,sourceRef,receiptBranch,reviewerId,environment='private-name-approval-delivery'}, {read}) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository) || !/^[a-f0-9]{40}$/.test(sourceCommit) || !/^refs\/heads\/[\w./-]+$/.test(sourceRef) || !/^[\w./-]+$/.test(receiptBranch) || receiptBranch.includes('..') || !Number.isSafeInteger(reviewerId) || reviewerId<=0 || typeof read!=='function') throw Error('Exact protected GitHub setup pins required');
  const sourceBranch=sourceRef.slice('refs/heads/'.length);
  if(sourceBranch===receiptBranch) throw Error('Separate source and receipt branches required');
  const repo=await read(''); if(repo?.private!==true)throw Error('Private approval repository required');
  const ref=await read(`git/ref/heads/${sourceBranch}`); if(ref?.object?.sha!==sourceCommit)throw Error('Reviewed source commit changed');
  const env=await read(`environments/${encodeURIComponent(environment)}`);
  const rules=env?.protection_rules;
  const reviewers=Array.isArray(rules)?rules.filter(r=>r.type==='required_reviewers'):[];
  if(env?.can_admins_bypass!==false || reviewers.length!==1 || reviewers[0].prevent_self_review!==true || reviewers[0].reviewers?.length!==1 || reviewers[0].reviewers[0].type!=='User' || reviewers[0].reviewers[0].reviewer?.id!==reviewerId)throw Error('Exact human reviewer, self-review prevention and no bypass required');
  if(env?.deployment_branch_policy?.custom_branch_policies!==true || env.deployment_branch_policy.protected_branches!==false)throw Error('Exact deployment branch policy required');
  const policies=await read(`environments/${encodeURIComponent(environment)}/deployment-branch-policies?per_page=100`);
  if(policies?.total_count!==1 || policies.branch_policies?.length!==1 || policies.branch_policies[0].name!==sourceBranch || policies.branch_policies[0].type!=='branch')throw Error('Broad or unverifiable deployment branch policy');
  const protect=async(branch,source)=>{
    const p=await read(`branches/${encodeURIComponent(branch)}/protection`);
    if(p?.enforce_admins?.enabled!==true || p.allow_force_pushes?.enabled!==false || p.allow_deletions?.enabled!==false)throw Error('Administrator enforcement and no rewind/deletion required');
    if(source && (!Number.isSafeInteger(p.required_pull_request_reviews?.required_approving_review_count) || p.required_pull_request_reviews.required_approving_review_count<1 || p.required_pull_request_reviews?.dismiss_stale_reviews!==true || p.required_pull_request_reviews?.require_last_push_approval!==true))throw Error('Reviewed source protection required');
    // Ordinary descendant commits can replace receipts too. Do not certify
    // append-only semantics from no-force flags: require the branch locked.
    if(!source && p.lock_branch?.enabled!==true)throw Error('Receipt branch is not immutable; ordinary replacement remains possible');
  };
  await protect(sourceBranch,true);await protect(receiptBranch,false);
  const head=await read(`git/ref/heads/${receiptBranch}`);if(!/^[a-f0-9]{40}$/.test(head?.object?.sha??''))throw Error('Exact retained receipt head required');
  return {kind:'private-name-github-setup-v1',repository,sourceCommit,sourceRef,receiptBranch,receiptHead:head.object.sha,reviewerId,deliveryReady:false,blocker:'Locked receipts require separately governed append-only write admission; do not unlock automatically'};
}