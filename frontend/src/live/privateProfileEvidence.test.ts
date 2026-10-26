import {describe,it,expect} from 'vitest';
import {Principal} from '@icp-sdk/core/principal';
import type {FeatureBackendContext} from './featureRouter';
import {readPrivateProfileEvidence,registerPrivateProfileEvidenceReader} from './privateProfileEvidence';
const ctx={identity:{getPrincipal:()=>Principal.fromText('rrkah-fqaaa-aaaaa-aaaaq-cai')},target:{alias:'runtime',host:'https://icp-api.io',networkKind:'public_mainnet',canisterIds:{}}} as FeatureBackendContext;
const binding={targetAlias:'runtime',registryAlias:'mainnet',host:'https://icp-api.io',networkKind:'public_mainnet',deploymentId:'mainnet',deploymentRevision:1n,registryRevision:7n,requiredClubAuthorities:['ryjl3-tyaaa-aaaaa-aaaba-cai']};
describe('independently supplied private profile evidence',()=>{
  it('does not invent deployment evidence from runtime configuration',async()=>{expect(await readPrivateProfileEvidence(ctx)).toBeUndefined();});
  it('shares owner-supplied evidence without rewriting registry aliases or mutable arrays',async()=>{
    const remove=registerPrivateProfileEvidenceReader(async()=>binding);
    try{const result=await readPrivateProfileEvidence(ctx);expect(result).toEqual(binding);expect(result?.requiredClubAuthorities).not.toBe(binding.requiredClubAuthorities);}finally{remove();}
  });
  it('rejects omitted legacy authorities and foreign revisions',async()=>{
    await expect(readPrivateProfileEvidence(ctx,{...binding,requiredClubAuthorities:[]})).rejects.toThrow('evidence');
    await expect(readPrivateProfileEvidence(ctx,{...binding,registryRevision:0n})).rejects.toThrow('evidence');
  });
  it('rejects replacement of the supplied evidence source during its await',async()=>{
    let removeReplacement:()=>void=()=>{};
    const remove=registerPrivateProfileEvidenceReader(async()=>{removeReplacement=registerPrivateProfileEvidenceReader(async()=>binding);return binding;});
    try{await expect(readPrivateProfileEvidence(ctx)).rejects.toThrow('changed');}finally{remove();removeReplacement();}
  });
});