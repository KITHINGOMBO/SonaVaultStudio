export type StudioTab = 'studio' | 'mixer' | 'collaborate' | 'exports';

export type MemberRole = 'owner' | 'editor' | 'viewer';

export type ExportFormat = 'wav24' | 'wav16' | 'aiff24' | 'mp3_320' | 'mp3_192' | 'webm_opus';

export interface NoiseProfile {
  noiseFloorDb: number;
  peakDb: number;
  hum50HzRatio: number;
  hum60HzRatio: number;
  subRumbleRatio: number;
  vocalFormantEnergyRatio: number;
  sibilanceRatio: number;
  highpassHz: number;
  humNotchHz: number;
  denoiseStrength: number;
  deEssDb: number;
  vocalRetentionPct: number;
  detectedNoiseSources: string[];
  voicePreservationNotes: string;
  recommendedPresetName: string;
}

export interface MasterSettings {
  eqLowDb: number;
  eqMidDb: number;
  eqHighDb: number;
  eqAirDb: number;
  stereoWidth: number;
  compThresholdDb: number;
  compRatio: number;
  limiterCeilingDb: number;
  limiterDriveDb: number;
  targetLufs: number;
  presetName: string;
}

export interface StudioTrack {
  id: string;
  projectId: string;
  ownerId: string;
  authorId: string;
  authorName: string;
  name: string;
  instrument: string;
  color: string;
  durationSec: number;
  sampleRate: number;
  channels: number;
  startOffsetSec: number;
  trimStartSec: number;
  trimEndSec: number;
  volumeDb: number;
  pan: number;
  muted: boolean;
  solo: boolean;
  armed: boolean;
  aiDenoiseEnabled: boolean;
  aiDenoiseStrength: number;
  vocalPreserveMode: boolean;
  highpassHz: number;
  humNotchHz: number;
  deEssDb: number;
  eqLowDb: number;
  eqMidDb: number;
  eqHighDb: number;
  compThresholdDb: number;
  compRatio: number;
  reverbSend: number;
  delaySend: number;
  peaks: number[];
  rawBuffer: AudioBuffer | null;
  cleanedBuffer: AudioBuffer | null;
  aiNoiseProfile?: NoiseProfile;
  chunkCount: number;
  totalBytes: number;
  isSyncingAudio?: boolean;
  isDirtyAudio?: boolean;
}

export interface StudioProject {
  id: string;
  title: string;
  genre: string;
  bpm: number;
  timeSignature: string;
  musicalKey: string;
  ownerId: string;
  ownerName: string;
  masterSettings: MasterSettings;
  trackCount: number;
  trackIds: string[];
  isCloudBacked: boolean;
  role: MemberRole;
  updatedAtMs?: number;
}

export interface ProjectMembershipSummary {
  id: string;
  projectId: string;
  userId: string;
  ownerId: string;
  projectTitle: string;
  ownerName: string;
  role: MemberRole;
  updatedAtMs: number;
}

export interface ProjectMember {
  projectId: string;
  userId: string;
  ownerId: string;
  displayName: string;
  role: MemberRole;
  joinedAtMs: number;
}

export interface ProjectInvite {
  id: string;
  projectId: string;
  projectTitle: string;
  inviterId: string;
  inviterName: string;
  inviteeEmail: string;
  role: 'editor' | 'viewer';
  status: 'pending' | 'accepted' | 'revoked';
  createdAtMs: number;
}

export interface SessionComment {
  id: string;
  projectId: string;
  authorId: string;
  authorName: string;
  timecodeSec: number;
  text: string;
  createdAtMs: number;
}

export interface ExportHistoryItem {
  id: string;
  filename: string;
  format: ExportFormat;
  sampleRate: number;
  durationSec: number;
  fileSizeBytes: number;
  downloadUrl: string;
  createdAtMs: number;
}

export interface MixdownTelemetry {
  integratedLufs: number;
  shortTermPeakDb: number;
  crestFactorDb: number;
  lowEnergyRatio: number;
  lowMidEnergyRatio: number;
  presenceEnergyRatio: number;
  airEnergyRatio: number;
  hasVocals: boolean;
}
