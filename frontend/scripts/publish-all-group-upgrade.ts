import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { createJournalApi } from './media-stage-two-github.mjs';
import { persistGroup2Journal } from '../../scripts/group2-journal.mjs';
import { publishVerifiedFiles, requirePublicationReadback } from '../../scripts/all-group-publication.mjs';
import { validateJournal, digest } from '../../scripts/all-group-upgrade-policy.mjs';
const repo=process.env.GITHUB_REPOSITORY, release=process.env.GITHUB_SHA, branch=process.env.GITHUB_REF;
if(!repo||!release||!branch)throw Error('Workflow source required');
const api=createJournalApi(repo,JSON.stringify), receipts='all-group-upgrade-receipts',path='contents/all-group-upgrade.json';
let stored=api(`${path}?ref=${receipts}`);
const journal=JSON.parse(Buffer.from(stored.content,'base64').toString());
validateJournal(journal,journal.binding);
if(journal.binding.repo!==repo||journal.binding.release!==release||digest(journal.binding)!==process.env.CHECKED_PLAN)throw Error('Release binding differs');
const root=new URL('../../',import.meta.url);
const paths=['frontend/src/live/generated/routingGates.ts'];
for(const e of readdirSync(new URL('deploy/groups/',root),{withFileTypes:true}))if(e.isDirectory()&&/^g[1-9][0-9]*$/.test(e.name)){
  const p=`deploy/groups/${e.name}/general-opening.json`;
  if(existsSync(new URL(p,root)))paths.push(p);
}
const files=paths.sort().map(path=>({path,content:readFileSync(new URL(path,root),'utf8')}));
const options={branch,release,journal,files};
journal.publication=publishVerifiedFiles(api,options);
stored=persistGroup2Journal(api,path,receipts,stored,journal,'publication intent');
// This second call applies only the acknowledged exact commit, never recreates it.
publishVerifiedFiles(api,options);
requirePublicationReadback(api,branch,journal.publication);
journal.published=true;
persistGroup2Journal(api,path,receipts,stored,journal,'publication complete');
console.log('All-group release fingerprints published and read back. Deploy matching app next; no app deployment occurred.');