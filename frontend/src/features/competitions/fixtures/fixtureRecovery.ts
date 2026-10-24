export interface FixtureIntent<T> {operation:string;input:T}
export function readFixtureIntent<T>(storage:Pick<Storage,"getItem">,scope:string):FixtureIntent<T>|null {
  const raw=storage.getItem(`ignite.fixture-intent.v1:${scope}`);if(!raw)return null;
  const value:unknown=JSON.parse(raw);
  if(!value || typeof value!=="object" || !("operation" in value) || typeof value.operation!=="string" || !("input" in value))throw new Error("Fixture recovery record invalid");
  return {operation:value.operation,input:value.input as T};
}
export function reserveFixtureIntent<T>(storage:Pick<Storage,"getItem"|"setItem">,scope:string,input:T,newOperation:()=>string):FixtureIntent<T> {
  const key=`ignite.fixture-intent.v1:${scope}`;
  const existing=storage.getItem(key);
  if(existing){
    const value:unknown=JSON.parse(existing);
    if(!value || typeof value!=="object" || !("operation" in value) || typeof value.operation!=="string" || !("input" in value))throw new Error("Fixture recovery record invalid");
    if(JSON.stringify(value.input)!==JSON.stringify(input))throw new Error("Resolve the original fixture before adding a different match.");
    return {operation:value.operation,input:value.input as T};
  }
  const intent={operation:newOperation(),input};storage.setItem(key,JSON.stringify(intent));return intent;
}
export function clearFixtureIntent(storage:Pick<Storage,"removeItem">,scope:string){storage.removeItem(`ignite.fixture-intent.v1:${scope}`)}