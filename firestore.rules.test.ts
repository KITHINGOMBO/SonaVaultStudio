/**
 * Phase 0 Payload-First Security TDD Test Suite for SonaVault Studio
 * Verifies all "Dirty Dozen" adversarial payloads are rejected by firestore.rules.
 */
export interface DirtyDozenCase {
  id: number;
  name: string;
  path: string;
  operation: 'get' | 'list' | 'create' | 'update' | 'delete';
  auth: { uid: string; email: string; email_verified: boolean } | null;
  payload?: Record<string, unknown>;
  expected: 'PERMISSION_DENIED';
}

export const DIRTY_DOZEN_PAYLOADS: DirtyDozenCase[] = [
  {
    id: 1,
    name: 'Identity Spoofing on Project Create',
    path: '/projects/proj_spoof_1',
    operation: 'create',
    auth: { uid: 'attacker_uid', email: 'attacker@example.com', email_verified: true },
    payload: { id: 'proj_spoof_1', ownerId: 'victim_uid', title: 'Hijacked Session' },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 2,
    name: 'Shadow Ghost Field Injection',
    path: '/projects/proj_ghost_1',
    operation: 'create',
    auth: { uid: 'attacker_uid', email: 'attacker@example.com', email_verified: true },
    payload: { id: 'proj_ghost_1', ownerId: 'attacker_uid', title: 'Test', isVerified: true },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 3,
    name: 'Unverified Email Bypass on Invite',
    path: '/invites/inv_1',
    operation: 'get',
    auth: { uid: 'attacker_uid', email: 'victim@example.com', email_verified: false },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 4,
    name: 'PII Scraping on /users',
    path: '/users/victim_uid',
    operation: 'get',
    auth: { uid: 'attacker_uid', email: 'attacker@example.com', email_verified: true },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 5,
    name: 'Orphaned Project Without Member Record',
    path: '/projects/proj_orphan_1',
    operation: 'create',
    auth: { uid: 'user_1', email: 'user1@example.com', email_verified: true },
    payload: { id: 'proj_orphan_1', ownerId: 'user_1', title: 'Orphan' },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 6,
    name: 'Self-Assigned Collaborator Escalation',
    path: '/projects/proj_victim/members/attacker_uid',
    operation: 'create',
    auth: { uid: 'attacker_uid', email: 'attacker@example.com', email_verified: true },
    payload: { projectId: 'proj_victim', userId: 'attacker_uid', role: 'editor' },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 7,
    name: 'Terminal Invite Replay',
    path: '/invites/inv_accepted',
    operation: 'update',
    auth: { uid: 'attacker_uid', email: 'attacker@example.com', email_verified: true },
    payload: { status: 'accepted' },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 8,
    name: 'Path Variable ID Poisoning',
    path: '/projects/' + 'a'.repeat(200),
    operation: 'create',
    auth: { uid: 'user_1', email: 'user1@example.com', email_verified: true },
    payload: { id: 'a'.repeat(200), ownerId: 'user_1' },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 9,
    name: 'Immutable OwnerId Mutation',
    path: '/projects/proj_1',
    operation: 'update',
    auth: { uid: 'editor_uid', email: 'editor@example.com', email_verified: true },
    payload: { ownerId: 'editor_uid' },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 10,
    name: 'Viewer Track Tampering',
    path: '/projects/proj_1/tracks/trk_1',
    operation: 'create',
    auth: { uid: 'viewer_uid', email: 'viewer@example.com', email_verified: true },
    payload: { id: 'trk_1', projectId: 'proj_1', authorId: 'viewer_uid', name: 'Unauthorized Vocal' },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 11,
    name: 'Client Timestamp Forgery',
    path: '/projects/proj_1/tracks/trk_2',
    operation: 'create',
    auth: { uid: 'owner_uid', email: 'owner@example.com', email_verified: true },
    payload: { id: 'trk_2', projectId: 'proj_1', createdAt: '2020-01-01T00:00:00Z' },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 12,
    name: 'Blanket List Query Scraping',
    path: '/projectMemberships',
    operation: 'list',
    auth: { uid: 'attacker_uid', email: 'attacker@example.com', email_verified: true },
    expected: 'PERMISSION_DENIED',
  },
];
