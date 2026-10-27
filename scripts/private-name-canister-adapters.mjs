// Generated-actor transport adapters. Callers supply signed actors and verified
// exclusion/approval; no mainnet bootstrap or implicit production activation.
const unwrap = reply => {
  if (!reply || !Object.hasOwn(reply,'Ok') || Object.hasOwn(reply,'Err')) throw Error('Private-name consensus operation refused');
  return reply.Ok;
};
const principal = value => {
  const text = value?.toText?.();
  if (typeof text !== 'string' || !text || text === '2vxsx-fae' || text === 'aaaaa-aa') throw Error('Exact nonanonymous canister/account principal required');
  return text;
};
const revision = value => {
  if (!['string','bigint'].includes(typeof value) || !/^(0|[1-9][0-9]*)$/.test(String(value))) throw Error('Exact nat64 revision required');
  const n=BigInt(value);if(n>18446744073709551615n)throw Error('Exact nat64 revision required');return n;
};
export function normalizePrivateNameWindow(window) {
  const phases=['Fencing','Opening','Writing','Closing','Releasing','Done'];
  if (!window || !window.phase || Object.keys(window.phase).length!==1 || !phases.includes(Object.keys(window.phase)[0])) throw Error('Unknown private-name coordinator phase');
  const receipts = value => {
    if (!Array.isArray(value)) throw Error('Complete coordinator receipts required');
    return value.map(receipt=>({...receipt,receiver:principal(receipt.receiver)}));
  };
  return {...window,phase:Object.keys(window.phase)[0],sinks:window.sinks.map(principal),writers:window.writers.map(principal),opened:receipts(window.opened),sealed:receipts(window.sealed),completed:receipts(window.completed)};
}

export function createPrivateNameCoordinatorAdapter(actor, Principal) {
  return {
    begin:async(id,rev)=>normalizePrivateNameWindow(unwrap(await actor.begin_private_name_write_window(id,revision(rev)))),
    advance:async(id,target)=>normalizePrivateNameWindow(unwrap(await actor.advance_private_name_write_window(id,Principal.fromText(target)))),
    close:async id=>normalizePrivateNameWindow(unwrap(await actor.close_private_name_write_window(id))),
    read:async id=>normalizePrivateNameWindow(unwrap(await actor.read_private_name_write_window(id))),
  };
}

/** Exact signed backend admission. No signer or approval is manufactured here;
 * loadApproval must read the original independently protected signed artifact. */
export function createApprovedNameCoordinatorAdapter(actor,Principal,{loadApproval,assertFence}) {
  if(typeof loadApproval!=='function' || typeof assertFence!=='function')throw Error('Protected signed admission and exclusion required');
  const base=createPrivateNameCoordinatorAdapter(actor,Principal);
  return {...base,begin:async(id,revision)=>{
    if(await assertFence()!==true)throw Error('Conversion exclusion required');
    const window=await base.begin(id,revision);
    const approval=await loadApproval(id,structuredClone(window));
    if(await assertFence()!==true)throw Error('Conversion exclusion required');
    unwrap(await actor.approve_private_name_conversion(id,approval));
    if(await assertFence()!==true)throw Error('Conversion exclusion required');
    return window;
  }};
}
export function createApprovedNameWriteAdapter(actor,{operationId,rows,assertFence}) {
  if(!/^club-name-conversion-[a-f0-9]{64}$/.test(operationId) || !Array.isArray(rows) || typeof assertFence!=='function')throw Error('Exact approved operation required');
  const saved=structuredClone(rows);
  const guard=async()=>{if(await assertFence()!==true)throw Error('Conversion exclusion required');};
  const write=async(subject,club)=>{
    const row=saved.find(r=>r.subject===subject);if(!row || (club!==null && !row.clubs.some(c=>c.id===club)))throw Error('Exact approved row required');
    await guard();unwrap(await actor.write_approved_private_name(operationId,row.accountId,club===null?[]:[club]));await guard();
  };
  return {writeOriginal:subject=>write(subject,null),writeClub:(subject,club)=>write(subject,club),publishReference:async(account,reference)=>{
    const row=saved.find(r=>r.accountId===account);if(!row || reference!==`pii-display-name:v1:${row.sink}:${row.subject}`)throw Error('Exact approved reference required');
    await guard();const profile=unwrap(await actor.publish_approved_private_name(operationId,account));await guard();return profile;
  }};
}

/** Consensus bounded paging; copying aliases never makes the first alias a
 * complete account identity. Externally verified eligibility remains required. */
export function createPrivateNameProfileAdapter(actor,{assertFence,maxPages=1000,maxProfiles=100000}={}) {
  if(typeof assertFence!=='function' || !Number.isSafeInteger(maxPages) || maxPages<1 || maxPages>1000 || !Number.isSafeInteger(maxProfiles) || maxProfiles<1 || maxProfiles>100000)throw Error('Bounded authenticated profile inventory required');
  const guard=async()=>{if(await assertFence()!==true)throw Error('Profile inventory exclusion required');};
  const listProfiles=async()=>{
    const rows=[],accounts=new Set(),aliases=new Set();let cursor=[];
    for(let pageIndex=0;pageIndex<maxPages;pageIndex++){
      await guard();const page=unwrap(await actor.list_profiles_for_conversion(cursor,200));await guard();
      if(!Array.isArray(page.rows) || page.rows.length>200 || !Array.isArray(page.next) || page.next.length>1)throw Error('Invalid bounded conversion page');
      let previous=cursor[0]??'';
      for(const row of page.rows){
        if(typeof row.account_id!=='string' || !row.account_id || row.account_id<=previous || accounts.has(row.account_id) || typeof row.display_name!=='string' || !Array.isArray(row.principals) || !row.principals.length)throw Error('Conversion account inventory changed');
        previous=row.account_id;accounts.add(row.account_id);
        const principals=row.principals.map(principal);
        for(const alias of principals){if(aliases.has(alias))throw Error('Ambiguous account alias inventory');aliases.add(alias);}
        rows.push({account_id:row.account_id,display_name:row.display_name,principals});
        if(rows.length>maxProfiles)throw Error('Profile inventory exceeds bound');
      }
      if(page.next.length===0)return rows;
      if(page.rows.length===0 || typeof page.next[0]!=='string' || page.next[0]!==previous || page.next[0]<=(cursor[0]??''))throw Error('Conversion profile cursor changed');
      cursor=[page.next[0]];
    }
    throw Error('Conversion profile page budget exceeded');
  };
  return {listProfiles,readProfile:async id=>{const profiles=await listProfiles();const row=profiles.find(p=>p.account_id===id);if(!row)throw Error('Exact conversion profile absent');return row;},publishReference:async(id,reference)=>{await guard();const profile=unwrap(await actor.convert_profile_name(id,reference));await guard();if(profile.account_id!==id || profile.display_name!==reference)throw Error('Conversion publication readback mismatch');return profile;}};
}

/** Account-first consensus evidence, including the terminal dangling-profile
 * validation pass. A complete result is never inferred from a short page. */
export function createPrivateNameAccountInventoryAdapter(actor,{operationId,request,assertFence,maxPages=2000,maxAccounts=100000}) {
  if(typeof operationId!=='string' || !operationId || !request || typeof assertFence!=='function' || !Number.isSafeInteger(maxPages) || maxPages<1 || maxPages>2000 || !Number.isSafeInteger(maxAccounts) || maxAccounts<1 || maxAccounts>100000)throw Error('Exact bounded locked account inventory required');
  const expected={operation_id:request.operation_id,generation:revision(request.generation),inventory_digest:Array.from(request.inventory_digest??[])};
  if(expected.operation_id!==`names:${operationId}` || expected.inventory_digest.length!==32 || expected.inventory_digest.some(b=>!Number.isInteger(b)||b<0||b>255))throw Error('Exact account inventory request required');
  const sameRequest=r=>r?.operation_id===expected.operation_id && revision(r.generation)===expected.generation && JSON.stringify(Array.from(r.inventory_digest))===JSON.stringify(expected.inventory_digest);
  const guard=async()=>{if(await assertFence(structuredClone(expected))!==true)throw Error('Account inventory exclusion required');};
  return {listAccounts:async()=>{
    const rows=[],accounts=new Set(),aliases=new Set();let cursor=[],pinnedRevision;
    for(let i=0;i<maxPages;i++){
      await guard();const page=unwrap(await actor.read_private_name_account_inventory(operationId,expected,cursor,100));await guard();
      const rev=revision(page.revision),phase=cursor[0]?.phase??0;
      if(pinnedRevision===undefined)pinnedRevision=rev;
      if(rev!==pinnedRevision || !sameRequest(page.request) || !Number.isInteger(page.scanned) || page.scanned<0 || page.scanned>100 || !Array.isArray(page.rows) || page.rows.length>page.scanned || (phase===1 && page.rows.length!==0) || !Array.isArray(page.next) || page.next.length>1)throw Error('Account inventory binding changed');
      let previous=cursor[0]?.after[0]??'';
      for(const row of page.rows){
        const a=row?.account,status=Object.keys(a?.status??{});
        if(typeof a?.id!=='string' || !a.id || a.id.length>64 || a.id<=previous || accounts.has(a.id) || !Array.isArray(a.principals) || !a.principals.length || status.length!==1 || !['Active','Suspended'].includes(status[0]) || !Array.isArray(row.profile) || row.profile.length>1)throw Error('Invalid complete account inventory');
        const principals=a.principals.map(principal);for(const alias of principals){if(aliases.has(alias))throw Error('Ambiguous account alias inventory');aliases.add(alias);}
        const profile=row.profile[0]??null;if(profile && (profile.account_id!==a.id || typeof profile.display_name!=='string'))throw Error('Account profile binding changed');
        const kind=Object.keys(row.original_authority??{});if(kind.length!==1 || !['NoName','Unresolved','Existing'].includes(kind[0]))throw Error('Explicit original authority required');
        let originalAuthority={kind:kind[0]};
        if(kind[0]==='Existing'){const value=row.original_authority.Existing,sink=principal(value?.sink),subject=principal(value?.subject);if(!principals.includes(subject) || profile?.display_name!==`pii-display-name:v1:${sink}:${subject}`)throw Error('Original authority binding changed');originalAuthority={kind:'Existing',sink,subject};}
        if(kind[0]==='NoName' && profile?.display_name)throw Error('Named account cannot disappear from conversion');
        const sourceDigest=Array.from(row.source_digest??[]);if(sourceDigest.length!==32 || sourceDigest.some(b=>!Number.isInteger(b)||b<0||b>255))throw Error('Exact optional-profile source digest required');
        accounts.add(a.id);previous=a.id;rows.push({accountId:a.id,principals,version:String(revision(a.version)),status:status[0],profile:profile?structuredClone(profile):null,originalAuthority,sourceDigest});
        if(rows.length>maxAccounts)throw Error('Account inventory exceeds bound');
      }
      if(!page.next.length){if(phase!==1)throw Error('Profile integrity traversal incomplete');await guard();return {request:structuredClone(expected),revision:String(pinnedRevision),rows};}
      const next=page.next[0];if(!next || revision(next.revision)!==pinnedRevision || !Array.isArray(next.after) || next.after.length>1 || ![0,1].includes(next.phase))throw Error('Account inventory cursor changed');
      if(next.phase===phase){if(page.scanned===0 || typeof next.after[0]!=='string' || next.after[0]<=(cursor[0]?.after[0]??'') || (phase===0 && next.after[0]!==previous))throw Error('Account inventory cursor made no progress');}
      else if(phase!==0 || next.phase!==1 || next.after.length!==0)throw Error('Account inventory phase changed');
      cursor=[{phase:next.phase,after:[...next.after],revision:pinnedRevision}];
    }
    throw Error('Account inventory page budget exceeded');
  }};
}

export function createPrivateNamePiiAdapter(actor,Principal) {
  const original=record=>{
    if(!record || typeof record.pii_id!=='string' || record.field_id!=='display_name')throw Error('PII ciphertext binding changed');
    return {subject:record.pii_id,field:record.field_id,ciphertext:Array.from(record.ciphertext),master_key_id:record.master_key_id};
  };
  return {
    readOriginal:async subject=>{const rows=unwrap(await actor.get_encrypted_pii_batch([subject],'display_name','profile_display','Protected conversion readback'));if(rows.length!==1 || rows[0].pii_id!==subject)throw Error('Exact original ciphertext required');return original(rows[0]);},
    writeOriginal:async(subject,bytes)=>unwrap(await actor.register_pii(subject,'display_name',bytes,Principal.fromText(subject))),
    readClub:async(subject,club)=>({...original(unwrap(await actor.read_private_club_name_preparation(Principal.fromText(subject),club))),club}),
    writeClub:async(subject,club,bytes)=>unwrap(await actor.register_private_club_name(Principal.fromText(subject),club,bytes)),
    publicKey:async()=>Array.from(await actor.pii_vetkey_verification_key()),
  };
}