import { describe, expect, it } from 'vitest';
import { capturePrivateProfileSession, onPrivateProfileSessionRetired, retirePrivateProfileSession } from './privateProfileSession';
describe('private disclosure session retirement', () => {
  it('retires old reads even when their identity objects have not changed', () => {
    const old = capturePrivateProfileSession();
    old();
    retirePrivateProfileSession();
    expect(old).toThrow('session retired');
    expect(() => capturePrivateProfileSession()()).not.toThrow();
  });
  it('notifies all mounted readers synchronously despite a failing listener', () => {
    let calls = 0;
    const removeBad = onPrivateProfileSessionRetired(() => { throw new Error('gone'); });
    const removeGood = onPrivateProfileSessionRetired(() => { calls++; });
    retirePrivateProfileSession();
    expect(calls).toBe(1);
    removeBad(); removeGood();
    retirePrivateProfileSession();
    expect(calls).toBe(1);
  });
});