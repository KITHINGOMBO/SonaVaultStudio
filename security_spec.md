# SonaVault Studio Security Specification (Phase 0 TDD)

## 1. Data Invariants

1. **Identity & PII Isolation (`/users/{userId}`)**: A user profile document containing `email` may only be read (`get`), created, or updated by the authenticated verified user whose `request.auth.uid == userId`. Listing `/users` is strictly denied.
2. **Project Ownership & Master Gate (`/projects/{projectId}`)**: A project can only be created when `ownerId == request.auth.uid`, `createdAt == request.time`, and `updatedAt == request.time`, and atomically creates the owner's `/projects/{projectId}/members/{uid}` and `/projectMemberships/{projectId}_{uid}` records in the same batch (`existsAfter`).
3. **Synchronous Membership Revocation**: Access to `/projects/{projectId}/tracks/{trackId}`, `/chunks/{chunkId}`, and `/comments/{commentId}` is gated via `get()` on `/projects/{projectId}/members/{request.auth.uid}`. Removing a member immediately revokes all sub-resource access.
4. **Tiered Role Permissions**:
   - `owner`: Full project settings, member management, track CRUD, comment CRUD.
   - `editor`: Update project mix/mastering settings, create/update/delete tracks & chunks, post/delete own comments. Cannot alter `ownerId` or delete the project.
   - `viewer`: Read-only access to project, tracks, chunks, and comments; may post comments on sessions they belong to.
5. **Temporal & Immutable Integrity**: `createdAt`, `ownerId`, `authorId`, and `projectId` are strictly immutable on update. `createdAt == request.time` on create; `updatedAt == request.time` on update.
6. **Zero Trust List Queries**: Every `allow list` rule evaluates `resource.data` against `request.auth.uid` or `request.auth.token.email` (with `email_verified == true`) and never uses `get()` or `exists()`.
7. **Invite Verification**: Collaborators cannot self-assign themselves to a project unless they present a valid `inviteId` referencing an active `pending` invite matching their verified email (`request.auth.token.email_verified == true && invite.inviteeEmail == request.auth.token.email`).

## 2. The "Dirty Dozen" Adversarial Payloads

1. **Identity Spoofing on Project Create**: Creating `/projects/p1` with `ownerId: "victim_uid"` while signed in as `"attacker_uid"` -> `PERMISSION_DENIED`.
2. **Shadow / Ghost Field Injection**: Creating `/projects/p1` with all valid fields plus `"isFeatured": true` -> `PERMISSION_DENIED` (`hasOnly` check).
3. **Unverified Email Bypass**: Reading or accepting `/invites/inv1` when `request.auth.token.email_verified == false` -> `PERMISSION_DENIED`.
4. **PII Scraping on `/users`**: Calling `list` on `/users` or `get` on `/users/victim_uid` as `"attacker_uid"` -> `PERMISSION_DENIED`.
5. **Orphaned Project Without Owner Member Doc**: Creating `/projects/p1` without an atomic batch write creating `/projects/p1/members/attacker_uid` -> `PERMISSION_DENIED` (`existsAfter` check).
6. **Self-Assigned Collaborator Escalation**: Creating `/projects/p1/members/attacker_uid` with `role: "editor"` without a valid pending invite -> `PERMISSION_DENIED`.
7. **Terminal Invite Replay**: Attempting to accept `/invites/inv1` when `status` is already `"accepted"` or `"revoked"` -> `PERMISSION_DENIED`.
8. **ID Poisoning**: Creating `/projects/../../../evil` or a 500-char ID -> `PERMISSION_DENIED` (`isValidId`).
9. **Immutable Field Mutation**: Updating `/projects/p1` to change `ownerId` or `createdAt` -> `PERMISSION_DENIED`.
10. **Viewer Track Tampering**: A user with `role: "viewer"` attempting to create or update `/projects/p1/tracks/t1` -> `PERMISSION_DENIED`.
11. **Timestamp Forgery**: Creating a track with backdated `createdAt` not equal to `request.time` -> `PERMISSION_DENIED`.
12. **Blanket List Query Scraping**: Querying `/projectMemberships` without filtering `userId == request.auth.uid` -> `PERMISSION_DENIED`.
