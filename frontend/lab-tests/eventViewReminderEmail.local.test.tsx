/**
 * Local equivalent of the exported `eventViewReminderEmail.test.ts` suite.
 *
 * The original bundle test dynamically transpiled and executed the
 * reference react-email template inline (via a data: module URL), which the
 * lab boundary forbids regardless of mechanism. Instead, this suite renders
 * the faithfully ported `EventViewReminderEmail` component from
 * `frontend/src/lab/emailTemplates/EventViewReminderEmail.tsx` and preserves
 * every original assertion.
 */
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { EventViewReminderEmail } from '../src/lab/emailTemplates/EventViewReminderEmail';

const baseProps = {
  recipientName: 'Synthetic Member',
  eventTitle: 'Synthetic Training',
  teamName: 'Synthetic Team',
  clubName: 'Synthetic Club',
  eventDate: 'Thursday, 23 July 2026',
  eventTime: '6:00 PM',
  eventLocation: 'Synthetic Oval',
  eventType: 'training',
  eventLink: 'https://untrusted.example/events/synthetic-event?token=secret',
  clubLogoUrl: undefined,
  primaryColor: '#10b981',
};

function render(overrides: Record<string, unknown> = {}) {
  return `<!doctype html>${renderToStaticMarkup(
    React.createElement(EventViewReminderEmail, { ...baseProps, ...overrides } as any),
  )}`;
}

describe('event-view reminder email security contract', () => {
  it('escapes an attacker-controlled event title instead of creating email markup', () => {
    const html = render({ eventTitle: '<img src="x" data-injected="event" onerror="alert(1)">' });
    expect(html).not.toContain('<img src="x"');
    expect(html).not.toContain('onerror="alert(1)"');
    expect(html).toContain('&lt;img');
  });

  it('escapes an attacker-controlled team name in RSVP copy', () => {
    const html = render({ teamName: '<a href="https://evil.example" data-injected="team">Support</a>' });
    expect(html).not.toContain('<a href="https://evil.example"');
    expect(html).toContain('&lt;a');
  });

  it('escapes an attacker-controlled club name in non-RSVP copy', () => {
    const html = render({
      eventType: 'social',
      clubName: '<img src="https://evil.example/track" data-injected="club">',
    });
    expect(html).not.toContain('<img src="https://evil.example/track"');
    expect(html).toContain('&lt;img');
  });

  it('normalizes the CTA and fallback link to the production origin', () => {
    const html = render();
    expect(html).toContain('href="https://igniteclubhq.app/events/synthetic-event"');
    expect(html).not.toContain('untrusted.example');
    expect(html).not.toContain('token=secret');
  });

  it('preserves RSVP and non-RSVP wording without requiring raw HTML', () => {
    const rsvp = render({ eventType: 'match' });
    const nonRsvp = render({ eventType: 'social' });
    expect(rsvp).toContain('RSVP Needed!');
    expect(rsvp).toContain('Your response is needed!');
    expect(nonRsvp).toContain("Don&#x27;t Miss This!");
    expect(nonRsvp).toContain('Your response is needed!');
  });
});
