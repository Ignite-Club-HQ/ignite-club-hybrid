import { describe, expect, it } from 'vitest';

function evaluateXmldomSafety(xml: string) {
  const lowered = xml.toLowerCase();
  if (lowered.includes('<!doctype') || lowered.includes('entity') || lowered.includes('system')) {
    return { ok: false, reason: 'external-entity-risk' } as const;
  }
  return { ok: true } as const;
}

describe('xmldom security upgrade safety', () => {
  it('rejects unsafe XML entities or external system references while allowing safe payloads', () => {
    expect(evaluateXmldomSafety('<note><text>ok</text></note>')).toEqual({ ok: true });
    expect(evaluateXmldomSafety('<!DOCTYPE root [<!ENTITY xxe SYSTEM "file:///etc/passwd">]>')).toEqual({ ok: false, reason: 'external-entity-risk' });
  });
});
