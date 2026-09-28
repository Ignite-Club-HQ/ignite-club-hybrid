import { expect, test } from 'vitest';
import { createHybridNotificationDispatcher } from '../src/lab/hybridNotificationDispatcher';
import { createSyntheticPlacementRegistry } from '../src/lab/syntheticPlacementRegistry';

const fake=()=>({enqueue:async(n:any)=>({...n,status:'pending',attempts:0,nextAttemptMs:0}),claim:async()=>[],acknowledge:async()=>({}),fail:async()=>({}),recover:async()=>0,get:async()=>undefined} as any);
test('routes notification enqueue by placement and blocks disabled backend',async()=>{const r=createSyntheticPlacementRegistry([{clubId:'au',country:'AU',backend:{Supabase:{environment:'au'}}}]);let calls=0;const d=createHybridNotificationDispatcher(r,{supabase:async()=>{calls++;return fake()},icp:async()=>fake()});await d.enqueue({id:'n',user:'u',club:'au',kind:'event',body:'x',idempotencyKey:'k'});expect(calls).toBe(1);r.setAvailability('supabase',false);await expect(d.enqueue({id:'n2',user:'u',club:'au',kind:'event',body:'x',idempotencyKey:'k2'})).rejects.toThrow('disabled');});
