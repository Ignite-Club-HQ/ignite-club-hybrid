import { digest } from './all-group-upgrade-policy.mjs';
export const EVIDENCE_BRANCH = 'refs/heads/all-group-upgrade-evidence';
const EVIDENCE_REF = 'heads/all-group-upgrade-evidence';
/** CAS publication on the dedicated evidence branch. Workflows never push to the
 * Lovable-synced main branch: the two-way sync reverts direct pushes, which is
 * what reverted the f86b6f98 release publication. Main copies of the snapshot
 * files land through the normal project edit/sync path instead. */
export function publishVerifiedFiles(api, { branch, release, journal, files }) {
  if (journal?.recovery && (journal.recovery.source!==release || journal.recovery.branch!==branch || journal.recovery.planHash!==digest(journal.binding))) throw Error('Publication recovery binding differs');
  if (!/^refs\/heads\/[A-Za-z0-9._/-]+$/.test(branch ?? '') || !/^[a-f0-9]{40}$/.test(release ?? '') || !journal?.complete || journal.snapshotVerified!==true) throw Error('Verified complete release and source branch required');
  if (!Array.isArray(journal.snapshotFiles) || digest(files)!==journal.snapshotFilesHash || digest(journal.snapshotFiles)!==journal.snapshotFilesHash) throw Error('Publication must use the immutable verified snapshot');
  if (!files.length || files.some(f=> !/^deploy\/groups\/g[1-9][0-9]*\/general-opening\.json$/.test(f.path) && !['frontend/src/live/generated/routingGates.ts','deploy/mainnet/backend-release.json'].includes(f.path)) || new Set(files.map(f=>f.path)).size!==files.length) throw Error('Publication paths not allowlisted');
  if (!api('git/matching-refs/heads/all-group-upgrade-evidence').some(r => r.ref === EVIDENCE_BRANCH)) api('git/refs', 'POST', { ref: EVIDENCE_BRANCH, sha: release });
  const head = api(`git/ref/${EVIDENCE_REF}`).object.sha;
  if (journal.publication) {
    const commit = api(`git/commits/${journal.publication.commit}`);
    if (commit.tree.sha!==journal.publication.tree || commit.parents?.[0]?.sha!==journal.publication.parent || digest(journal.publication.files)!==digest(files.map(f=>({path:f.path,content:f.content})))) throw Error('Publication acknowledgement differs');
    if (head===journal.publication.parent) api(`git/refs/${EVIDENCE_REF}`,'PATCH',{sha:journal.publication.commit,force:false});
    else if (head!==journal.publication.commit) throw Error('Evidence branch advanced; retain publication evidence');
    if (api(`git/ref/${EVIDENCE_REF}`).object.sha!==journal.publication.commit) throw Error('Publication branch readback failed');
    return journal.publication;
  }
  const original=api(`git/commits/${head}`);
  const tree=api('git/trees','POST',{base_tree:original.tree.sha,tree:files.map(f=>({path:f.path,mode:'100644',type:'blob',content:f.content}))});
  const commit=api('git/commits','POST',{message:'chore: verified all-group backend upgrade snapshot [skip ci]',tree:tree.sha,parents:[head]});
  if(!/^[a-f0-9]{40}$/.test(tree.sha ?? '') || !/^[a-f0-9]{40}$/.test(commit.sha ?? ''))throw Error('Publication object acknowledgement invalid');
  // Caller must durably persist this result BEFORE updating the branch.
  return {commit:commit.sha,tree:tree.sha,parent:head,files};
}
export function requirePublicationReadback(api, _sourceBranch, publication) {
  const commit=api(`git/commits/${publication.commit}`);
  if(commit.tree.sha!==publication.tree || api(`git/ref/${EVIDENCE_REF}`).object.sha!==publication.commit)throw Error('Publication not read back');
  for(const file of publication.files){const reply=api(`contents/${file.path}?ref=${publication.commit}`);if(reply.encoding!=='base64'||Buffer.from(reply.content,'base64').toString()!==file.content)throw Error('Published file readback differs');}
}
/** A release whose on-chain upgrade completed but whose main-branch evidence was
 * reverted by the sync settles once the exact snapshot files reached main through
 * the normal edit/sync path. Never replays installs and never pushes to main. */
export function settlePublishedEvidence(api, sourceBranch, journal) {
  if (!/^refs\/heads\/[A-Za-z0-9._/-]+$/.test(sourceBranch ?? '')) throw Error('Source branch required');
  if (!journal?.complete || journal.published || !journal.publication || !Array.isArray(journal.snapshotFiles) || !journal.snapshotFiles.length) throw Error('Complete unpublished release with retained evidence required');
  if (digest(journal.snapshotFiles)!==journal.snapshotFilesHash) throw Error('Snapshot digest differs');
  const ref = sourceBranch.slice('refs/'.length);
  for (const file of journal.snapshotFiles) {
    const reply=api(`contents/${file.path}?ref=${ref}`);
    if(reply?.encoding!=='base64'||Buffer.from(reply.content,'base64').toString()!==file.content) throw Error(`Released file not yet on ${ref}: ${file.path}; land the verified snapshot through the normal sync first`);
  }
}
