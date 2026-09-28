# Canister declarations

Once the ICP canisters are deployed, drop the generated TypeScript
declarations here (one folder per canister), then import the IDL factory where
you call `createActor` from `../actor.ts`.

Generate them from your dfx project with:

```sh
dfx generate
```

and copy each canister's `src/declarations/<canister_name>/` output into this
folder, e.g.:

```
declarations/
  backend/
    index.ts          <- exports idlFactory + canisterId
    backend.did.d.ts
    backend.did.js
```

Example usage:

```ts
import { idlFactory } from "@/lib/icp/declarations/backend";
import { createActor } from "@/lib/icp/actor";

const backend = createActor(canisterId, idlFactory, identity);
const result = await backend.greet("Ignite");
```
