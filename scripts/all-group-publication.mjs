import { digest } from './all-group-upgrade-policy.mjs';
/** CAS publication on the exact checked source. No force push and no installed-module replay. */
export function publishVerifiedFiles(api, { branch, release, journal, files }) {
  if (!/^refs\/heads\/[A-Za-z0-9._/-]+$/.test(branch ?? '') || !/^[a-f0-9]{40}$/.test(release ?? '') || !journal?.complete || journal.snapshotVerified!==true) throw Error('Verified complete release and source branch required');
  if (!Array.isArray(journal.snapshotFiles) || digest(files)!==journal.snapshotFilesHash || digest(journal.snapshotFiles)!==journal.snapshotFilesHash) throw Error('Publication must use the immutable verified snapshot');
  const ref = branch.slice('refs/'.length);
  const head = api(`git/ref/${ref}`).object.sha;
  if (journal.publication) {
    const commit = api(`git/commits/${journal.publication.commit}`);
    if (commit.tree.sha!==journal.publication.tree || commit.parents?.[0]?.sha!==release || digest(journal.publication.files)!==digest(files.map(f=>({path:f.path,content:f.content})))) throw Error('Publication acknowledgement differs');
    if (head!==release && head!==journal.publication.commit) throw Error('Source branch advanced; retain publication evidence');
    if(head===release)api(`git/refs/${ref}`,'PATCH',{sha:journal.publication.commit,force:false});
    if(api(`git/ref/${ref}`).object.sha!==journal.publication.commit)throw Error('Publication branch readback failed');
    return journal.publication;
  }
  if(head!==release)throw Error('Source branch advanced; no overwrite/rebase permitted');
  const original=api(`git/commits/${release}`);
  if(!files.length || files.some(f=> !/^deploy\/groups\/g[1-9][0-9]*\/general-opening\.json$/.test(f.path) && !['frontend/src/live/generated/routingGates.ts','deploy/mainnet/backend-release.json'].includes(f.path)) || new Set(files.map(f=>f.path)).size!==files.length)throw Error('Publication paths not allowlisted');
  const tree=api('git/trees','POST',{base_tree:original.tree.sha,tree:files.map(f=>({path:f.path,mode:'100644',type:'blob',content:f.content}))});
  const commit=api('git/commits','POST',{message:'chore: verified all-group backend upgrade snapshot [skip ci]',tree:tree.sha,parents:[release]});
  if(!/^[a-f0-9]{40}$/.test(tree.sha ?? '') || !/^[a-f0-9]{40}$/.test(commit.sha ?? ''))throw Error('Publication object acknowledgement invalid');
  // Caller must durably persist this result BEFORE updating the branch.
  return {commit:commit.sha,tree:tree.sha,files};
}
export function requirePublicationReadback(api, branch, publication) {
  const commit=api(`git/commits/${publication.commit}`);
  if(commit.tree.sha!==publication.tree || api(`git/ref/${branch.slice(5)}`).object.sha!==publication.commit)throw Error('Publication not read back');
  for(const file of publication.files){const reply=api(`contents/${file.path}?ref=${publication.commit}`);if(reply.encoding!=='base64'||Buffer.from(reply.content,'base64').toString()!==file.content)throw Error('Published file readback differs');}
}