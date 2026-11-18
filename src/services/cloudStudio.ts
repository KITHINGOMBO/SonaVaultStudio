import type { User } from 'firebase/auth';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
  writeBatch,
  type Unsubscribe,
} from 'firebase/firestore';
import { decodeChunksToAudioBuffer, encodeAudioBufferToChunks } from '../audio/audioCodec';
import { applyVocalPreservingDenoise } from '../audio/dspEngine';
import { db, handleFirestoreError, OperationType } from '../firebase';
import type {
  MasterSettings,
  MemberRole,
  ProjectInvite,
  ProjectMember,
  ProjectMembershipSummary,
  SessionComment,
  StudioProject,
  StudioTrack,
} from '../types/studio';

function makeSafeId(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 10);
  return `${prefix}_${Date.now().toString(36)}_${rand}`;
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function sanitizeMasterSettings(ms: MasterSettings): MasterSettings {
  return {
    eqLowDb: clamp(Number(ms.eqLowDb) || 0, -18, 18),
    eqMidDb: clamp(Number(ms.eqMidDb) || 0, -18, 18),
    eqHighDb: clamp(Number(ms.eqHighDb) || 0, -18, 18),
    eqAirDb: clamp(Number(ms.eqAirDb) || 0, -18, 18),
    stereoWidth: clamp(Number(ms.stereoWidth) || 1, 0, 2),
    compThresholdDb: clamp(Number(ms.compThresholdDb) || -14, -60, 0),
    compRatio: clamp(Number(ms.compRatio) || 2.5, 1, 20),
    limiterCeilingDb: clamp(Number(ms.limiterCeilingDb) || -0.8, -6, 0),
    limiterDriveDb: clamp(Number(ms.limiterDriveDb) || 2.0, 0, 18),
    targetLufs: clamp(Number(ms.targetLufs) || -14, -24, -6),
    presetName: (ms.presetName || 'Balanced Master').slice(0, 60),
  };
}

function toMillis(val: unknown): number {
  if (val instanceof Timestamp) return val.toMillis();
  if (typeof val === 'number') return val;
  return Date.now();
}

export async function ensureUserProfile(user: User): Promise<void> {
  const path = `users/${user.uid}`;
  try {
    const ref = doc(db, 'users', user.uid);
    const snap = await getDoc(ref);
    const displayName = (user.displayName || user.email?.split('@')[0] || 'Musician').slice(0, 100);
    const email = (user.email || '').toLowerCase().slice(0, 256);
    const photoURL = (user.photoURL || '').slice(0, 512);

    if (!snap.exists()) {
      await setDoc(ref, {
        uid: user.uid,
        email,
        displayName,
        ...(photoURL ? { photoURL } : {}),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      await updateDoc(ref, {
        email,
        displayName,
        ...(photoURL ? { photoURL } : {}),
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export function subscribeToUserMemberships(
  uid: string,
  onData: (items: ProjectMembershipSummary[]) => void
): Unsubscribe {
  const path = 'projectMemberships';
  const q = query(collection(db, path), where('userId', '==', uid));
  return onSnapshot(
    q,
    (snap) => {
      const list: ProjectMembershipSummary[] = snap.docs.map((d) => {
        const data = d.data();
        return {
          id: d.id,
          projectId: String(data.projectId),
          userId: String(data.userId),
          ownerId: String(data.ownerId),
          projectTitle: String(data.projectTitle),
          ownerName: String(data.ownerName),
          role: (data.role as MemberRole) || 'viewer',
          updatedAtMs: toMillis(data.updatedAt),
        };
      });
      list.sort((a, b) => b.updatedAtMs - a.updatedAtMs);
      onData(list);
    },
    (error) => handleFirestoreError(error, OperationType.LIST, path)
  );
}

export function subscribeToProjectInvites(
  email: string,
  onData: (invites: ProjectInvite[]) => void
): Unsubscribe {
  const path = 'invites';
  const q = query(collection(db, path), where('inviteeEmail', '==', email.toLowerCase()));
  return onSnapshot(
    q,
    (snap) => {
      const list: ProjectInvite[] = snap.docs.map((d) => {
        const data = d.data();
        return {
          id: d.id,
          projectId: String(data.projectId),
          projectTitle: String(data.projectTitle),
          inviterId: String(data.inviterId),
          inviterName: String(data.inviterName),
          inviteeEmail: String(data.inviteeEmail),
          role: (data.role as 'editor' | 'viewer') || 'editor',
          status: (data.status as 'pending' | 'accepted' | 'revoked') || 'pending',
          createdAtMs: toMillis(data.createdAt),
        };
      });
      list.sort((a, b) => b.createdAtMs - a.createdAtMs);
      onData(list);
    },
    (error) => handleFirestoreError(error, OperationType.LIST, path)
  );
}

export function subscribeToSentInvites(
  uid: string,
  projectId: string,
  onData: (invites: ProjectInvite[]) => void
): Unsubscribe {
  const path = 'invites';
  const q = query(
    collection(db, path),
    where('inviterId', '==', uid),
    where('projectId', '==', projectId)
  );
  return onSnapshot(
    q,
    (snap) => {
      const list: ProjectInvite[] = snap.docs.map((d) => {
        const data = d.data();
        return {
          id: d.id,
          projectId: String(data.projectId),
          projectTitle: String(data.projectTitle),
          inviterId: String(data.inviterId),
          inviterName: String(data.inviterName),
          inviteeEmail: String(data.inviteeEmail),
          role: (data.role as 'editor' | 'viewer') || 'editor',
          status: (data.status as 'pending' | 'accepted' | 'revoked') || 'pending',
          createdAtMs: toMillis(data.createdAt),
        };
      });
      list.sort((a, b) => b.createdAtMs - a.createdAtMs);
      onData(list);
    },
    (error) => handleFirestoreError(error, OperationType.LIST, path)
  );
}

export function subscribeToProjectMembers(
  ownerUid: string,
  projectId: string,
  onData: (members: ProjectMember[]) => void
): Unsubscribe {
  const path = `projects/${projectId}/members`;
  const q = query(collection(db, 'projects', projectId, 'members'), where('ownerId', '==', ownerUid));
  return onSnapshot(
    q,
    (snap) => {
      const list: ProjectMember[] = snap.docs.map((d) => {
        const data = d.data();
        return {
          projectId: String(data.projectId),
          userId: String(data.userId),
          ownerId: String(data.ownerId),
          displayName: String(data.displayName),
          role: (data.role as MemberRole) || 'viewer',
          joinedAtMs: toMillis(data.joinedAt),
        };
      });
      onData(list);
    },
    (error) => handleFirestoreError(error, OperationType.LIST, path)
  );
}

export function subscribeToProjectComments(
  uid: string,
  projectId: string,
  onData: (comments: SessionComment[]) => void
): Unsubscribe {
  const path = `projects/${projectId}/comments`;
  const q = query(
    collection(db, 'projects', projectId, 'comments'),
    where('memberUids', 'array-contains', uid)
  );
  return onSnapshot(
    q,
    (snap) => {
      const list: SessionComment[] = snap.docs.map((d) => {
        const data = d.data();
        return {
          id: d.id,
          projectId: String(data.projectId),
          authorId: String(data.authorId),
          authorName: String(data.authorName),
          timecodeSec: Number(data.timecodeSec || 0),
          text: String(data.text || ''),
          createdAtMs: toMillis(data.createdAt),
        };
      });
      list.sort((a, b) => a.timecodeSec - b.timecodeSec);
      onData(list);
    },
    (error) => handleFirestoreError(error, OperationType.LIST, path)
  );
}

async function uploadTrackToCloud(
  user: User,
  projectId: string,
  ownerId: string,
  memberUids: string[],
  track: StudioTrack
): Promise<StudioTrack> {
  const trackPath = `projects/${projectId}/tracks/${track.id}`;
  const safeMembers = Array.from(new Set([ownerId, user.uid, ...memberUids])).slice(0, 16);
  const trackRef = doc(db, 'projects', projectId, 'tracks', track.id);

  let chunkCount = track.chunkCount;
  let totalBytes = track.totalBytes;

  if (track.isDirtyAudio || track.chunkCount === 0) {
    const audioToStore = track.rawBuffer ?? track.cleanedBuffer;
    if (audioToStore) {
      const encoded = await encodeAudioBufferToChunks(audioToStore);
      chunkCount = encoded.chunks.length;
      totalBytes = encoded.totalBytes;

      // Upload chunks in sequential/small batches
      for (const chunk of encoded.chunks) {
        const chunkId = `chunk_${chunk.index}`;
        const chunkPath = `${trackPath}/chunks/${chunkId}`;
        try {
          await setDoc(doc(db, 'projects', projectId, 'tracks', track.id, 'chunks', chunkId), {
            projectId,
            trackId: track.id,
            authorId: user.uid,
            memberUids: safeMembers,
            index: chunk.index,
            encoding: chunk.encoding,
            data: chunk.data,
            byteLength: chunk.byteLength,
            createdAt: serverTimestamp(),
          });
        } catch (err) {
          handleFirestoreError(err, OperationType.CREATE, chunkPath);
        }
      }
    }
  }

  const safePeaks = (track.peaks.length > 0 ? track.peaks : [0.01]).slice(0, 240);
  const existingSnap = await getDoc(trackRef).catch(() => null);

  const trackDocPayload = {
    id: track.id,
    projectId,
    ownerId,
    authorId: existingSnap?.exists() ? String(existingSnap.data().authorId) : user.uid,
    authorName: existingSnap?.exists()
      ? String(existingSnap.data().authorName)
      : (user.displayName || user.email?.split('@')[0] || 'Musician').slice(0, 100),
    name: (track.name || 'Track').slice(0, 80),
    instrument: (track.instrument || 'Audio').slice(0, 40),
    color: (track.color || '#E59A3C').slice(0, 16),
    durationSec: clamp(track.durationSec, 0, 1800),
    sampleRate: clamp(track.sampleRate || 48000, 8000, 192000),
    channels: clamp(track.channels || 1, 1, 2),
    startOffsetSec: clamp(track.startOffsetSec, 0, 1800),
    trimStartSec: clamp(track.trimStartSec, 0, 1800),
    trimEndSec: clamp(track.trimEndSec, 0, 1800),
    volumeDb: clamp(track.volumeDb, -60, 12),
    pan: clamp(track.pan, -1, 1),
    muted: Boolean(track.muted),
    solo: Boolean(track.solo),
    aiDenoiseEnabled: Boolean(track.aiDenoiseEnabled),
    aiDenoiseStrength: clamp(track.aiDenoiseStrength, 0, 1),
    vocalPreserveMode: Boolean(track.vocalPreserveMode),
    eqLowDb: clamp(track.eqLowDb, -18, 18),
    eqMidDb: clamp(track.eqMidDb, -18, 18),
    eqHighDb: clamp(track.eqHighDb, -18, 18),
    compThresholdDb: clamp(track.compThresholdDb, -60, 0),
    compRatio: clamp(track.compRatio, 1, 20),
    reverbSend: clamp(track.reverbSend, 0, 1),
    delaySend: clamp(track.delaySend, 0, 1),
    chunkCount: clamp(chunkCount, 0, 200),
    totalBytes: clamp(totalBytes, 0, 60000000),
    peaks: safePeaks,
    memberUids: safeMembers,
    ...(track.aiNoiseProfile
      ? {
          aiNoiseProfile: {
            highpassHz: track.highpassHz,
            humNotchHz: track.humNotchHz,
            deEssDb: track.deEssDb,
            vocalRetentionPct: track.aiNoiseProfile.vocalRetentionPct,
            recommendedPresetName: track.aiNoiseProfile.recommendedPresetName.slice(0, 60),
          },
        }
      : {}),
  };

  try {
    if (!existingSnap || !existingSnap.exists()) {
      await setDoc(trackRef, {
        ...trackDocPayload,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      await updateDoc(trackRef, {
        name: trackDocPayload.name,
        instrument: trackDocPayload.instrument,
        color: trackDocPayload.color,
        startOffsetSec: trackDocPayload.startOffsetSec,
        trimStartSec: trackDocPayload.trimStartSec,
        trimEndSec: trackDocPayload.trimEndSec,
        volumeDb: trackDocPayload.volumeDb,
        pan: trackDocPayload.pan,
        muted: trackDocPayload.muted,
        solo: trackDocPayload.solo,
        aiDenoiseEnabled: trackDocPayload.aiDenoiseEnabled,
        aiDenoiseStrength: trackDocPayload.aiDenoiseStrength,
        vocalPreserveMode: trackDocPayload.vocalPreserveMode,
        eqLowDb: trackDocPayload.eqLowDb,
        eqMidDb: trackDocPayload.eqMidDb,
        eqHighDb: trackDocPayload.eqHighDb,
        compThresholdDb: trackDocPayload.compThresholdDb,
        compRatio: trackDocPayload.compRatio,
        reverbSend: trackDocPayload.reverbSend,
        delaySend: trackDocPayload.delaySend,
        memberUids: trackDocPayload.memberUids,
        ...(trackDocPayload.aiNoiseProfile ? { aiNoiseProfile: trackDocPayload.aiNoiseProfile } : {}),
        updatedAt: serverTimestamp(),
      });
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, trackPath);
  }

  return {
    ...track,
    projectId,
    ownerId,
    chunkCount,
    totalBytes,
    isDirtyAudio: false,
  };
}

export async function saveSessionToCloud(
  user: User,
  project: StudioProject,
  tracks: StudioTrack[],
  memberUids: string[]
): Promise<{ project: StudioProject; tracks: StudioTrack[] }> {
  await ensureUserProfile(user);

  const isNewCloud = !project.isCloudBacked;
  const projectId = isNewCloud ? makeSafeId('proj') : project.id;
  const ownerId = isNewCloud ? user.uid : project.ownerId;
  const ownerName = isNewCloud
    ? (user.displayName || user.email?.split('@')[0] || 'Producer').slice(0, 100)
    : project.ownerName;

  const normalizedTrackIds = tracks.slice(0, 64).map((t) => {
    const valid = /^[a-zA-Z0-9_-]+$/.test(t.id);
    return valid ? t.id : makeSafeId('trk');
  });

  const remappedTracks = tracks.map((t, i) => ({
    ...t,
    id: normalizedTrackIds[i],
    projectId,
    ownerId,
  }));

  const safeMaster = sanitizeMasterSettings(project.masterSettings);
  const projectPath = `projects/${projectId}`;

  if (isNewCloud) {
    try {
      const batch = writeBatch(db);
      const projRef = doc(db, 'projects', projectId);
      const memberRef = doc(db, 'projects', projectId, 'members', user.uid);
      const membershipId = `${projectId}_${user.uid}`;
      const membershipRef = doc(db, 'projectMemberships', membershipId);

      batch.set(projRef, {
        id: projectId,
        title: (project.title || 'Untitled Session').slice(0, 100),
        genre: (project.genre || 'Contemporary').slice(0, 40),
        bpm: clamp(project.bpm, 40, 240),
        timeSignature: (project.timeSignature || '4/4').slice(0, 10),
        musicalKey: (project.musicalKey || 'C Minor').slice(0, 24),
        ownerId,
        ownerName,
        masterSettings: safeMaster,
        trackCount: remappedTracks.length,
        trackIds: normalizedTrackIds,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      batch.set(memberRef, {
        projectId,
        userId: user.uid,
        ownerId,
        displayName: ownerName,
        role: 'owner',
        joinedAt: serverTimestamp(),
      });

      batch.set(membershipRef, {
        id: membershipId,
        projectId,
        userId: user.uid,
        ownerId,
        projectTitle: (project.title || 'Untitled Session').slice(0, 100),
        ownerName,
        role: 'owner',
        updatedAt: serverTimestamp(),
      });

      await batch.commit();
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, projectPath);
    }
  } else {
    try {
      const updatePayload: Record<string, unknown> = {
        bpm: clamp(project.bpm, 40, 240),
        timeSignature: (project.timeSignature || '4/4').slice(0, 10),
        musicalKey: (project.musicalKey || 'C Minor').slice(0, 24),
        masterSettings: safeMaster,
        trackCount: remappedTracks.length,
        trackIds: normalizedTrackIds,
        updatedAt: serverTimestamp(),
      };
      if (ownerId === user.uid) {
        updatePayload.title = (project.title || 'Untitled Session').slice(0, 100);
        updatePayload.genre = (project.genre || 'Contemporary').slice(0, 40);
      }
      await updateDoc(doc(db, 'projects', projectId), updatePayload);
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, projectPath);
    }
  }

  const uploadedTracks: StudioTrack[] = [];
  for (const t of remappedTracks) {
    const saved = await uploadTrackToCloud(user, projectId, ownerId, memberUids, t);
    uploadedTracks.push(saved);
  }

  return {
    project: {
      ...project,
      id: projectId,
      ownerId,
      ownerName,
      masterSettings: safeMaster,
      trackCount: uploadedTracks.length,
      trackIds: normalizedTrackIds,
      isCloudBacked: true,
      role: isNewCloud ? 'owner' : project.role,
    },
    tracks: uploadedTracks,
  };
}

export async function loadCloudProject(
  projectId: string,
  user: User,
  ctx: BaseAudioContext
): Promise<{ project: StudioProject; tracks: StudioTrack[] }> {
  const projectPath = `projects/${projectId}`;
  let projSnap;
  try {
    projSnap = await getDoc(doc(db, 'projects', projectId));
  } catch (err) {
    handleFirestoreError(err, OperationType.GET, projectPath);
  }

  if (!projSnap.exists()) {
    throw new Error('Cloud project no longer exists.');
  }

  const pData = projSnap.data();

  let role: MemberRole = pData.ownerId === user.uid ? 'owner' : 'viewer';
  try {
    const mSnap = await getDoc(doc(db, 'projects', projectId, 'members', user.uid));
    if (mSnap.exists()) {
      role = (mSnap.data().role as MemberRole) || role;
    }
  } catch {
    // Keep inferred role
  }

  const trackIds: string[] = Array.isArray(pData.trackIds) ? pData.trackIds.map(String) : [];
  const loadedTracks: StudioTrack[] = [];

  for (const tid of trackIds) {
    const tPath = `projects/${projectId}/tracks/${tid}`;
    try {
      const tSnap = await getDoc(doc(db, 'projects', projectId, 'tracks', tid));
      if (!tSnap.exists()) continue;
      const td = tSnap.data();

      const chunkCount = Number(td.chunkCount || 0);
      let rawBuffer: AudioBuffer | null = null;
      let cleanedBuffer: AudioBuffer | null = null;

      if (chunkCount > 0) {
        const chunkPromises = [];
        for (let i = 0; i < chunkCount; i++) {
          chunkPromises.push(
            getDoc(doc(db, 'projects', projectId, 'tracks', tid, 'chunks', `chunk_${i}`))
          );
        }
        const chunkSnaps = await Promise.all(chunkPromises);
        const chunks = chunkSnaps
          .filter((s) => s.exists())
          .map((s) => {
            const cd = s.data();
            return {
              index: Number(cd.index),
              encoding: String(cd.encoding),
              data: String(cd.data),
            };
          });

        if (chunks.length > 0) {
          rawBuffer = await decodeChunksToAudioBuffer(
            chunks,
            Number(td.sampleRate || 48000),
            Number(td.channels || 1),
            ctx
          );
        }
      }

      const hpHz = Number(td.aiNoiseProfile?.highpassHz ?? 80);
      const notchHz = Number(td.aiNoiseProfile?.humNotchHz ?? 0);
      const deEssDb = Number(td.aiNoiseProfile?.deEssDb ?? 2);
      const denoiseStrength = Number(td.aiDenoiseStrength ?? 0.45);
      const vocalPreserveMode = Boolean(td.vocalPreserveMode ?? true);

      let vocalRetentionPct = Number(td.aiNoiseProfile?.vocalRetentionPct ?? 98.5);
      if (rawBuffer && Boolean(td.aiDenoiseEnabled)) {
        const res = await applyVocalPreservingDenoise(rawBuffer, {
          highpassHz: hpHz,
          humNotchHz: notchHz,
          denoiseStrength,
          vocalPreserveMode,
          deEssDb,
        });
        cleanedBuffer = res.cleanedBuffer;
        vocalRetentionPct = res.vocalRetentionPct;
      }

      loadedTracks.push({
        id: tid,
        projectId,
        ownerId: String(td.ownerId),
        authorId: String(td.authorId),
        authorName: String(td.authorName),
        name: String(td.name),
        instrument: String(td.instrument),
        color: String(td.color),
        durationSec: Number(td.durationSec || 0),
        sampleRate: Number(td.sampleRate || 48000),
        channels: Number(td.channels || 1),
        startOffsetSec: Number(td.startOffsetSec || 0),
        trimStartSec: Number(td.trimStartSec || 0),
        trimEndSec: Number(td.trimEndSec || 0),
        volumeDb: Number(td.volumeDb ?? 0),
        pan: Number(td.pan ?? 0),
        muted: Boolean(td.muted),
        solo: Boolean(td.solo),
        armed: false,
        aiDenoiseEnabled: Boolean(td.aiDenoiseEnabled),
        aiDenoiseStrength: denoiseStrength,
        vocalPreserveMode,
        highpassHz: hpHz,
        humNotchHz: notchHz,
        deEssDb,
        eqLowDb: Number(td.eqLowDb ?? 0),
        eqMidDb: Number(td.eqMidDb ?? 0),
        eqHighDb: Number(td.eqHighDb ?? 0),
        compThresholdDb: Number(td.compThresholdDb ?? -18),
        compRatio: Number(td.compRatio ?? 2.5),
        reverbSend: Number(td.reverbSend ?? 0.15),
        delaySend: Number(td.delaySend ?? 0),
        peaks: Array.isArray(td.peaks) ? td.peaks.map(Number) : [0.01],
        rawBuffer,
        cleanedBuffer,
        chunkCount,
        totalBytes: Number(td.totalBytes || 0),
        isDirtyAudio: false,
        aiNoiseProfile: td.aiNoiseProfile
          ? {
              noiseFloorDb: -54,
              peakDb: -6,
              hum50HzRatio: 0,
              hum60HzRatio: 0,
              subRumbleRatio: 0,
              vocalFormantEnergyRatio: 0.5,
              sibilanceRatio: 0.05,
              highpassHz: hpHz,
              humNotchHz: notchHz,
              denoiseStrength,
              deEssDb,
              vocalRetentionPct,
              detectedNoiseSources: ['Cloud-synced denoise profile'],
              voicePreservationNotes: 'Formant protection calibrated on cloud save.',
              recommendedPresetName: String(td.aiNoiseProfile.recommendedPresetName || 'Vocal Clean'),
            }
          : undefined,
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.GET, tPath);
    }
  }

  return {
    project: {
      id: projectId,
      title: String(pData.title),
      genre: String(pData.genre),
      bpm: Number(pData.bpm || 110),
      timeSignature: String(pData.timeSignature || '4/4'),
      musicalKey: String(pData.musicalKey || 'C Minor'),
      ownerId: String(pData.ownerId),
      ownerName: String(pData.ownerName),
      masterSettings: sanitizeMasterSettings(pData.masterSettings as MasterSettings),
      trackCount: loadedTracks.length,
      trackIds,
      isCloudBacked: true,
      role,
      updatedAtMs: toMillis(pData.updatedAt),
    },
    tracks: loadedTracks,
  };
}

export async function sendProjectInvite(
  user: User,
  project: StudioProject,
  inviteeEmail: string,
  role: 'editor' | 'viewer'
): Promise<void> {
  const inviteId = makeSafeId('inv');
  const path = `invites/${inviteId}`;
  try {
    await setDoc(doc(db, 'invites', inviteId), {
      id: inviteId,
      projectId: project.id,
      projectTitle: project.title.slice(0, 100),
      inviterId: user.uid,
      inviterName: (user.displayName || user.email?.split('@')[0] || 'Producer').slice(0, 100),
      inviteeEmail: inviteeEmail.trim().toLowerCase().slice(0, 256),
      role,
      status: 'pending',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, path);
  }
}

export async function acceptProjectInvite(user: User, invite: ProjectInvite): Promise<void> {
  await ensureUserProfile(user);
  const path = `invites/${invite.id}`;
  const membershipId = `${invite.projectId}_${user.uid}`;
  try {
    const batch = writeBatch(db);

    batch.set(doc(db, 'projects', invite.projectId, 'members', user.uid), {
      projectId: invite.projectId,
      userId: user.uid,
      ownerId: invite.inviterId,
      displayName: (user.displayName || user.email?.split('@')[0] || 'Collaborator').slice(0, 100),
      role: invite.role,
      inviteId: invite.id,
      joinedAt: serverTimestamp(),
    });

    batch.set(doc(db, 'projectMemberships', membershipId), {
      id: membershipId,
      projectId: invite.projectId,
      userId: user.uid,
      ownerId: invite.inviterId,
      projectTitle: invite.projectTitle.slice(0, 100),
      ownerName: invite.inviterName.slice(0, 100),
      role: invite.role,
      inviteId: invite.id,
      updatedAt: serverTimestamp(),
    });

    batch.update(doc(db, 'invites', invite.id), {
      status: 'accepted',
      updatedAt: serverTimestamp(),
    });

    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, path);
  }
}

export async function revokeInvite(inviteId: string): Promise<void> {
  const path = `invites/${inviteId}`;
  try {
    await updateDoc(doc(db, 'invites', inviteId), {
      status: 'revoked',
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

export async function updateMemberRole(
  projectId: string,
  memberUid: string,
  role: 'editor' | 'viewer'
): Promise<void> {
  const path = `projects/${projectId}/members/${memberUid}`;
  try {
    await updateDoc(doc(db, 'projects', projectId, 'members', memberUid), {
      role,
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

export async function removeProjectMember(projectId: string, memberUid: string): Promise<void> {
  const path = `projects/${projectId}/members/${memberUid}`;
  try {
    await deleteDoc(doc(db, 'projects', projectId, 'members', memberUid));
    await deleteDoc(doc(db, 'projectMemberships', `${projectId}_${memberUid}`)).catch(() => undefined);
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, path);
  }
}

export async function postSessionComment(
  user: User,
  project: StudioProject,
  memberUids: string[],
  timecodeSec: number,
  text: string
): Promise<void> {
  const commentId = makeSafeId('cmt');
  const path = `projects/${project.id}/comments/${commentId}`;
  const safeMembers = Array.from(new Set([project.ownerId, user.uid, ...memberUids])).slice(0, 16);
  try {
    await setDoc(doc(db, 'projects', project.id, 'comments', commentId), {
      id: commentId,
      projectId: project.id,
      authorId: user.uid,
      authorName: (user.displayName || user.email?.split('@')[0] || 'Musician').slice(0, 100),
      memberUids: safeMembers,
      timecodeSec: clamp(timecodeSec, 0, 3600),
      text: text.trim().slice(0, 500),
      createdAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, path);
  }
}
