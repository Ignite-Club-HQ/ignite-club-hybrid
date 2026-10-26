import {QueryClient} from '@tanstack/react-query';
import {act,renderHook} from '@testing-library/react';
import {describe,expect,it,vi} from 'vitest';
import {acknowledgedGalleryPosts} from './acknowledgedGalleryPosts';
import {beginGalleryUpload,acknowledgeGalleryUpload,usePendingGalleryUploads} from './pendingGalleryUploads';
const row=(id:string)=>({id,batchId:'batch',src:`blob:${id}`,clubId:'club-a',clubName:'Giddy Goat',teamId:'u9',scopeName:'U9',competitionId:null,isVideo:false});
const receipt={albumId:'album-a',miniLeagueId:null,eventId:null,caption:'Match',createdAtMs:1234};
describe('acknowledged gallery publication',()=>{
  it('exposes the exact published post while another photo and feed refresh remain pending',()=>{
    const client=new QueryClient();const hook=renderHook(()=>usePendingGalleryUploads(client,'paul'));
    act(()=>beginGalleryUpload(client,'paul',[row('first'),row('second')]));
    act(()=>acknowledgeGalleryUpload(client,'paul','first','asset-1',receipt));
    const posts=acknowledgedGalleryPosts(hook.result.current,'paul');
    expect(posts).toHaveLength(1);expect(posts[0].representativeAssetId).toBe('asset-1');
    expect(posts[0].teamId).toBe('u9');expect(posts[0].clubId).toBe('club-a');
    expect(posts[0].assets[0].url).toBe('blob:first');expect(hook.result.current[1].settled).toBeUndefined();
    expect(client.getQueryData(['icp-media-feed','paul'])).toBeUndefined();
  });
  it('does not enable actions from an asset ID without a scope acknowledgement',()=>{
    expect(acknowledgedGalleryPosts([{...row('first'),assetId:'asset-1',settled:true}],'paul')).toEqual([]);
  });
  it('keeps album identity and all acknowledged photos without duplicate assets',()=>{
    const rows=[{...row('first'),assetId:'asset-1',settled:true,publication:receipt},{...row('second'),assetId:'asset-2',settled:true,publication:receipt}];
    const posts=acknowledgedGalleryPosts([...rows,rows[0]],'paul');
    expect(posts).toHaveLength(1);expect(posts[0].id).toBe('album-a');expect(posts[0].assets.map(a=>a.id)).toEqual(['asset-1','asset-2']);
  });
});