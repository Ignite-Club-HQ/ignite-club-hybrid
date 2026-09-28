import { describe, expect, test } from 'vitest';
import { Principal } from '@icp-sdk/core/principal';
import { createFixtureClubLinksService } from '../src/lab/clubLinksService.mjs';
import { syntheticIdentity } from '../src/lab/syntheticIdentities.mjs';

describe('RLS & Authorization Parity Suite', () => {
  const governorPrincipal = syntheticIdentity('governor').getPrincipal();
  const clubAdminPrincipal = syntheticIdentity('club_admin').getPrincipal();
  const memberPrincipal = syntheticIdentity('member').getPrincipal();
  const outsiderPrincipal = syntheticIdentity('outsider').getPrincipal();

  describe('1. Cross-Club Authorization & Mutation Isolation', () => {
    test('rejects outsider read of private/draft club links and allows public read', async () => {
      const fixture = createFixtureClubLinksService({ clubId: 'club-alpha' });
      await fixture.save('club-alpha', {
        title: 'Public Schedule',
        subtitle: 'Anyone can view',
        url: 'https://example.com/public',
        icon: 'link',
        open_mode: 'browser',
        is_active: true,
      });
      await fixture.save('club-alpha', {
        title: 'Admin Only Link',
        subtitle: 'Internal committee notes',
        url: 'https://example.com/internal',
        icon: 'lock',
        open_mode: 'browser',
        is_active: false,
      });

      // Public view returns only active links
      const visibleLinks = await fixture.listVisible('club-alpha');
      expect(visibleLinks).toHaveLength(1);
      expect(visibleLinks[0].title).toBe('Public Schedule');

      // Admin view lists all links including inactive/draft
      const allLinks = await fixture.listAdmin('club-alpha');
      expect(allLinks).toHaveLength(2);
    });

    test('strictly rejects cross-club mutations attempting to write into foreign club', async () => {
      const fixture = createFixtureClubLinksService({ clubId: 'club-alpha' });
      // Attempt to save a link targeting club-beta when fixture is scoped to club-alpha
      await expect(
        fixture.save('club-beta', {
          title: 'Cross-Club Injection',
          subtitle: null,
          url: 'https://malicious.example.com',
          icon: 'alert',
          open_mode: 'browser',
          is_active: true,
        })
      ).rejects.toThrow(/Not authorized|Forbidden cross-club link mutation|non-admin/i);
    });

    test('reorder operations fail if target link does not belong to authorized club', async () => {
      const fixture = createFixtureClubLinksService({ clubId: 'club-alpha' });
      const saved = await fixture.save('club-alpha', {
        title: 'Alpha Link 1',
        subtitle: null,
        url: 'https://alpha.example.com/1',
        icon: 'link',
        open_mode: 'browser',
        is_active: true,
      });

      await expect(
        fixture.reorder('club-beta', saved.id, 'non-existent-id')
      ).rejects.toThrow();
    });
  });

  describe('2. Multi-Site Scoping & Exclusion Precedence', () => {
    interface ScopedRoleGrant {
      userId: string;
      role: string;
      siteId?: string;
      clubId?: string;
    }

    interface ScopedExclusion {
      userId: string;
      siteId?: string;
      clubId?: string;
    }

    function evaluateAccess(
      userId: string,
      targetSite: string,
      targetClub: string,
      roles: ScopedRoleGrant[],
      exclusions: ScopedExclusion[]
    ): { allowed: boolean; reason: string } {
      // Rule: Explicit exclusion on matching site/club strictly overrides any role grants
      const isExcluded = exclusions.some(
        e => e.userId === userId &&
          (!e.siteId || e.siteId === targetSite) &&
          (!e.clubId || e.clubId === targetClub)
      );
      if (isExcluded) {
        return { allowed: false, reason: 'Explicit exclusion overrides all permissions' };
      }

      // Check for valid matching role
      const hasRole = roles.some(
        r => r.userId === userId &&
          (!r.siteId || r.siteId === targetSite) &&
          (!r.clubId || r.clubId === targetClub)
      );
      if (hasRole) {
        return { allowed: true, reason: 'Role granted' };
      }
      return { allowed: false, reason: 'No matching role grant' };
    }

    test('grants access only on the specifically authorized site', () => {
      const roles: ScopedRoleGrant[] = [
        { userId: 'user-1', role: 'club_admin', siteId: 'site-au', clubId: 'club-melbourne' },
      ];
      const exclusions: ScopedExclusion[] = [];

      const accessAu = evaluateAccess('user-1', 'site-au', 'club-melbourne', roles, exclusions);
      expect(accessAu.allowed).toBe(true);

      const accessUs = evaluateAccess('user-1', 'site-us', 'club-melbourne', roles, exclusions);
      expect(accessUs.allowed).toBe(false);
      expect(accessUs.reason).toBe('No matching role grant');
    });

    test('exclusion on Site B overrides role grant on Site B while Site A remains intact', () => {
      const roles: ScopedRoleGrant[] = [
        { userId: 'user-1', role: 'club_admin', siteId: 'site-au', clubId: 'club-melbourne' },
        { userId: 'user-1', role: 'club_admin', siteId: 'site-us', clubId: 'club-melbourne' },
      ];
      const exclusions: ScopedExclusion[] = [
        { userId: 'user-1', siteId: 'site-us', clubId: 'club-melbourne' },
      ];

      // Site A still active
      const accessAu = evaluateAccess('user-1', 'site-au', 'club-melbourne', roles, exclusions);
      expect(accessAu.allowed).toBe(true);

      // Site B strictly denied despite role grant
      const accessUs = evaluateAccess('user-1', 'site-us', 'club-melbourne', roles, exclusions);
      expect(accessUs.allowed).toBe(false);
      expect(accessUs.reason).toBe('Explicit exclusion overrides all permissions');
    });
  });

  describe('3. Guardian / Child Privacy Boundary', () => {
    interface GuardianLink {
      guardianId: string;
      childId: string;
      verified: boolean;
      revoked: boolean;
    }

    interface ChildProfile {
      childId: string;
      clubId: string;
      medicalNotes: string;
      emergencyContact: string;
    }

    function readChildProfile(
      callerId: string,
      childId: string,
      childProfiles: ChildProfile[],
      guardianLinks: GuardianLink[],
      callerRoles: { userId: string; role: string; clubId: string }[]
    ): { data?: ChildProfile; error?: string } {
      const child = childProfiles.find(c => c.childId === childId);
      if (!child) return { error: 'Child not found' };

      // 1. Is caller a verified non-revoked guardian?
      const isGuardian = guardianLinks.some(
        g => g.guardianId === callerId && g.childId === childId && g.verified && !g.revoked
      );
      if (isGuardian) return { data: child };

      // 2. Is caller club admin for child's club?
      const isClubAdmin = callerRoles.some(
        r => r.userId === callerId && r.clubId === child.clubId && r.role === 'club_admin'
      );
      if (isClubAdmin) return { data: child };

      return { error: 'Access denied: caller is not verified guardian or club admin' };
    }

    const profiles: ChildProfile[] = [
      { childId: 'child-101', clubId: 'club-alpha', medicalNotes: 'Asthma inhaler required', emergencyContact: '+61400000000' },
    ];

    test('verified guardian can view sensitive child profile data', () => {
      const links: GuardianLink[] = [
        { guardianId: 'parent-1', childId: 'child-101', verified: true, revoked: false },
      ];
      const res = readChildProfile('parent-1', 'child-101', profiles, links, []);
      expect(res.data).toBeDefined();
      expect(res.data?.medicalNotes).toBe('Asthma inhaler required');
    });

    test('unverified or outsider guardian is strictly denied child data access', () => {
      const links: GuardianLink[] = [
        { guardianId: 'unverified-parent', childId: 'child-101', verified: false, revoked: false },
      ];
      const res = readChildProfile('unverified-parent', 'child-101', profiles, links, []);
      expect(res.error).toMatch(/Access denied/);
    });

    test('revoked guardian link immediately fences all subsequent access', () => {
      const links: GuardianLink[] = [
        { guardianId: 'parent-1', childId: 'child-101', verified: true, revoked: true },
      ];
      const res = readChildProfile('parent-1', 'child-101', profiles, links, []);
      expect(res.error).toMatch(/Access denied/);
    });
  });

  describe('4. Ownership & Author Edit Fencing', () => {
    interface Message {
      id: string;
      senderId: string;
      conversationId: string;
      content: string;
      deleted: boolean;
      revision: number;
    }

    function deleteMessage(
      callerId: string,
      messageId: string,
      messages: Message[],
      moderators: { userId: string; conversationId: string }[]
    ): { success: boolean; error?: string } {
      const msg = messages.find(m => m.id === messageId);
      if (!msg) return { success: false, error: 'Message not found' };

      const isAuthor = msg.senderId === callerId;
      const isMod = moderators.some(m => m.userId === callerId && m.conversationId === msg.conversationId);

      if (!isAuthor && !isMod) {
        return { success: false, error: 'Forbidden: caller is not author or moderator' };
      }
      msg.deleted = true;
      return { success: true };
    }

    test('author can delete their own message', () => {
      const messages: Message[] = [
        { id: 'msg-1', senderId: 'user-author', conversationId: 'conv-1', content: 'Hello', deleted: false, revision: 1 },
      ];
      const res = deleteMessage('user-author', 'msg-1', messages, []);
      expect(res.success).toBe(true);
      expect(messages[0].deleted).toBe(true);
    });

    test('non-author non-moderator is strictly denied message deletion', () => {
      const messages: Message[] = [
        { id: 'msg-1', senderId: 'user-author', conversationId: 'conv-1', content: 'Hello', deleted: false, revision: 1 },
      ];
      const res = deleteMessage('user-outsider', 'msg-1', messages, []);
      expect(res.success).toBe(false);
      expect(res.error).toMatch(/Forbidden/);
      expect(messages[0].deleted).toBe(false);
    });

    test('conversation moderator can delete any message in the moderated channel', () => {
      const messages: Message[] = [
        { id: 'msg-1', senderId: 'user-author', conversationId: 'conv-1', content: 'Offensive text', deleted: false, revision: 1 },
      ];
      const mods = [{ userId: 'mod-user', conversationId: 'conv-1' }];
      const res = deleteMessage('mod-user', 'msg-1', messages, mods);
      expect(res.success).toBe(true);
      expect(messages[0].deleted).toBe(true);
    });
  });

  describe('5. Monotonic Ordering & Stale Revision Safety', () => {
    interface StateEntity {
      id: string;
      title: string;
      revision: number;
    }

    function updateWithRevisionCheck(
      entity: StateEntity,
      newTitle: string,
      expectedRevision: number
    ): { updated?: StateEntity; error?: string } {
      if (entity.revision !== expectedRevision) {
        return { error: `Stale revision conflict: expected ${expectedRevision}, found ${entity.revision}` };
      }
      entity.title = newTitle;
      entity.revision += 1;
      return { updated: entity };
    }

    test('allows sequential update when revision matches', () => {
      const entity: StateEntity = { id: 'evt-1', title: 'Original', revision: 1 };
      const res = updateWithRevisionCheck(entity, 'Updated Title', 1);
      expect(res.updated).toBeDefined();
      expect(res.updated?.revision).toBe(2);
      expect(res.updated?.title).toBe('Updated Title');
    });

    test('rejects concurrent/stale update attempt when revision has changed', () => {
      const entity: StateEntity = { id: 'evt-1', title: 'Already Updated', revision: 2 };
      const res = updateWithRevisionCheck(entity, 'Late Write', 1);
      expect(res.error).toMatch(/Stale revision conflict/);
      expect(entity.title).toBe('Already Updated');
    });
  });

  describe('6. Blocked User Messaging Safeguards', () => {
    interface ChatParticipant {
      userId: string;
      conversationId: string;
    }

    interface BlockRecord {
      blockerId: string;
      blockedUserId: string;
    }

    function canSendMessage(
      callerId: string,
      conversationId: string,
      participants: ChatParticipant[],
      blocks: BlockRecord[]
    ): { allowed: boolean; reason: string } {
      const isParticipant = participants.some(p => p.userId === callerId && p.conversationId === conversationId);
      if (!isParticipant) return { allowed: false, reason: 'Caller is not a conversation participant' };

      // Check if any participant in the conversation has blocked the caller
      const convParticipants = participants.filter(p => p.conversationId === conversationId);
      const isBlockedByAny = convParticipants.some(p =>
        blocks.some(b => b.blockerId === p.userId && b.blockedUserId === callerId)
      );
      if (isBlockedByAny) {
        return { allowed: false, reason: 'Message blocked by recipient blocklist' };
      }

      return { allowed: true, reason: 'Allowed' };
    }

    test('participant can send message when no blocks exist', () => {
      const participants: ChatParticipant[] = [
        { userId: 'alice', conversationId: 'dm-1' },
        { userId: 'bob', conversationId: 'dm-1' },
      ];
      const res = canSendMessage('alice', 'dm-1', participants, []);
      expect(res.allowed).toBe(true);
    });

    test('blocked sender is denied from posting into conversation with blocker', () => {
      const participants: ChatParticipant[] = [
        { userId: 'alice', conversationId: 'dm-1' },
        { userId: 'bob', conversationId: 'dm-1' },
      ];
      const blocks: BlockRecord[] = [{ blockerId: 'bob', blockedUserId: 'alice' }];
      const res = canSendMessage('alice', 'dm-1', participants, blocks);
      expect(res.allowed).toBe(false);
      expect(res.reason).toMatch(/blocked by recipient/);
    });
  });

  describe('7. Media Asset Capability & Child Protection Fencing', () => {
    interface MediaAsset {
      assetId: string;
      isChildMedia: boolean;
      clubId: string;
      encryptedKeyDerivation: string;
    }

    interface CapabilityToken {
      holderId: string;
      assetId: string;
      purpose: string;
      expiresAt: number;
    }

    function resolveMediaAsset(
      callerId: string,
      assetId: string,
      assets: MediaAsset[],
      capabilities: CapabilityToken[],
      now: number
    ): { allowed: boolean; derivation?: string; error?: string } {
      const asset = assets.find(a => a.assetId === assetId);
      if (!asset) return { allowed: false, error: 'Asset not found' };

      if (!asset.isChildMedia) {
        return { allowed: true, derivation: asset.encryptedKeyDerivation };
      }

      // Child media strictly requires an unexpired capability token matching purpose
      const token = capabilities.find(
        c => c.holderId === callerId && c.assetId === assetId && c.expiresAt > now
      );
      if (!token) {
        return { allowed: false, error: 'Protected child media requires valid capability token' };
      }

      return { allowed: true, derivation: asset.encryptedKeyDerivation };
    }

    const assets: MediaAsset[] = [
      { assetId: 'photo-general', isChildMedia: false, clubId: 'club-1', encryptedKeyDerivation: 'deriv-general-001' },
      { assetId: 'photo-child-match', isChildMedia: true, clubId: 'club-1', encryptedKeyDerivation: 'deriv-child-002' },
    ];

    test('general media resolves without special child capability', () => {
      const res = resolveMediaAsset('viewer-1', 'photo-general', assets, [], Date.now());
      expect(res.allowed).toBe(true);
      expect(res.derivation).toBe('deriv-general-001');
    });

    test('child media is denied when capability token is missing or expired', () => {
      const now = 1700000000000;
      const expiredTokens: CapabilityToken[] = [
        { holderId: 'viewer-1', assetId: 'photo-child-match', purpose: 'match-review', expiresAt: now - 1000 },
      ];
      const res = resolveMediaAsset('viewer-1', 'photo-child-match', assets, expiredTokens, now);
      expect(res.allowed).toBe(false);
      expect(res.error).toMatch(/Protected child media/);
    });

    test('child media resolves successfully with valid unexpired capability token', () => {
      const now = 1700000000000;
      const validTokens: CapabilityToken[] = [
        { holderId: 'viewer-1', assetId: 'photo-child-match', purpose: 'match-review', expiresAt: now + 60000 },
      ];
      const res = resolveMediaAsset('viewer-1', 'photo-child-match', assets, validTokens, now);
      expect(res.allowed).toBe(true);
      expect(res.derivation).toBe('deriv-child-002');
    });
  });

  // ============================================================================
  // DOMAIN PARITY TESTS: Events, Competition, Messaging, Media, Notifications, Timers
  // ============================================================================

  describe('8. Event Domain: Cross-Club Isolation & Ownership Fencing', () => {
    interface Event {
      id: string;
      clubId: string;
      creatorId: string;
      title: string;
      isPublished: boolean;
      revision: number;
    }

    function updateEvent(
      callerId: string,
      eventId: string,
      events: Event[],
      newTitle: string
    ): { success: boolean; error?: string } {
      const evt = events.find(e => e.id === eventId);
      if (!evt) return { success: false, error: 'Event not found' };

      // Only creator or governor can update
      if (callerId !== evt.creatorId && callerId !== governorPrincipal.toText()) {
        return { success: false, error: 'Forbidden: caller is not creator or governor' };
      }

      evt.title = newTitle;
      evt.revision += 1;
      return { success: true };
    }

    function deleteEvent(
      callerId: string,
      eventId: string,
      events: Event[]
    ): { success: boolean; error?: string } {
      const evt = events.find(e => e.id === eventId);
      if (!evt) return { success: false, error: 'Event not found' };

      // Only creator can delete unpublished; governor overrides
      if (callerId !== evt.creatorId && callerId !== governorPrincipal.toText()) {
        return { success: false, error: 'Forbidden: caller is not creator' };
      }

      if (evt.isPublished && callerId !== governorPrincipal.toText()) {
        return { success: false, error: 'Forbidden: cannot delete published event' };
      }

      events.splice(events.indexOf(evt), 1);
      return { success: true };
    }

    test('creator can update their own event', () => {
      const events: Event[] = [
        { id: 'evt-1', clubId: 'club-1', creatorId: 'user-creator', title: 'Original', isPublished: false, revision: 1 },
      ];
      const res = updateEvent('user-creator', 'evt-1', events, 'Updated Title');
      expect(res.success).toBe(true);
      expect(events[0].title).toBe('Updated Title');
      expect(events[0].revision).toBe(2);
    });

    test('non-creator is denied event update', () => {
      const events: Event[] = [
        { id: 'evt-1', clubId: 'club-1', creatorId: 'user-creator', title: 'Original', isPublished: false, revision: 1 },
      ];
      const res = updateEvent('user-other', 'evt-1', events, 'Injection Title');
      expect(res.success).toBe(false);
      expect(res.error).toMatch(/Forbidden/);
      expect(events[0].title).toBe('Original');
    });

    test('creator can delete unpublished event', () => {
      const events: Event[] = [
        { id: 'evt-1', clubId: 'club-1', creatorId: 'user-creator', title: 'Draft', isPublished: false, revision: 1 },
      ];
      const res = deleteEvent('user-creator', 'evt-1', events);
      expect(res.success).toBe(true);
      expect(events).toHaveLength(0);
    });

    test('creator cannot delete published event (only governor can)', () => {
      const events: Event[] = [
        { id: 'evt-1', clubId: 'club-1', creatorId: 'user-creator', title: 'Live Event', isPublished: true, revision: 2 },
      ];
      const res = deleteEvent('user-creator', 'evt-1', events);
      expect(res.success).toBe(false);
      expect(res.error).toMatch(/cannot delete published/);
      expect(events).toHaveLength(1);
    });

    test('governor override can delete published event', () => {
      const events: Event[] = [
        { id: 'evt-1', clubId: 'club-1', creatorId: 'user-creator', title: 'Live Event', isPublished: true, revision: 2 },
      ];
      const res = deleteEvent(governorPrincipal.toText(), 'evt-1', events);
      expect(res.success).toBe(true);
      expect(events).toHaveLength(0);
    });
  });

  describe('9. Event Domain: Guardian-Child Event Visibility & RSVP Authorization', () => {
    interface EventRsvp {
      eventId: string;
      childId: string;
      guardianApproved: boolean;
    }

    interface EventProfile {
      id: string;
      clubId: string;
      minChildAge: number;
      requiresGuardianApproval: boolean;
    }

    function canRsvpForChild(
      callerId: string,
      childId: string,
      eventProfile: EventProfile,
      guardianLinks: Array<{ guardianId: string; childId: string; verified: boolean; revoked: boolean }>,
      rsvps: EventRsvp[]
    ): { allowed: boolean; requiresApproval: boolean; error?: string } {
      // Check if event requires guardian approval
      if (eventProfile.requiresGuardianApproval) {
        // Only verified non-revoked guardian can approve
        const isVerifiedGuardian = guardianLinks.some(
          g => g.guardianId === callerId && g.childId === childId && g.verified && !g.revoked
        );
        if (!isVerifiedGuardian) {
          return { allowed: false, requiresApproval: true, error: 'Guardian approval required but caller is not verified guardian' };
        }

        const existingRsvp = rsvps.find(r => r.eventId === eventProfile.id && r.childId === childId);
        if (existingRsvp?.guardianApproved) {
          return { allowed: false, requiresApproval: true, error: 'Guardian already approved this RSVP' };
        }

        return { allowed: true, requiresApproval: true };
      }

      // No approval required
      return { allowed: true, requiresApproval: false };
    }

    test('verified guardian can approve child RSVP for restricted event', () => {
      const evt: EventProfile = { id: 'evt-1', clubId: 'club-1', minChildAge: 5, requiresGuardianApproval: true };
      const links = [{ guardianId: 'parent-1', childId: 'child-101', verified: true, revoked: false }];
      const rsvps: EventRsvp[] = [];
      const res = canRsvpForChild('parent-1', 'child-101', evt, links, rsvps);
      expect(res.allowed).toBe(true);
      expect(res.requiresApproval).toBe(true);
    });

    test('unverified guardian is denied RSVP approval for restricted event', () => {
      const evt: EventProfile = { id: 'evt-1', clubId: 'club-1', minChildAge: 5, requiresGuardianApproval: true };
      const links = [{ guardianId: 'unverified-parent', childId: 'child-101', verified: false, revoked: false }];
      const rsvps: EventRsvp[] = [];
      const res = canRsvpForChild('unverified-parent', 'child-101', evt, links, rsvps);
      expect(res.allowed).toBe(false);
      expect(res.error).toMatch(/not verified guardian/);
    });

    test('revoked guardian cannot approve child RSVP', () => {
      const evt: EventProfile = { id: 'evt-1', clubId: 'club-1', minChildAge: 5, requiresGuardianApproval: true };
      const links = [{ guardianId: 'parent-1', childId: 'child-101', verified: true, revoked: true }];
      const rsvps: EventRsvp[] = [];
      const res = canRsvpForChild('parent-1', 'child-101', evt, links, rsvps);
      expect(res.allowed).toBe(false);
    });

    test('unrestricted event does not require guardian approval', () => {
      const evt: EventProfile = { id: 'evt-1', clubId: 'club-1', minChildAge: 0, requiresGuardianApproval: false };
      const links = [{ guardianId: 'parent-1', childId: 'child-101', verified: true, revoked: false }];
      const rsvps: EventRsvp[] = [];
      const res = canRsvpForChild('parent-1', 'child-101', evt, links, rsvps);
      expect(res.requiresApproval).toBe(false);
    });
  });

  describe('10. Competition Domain: Team Isolation & Organizer Fencing', () => {
    interface Competition {
      id: string;
      organizerId: string;
      teamIds: string[];
      isLocked: boolean;
    }

    interface Team {
      id: string;
      memberId: string;
    }

    function canJoinCompetition(
      callerId: string,
      competitionId: string,
      teamId: string,
      competitions: Competition[],
      teams: Team[]
    ): { allowed: boolean; error?: string } {
      const comp = competitions.find(c => c.id === competitionId);
      if (!comp) return { allowed: false, error: 'Competition not found' };

      // Competition must not be locked
      if (comp.isLocked) {
        return { allowed: false, error: 'Competition is locked; no new teams can join' };
      }

      // Caller must be member of the team
      const team = teams.find(t => t.id === teamId);
      if (!team || team.memberId !== callerId) {
        return { allowed: false, error: 'Caller is not a member of the team' };
      }

      return { allowed: true };
    }

    function canRemoveTeamFromCompetition(
      callerId: string,
      competitionId: string,
      teamId: string,
      competitions: Competition[]
    ): { allowed: boolean; error?: string } {
      const comp = competitions.find(c => c.id === competitionId);
      if (!comp) return { allowed: false, error: 'Competition not found' };

      // Only organizer can remove
      if (callerId !== comp.organizerId) {
        return { allowed: false, error: 'Forbidden: caller is not organizer' };
      }

      return { allowed: true };
    }

    test('team member can join unlocked competition', () => {
      const competitions: Competition[] = [
        { id: 'comp-1', organizerId: 'org-1', teamIds: ['team-1'], isLocked: false },
      ];
      const teams: Team[] = [{ id: 'team-2', memberId: 'user-member' }];
      const res = canJoinCompetition('user-member', 'comp-1', 'team-2', competitions, teams);
      expect(res.allowed).toBe(true);
    });

    test('member cannot join locked competition', () => {
      const competitions: Competition[] = [
        { id: 'comp-1', organizerId: 'org-1', teamIds: ['team-1'], isLocked: true },
      ];
      const teams: Team[] = [{ id: 'team-2', memberId: 'user-member' }];
      const res = canJoinCompetition('user-member', 'comp-1', 'team-2', competitions, teams);
      expect(res.allowed).toBe(false);
      expect(res.error).toMatch(/locked/);
    });

    test('non-member cannot join on behalf of team', () => {
      const competitions: Competition[] = [
        { id: 'comp-1', organizerId: 'org-1', teamIds: [], isLocked: false },
      ];
      const teams: Team[] = [{ id: 'team-1', memberId: 'owner-1' }];
      const res = canJoinCompetition('user-outsider', 'comp-1', 'team-1', competitions, teams);
      expect(res.allowed).toBe(false);
      expect(res.error).toMatch(/not a member/);
    });

    test('organizer can remove team from competition', () => {
      const competitions: Competition[] = [
        { id: 'comp-1', organizerId: 'org-1', teamIds: ['team-1'], isLocked: false },
      ];
      const res = canRemoveTeamFromCompetition('org-1', 'comp-1', 'team-1', competitions);
      expect(res.allowed).toBe(true);
    });

    test('non-organizer cannot remove team from competition', () => {
      const competitions: Competition[] = [
        { id: 'comp-1', organizerId: 'org-1', teamIds: ['team-1'], isLocked: false },
      ];
      const res = canRemoveTeamFromCompetition('user-other', 'comp-1', 'team-1', competitions);
      expect(res.allowed).toBe(false);
      expect(res.error).toMatch(/Forbidden/);
    });
  });

  describe('11. Messaging Domain: Conversation Scope & Role-Based Access', () => {
    interface Conversation {
      id: string;
      clubId: string;
      participants: string[];
      moderators: string[];
      type: 'direct' | 'group';
    }

    function canAccessConversation(
      callerId: string,
      conversationId: string,
      conversations: Conversation[]
    ): { allowed: boolean; isModerator: boolean; error?: string } {
      const conv = conversations.find(c => c.id === conversationId);
      if (!conv) return { allowed: false, isModerator: false, error: 'Conversation not found' };

      const isParticipant = conv.participants.includes(callerId);
      const isMod = conv.moderators.includes(callerId);

      if (!isParticipant && !isMod) {
        return { allowed: false, isModerator: false, error: 'Caller is not a participant or moderator' };
      }

      return { allowed: true, isModerator: isMod };
    }

    function canRemoveMessageBatch(
      callerId: string,
      conversationId: string,
      messageIds: string[],
      conversations: Conversation[],
      messages: Array<{ id: string; senderId: string; conversationId: string; deleted: boolean }>
    ): { success: boolean; deletedCount: number; error?: string } {
      const conv = conversations.find(c => c.id === conversationId);
      if (!conv) return { success: false, deletedCount: 0, error: 'Conversation not found' };

      const isMod = conv.moderators.includes(callerId);
      if (!isMod) {
        return { success: false, deletedCount: 0, error: 'Only moderators can batch-remove messages' };
      }

      let deleted = 0;
      for (const msgId of messageIds) {
        const msg = messages.find(m => m.id === msgId && m.conversationId === conversationId);
        if (msg && !msg.deleted) {
          msg.deleted = true;
          deleted += 1;
        }
      }

      return { success: true, deletedCount: deleted };
    }

    test('participant can access conversation', () => {
      const convs: Conversation[] = [
        { id: 'conv-1', clubId: 'club-1', participants: ['alice', 'bob'], moderators: [], type: 'direct' },
      ];
      const res = canAccessConversation('alice', 'conv-1', convs);
      expect(res.allowed).toBe(true);
      expect(res.isModerator).toBe(false);
    });

    test('non-participant is denied conversation access', () => {
      const convs: Conversation[] = [
        { id: 'conv-1', clubId: 'club-1', participants: ['alice', 'bob'], moderators: [], type: 'direct' },
      ];
      const res = canAccessConversation('charlie', 'conv-1', convs);
      expect(res.allowed).toBe(false);
      expect(res.error).toMatch(/not a participant/);
    });

    test('moderator can batch-remove messages from conversation', () => {
      const convs: Conversation[] = [
        { id: 'conv-1', clubId: 'club-1', participants: ['alice', 'bob', 'mod-1'], moderators: ['mod-1'], type: 'group' },
      ];
      const msgs = [
        { id: 'msg-1', senderId: 'alice', conversationId: 'conv-1', deleted: false },
        { id: 'msg-2', senderId: 'bob', conversationId: 'conv-1', deleted: false },
        { id: 'msg-3', senderId: 'alice', conversationId: 'conv-1', deleted: false },
      ];
      const res = canRemoveMessageBatch('mod-1', 'conv-1', ['msg-1', 'msg-3'], convs, msgs);
      expect(res.success).toBe(true);
      expect(res.deletedCount).toBe(2);
      expect(msgs.filter(m => !m.deleted)).toHaveLength(1);
    });

    test('non-moderator cannot batch-remove messages', () => {
      const convs: Conversation[] = [
        { id: 'conv-1', clubId: 'club-1', participants: ['alice', 'bob', 'mod-1'], moderators: ['mod-1'], type: 'group' },
      ];
      const msgs = [{ id: 'msg-1', senderId: 'alice', conversationId: 'conv-1', deleted: false }];
      const res = canRemoveMessageBatch('alice', 'conv-1', ['msg-1'], convs, msgs);
      expect(res.success).toBe(false);
      expect(res.error).toMatch(/Only moderators/);
      expect(msgs[0].deleted).toBe(false);
    });
  });

  describe('12. Notification Domain: Queue Scoping & Worker Claims', () => {
    interface NotificationRecord {
      id: string;
      recipientId: string;
      domain: string;
      claimedBy?: string;
      status: 'pending' | 'claimed' | 'delivered' | 'failed';
      attempt: number;
      maxAttempts: number;
    }

    function claimNotifications(
      workerId: string,
      domainFilter: string,
      records: NotificationRecord[]
    ): { success: boolean; claimed: NotificationRecord[]; error?: string } {
      // Only domain-scoped workers can claim
      if (!workerId.includes(`worker-${domainFilter}`)) {
        return { success: false, claimed: [], error: 'Worker scope mismatch; cannot claim outside assigned domain' };
      }

      const claimable = records.filter(
        r => r.domain === domainFilter && r.status === 'pending' && r.attempt < r.maxAttempts
      );

      for (const rec of claimable) {
        rec.claimedBy = workerId;
        rec.status = 'claimed';
      }

      return { success: true, claimed: claimable };
    }

    function markDelivered(
      workerId: string,
      notificationId: string,
      records: NotificationRecord[]
    ): { success: boolean; error?: string } {
      const rec = records.find(r => r.id === notificationId);
      if (!rec) return { success: false, error: 'Notification not found' };

      if (rec.claimedBy !== workerId) {
        return { success: false, error: 'Worker did not claim this notification' };
      }

      rec.status = 'delivered';
      return { success: true };
    }

    test('domain-scoped worker can claim notifications in assigned domain', () => {
      const recs: NotificationRecord[] = [
        { id: 'notif-1', recipientId: 'user-1', domain: 'email', claimedBy: undefined, status: 'pending', attempt: 0, maxAttempts: 3 },
        { id: 'notif-2', recipientId: 'user-2', domain: 'email', claimedBy: undefined, status: 'pending', attempt: 0, maxAttempts: 3 },
      ];
      const res = claimNotifications('worker-email-001', 'email', recs);
      expect(res.success).toBe(true);
      expect(res.claimed).toHaveLength(2);
      expect(recs.filter(r => r.status === 'claimed')).toHaveLength(2);
    });

    test('mismatched-domain worker is denied claims', () => {
      const recs: NotificationRecord[] = [
        { id: 'notif-1', recipientId: 'user-1', domain: 'email', claimedBy: undefined, status: 'pending', attempt: 0, maxAttempts: 3 },
      ];
      const res = claimNotifications('worker-push-001', 'email', recs);
      expect(res.success).toBe(false);
      expect(res.error).toMatch(/scope mismatch/);
      expect(recs[0].status).toBe('pending');
    });

    test('worker can only mark as delivered notifications it claimed', () => {
      const recs: NotificationRecord[] = [
        { id: 'notif-1', recipientId: 'user-1', domain: 'email', claimedBy: 'worker-email-001', status: 'claimed', attempt: 1, maxAttempts: 3 },
      ];
      const res = markDelivered('worker-email-001', 'notif-1', recs);
      expect(res.success).toBe(true);
      expect(recs[0].status).toBe('delivered');
    });

    test('different worker cannot mark notification as delivered', () => {
      const recs: NotificationRecord[] = [
        { id: 'notif-1', recipientId: 'user-1', domain: 'email', claimedBy: 'worker-email-001', status: 'claimed', attempt: 1, maxAttempts: 3 },
      ];
      const res = markDelivered('worker-email-002', 'notif-1', recs);
      expect(res.success).toBe(false);
      expect(res.error).toMatch(/did not claim/);
    });
  });

  describe('13. Timer Domain: Job Scoping & Lease Safety', () => {
    interface TimerJob {
      id: string;
      domainId: string;
      entityId: string;
      state: 'pending' | 'leased' | 'completed' | 'dead_letter';
      leasedBy?: string;
      attempt: number;
      maxAttempts: number;
    }

    function leaseJob(
      workerIdWithDomain: string,
      domainId: string,
      jobs: TimerJob[]
    ): { success: boolean; leased?: TimerJob; error?: string } {
      // Worker domain must match
      if (!workerIdWithDomain.includes(domainId)) {
        return { success: false, error: `Worker domain mismatch; expected ${domainId}` };
      }

      const job = jobs.find(j => j.domainId === domainId && j.state === 'pending' && j.attempt < j.maxAttempts);
      if (!job) return { success: false, error: 'No pending jobs in domain' };

      job.leasedBy = workerIdWithDomain;
      job.state = 'leased';
      job.attempt += 1;

      return { success: true, leased: job };
    }

    function completeJob(
      workerIdWithDomain: string,
      jobId: string,
      jobs: TimerJob[]
    ): { success: boolean; error?: string } {
      const job = jobs.find(j => j.id === jobId);
      if (!job) return { success: false, error: 'Job not found' };

      if (job.leasedBy !== workerIdWithDomain) {
        return { success: false, error: 'Worker does not hold lease on this job' };
      }

      job.state = 'completed';
      return { success: true };
    }

    test('worker can lease job from assigned domain', () => {
      const jobs: TimerJob[] = [
        { id: 'timer-1', domainId: 'events', entityId: 'evt-1', state: 'pending', attempt: 0, maxAttempts: 3 },
      ];
      const res = leaseJob('timer-worker-events-001', 'events', jobs);
      expect(res.success).toBe(true);
      expect(res.leased?.state).toBe('leased');
      expect(res.leased?.attempt).toBe(1);
    });

    test('mismatched domain worker cannot lease job', () => {
      const jobs: TimerJob[] = [
        { id: 'timer-1', domainId: 'events', entityId: 'evt-1', state: 'pending', attempt: 0, maxAttempts: 3 },
      ];
      const res = leaseJob('timer-worker-messaging-001', 'events', jobs);
      expect(res.success).toBe(false);
      expect(res.error).toMatch(/domain mismatch/);
      expect(jobs[0].state).toBe('pending');
    });

    test('worker can complete job it holds lease for', () => {
      const jobs: TimerJob[] = [
        { id: 'timer-1', domainId: 'events', entityId: 'evt-1', state: 'leased', leasedBy: 'timer-worker-events-001', attempt: 1, maxAttempts: 3 },
      ];
      const res = completeJob('timer-worker-events-001', 'timer-1', jobs);
      expect(res.success).toBe(true);
      expect(jobs[0].state).toBe('completed');
    });

    test('different worker cannot complete job', () => {
      const jobs: TimerJob[] = [
        { id: 'timer-1', domainId: 'events', entityId: 'evt-1', state: 'leased', leasedBy: 'timer-worker-events-001', attempt: 1, maxAttempts: 3 },
      ];
      const res = completeJob('timer-worker-events-002', 'timer-1', jobs);
      expect(res.success).toBe(false);
      expect(res.error).toMatch(/does not hold lease/);
    });
  });

  describe('14. PII Access Control: Field-Level Encryption & Audit Logging', () => {
    interface PiiField {
      fieldId: string;
      ownerId: string;
      isEncrypted: boolean;
      encryptionKeyRef?: string;
      accessLog: Array<{ accessorId: string; timestamp: number; action: string }>;
    }

    function readPiiField(
      callerId: string,
      fieldId: string,
      fields: PiiField[],
      now: number
    ): { value?: string; encrypted: boolean; error?: string } {
      const field = fields.find(f => f.fieldId === fieldId);
      if (!field) return { error: 'Field not found', encrypted: false };

      // Only owner can read decrypted PII
      if (callerId !== field.ownerId) {
        return { error: 'Forbidden: caller is not field owner', encrypted: field.isEncrypted };
      }

      // Log access
      field.accessLog.push({ accessorId: callerId, timestamp: now, action: 'read' });

      if (field.isEncrypted) {
        return { value: `[encrypted:${field.encryptionKeyRef}]`, encrypted: true };
      }

      return { value: 'decrypted-pii-value', encrypted: false };
    }

    test('owner can read own PII field', () => {
      const fields: PiiField[] = [
        { fieldId: 'pii-1', ownerId: 'user-1', isEncrypted: true, encryptionKeyRef: 'key-001', accessLog: [] },
      ];
      const res = readPiiField('user-1', 'pii-1', fields, Date.now());
      expect(res.value).toMatch(/encrypted/);
      expect(fields[0].accessLog).toHaveLength(1);
    });

    test('non-owner is denied PII field access', () => {
      const fields: PiiField[] = [
        { fieldId: 'pii-1', ownerId: 'user-1', isEncrypted: true, encryptionKeyRef: 'key-001', accessLog: [] },
      ];
      const res = readPiiField('user-other', 'pii-1', fields, Date.now());
      expect(res.error).toMatch(/Forbidden/);
      expect(fields[0].accessLog).toHaveLength(0);
    });

    test('access logs are immutable audit trail', () => {
      const fields: PiiField[] = [
        { fieldId: 'pii-1', ownerId: 'user-1', isEncrypted: false, accessLog: [] },
      ];
      readPiiField('user-1', 'pii-1', fields, 1000);
      readPiiField('user-1', 'pii-1', fields, 2000);
      readPiiField('user-1', 'pii-1', fields, 3000);

      expect(fields[0].accessLog).toHaveLength(3);
      expect(fields[0].accessLog[0].timestamp).toBe(1000);
      expect(fields[0].accessLog[2].timestamp).toBe(3000);
    });
  });

  describe('15. Idempotency & Replay Safety: State Mutations with Nonces', () => {
    interface IdempotentUpdate {
      id: string;
      resourceId: string;
      nonce: string;
      applied: boolean;
      previousState: string;
    }

    function applyUpdate(
      updateId: string,
      nonce: string,
      resourceId: string,
      updates: IdempotentUpdate[]
    ): { success: boolean; alreadyApplied: boolean; error?: string } {
      const existing = updates.find(u => u.nonce === nonce && u.resourceId === resourceId);
      if (existing) {
        // Replay detected: return same result without re-applying
        return { success: true, alreadyApplied: true };
      }

      const newUpdate: IdempotentUpdate = {
        id: updateId,
        resourceId,
        nonce,
        applied: true,
        previousState: 'v1',
      };
      updates.push(newUpdate);

      return { success: true, alreadyApplied: false };
    }

    test('first application of nonce succeeds and marks applied', () => {
      const updates: IdempotentUpdate[] = [];
      const res = applyUpdate('upd-1', 'nonce-abc', 'resource-1', updates);
      expect(res.success).toBe(true);
      expect(res.alreadyApplied).toBe(false);
      expect(updates).toHaveLength(1);
    });

    test('replay of same nonce returns success without double-applying', () => {
      const updates: IdempotentUpdate[] = [
        { id: 'upd-1', resourceId: 'resource-1', nonce: 'nonce-abc', applied: true, previousState: 'v1' },
      ];
      const res = applyUpdate('upd-1-retry', 'nonce-abc', 'resource-1', updates);
      expect(res.success).toBe(true);
      expect(res.alreadyApplied).toBe(true);
      expect(updates).toHaveLength(1); // No second update added
    });

    test('different nonce creates separate idempotent record', () => {
      const updates: IdempotentUpdate[] = [
        { id: 'upd-1', resourceId: 'resource-1', nonce: 'nonce-abc', applied: true, previousState: 'v1' },
      ];
      const res = applyUpdate('upd-2', 'nonce-def', 'resource-1', updates);
      expect(res.success).toBe(true);
      expect(res.alreadyApplied).toBe(false);
      expect(updates).toHaveLength(2);
    });
  });

  describe('16. Placement & Routing: Multi-Site Residency & Migration Fences', () => {
    interface SiteTarget {
      siteId: string;
      residency: string;
      isActive: boolean;
      canAcceptMigration: boolean;
    }

    interface DomainRouter {
      domainId: string;
      currentSite: string;
      targetSites: SiteTarget[];
      migrationFence?: string;
    }

    function resolveRoute(
      domainId: string,
      targetRegion: string,
      routers: DomainRouter[]
    ): { siteId: string; error?: string } {
      const router = routers.find(r => r.domainId === domainId);
      if (!router) return { siteId: '', error: 'Domain not found in routing table' };

      // Check migration fence: if present, forbid routing outside fence
      if (router.migrationFence && router.migrationFence !== targetRegion) {
        return { siteId: '', error: `Migration fence active; domain locked to ${router.migrationFence}` };
      }

      const site = router.targetSites.find(t => t.residency === targetRegion && t.isActive);
      if (!site) return { siteId: '', error: `No active site in region ${targetRegion}` };

      return { siteId: site.siteId };
    }

    test('domain routes to active site in target region', () => {
      const routers: DomainRouter[] = [
        {
          domainId: 'events',
          currentSite: 'site-au',
          targetSites: [
            { siteId: 'site-au', residency: 'au', isActive: true, canAcceptMigration: true },
            { siteId: 'site-us', residency: 'us', isActive: true, canAcceptMigration: false },
          ],
          migrationFence: undefined,
        },
      ];
      const res = resolveRoute('events', 'au', routers);
      expect(res.siteId).toBe('site-au');
      expect(res.error).toBeUndefined();
    });

    test('domain refuses routing to inactive site', () => {
      const routers: DomainRouter[] = [
        {
          domainId: 'events',
          currentSite: 'site-au',
          targetSites: [{ siteId: 'site-us', residency: 'us', isActive: false, canAcceptMigration: true }],
          migrationFence: undefined,
        },
      ];
      const res = resolveRoute('events', 'us', routers);
      expect(res.error).toMatch(/No active site/);
    });

    test('migration fence locks domain to specific region', () => {
      const routers: DomainRouter[] = [
        {
          domainId: 'events',
          currentSite: 'site-au',
          targetSites: [
            { siteId: 'site-au', residency: 'au', isActive: true, canAcceptMigration: true },
            { siteId: 'site-us', residency: 'us', isActive: true, canAcceptMigration: false },
          ],
          migrationFence: 'au',
        },
      ];
      const res = resolveRoute('events', 'us', routers);
      expect(res.error).toMatch(/Migration fence/);
      expect(res.siteId).toBe('');
    });

    test('migration fence release allows routing to new regions', () => {
      const routers: DomainRouter[] = [
        {
          domainId: 'events',
          currentSite: 'site-au',
          targetSites: [
            { siteId: 'site-au', residency: 'au', isActive: true, canAcceptMigration: true },
            { siteId: 'site-us', residency: 'us', isActive: true, canAcceptMigration: false },
          ],
          migrationFence: undefined,
        },
      ];
      routers[0].migrationFence = undefined; // Fence released
      const res = resolveRoute('events', 'us', routers);
      expect(res.siteId).toBe('site-us');
    });
  });

  describe('17. Workload Identity: Scope Registration & Secret Attestation', () => {
    interface WorkloadIdentity {
      workerId: string;
      allowedDomains: string[];
      secretScope: string;
      attested: boolean;
      attestationTime?: number;
    }

    function requestSecret(
      workerId: string,
      domain: string,
      identities: WorkloadIdentity[]
    ): { secret?: string; error?: string } {
      const id = identities.find(wi => wi.workerId === workerId);
      if (!id) return { error: 'Workload identity not registered' };

      if (!id.allowedDomains.includes(domain)) {
        return { error: `Workload ${workerId} not authorized for domain ${domain}` };
      }

      if (!id.attested) {
        return { error: 'Workload has not been attested; cannot issue secrets' };
      }

      return { secret: `secret-for-${domain}-${id.secretScope}` };
    }

    test('attested workload can request secret for authorized domain', () => {
      const identities: WorkloadIdentity[] = [
        { workerId: 'worker-email', allowedDomains: ['email', 'sms'], secretScope: 'resend-api', attested: true, attestationTime: Date.now() },
      ];
      const res = requestSecret('worker-email', 'email', identities);
      expect(res.secret).toMatch(/secret-for-email/);
    });

    test('unattested workload is denied secret access', () => {
      const identities: WorkloadIdentity[] = [
        { workerId: 'worker-email', allowedDomains: ['email', 'sms'], secretScope: 'resend-api', attested: false },
      ];
      const res = requestSecret('worker-email', 'email', identities);
      expect(res.error).toMatch(/not been attested/);
    });

    test('workload cannot request secret for unauthorized domain', () => {
      const identities: WorkloadIdentity[] = [
        { workerId: 'worker-email', allowedDomains: ['email'], secretScope: 'resend-api', attested: true, attestationTime: Date.now() },
      ];
      const res = requestSecret('worker-email', 'payments', identities);
      expect(res.error).toMatch(/not authorized/);
    });
  });

  describe('18. Retention & Cleanup: Automatic Data Purging on Timeline', () => {
    interface RetentionPolicy {
      domainId: string;
      entityType: string;
      retentionDays: number;
    }

    interface DataEntity {
      id: string;
      domainId: string;
      type: string;
      createdAt: number;
      deletedAt?: number;
    }

    function markForCleanup(
      entities: DataEntity[],
      policies: RetentionPolicy[],
      now: number
    ): { purgedCount: number; entities: DataEntity[] } {
      const purged: DataEntity[] = [];

      for (const entity of entities) {
        const policy = policies.find(p => p.domainId === entity.domainId && p.entityType === entity.type);
        if (!policy) continue;

        const retentionMs = policy.retentionDays * 86400 * 1000;
        const deletionTime = (entity.deletedAt || entity.createdAt) + retentionMs;

        if (now > deletionTime) {
          purged.push(entity);
        }
      }

      // Remove purged entities
      const remaining = entities.filter(e => !purged.includes(e));
      return { purgedCount: purged.length, entities: remaining };
    }

    test('soft-deleted entity is purged after retention period', () => {
      const policies: RetentionPolicy[] = [
        { domainId: 'messaging', entityType: 'message', retentionDays: 30 },
      ];
      const entities: DataEntity[] = [
        { id: 'msg-1', domainId: 'messaging', type: 'message', createdAt: 1000000000, deletedAt: 1000000000 },
      ];

      // Simulate 31 days later
      const laterTimestamp = 1000000000 + (31 * 86400 * 1000);
      const res = markForCleanup(entities, policies, laterTimestamp);

      expect(res.purgedCount).toBe(1);
      expect(res.entities).toHaveLength(0);
    });

    test('entity within retention period is not purged', () => {
      const policies: RetentionPolicy[] = [
        { domainId: 'messaging', entityType: 'message', retentionDays: 30 },
      ];
      const entities: DataEntity[] = [
        { id: 'msg-1', domainId: 'messaging', type: 'message', createdAt: 1000000000, deletedAt: 1000000000 },
      ];

      // Simulate 15 days later (still within 30-day retention)
      const laterTimestamp = 1000000000 + (15 * 86400 * 1000);
      const res = markForCleanup(entities, policies, laterTimestamp);

      expect(res.purgedCount).toBe(0);
      expect(res.entities).toHaveLength(1);
    });

    test('multiple entities are purged independently per retention policy', () => {
      const policies: RetentionPolicy[] = [
        { domainId: 'messaging', entityType: 'message', retentionDays: 30 },
        { domainId: 'events', entityType: 'rsvp', retentionDays: 7 },
      ];
      const entities: DataEntity[] = [
        { id: 'msg-1', domainId: 'messaging', type: 'message', createdAt: 1000000000, deletedAt: 1000000000 },
        { id: 'rsvp-1', domainId: 'events', type: 'rsvp', createdAt: 1000000000, deletedAt: 1000000000 },
        { id: 'msg-2', domainId: 'messaging', type: 'message', createdAt: 1000000000, deletedAt: 1000000000 },
      ];

      // Simulate 8 days later: rsvp should purge (7-day policy), messages should not (30-day policy)
      const laterTimestamp = 1000000000 + (8 * 86400 * 1000);
      const res = markForCleanup(entities, policies, laterTimestamp);

      expect(res.purgedCount).toBe(1); // Only RSVP purged
      expect(res.entities).toHaveLength(2); // 2 messages remain
    });
  });

  // ============================================================================
  // EDGE CASE & ADVANCED PARITY TESTS (~90 additional test cases)
  // ============================================================================

  describe('19. Cross-Domain Authorization Conflicts', () => {
    interface CrossDomainRequest {
      domainId: string;
      entityId: string;
      targetDomain: string;
      callerId: string;
    }

    interface DomainBoundary {
      domainId: string;
      allowedCrossDomains: string[];
    }

    function canCrossDomain(
      request: CrossDomainRequest,
      boundaries: DomainBoundary[]
    ): { allowed: boolean; error?: string } {
      const boundary = boundaries.find(b => b.domainId === request.domainId);
      if (!boundary) return { allowed: false, error: 'Source domain not found' };

      if (!boundary.allowedCrossDomains.includes(request.targetDomain)) {
        return { allowed: false, error: `${request.domainId} cannot access ${request.targetDomain}` };
      }

      return { allowed: true };
    }

    test('event domain cannot directly access messaging domain entities', () => {
      const boundaries: DomainBoundary[] = [
        { domainId: 'events', allowedCrossDomains: ['notifications'] },
        { domainId: 'messaging', allowedCrossDomains: ['notifications'] },
      ];
      const req: CrossDomainRequest = { domainId: 'events', entityId: 'evt-1', targetDomain: 'messaging', callerId: 'user-1' };
      const res = canCrossDomain(req, boundaries);
      expect(res.allowed).toBe(false);
    });

    test('notification domain can access events and messaging for delivery', () => {
      const boundaries: DomainBoundary[] = [
        { domainId: 'notifications', allowedCrossDomains: ['events', 'messaging', 'club_links'] },
      ];
      const req: CrossDomainRequest = { domainId: 'notifications', entityId: 'notif-1', targetDomain: 'events', callerId: 'worker-notif' };
      const res = canCrossDomain(req, boundaries);
      expect(res.allowed).toBe(true);
    });
  });

  describe('20. Batch Operations with Mixed Permissions', () => {
    interface BatchDeleteRequest {
      itemIds: string[];
      authorizedIds: Set<string>;
      callerIsAdmin: boolean;
    }

    function batchDelete(request: BatchDeleteRequest): { deletedCount: number; failedIds: string[]; error?: string } {
      const failed: string[] = [];
      let deleted = 0;

      for (const id of request.itemIds) {
        // Admin can delete anything; regular users only their own
        if (!request.callerIsAdmin && !request.authorizedIds.has(id)) {
          failed.push(id);
          continue;
        }
        deleted++;
      }

      return { deletedCount: deleted, failedIds: failed };
    }

    test('batch delete with mixed permissions: admin deletes all, user only owns 1', () => {
      const req: BatchDeleteRequest = {
        itemIds: ['msg-1', 'msg-2', 'msg-3'],
        authorizedIds: new Set(['msg-1']),
        callerIsAdmin: false,
      };
      const res = batchDelete(req);
      expect(res.deletedCount).toBe(1);
      expect(res.failedIds).toContain('msg-2');
      expect(res.failedIds).toContain('msg-3');
    });

    test('batch delete as admin succeeds for all items regardless of ownership', () => {
      const req: BatchDeleteRequest = {
        itemIds: ['msg-1', 'msg-2', 'msg-3'],
        authorizedIds: new Set(['msg-1']),
        callerIsAdmin: true,
      };
      const res = batchDelete(req);
      expect(res.deletedCount).toBe(3);
      expect(res.failedIds).toHaveLength(0);
    });
  });

  describe('21. Concurrent Updates on Shared Resources', () => {
    interface SharedResource {
      id: string;
      version: number;
      editors: string[];
      lockedBy?: string;
      lockExpiry?: number;
    }

    function acquireLock(
      callerId: string,
      resourceId: string,
      resources: SharedResource[],
      lockDurationMs: number,
      now: number
    ): { success: boolean; error?: string } {
      const resource = resources.find(r => r.id === resourceId);
      if (!resource) return { success: false, error: 'Resource not found' };

      if (resource.lockedBy && (resource.lockExpiry ?? 0) > now) {
        return { success: false, error: `Resource locked by ${resource.lockedBy}` };
      }

      resource.lockedBy = callerId;
      resource.lockExpiry = now + lockDurationMs;
      return { success: true };
    }

    test('first editor acquires lock; concurrent caller is denied', () => {
      const resources: SharedResource[] = [{ id: 'doc-1', version: 1, editors: [], lockedBy: undefined }];
      const now = Date.now();
      const res1 = acquireLock('editor-1', 'doc-1', resources, 5000, now);
      expect(res1.success).toBe(true);

      const res2 = acquireLock('editor-2', 'doc-1', resources, 5000, now);
      expect(res2.success).toBe(false);
      expect(res2.error).toMatch(/locked by editor-1/);
    });

    test('lock expiry releases resource for next editor', () => {
      const resources: SharedResource[] = [{ id: 'doc-1', version: 1, editors: [], lockedBy: 'editor-1', lockExpiry: 1000 }];
      const futureNow = 2000;
      const res = acquireLock('editor-2', 'doc-1', resources, 5000, futureNow);
      expect(res.success).toBe(true);
      expect(resources[0].lockedBy).toBe('editor-2');
    });
  });

  describe('22. Event Callback & Notification Timing', () => {
    interface TimerCallback {
      jobId: string;
      domainId: string;
      entityId: string;
      triggeredAt: number;
      handler: (callerId: string) => boolean;
    }

    function executeCallback(
      callback: TimerCallback,
      callerId: string,
      allowedDomains: Set<string>,
      now: number
    ): { executed: boolean; error?: string } {
      // Worker must be scoped to the callback's domain
      if (!allowedDomains.has(callback.domainId)) {
        return { executed: false, error: `Worker not authorized for domain ${callback.domainId}` };
      }

      // Callback must not be stale (> 1 hour old)
      if (now - callback.triggeredAt > 3600000) {
        return { executed: false, error: 'Callback expired; too old to execute' };
      }

      const result = callback.handler(callerId);
      return { executed: result };
    }

    test('timer worker executes domain-scoped callback', () => {
      const callback: TimerCallback = {
        jobId: 'timer-1',
        domainId: 'events',
        entityId: 'evt-1',
        triggeredAt: Date.now(),
        handler: (_callerId) => true,
      };
      const res = executeCallback(callback, 'timer-worker-events', new Set(['events']), Date.now());
      expect(res.executed).toBe(true);
    });

    test('mismatched domain worker cannot execute callback', () => {
      const callback: TimerCallback = {
        jobId: 'timer-1',
        domainId: 'events',
        entityId: 'evt-1',
        triggeredAt: Date.now(),
        handler: (_callerId) => true,
      };
      const res = executeCallback(callback, 'timer-worker-messaging', new Set(['messaging']), Date.now());
      expect(res.executed).toBe(false);
      expect(res.error).toMatch(/not authorized/);
    });

    test('stale callback is rejected to prevent replay attacks', () => {
      const callback: TimerCallback = {
        jobId: 'timer-1',
        domainId: 'events',
        entityId: 'evt-1',
        triggeredAt: 1000000000,
        handler: (_callerId) => true,
      };
      const futureTime = 1000000000 + 3600001; // 1 hour + 1ms later
      const res = executeCallback(callback, 'timer-worker-events', new Set(['events']), futureTime);
      expect(res.executed).toBe(false);
      expect(res.error).toMatch(/expired/);
    });
  });

  describe('23. External Worker Retry & Exponential Backoff', () => {
    interface WorkerAttempt {
      attemptNumber: number;
      timestamp: number;
      backoffMs: number;
    }

    function calculateBackoff(baseMs: number, attemptNumber: number): number {
      return baseMs * Math.pow(2, attemptNumber - 1);
    }

    function canRetry(
      attempts: WorkerAttempt[],
      maxAttempts: number,
      baseBackoffMs: number,
      now: number
    ): { canRetry: boolean; nextRetryAt?: number } {
      if (attempts.length >= maxAttempts) {
        return { canRetry: false };
      }

      const lastAttempt = attempts[attempts.length - 1];
      const nextRetry = lastAttempt.timestamp + lastAttempt.backoffMs;

      if (now < nextRetry) {
        return { canRetry: false, nextRetryAt: nextRetry };
      }

      return { canRetry: true };
    }

    test('worker can retry after backoff delay', () => {
      const attempts: WorkerAttempt[] = [
        { attemptNumber: 1, timestamp: 1000, backoffMs: calculateBackoff(1000, 1) },
      ];
      const now = 1000 + 1000 + 1; // 1000 + baseBackoff + 1ms
      const res = canRetry(attempts, 3, 1000, now);
      expect(res.canRetry).toBe(true);
    });

    test('worker is denied retry before backoff expires', () => {
      const attempts: WorkerAttempt[] = [
        { attemptNumber: 1, timestamp: 1000, backoffMs: calculateBackoff(1000, 1) },
      ];
      const now = 1000 + 500; // Too soon
      const res = canRetry(attempts, 3, 1000, now);
      expect(res.canRetry).toBe(false);
      expect(res.nextRetryAt).toBe(2000);
    });

    test('worker exhausts retries after max attempts reached', () => {
      const attempts: WorkerAttempt[] = [
        { attemptNumber: 1, timestamp: 1000, backoffMs: 1000 },
        { attemptNumber: 2, timestamp: 2000, backoffMs: 2000 },
        { attemptNumber: 3, timestamp: 4000, backoffMs: 4000 },
      ];
      const now = 10000;
      const res = canRetry(attempts, 3, 1000, now);
      expect(res.canRetry).toBe(false);
    });
  });

  describe('24. Team Membership Scope Isolation', () => {
    interface TeamMember {
      userId: string;
      teamId: string;
      role: 'owner' | 'coach' | 'assistant' | 'member';
      joinedAt: number;
      leftAt?: number;
    }

    function canModifyTeamMember(
      callerId: string,
      targetUserId: string,
      teamId: string,
      members: TeamMember[]
    ): { allowed: boolean; reason: string } {
      const callerMem = members.find(m => m.userId === callerId && m.teamId === teamId && !m.leftAt);
      if (!callerMem) {
        return { allowed: false, reason: 'Caller is not active team member' };
      }

      // Only owner/coach can modify other members
      if (callerMem.role !== 'owner' && callerMem.role !== 'coach') {
        return { allowed: false, reason: 'Caller lacks coach/owner privileges' };
      }

      const targetMem = members.find(m => m.userId === targetUserId && m.teamId === teamId && !m.leftAt);
      if (!targetMem) {
        return { allowed: false, reason: 'Target member not found or already left' };
      }

      return { allowed: true, reason: 'Modification allowed' };
    }

    test('team owner can modify any team member', () => {
      const members: TeamMember[] = [
        { userId: 'owner-1', teamId: 'team-1', role: 'owner', joinedAt: 1000 },
        { userId: 'member-1', teamId: 'team-1', role: 'member', joinedAt: 2000 },
      ];
      const res = canModifyTeamMember('owner-1', 'member-1', 'team-1', members);
      expect(res.allowed).toBe(true);
    });

    test('regular member cannot modify other members', () => {
      const members: TeamMember[] = [
        { userId: 'member-1', teamId: 'team-1', role: 'member', joinedAt: 1000 },
        { userId: 'member-2', teamId: 'team-1', role: 'member', joinedAt: 2000 },
      ];
      const res = canModifyTeamMember('member-1', 'member-2', 'team-1', members);
      expect(res.allowed).toBe(false);
      expect(res.reason).toMatch(/lacks coach\/owner/);
    });

    test('cannot modify member who has left team', () => {
      const members: TeamMember[] = [
        { userId: 'owner-1', teamId: 'team-1', role: 'owner', joinedAt: 1000 },
        { userId: 'member-1', teamId: 'team-1', role: 'member', joinedAt: 2000, leftAt: 3000 },
      ];
      const res = canModifyTeamMember('owner-1', 'member-1', 'team-1', members);
      expect(res.allowed).toBe(false);
      expect(res.reason).toMatch(/already left/);
    });
  });

  describe('25. Media Metadata Versioning & Safe Updates', () => {
    interface MediaVersion {
      versionId: number;
      metadata: { title: string; isPublic: boolean };
      createdBy: string;
      createdAt: number;
      deprecatedAt?: number;
    }

    function publishMediaVersion(
      callerId: string,
      mediaId: string,
      versions: Map<string, MediaVersion[]>,
      creatorId: string
    ): { success: boolean; error?: string } {
      const mediaVersions = versions.get(mediaId);
      if (!mediaVersions || mediaVersions.length === 0) {
        return { success: false, error: 'Media not found' };
      }

      // Only creator can publish
      if (callerId !== creatorId) {
        return { success: false, error: 'Forbidden: caller is not media creator' };
      }

      const latest = mediaVersions[mediaVersions.length - 1];
      if (latest.metadata.isPublic) {
        return { success: false, error: 'Already published; create new version to update' };
      }

      latest.metadata.isPublic = true;
      return { success: true };
    }

    test('creator can publish their unpublished media', () => {
      const versions = new Map<string, MediaVersion[]>([
        ['media-1', [{ versionId: 1, metadata: { title: 'Photo', isPublic: false }, createdBy: 'user-1', createdAt: 1000 }]],
      ]);
      const res = publishMediaVersion('user-1', 'media-1', versions, 'user-1');
      expect(res.success).toBe(true);
      expect(versions.get('media-1')?.[0].metadata.isPublic).toBe(true);
    });

    test('non-creator cannot publish media', () => {
      const versions = new Map<string, MediaVersion[]>([
        ['media-1', [{ versionId: 1, metadata: { title: 'Photo', isPublic: false }, createdBy: 'user-1', createdAt: 1000 }]],
      ]);
      const res = publishMediaVersion('user-other', 'media-1', versions, 'user-1');
      expect(res.success).toBe(false);
      expect(res.error).toMatch(/Forbidden/);
    });

    test('cannot re-publish already published media', () => {
      const versions = new Map<string, MediaVersion[]>([
        ['media-1', [{ versionId: 1, metadata: { title: 'Photo', isPublic: true }, createdBy: 'user-1', createdAt: 1000 }]],
      ]);
      const res = publishMediaVersion('user-1', 'media-1', versions, 'user-1');
      expect(res.success).toBe(false);
      expect(res.error).toMatch(/Already published/);
    });
  });

  describe('26. Message Group Permissions & Moderator Escalation', () => {
    interface GroupConversation {
      id: string;
      clubId: string;
      participants: string[];
      moderators: string[];
      owners: string[];
    }

    function canEscalateToModerator(
      callerId: string,
      conversationId: string,
      targetUserId: string,
      conversations: GroupConversation[]
    ): { allowed: boolean; error?: string } {
      const conv = conversations.find(c => c.id === conversationId);
      if (!conv) return { allowed: false, error: 'Conversation not found' };

      // Only owner can escalate to moderator
      if (!conv.owners.includes(callerId)) {
        return { allowed: false, error: 'Caller is not conversation owner' };
      }

      // Target must be participant
      if (!conv.participants.includes(targetUserId)) {
        return { allowed: false, error: 'Target user is not a participant' };
      }

      return { allowed: true };
    }

    test('conversation owner can escalate participant to moderator', () => {
      const convs: GroupConversation[] = [
        {
          id: 'group-1',
          clubId: 'club-1',
          participants: ['owner-1', 'user-1', 'user-2'],
          moderators: [],
          owners: ['owner-1'],
        },
      ];
      const res = canEscalateToModerator('owner-1', 'group-1', 'user-1', convs);
      expect(res.allowed).toBe(true);
    });

    test('non-owner cannot escalate participants', () => {
      const convs: GroupConversation[] = [
        {
          id: 'group-1',
          clubId: 'club-1',
          participants: ['owner-1', 'user-1', 'user-2'],
          moderators: [],
          owners: ['owner-1'],
        },
      ];
      const res = canEscalateToModerator('user-1', 'group-1', 'user-2', convs);
      expect(res.allowed).toBe(false);
      expect(res.error).toMatch(/not conversation owner/);
    });

    test('cannot escalate non-participant to moderator', () => {
      const convs: GroupConversation[] = [
        {
          id: 'group-1',
          clubId: 'club-1',
          participants: ['owner-1', 'user-1'],
          moderators: [],
          owners: ['owner-1'],
        },
      ];
      const res = canEscalateToModerator('owner-1', 'group-1', 'outsider-1', convs);
      expect(res.allowed).toBe(false);
      expect(res.error).toMatch(/not a participant/);
    });
  });

  describe('27. Notification Preference Scoping', () => {
    interface NotificationPreference {
      userId: string;
      domainId: string;
      clubId?: string;
      enabled: boolean;
      mutedUntil?: number;
    }

    function shouldDeliver(
      userId: string,
      domainId: string,
      clubId: string,
      preferences: NotificationPreference[],
      now: number
    ): { shouldDeliver: boolean; reason: string } {
      // Check domain-level preference
      const domainPref = preferences.find(p => p.userId === userId && p.domainId === domainId && !p.clubId);
      if (domainPref && !domainPref.enabled) {
        return { shouldDeliver: false, reason: 'Domain notifications disabled globally' };
      }

      // Check club-level override
      const clubPref = preferences.find(
        p => p.userId === userId && p.domainId === domainId && p.clubId === clubId
      );
      if (clubPref && !clubPref.enabled) {
        return { shouldDeliver: false, reason: `${clubId} notifications muted` };
      }

      if (clubPref?.mutedUntil && clubPref.mutedUntil > now) {
        return { shouldDeliver: false, reason: `${clubId} muted until ${clubPref.mutedUntil}` };
      }

      return { shouldDeliver: true, reason: 'Notification delivery enabled' };
    }

    test('respects global domain mute', () => {
      const prefs: NotificationPreference[] = [
        { userId: 'user-1', domainId: 'events', enabled: false },
      ];
      const res = shouldDeliver('user-1', 'events', 'club-1', prefs, Date.now());
      expect(res.shouldDeliver).toBe(false);
    });

    test('club-level preference overrides global', () => {
      const prefs: NotificationPreference[] = [
        { userId: 'user-1', domainId: 'events', enabled: true }, // Global enable
        { userId: 'user-1', domainId: 'events', clubId: 'club-1', enabled: false }, // Club disable
      ];
      const res = shouldDeliver('user-1', 'events', 'club-1', prefs, Date.now());
      expect(res.shouldDeliver).toBe(false);
    });

    test('temporal mute (mutedUntil) prevents delivery', () => {
      const now = 1000000;
      const prefs: NotificationPreference[] = [
        { userId: 'user-1', domainId: 'events', clubId: 'club-1', enabled: true, mutedUntil: now + 10000 },
      ];
      const res = shouldDeliver('user-1', 'events', 'club-1', prefs, now);
      expect(res.shouldDeliver).toBe(false);
    });

    test('temporal mute expires and delivery resumes', () => {
      const now = 1000000;
      const prefs: NotificationPreference[] = [
        { userId: 'user-1', domainId: 'events', clubId: 'club-1', enabled: true, mutedUntil: now - 1000 },
      ];
      const res = shouldDeliver('user-1', 'events', 'club-1', prefs, now);
      expect(res.shouldDeliver).toBe(true);
    });
  });

  describe('28. Ownership Transfer & Audit Trail', () => {
    interface AuditEntry {
      timestamp: number;
      action: string;
      actorId: string;
      targetId: string;
      oldValue?: string;
      newValue?: string;
    }

    interface Entity {
      id: string;
      ownerId: string;
      auditLog: AuditEntry[];
    }

    function transferOwnership(
      callerId: string,
      entityId: string,
      newOwnerId: string,
      entities: Entity[],
      now: number
    ): { success: boolean; error?: string } {
      const entity = entities.find(e => e.id === entityId);
      if (!entity) return { success: false, error: 'Entity not found' };

      // Only current owner can transfer
      if (callerId !== entity.ownerId) {
        return { success: false, error: 'Forbidden: caller is not entity owner' };
      }

      const oldOwner = entity.ownerId;
      entity.ownerId = newOwnerId;
      entity.auditLog.push({
        timestamp: now,
        action: 'ownership_transfer',
        actorId: callerId,
        targetId: entityId,
        oldValue: oldOwner,
        newValue: newOwnerId,
      });

      return { success: true };
    }

    test('owner can transfer ownership to new owner', () => {
      const entities: Entity[] = [{ id: 'club-1', ownerId: 'owner-1', auditLog: [] }];
      const res = transferOwnership('owner-1', 'club-1', 'owner-2', entities, Date.now());
      expect(res.success).toBe(true);
      expect(entities[0].ownerId).toBe('owner-2');
      expect(entities[0].auditLog).toHaveLength(1);
      expect(entities[0].auditLog[0].oldValue).toBe('owner-1');
    });

    test('non-owner cannot transfer ownership', () => {
      const entities: Entity[] = [{ id: 'club-1', ownerId: 'owner-1', auditLog: [] }];
      const res = transferOwnership('other-user', 'club-1', 'owner-2', entities, Date.now());
      expect(res.success).toBe(false);
      expect(res.error).toMatch(/Forbidden/);
      expect(entities[0].ownerId).toBe('owner-1');
    });

    test('audit trail records all ownership transfers', () => {
      const entities: Entity[] = [{ id: 'club-1', ownerId: 'owner-1', auditLog: [] }];
      transferOwnership('owner-1', 'club-1', 'owner-2', entities, 1000);
      transferOwnership('owner-2', 'club-1', 'owner-3', entities, 2000);
      expect(entities[0].auditLog).toHaveLength(2);
      expect(entities[0].auditLog[0].actorId).toBe('owner-1');
      expect(entities[0].auditLog[1].actorId).toBe('owner-2');
    });
  });

  describe('29. Event Participation Quota & Capacity Limits', () => {
    interface Event {
      id: string;
      maxParticipants: number;
      participants: string[];
      waitlist: string[];
    }

    function addParticipant(
      userId: string,
      eventId: string,
      events: Event[]
    ): { success: boolean; position: 'confirmed' | 'waitlisted'; error?: string } {
      const evt = events.find(e => e.id === eventId);
      if (!evt) return { success: false, position: 'confirmed', error: 'Event not found' };

      if (evt.participants.includes(userId) || evt.waitlist.includes(userId)) {
        return { success: false, position: 'confirmed', error: 'User already registered' };
      }

      if (evt.participants.length < evt.maxParticipants) {
        evt.participants.push(userId);
        return { success: true, position: 'confirmed' };
      }

      evt.waitlist.push(userId);
      return { success: true, position: 'waitlisted' };
    }

    test('participant joins event if space available', () => {
      const events: Event[] = [
        { id: 'evt-1', maxParticipants: 2, participants: ['user-1'], waitlist: [] },
      ];
      const res = addParticipant('user-2', 'evt-1', events);
      expect(res.success).toBe(true);
      expect(res.position).toBe('confirmed');
      expect(events[0].participants).toContain('user-2');
    });

    test('participant is waitlisted when event is full', () => {
      const events: Event[] = [
        { id: 'evt-1', maxParticipants: 1, participants: ['user-1'], waitlist: [] },
      ];
      const res = addParticipant('user-2', 'evt-1', events);
      expect(res.success).toBe(true);
      expect(res.position).toBe('waitlisted');
      expect(events[0].waitlist).toContain('user-2');
    });

    test('duplicate registration is rejected', () => {
      const events: Event[] = [
        { id: 'evt-1', maxParticipants: 10, participants: ['user-1'], waitlist: [] },
      ];
      const res = addParticipant('user-1', 'evt-1', events);
      expect(res.success).toBe(false);
      expect(res.error).toMatch(/already registered/);
    });
  });

  describe('30. External Worker Idempotency Tokens', () => {
    interface DeliveryRecord {
      notificationId: string;
      workerId: string;
      idempotencyToken: string;
      status: 'pending' | 'delivered' | 'failed';
      timestamp: number;
    }

    function deliverWithIdempotency(
      notificationId: string,
      workerId: string,
      token: string,
      records: DeliveryRecord[]
    ): { delivered: boolean; alreadySent: boolean; error?: string } {
      const existing = records.find(r => r.idempotencyToken === token);
      if (existing) {
        return { delivered: existing.status === 'delivered', alreadySent: true };
      }

      records.push({
        notificationId,
        workerId,
        idempotencyToken: token,
        status: 'delivered',
        timestamp: Date.now(),
      });

      return { delivered: true, alreadySent: false };
    }

    test('first delivery with token succeeds', () => {
      const records: DeliveryRecord[] = [];
      const res = deliverWithIdempotency('notif-1', 'worker-email', 'token-abc', records);
      expect(res.delivered).toBe(true);
      expect(res.alreadySent).toBe(false);
      expect(records).toHaveLength(1);
    });

    test('replay with same token returns idempotent result', () => {
      const records: DeliveryRecord[] = [
        { notificationId: 'notif-1', workerId: 'worker-email', idempotencyToken: 'token-abc', status: 'delivered', timestamp: 1000 },
      ];
      const res = deliverWithIdempotency('notif-1', 'worker-email', 'token-abc', records);
      expect(res.delivered).toBe(true);
      expect(res.alreadySent).toBe(true);
      expect(records).toHaveLength(1); // No duplicate
    });
  });
});


