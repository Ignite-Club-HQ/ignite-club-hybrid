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