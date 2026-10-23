/** Only local, verified routing drift invalidates a captured session. */
export class StaleGroupSessionError extends Error {
  constructor() {
    super('Group registry changed; reopen session');
    this.name = 'StaleGroupSessionError';
  }
}