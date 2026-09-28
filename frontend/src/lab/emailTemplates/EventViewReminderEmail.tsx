/**
 * Local port of `supabase/functions/send-event-view-reminder/_templates/event-view-reminder.tsx`
 * (see reference/backend/supabase/functions/send-event-view-reminder/_templates/event-view-reminder.tsx.md).
 *
 * The reference template composes `@react-email/components` (Body, Button,
 * Container, ...). Those are not installed here (and the reference module
 * itself is never imported/transpiled/executed per the lab boundary), so this
 * port renders the equivalent plain HTML host elements directly — the same
 * approach the original bundle test's own harness used to stand in for the
 * react-email package. React's automatic text escaping and the link
 * normalization / RSVP-copy logic are preserved exactly.
 *
 * `PRODUCTION_DOMAIN` was redacted to a placeholder (`https://reference.invalid`)
 * by the export sanitizer; `igniteclubhq.app` is used instead, matching the
 * literal normalized-link value the original bundle test asserted against.
 */
import * as React from 'react';

export interface EventViewReminderEmailProps {
  recipientName: string;
  eventTitle: string;
  teamName: string;
  clubName: string;
  eventDate: string;
  eventTime: string;
  eventLocation?: string;
  eventType: string;
  eventLink: string;
  clubLogoUrl?: string;
  primaryColor?: string;
}

const PRODUCTION_DOMAIN = 'https://igniteclubhq.app';
const IGNITE_BRAND_COLOR = '#10b981';
const IGNITE_ICON_URL = `${PRODUCTION_DOMAIN}/ignite-icon.png`;

const isValidExternalUrl = (url?: string): boolean => {
  if (!url) return false;
  return url.startsWith('http://') || url.startsWith('https://');
};

const normalizeLink = (link: string): string => {
  try {
    const url = new URL(link);
    return `${PRODUCTION_DOMAIN}${url.pathname}`;
  } catch {
    if (link.startsWith('/')) {
      return `${PRODUCTION_DOMAIN}${link}`;
    }
    return link;
  }
};

const isRsvpEvent = (eventType: string): boolean => {
  const lower = eventType.toLowerCase();
  return lower === 'game' || lower === 'training' || lower === 'match';
};

export const EventViewReminderEmail = ({
  recipientName = 'Member',
  eventTitle = 'Team Event',
  teamName = 'The Team',
  clubName = 'The Club',
  eventDate = 'Saturday, January 25, 2025',
  eventTime = '2:00 PM',
  eventLocation,
  eventType = 'Event',
  eventLink = PRODUCTION_DOMAIN,
  clubLogoUrl,
  primaryColor = IGNITE_BRAND_COLOR,
}: EventViewReminderEmailProps) => {
  const normalizedEventLink = normalizeLink(eventLink);
  const validClubLogoUrl = isValidExternalUrl(clubLogoUrl) ? clubLogoUrl : undefined;
  const rsvpStyle = isRsvpEvent(eventType);
  const safePrimaryColor = /^#[0-9a-fA-F]{3,8}$/.test(primaryColor ?? '')
    ? primaryColor
    : IGNITE_BRAND_COLOR;

  const bannerText = rsvpStyle ? '📋 RSVP Needed!' : "🎉 Don't Miss This!";
  const headingText = '📅 Event Reminder';
  const previewText = rsvpStyle
    ? `RSVP needed: ${eventTitle} - ${eventDate} at ${eventTime}`
    : `Don't miss: ${eventTitle} - ${eventDate} at ${eventTime}`;
  const ctaText = 'View Event & RSVP Now';

  return (
    <html>
      <head />
      <body>
        <div>
          <span>{previewText}</span>
          <div>
            {validClubLogoUrl ? (
              <img src={validClubLogoUrl} width="60" height="60" alt={clubName} />
            ) : (
              <div style={{ backgroundColor: safePrimaryColor }}>
                <p>{clubName.charAt(0).toUpperCase()}</p>
              </div>
            )}
            <p>{clubName}</p>
          </div>
          <hr />
          <div>
            <p>{bannerText}</p>
          </div>
          <div>
            <h1>{headingText}</h1>
            <p>Dear {recipientName},</p>
            <p>
              {rsvpStyle ? (
                <>
                  Your team admin has noticed you haven't RSVP'd to <strong>"{eventTitle}"</strong>{' '}
                  for{' '}
                  <strong style={{ color: safePrimaryColor }}>{teamName}</strong>. Please take a
                  moment to view the details and let them know if you can make it.
                </>
              ) : (
                <>
                  You haven't checked out <strong>"{eventTitle}"</strong> for{' '}
                  <strong style={{ color: safePrimaryColor }}>{clubName}</strong> yet! Take a look
                  at the details below and let us know if you can make it.
                </>
              )}
            </p>
            <div>
              <p>{eventTitle}</p>
              <div>
                <div>
                  <p>📆 Date</p>
                  <p>{eventDate}</p>
                </div>
                <div>
                  <p>🕐 Time</p>
                  <p>{eventTime}</p>
                </div>
              </div>
              {eventLocation && (
                <div>
                  <p>📍 Location</p>
                  <p>{eventLocation}</p>
                </div>
              )}
            </div>
            <div>
              <a style={{ backgroundColor: safePrimaryColor }} href={normalizedEventLink}>
                {ctaText}
              </a>
            </div>
            <p>
              <strong>Your response is needed!</strong>{' '}
              {rsvpStyle
                ? 'Tap the button above to view all the details and let your team know if you can make it.'
                : 'Tap the button above to view all the details and let us know if you can make it.'}
            </p>
            <p>
              Or copy this link:{' '}
              <a href={normalizedEventLink} style={{ color: safePrimaryColor }}>
                {normalizedEventLink}
              </a>
            </p>
          </div>
          <hr />
          <div>
            <p>
              This reminder was sent by {clubName}.
              <a href={normalizedEventLink} style={{ color: safePrimaryColor }}>
                {' '}
                Manage your notification preferences
              </a>
            </p>
            <p>
              📷 Photos may be shared within the app by team members. Photo consent is managed by
              your club, not Ignite. Please contact your club or team admin if you have concerns or
              wish to opt out.
            </p>
            <table cellPadding={0} cellSpacing={0} style={{ margin: '0 auto' }}>
              <tbody>
                <tr>
                  <td style={{ paddingRight: '8px', verticalAlign: 'middle' }}>
                    <img src={IGNITE_ICON_URL} width="24" height="24" alt="Ignite" />
                  </td>
                  <td style={{ verticalAlign: 'middle' }}>
                    <a href={PRODUCTION_DOMAIN}>Powered by Ignite</a>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </body>
    </html>
  );
};
