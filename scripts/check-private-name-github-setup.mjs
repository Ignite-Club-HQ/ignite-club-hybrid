import {verifyNameApprovalGithubSetup} from './private-name-github-protection.mjs';
const required=name=>{const v=process.env[name];if(!v)throw Error(`${name} required`);return v;};
const repository=required('GITHUB_REPOSITORY'),token=required('GH_TOKEN');
const report=await verifyNameApprovalGithubSetup({repository,sourceCommit:required('PRIVATE_NAME_APPROVAL_DELIVERY_SOURCE_COMMIT'),sourceRef:required('PRIVATE_NAME_APPROVAL_DELIVERY_SOURCE_REF'),receiptBranch:required('PRIVATE_NAME_APPROVAL_RECEIPTS_BRANCH'),reviewerId:Number(required('PRIVATE_NAME_APPROVAL_REVIEWER_ID'))},{read:async path=>{
  const r=await fetch(`https://api.github.com/repos/${repository}/${path}`,{headers:{Authorization:`Bearer ${token}`,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'},signal:AbortSignal.timeout(30000)});
  if(!r.ok)throw Error(`Protection verification unavailable (${r.status}); no delivery permitted`);
  const text=await r.text();if(text.length>1048576)throw Error('Protection response exceeds budget');return JSON.parse(text);
}});
console.log(JSON.stringify(report));
// GitHub no-force protection alone is not append-only. This diagnostic
// deliberately cannot authorize restoring a governor or delivery.
if(!report.deliveryReady)process.exitCode=1;