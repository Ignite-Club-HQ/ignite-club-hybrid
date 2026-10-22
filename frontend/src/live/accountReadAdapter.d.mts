export function isLoopbackRehearsalHost(host: string): boolean;
export function adaptLocalAccountReads<T extends object>(actor: T, service: unknown, host: string): T;
export function adaptRemoteAccountReads<T extends object>(actor: T, service: unknown, canisterId: string): T;