import { webcrypto } from 'node:crypto';
import { act, render, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
const local=vi.hoisted(()=>({fixture:null as any,context:null as any}));
vi.mock('./domains',()=>({
  connectLivePiiAccessControl:async (_t:unknown,i:any)=>local.fixture.connect('pii_access_control',i.getPrincipal()),
  connectLiveMessagingDomain:async (_t:unknown,i:any)=>local.fixture.connect('messaging_domain',i.getPrincipal()),
  connectLiveClubDomain:async (_t:unknown,i:any)=>local.fixture.connect('club_domain',i.getPrincipal()),
}));
vi.mock('./identityAccess',async()=>{
  const {createIdentityAccessClient}=await import('../lab/identityAccessClient');
  return {isLiveIdentityAccessConfigured:()=>true,connectLiveIdentityAccessClientWithIdentity:async (_t:unknown,i:any)=>({client:createIdentityAccessClient(local.fixture.connect('identity_access',i.getPrincipal()).actor)})};
});
vi.mock('./featureRouter',()=>({withFeatureBackend:async (_f:string,p:any)=>p.icp(local.context)}));
vi.mock('./features/membership',()=>({getLiveMyRoleGrants:async()=>[{club:[local.fixture.clubId]}]}));
vi.mock('./loadBackendRouting',()=>({isFeatureRoutedToIcp:()=>true}));
vi.mock('../components/chat/ForwardMessageSheet',()=>({ForwardMessageSheet:()=>null}));
vi.mock('../components/chat/ReportMessageDialog',()=>({ReportMessageDialog:()=>null}));
vi.mock('../components/BlockUserDialog',()=>({BlockUserDialog:()=>null}));
import {createNameEditFixture} from '../../scripts/private-name-edit-fixture.mjs';
import {saveIcpIdentityProfile} from './identityProfile';
import {readRelationshipProfiles} from './relationshipProfileRead';
import {usePrivateChatProfiles} from '../hooks/usePrivateChatProfiles';
import {GroupChatMessageRow} from '../components/chat/GroupChatMessageRow';
import {EventAttendeeCard} from '../components/event/EventAttendeeCard';
import {hydrateRsvpDisplayProfiles} from '../features/events/rsvpDisplayProfiles';
describe.runIf(process.env.IGNITE_CLUB_DISPLAY_REPLICA==='1')('dedicated production club-name display release',()=>{
  beforeAll(async()=>{
    vi.stubGlobal('crypto',webcrypto);
    vi.stubEnv('IGNITE_LIVE_PRIVATE_PROFILE_SEARCH_REHEARSAL','0');
    vi.stubEnv('IGNITE_LIVE_PRIVATE_CLUB_NAME_DISPLAYS','1');
    local.fixture=await createNameEditFixture({clubDisplayReleaseOnly:true});
  },120000);
  afterAll(async()=>{await local.fixture?.close();vi.unstubAllEnvs();vi.unstubAllGlobals();});
  it('secure saves render club chat and event names, reuse one club key and deny outsiders without releasing other audiences',async()=>{
    const f=local.fixture;
    const context=(user:any)=>({identity:{getPrincipal:()=>user},target:{alias:'disposable-club-display',host:'http://127.0.0.1:4943',networkKind:'public_mainnet',canisterIds:Object.fromEntries(Object.entries(f.services).map(([d,s]:[string,any])=>[d,s.canisterId.toText()]))}});
    const owner=context(f.owner),viewer=context(f.viewer),subject=f.owner.toText();
    const reference=`pii-display-name:v1:${f.services.pii_access_control.canisterId}:${subject}`;
    const before='Club Adult Before',after='Club Adult After';
    await saveIcpIdentityProfile(owner.identity as any,subject,{displayName:before},owner.target as any);
    const identity=f.connect('identity_access',f.owner).actor;
    expect(f.ok(await identity.get_profile()).display_name).toBe(reference);
    const pii=f.connect('pii_access_control',f.owner).actor;
    const oldCopy=f.ok(await pii.read_private_club_name_lifecycle(f.owner,f.clubId,[]))[0];
    expect(oldCopy.master_key_id).toBe(`vetkey-club-names-v1:${f.clubId}`);
    local.context=viewer;
    const queryClient=new QueryClient({defaultOptions:{queries:{retry:false}}});
    const msg={id:f.message.id,text:f.message.text,image_url:null,created_at:new Date().toISOString(),author_id:subject,group_id:f.conversationId,reply_to_id:null};
    function Chat(){
      const getProfile=usePrivateChatProfiles(f.conversationId,f.viewer.toText(),[subject],true);
      return <GroupChatMessageRow msg={msg} messagesById={new Map([[msg.id,msg]])} isOwnMessage={false} isAdmin={false} highlightedMessageId={null} messageReactions={[]} userId={f.viewer.toText()} getProfile={getProfile} readFrontier={{}} readCounts={{}} handleReply={()=>{}} handleEdit={()=>{}} deleteMessageMutation={{mutate:()=>{}}} toggleReactionMutation={{mutate:()=>{}}}/>;
    }
    const chat=render(<QueryClientProvider client={queryClient}><Chat/></QueryClientProvider>);
    await waitFor(()=>expect(within(chat.container).getByText(before)).toBeTruthy(),{timeout:15000});
    expect(f.counters.clubUnlocks).toBe(1);
    await saveIcpIdentityProfile(owner.identity as any,subject,{displayName:after},owner.target as any);
    const newCopy=f.ok(await pii.read_private_club_name_lifecycle(f.owner,f.clubId,[]))[0];
    expect(Array.from(newCopy.ciphertext)).not.toEqual(Array.from(oldCopy.ciphertext));
    act(()=>{window.dispatchEvent(new Event('pagehide'));window.dispatchEvent(new Event('pageshow'));});
    await waitFor(()=>expect(within(chat.container).getByText(after)).toBeTruthy(),{timeout:15000});
    expect(within(chat.container).queryByText(before)).toBeNull();
    const profiles=await readRelationshipProfiles(viewer as any,[subject],{kind:'club',resource:f.clubId});
    expect(profiles[0].display_name).toBe(after);
    const rows=hydrateRsvpDisplayProfiles([{id:'rsvp',user_id:subject,status:'going',profiles:null}],profiles.map(p=>({id:p.account_id,display_name:p.display_name})));
    const attendee=render(<EventAttendeeCard rsvp={rows[0]} currentStatus="going"/>);
    expect(within(attendee.container).getByText(after)).toBeTruthy();
    expect(f.counters.clubUnlocks).toBe(1);
    const outsider=f.connect('pii_access_control',f.outsider).actor;
    const audience={kind:'club',authority:f.services.club_domain.canisterId,resource:f.clubId,profile_revision:0n};
    expect('Err' in await outsider.get_private_profile_names_batch([subject],audience)).toBe(true);
    const {TransportSecretKey}=await import('@icp-sdk/vetkeys');
    expect('Err' in await outsider.get_private_profile_club_name_vetkey([subject],audience,TransportSecretKey.random().publicKeyBytes())).toBe(true);
    expect('Err' in await pii.get_private_profile_names_batch([subject],{...audience,resource:'foreign-club'})).toBe(true);
    for(const kind of ['family','direct','competition','guardian_search']) expect('Err' in await pii.get_private_profile_names_batch([subject],{...audience,kind})).toBe(true);
    expect('Err' in await pii.register_private_club_name(f.owner,f.clubId,newCopy.ciphertext)).toBe(true);
    expect('Err' in await pii.purge_private_club_name_lifecycle(f.owner,f.clubId,newCopy.ciphertext)).toBe(true);
    expect(f.ok(await identity.get_profile()).display_name).toBe(reference);
    attendee.unmount();chat.unmount();queryClient.clear();
  },120000);
});