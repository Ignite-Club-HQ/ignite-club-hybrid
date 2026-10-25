import { createJournalApi } from './media-stage-two-github.mjs';
import { persistGroup2Journal } from '../../scripts/group2-journal.mjs';
import { publishVerifiedFiles, requirePublicationReadback } from '../../scripts/all-group-publication.mjs';
import { validateJournal, digest, requireCompletedRecovery, normalizePlan } from '../../scripts/all-group-upgrade-policy.mjs';
const CHECKED_PLAN=normalizePlan(process.env.CHECKED_PLAN);
const repo=process.env.GITHUB_REPOSITORY, release=process.env.GITHUB_SHA, branch=process.env.GITHUB_REF;
if(!repo||!release||!branch)throw Error('Workflow source required');
const api=createJournalApi(repo,JSON.stringify), receipts='all-group-upgrade-receipts',path='contents/all-group-upgrade.json';
let stored=api(`${path}?ref=${receipts}`);
const journal=JSON.parse(Buffer.from(stored.content,'base64').toString());
validateJournal(journal,journal.binding);
if(journal.recovery){
  requireCompletedRecovery(journal,{repo,scope:journal.binding.scope,checkedPlan:CHECKED_PLAN,source:release,branch});
}else if(journal.binding.repo!==repo||journal.binding.release!==release||digest(journal.binding)!==CHECKED_PLAN)throw Error('Release binding differs');
const files=journal.snapshotFiles;
const options={branch,release,journal,files};
journal.publication=publishVerifiedFiles(api,options);
stored=persistGroup2Journal(api,path,receipts,stored,journal,'publication intent');
// This second call applies only the acknowledged exact commit, never recreates it.
publishVerifiedFiles(api,options);
requirePublicationReadback(api,branch,journal.publication);
journal.published=true;
persistGroup2Journal(api,path,receipts,stored,journal,'publication complete');
console.log('All-group release fingerprints published and read back. Deploy matching app next; no app deployment occurred.');