import { describe, expect, it } from 'vitest';
import { fillOwnPrivateName, recallOwnPrivateName, rememberOwnPrivateName } from './ownPrivateName';
import { retirePrivateProfileSession } from './privateProfileSession';

describe('own private name', () => {
  it('shows my own saved name instead of my encrypted reference', () => {
    rememberOwnPrivateName('me-principal', 'Paul C');
    const rows = fillOwnPrivateName([
      { display_name: 'pii-display-name:v1:auth:me-principal' },
      { display_name: 'pii-display-name:v1:auth:someone-else' },
    ], 'me-principal');
    expect(rows[0].display_name).toBe('Paul C');
    expect(rows[1].display_name).toBe('pii-display-name:v1:auth:someone-else');
  });

  it('forgets the name when the signed-in session ends', () => {
    rememberOwnPrivateName('me-principal', 'Paul C');
    retirePrivateProfileSession();
    expect(recallOwnPrivateName('me-principal')).toBeUndefined();
  });
});
