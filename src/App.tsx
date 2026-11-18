import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { User } from 'firebase/auth';
import { onAuthStateChanged, signInWithPopup, signOut } from 'firebase/auth';
import {
  Cloud,
  Disc,
  LogIn,
  LogOut,
  Pause,
  Play,
  Repeat,
  RotateCcw,
  SkipBack,
  Undo2,
} from 'lucide-react';
import {
  applyVocalPreservingDenoise,
  computePeaks,
  estimateNoiseSpectrum,
  extractAcousticTelemetry,
  analyzeMixdownTelemetry,
} from './audio/dspEngine';
import {
  computeProjectDurationSec,
  encodeBufferByFormat,
  encodeToWav,
  renderMasterOffline,
  renderSingleTrackStem,
} from './audio/exportEngine';
import { studioEngine } from './audio/liveEngine';
import { CollaborateView } from './components/CollaborateView';
import { ExportsView } from './components/ExportsView';
import { MixerMasteringView } from './components/MixerMasteringView';
import { TimelineEditor } from './components/TimelineEditor';
import { VocalDenoisePanel } from './components/VocalDenoisePanel';
import { auth, googleProvider } from './firebase';
import {
  analyzeTrackNoiseWithAI,
  generateMasteringPresetWithAI,
} from './services/aiAudioService';
import {
  acceptProjectInvite,
  ensureUserProfile,
  loadCloudProject,
  postSessionComment,
  removeProjectMember,
  revokeInvite,
  saveSessionToCloud,
  sendProjectInvite,
  subscribeToProjectComments,
  subscribeToProjectInvites,
  subscribeToProjectMembers,
  subscribeToSentInvites,
  subscribeToUserMemberships,
  updateMemberRole,
} from './services/cloudStudio';
import type {
  ExportFormat,
  ExportHistoryItem,
  MasterSettings,
  ProjectInvite,
  ProjectMember,
  ProjectMembershipSummary,
  SessionComment,
  StudioProject,
  StudioTab,
  StudioTrack,
} from './types/studio';

const TRACK_COLORS = ['#E59A3C', '#38BDF8', '#34D399', '#A78BFA', '#F472B6', '#FB7185'];

const DEFAULT_MASTER: MasterSettings = {
  eqLowDb: 0.5,
  eqMidDb: 0,
  eqHighDb: 0.5,
  eqAirDb: 1.0,
  stereoWidth: 1.05,
  compThresholdDb: -16,
  compRatio: 2.5,
  limiterCeilingDb: -0.8,
  limiterDriveDb: 2.0,
  targetLufs: -14,
  presetName: 'Natural Vocal Master',
};

function createEmptyTrack(index: number, projectId: string, ownerId: string, authorName: string): StudioTrack {
  const id = `trk_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
  const defaults = [
    { name: 'Lead Vocal', instrument: 'Lead Vocal', color: TRACK_COLORS[0] },
    { name: 'Acoustic / Backing', instrument: 'Acoustic Guitar', color: TRACK_COLORS[1] },
    { name: 'Harmony Vocal', instrument: 'Harmony Vocal', color: TRACK_COLORS[2] },
    { name: 'Percussion / Bass', instrument: 'Rhythm', color: TRACK_COLORS[3] },
  ];
  const d = defaults[index % defaults.length];
  return {
    id,
    projectId,
    ownerId,
    authorId: ownerId,
    authorName,
    name: index >= defaults.length ? `Track ${index + 1}` : d.name,
    instrument: d.instrument,
    color: TRACK_COLORS[index % TRACK_COLORS.length],
    durationSec: 0,
    sampleRate: 48000,
    channels: 1,
    startOffsetSec: 0,
    trimStartSec: 0,
    trimEndSec: 0,
    volumeDb: 0,
    pan: 0,
    muted: false,
    solo: false,
    armed: index === 0,
    aiDenoiseEnabled: true,
    aiDenoiseStrength: 0.45,
    vocalPreserveMode: true,
    highpassHz: 80,
    humNotchHz: 0,
    deEssDb: 1.5,
    eqLowDb: 0,
    eqMidDb: 0,
    eqHighDb: 0,
    compThresholdDb: -18,
    compRatio: 2.5,
    reverbSend: index === 0 ? 0.14 : 0.08,
    delaySend: 0,
    peaks: [0.01],
    rawBuffer: null,
    cleanedBuffer: null,
    chunkCount: 0,
    totalBytes: 0,
    isDirtyAudio: false,
  };
}

function createInitialProject(uid = 'local_artist', name = 'Studio Artist'): StudioProject {
  const id = `local_${Date.now().toString(36)}`;
  return {
    id,
    title: 'Untitled Session',
    genre: 'Indie / Acoustic',
    bpm: 112,
    timeSignature: '4/4',
    musicalKey: 'C Minor',
    ownerId: uid,
    ownerName: name,
    masterSettings: { ...DEFAULT_MASTER },
    trackCount: 2,
    trackIds: [],
    isCloudBacked: false,
    role: 'owner',
  };
}

function formatTimeDisplay(sec: number, bpm: number, timeSignature: string): string {
  const mins = Math.floor(sec / 60);
  const secs = (sec % 60).toFixed(2).padStart(5, '0');
  const beatsPerBar = Math.max(2, parseInt(timeSignature.split('/')[0] || '4', 10));
  const totalBeats = sec * (Math.max(40, bpm) / 60);
  const bar = Math.floor(totalBeats / beatsPerBar) + 1;
  const beat = Math.floor(totalBeats % beatsPerBar) + 1;
  return `${String(mins).padStart(2, '0')}:${secs} · Bar ${bar}.${beat}`;
}

export default function App() {
  const [activeTab, setActiveTab] = useState<StudioTab>('studio');
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);

  const [project, setProject] = useState<StudioProject>(() => createInitialProject());
  const [tracks, setTracks] = useState<StudioTrack[]>(() => [
    createEmptyTrack(0, 'local', 'local_artist', 'Studio Artist'),
    createEmptyTrack(1, 'local', 'local_artist', 'Studio Artist'),
  ]);
  const [selectedTrackId, setSelectedTrackId] = useState<string | null>(() => null);
  const [armedTrackId, setArmedTrackId] = useState<string | null>(() => null);
  const [undoStack, setUndoStack] = useState<StudioTrack[][]>([]);

  // Transport state
  const [isPlaying, setIsPlaying] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [playheadSec, setPlayheadSec] = useState(0);
  const [loopEnabled, setLoopEnabled] = useState(false);
  const [loopStartSec, setLoopStartSec] = useState(0);
  const [loopEndSec, setLoopEndSec] = useState(16);
  const [metronomeEnabled, setMetronomeEnabled] = useState(false);
  const [bypassMaster, setBypassMaster] = useState(false);

  // Mic & AI Denoise state
  const [micDevices, setMicDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState('');
  const [micArmed, setMicArmed] = useState(false);
  const [micMonitor, setMicMonitor] = useState(false);
  const [micInputGain, setMicInputGain] = useState(1.0);
  const [micInputLevel, setMicInputLevel] = useState({ peakDb: -60, normalized: 0 });
  const [liveRecordingPeaks, setLiveRecordingPeaks] = useState<number[]>([]);
  const [recordingStartSec, setRecordingStartSec] = useState(0);
  const [isCapturingNoisePrint, setIsCapturingNoisePrint] = useState(false);
  const [noisePrintSpectrum, setNoisePrintSpectrum] = useState<Float32Array | undefined>(undefined);
  const [isAnalyzingAI, setIsAnalyzingAI] = useState(false);
  const [isDenoising, setIsDenoising] = useState(false);
  const [aiNoiseError, setAiNoiseError] = useState<string | null>(null);

  // Mastering AI state
  const [isGeneratingMasterAI, setIsGeneratingMasterAI] = useState(false);
  const [aiMasterNotes, setAiMasterNotes] = useState<{ summary: string; vocalAdvice: string } | null>(null);
  const [aiMasterError, setAiMasterError] = useState<string | null>(null);

  // Cloud Collaboration state
  const [memberships, setMemberships] = useState<ProjectMembershipSummary[]>([]);
  const [members, setMembers] = useState<ProjectMember[]>([]);
  const [incomingInvites, setIncomingInvites] = useState<ProjectInvite[]>([]);
  const [sentInvites, setSentInvites] = useState<ProjectInvite[]>([]);
  const [comments, setComments] = useState<SessionComment[]>([]);
  const [isSavingCloud, setIsSavingCloud] = useState(false);
  const [isLoadingCloud, setIsLoadingCloud] = useState(false);
  const [cloudError, setCloudError] = useState<string | null>(null);
  const [statusBanner, setStatusBanner] = useState<string | null>(null);

  // Exports state
  const [exportHistory, setExportHistory] = useState<ExportHistoryItem[]>([]);
  const [isExporting, setIsExporting] = useState(false);
  const [exportProgressText, setExportProgressText] = useState('');

  // Initialize default track selection
  useEffect(() => {
    if (tracks.length > 0 && !selectedTrackId) {
      setSelectedTrackId(tracks[0].id);
      setArmedTrackId(tracks[0].id);
    }
  }, [tracks, selectedTrackId]);

  // Auth listener
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setAuthReady(true);
      if (u) {
        ensureUserProfile(u).catch((e) => setCloudError(e instanceof Error ? e.message : String(e)));
      }
    });
    return () => unsub();
  }, []);

  // Cloud subscriptions when authenticated
  useEffect(() => {
    if (!authReady || !user) {
      setMemberships([]);
      setIncomingInvites([]);
      return;
    }
    const unsubM = subscribeToUserMemberships(user.uid, setMemberships);
    const unsubInv = user.email
      ? subscribeToProjectInvites(user.email, setIncomingInvites)
      : () => undefined;
    return () => {
      unsubM();
      unsubInv();
    };
  }, [authReady, user]);

  useEffect(() => {
    if (!authReady || !user || !project.isCloudBacked) {
      setMembers([]);
      setSentInvites([]);
      setComments([]);
      return;
    }
    const unsubComments = subscribeToProjectComments(user.uid, project.id, setComments);
    let unsubMembers: () => void = () => {};
    let unsubSent: () => void = () => {};
    if (project.ownerId === user.uid) {
      unsubMembers = subscribeToProjectMembers(user.uid, project.id, setMembers);
      unsubSent = subscribeToSentInvites(user.uid, project.id, setSentInvites);
    }
    return () => {
      unsubComments();
      unsubMembers();
      unsubSent();
    };
  }, [authReady, user, project.isCloudBacked, project.id, project.ownerId]);

  // Live playback / recording clock loop
  const tracksRef = useRef(tracks);
  tracksRef.current = tracks;
  const projectRef = useRef(project);
  projectRef.current = project;

  useEffect(() => {
    if (!isPlaying && !isRecording && !micArmed) return;

    let rafId = 0;
    const tick = () => {
      if (micArmed) {
        setMicInputLevel(studioEngine.getMicInputLevel());
      }
      if (isRecording) {
        setLiveRecordingPeaks(studioEngine.getLiveRecordingPeaks(64));
      }
      if (isPlaying) {
        const pos = studioEngine.getCurrentPlayheadSec();
        if (loopEnabled && loopEndSec > loopStartSec && pos >= loopEndSec && !isRecording) {
          studioEngine.startPlayback(tracksRef.current, projectRef.current.masterSettings, loopStartSec, {
            bpm: projectRef.current.bpm,
            timeSignature: projectRef.current.timeSignature,
            metronomeEnabled,
            bypassMaster,
          });
          setPlayheadSec(loopStartSec);
        } else {
          const maxEnd = computeProjectDurationSec(tracksRef.current);
          if (!isRecording && pos >= maxEnd + 0.8 && tracksRef.current.some((t) => t.rawBuffer)) {
            studioEngine.stopPlayback();
            setIsPlaying(false);
            setPlayheadSec(0);
          } else {
            setPlayheadSec(pos);
          }
        }
      }
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [isPlaying, isRecording, micArmed, loopEnabled, loopStartSec, loopEndSec, metronomeEnabled, bypassMaster]);

  // Live sync track & master parameters during playback
  useEffect(() => {
    if (isPlaying) {
      studioEngine.updateLiveTracks(tracks);
    }
  }, [tracks, isPlaying]);

  useEffect(() => {
    studioEngine.updateMasterSettings(project.masterSettings, bypassMaster, project.bpm);
  }, [project.masterSettings, bypassMaster, project.bpm]);

  const canEdit = project.role !== 'viewer';
  const selectedTrack = useMemo(
    () => tracks.find((t) => t.id === selectedTrackId) ?? null,
    [tracks, selectedTrackId]
  );

  const pushUndo = useCallback((snapshot: StudioTrack[]) => {
    setUndoStack((prev) => [...prev.slice(-14), snapshot]);
  }, []);

  const handleUndo = () => {
    if (undoStack.length === 0) return;
    const prev = undoStack[undoStack.length - 1];
    setUndoStack((s) => s.slice(0, -1));
    setTracks(prev);
  };

  // --- Transport Handlers ---
  const handleTogglePlay = () => {
    if (isRecording) return;
    if (isPlaying) {
      studioEngine.stopPlayback();
      setIsPlaying(false);
    } else {
      studioEngine.startPlayback(tracks, project.masterSettings, playheadSec, {
        bpm: project.bpm,
        timeSignature: project.timeSignature,
        metronomeEnabled,
        bypassMaster,
      });
      setIsPlaying(true);
    }
  };

  const handleSeek = (sec: number) => {
    const clamped = Math.max(0, sec);
    setPlayheadSec(clamped);
    if (isPlaying && !isRecording) {
      studioEngine.startPlayback(tracks, project.masterSettings, clamped, {
        bpm: project.bpm,
        timeSignature: project.timeSignature,
        metronomeEnabled,
        bypassMaster,
      });
    }
  };

  // --- Mic & Recording ---
  const handleToggleArmMic = async () => {
    if (micArmed) {
      studioEngine.disarmMicrophone();
      setMicArmed(false);
      return;
    }
    try {
      await studioEngine.armMicrophone(selectedDeviceId || undefined, micMonitor, micInputGain);
      const devices = await studioEngine.listInputDevices();
      setMicDevices(devices);
      if (!selectedDeviceId && devices[0]?.deviceId) {
        setSelectedDeviceId(devices[0].deviceId);
      }
      setMicArmed(true);
      setAiNoiseError(null);
    } catch (err) {
      setAiNoiseError(
        err instanceof Error ? err.message : 'Microphone access denied. Check browser permissions.'
      );
    }
  };

  const handleSelectDevice = async (deviceId: string) => {
    setSelectedDeviceId(deviceId);
    if (micArmed) {
      await studioEngine.armMicrophone(deviceId, micMonitor, micInputGain);
    }
  };

  const handleCaptureNoisePrint = async () => {
    if (!micArmed || isRecording) return;
    setIsCapturingNoisePrint(true);
    studioEngine.beginMicCapture();
    setTimeout(() => {
      const buf = studioEngine.endMicCapture();
      setIsCapturingNoisePrint(false);
      if (buf && buf.length >= 2048) {
        const spec = estimateNoiseSpectrum(buf.getChannelData(0), buf.sampleRate);
        setNoisePrintSpectrum(spec);
        setStatusBanner('Room noise print captured. Ready to apply surgical vocal-preserving denoise.');
      }
    }, 1500);
  };

  const handleToggleRecord = async () => {
    if (!canEdit) return;

    if (!isRecording) {
      if (!micArmed) {
        await handleToggleArmMic();
      }
      const targetId = armedTrackId || tracks[0]?.id;
      if (!targetId) return;

      // Play existing non-armed tracks for overdubbing
      const overdubTracks = tracks.filter((t) => t.id !== targetId);
      setRecordingStartSec(playheadSec);
      setLiveRecordingPeaks([]);
      studioEngine.beginMicCapture();
      studioEngine.startPlayback(overdubTracks, project.masterSettings, playheadSec, {
        bpm: project.bpm,
        timeSignature: project.timeSignature,
        metronomeEnabled,
        bypassMaster,
      });
      setIsPlaying(true);
      setIsRecording(true);
    } else {
      studioEngine.stopPlayback();
      setIsPlaying(false);
      setIsRecording(false);
      const rawBuffer = studioEngine.endMicCapture();
      const targetId = armedTrackId || tracks[0]?.id;
      if (!rawBuffer || !targetId) return;

      const targetTrack = tracks.find((t) => t.id === targetId);
      if (!targetTrack) return;

      pushUndo(tracks);
      setIsDenoising(true);
      try {
        const { cleanedBuffer, vocalRetentionPct } = await applyVocalPreservingDenoise(
          rawBuffer,
          {
            highpassHz: targetTrack.highpassHz,
            humNotchHz: targetTrack.humNotchHz,
            denoiseStrength: targetTrack.aiDenoiseStrength,
            vocalPreserveMode: targetTrack.vocalPreserveMode,
            deEssDb: targetTrack.deEssDb,
          },
          noisePrintSpectrum
        );

        const peaks = computePeaks(cleanedBuffer, 180);
        const telemetry = extractAcousticTelemetry(rawBuffer);

        setTracks((prev) =>
          prev.map((t) =>
            t.id === targetId
              ? {
                  ...t,
                  rawBuffer,
                  cleanedBuffer,
                  durationSec: rawBuffer.duration,
                  sampleRate: rawBuffer.sampleRate,
                  channels: rawBuffer.numberOfChannels,
                  startOffsetSec: recordingStartSec,
                  trimStartSec: 0,
                  trimEndSec: rawBuffer.duration,
                  peaks,
                  isDirtyAudio: true,
                  aiNoiseProfile: {
                    ...telemetry,
                    highpassHz: t.highpassHz,
                    humNotchHz: t.humNotchHz,
                    denoiseStrength: t.aiDenoiseStrength,
                    deEssDb: t.deEssDb,
                    vocalRetentionPct,
                    detectedNoiseSources: ['Room floor & low-end rumble'],
                    voicePreservationNotes:
                      'Formant protection active across 180 Hz – 4.2 kHz to retain natural vocal timbre.',
                    recommendedPresetName: 'Studio Vocal Clean',
                  },
                }
              : t
          )
        );
        setSelectedTrackId(targetId);
      } finally {
        setIsDenoising(false);
      }
    }
  };

  // --- Track Management ---
  const handleAddTrack = (instrument = 'Vocal') => {
    if (!canEdit) return;
    pushUndo(tracks);
    const authorName = user?.displayName || project.ownerName;
    const newTrack = createEmptyTrack(tracks.length, project.id, user?.uid || project.ownerId, authorName);
    newTrack.instrument = instrument;
    setTracks((prev) => [...prev, newTrack]);
    setSelectedTrackId(newTrack.id);
    setArmedTrackId(newTrack.id);
  };

  const handleImportFiles = async (files: FileList) => {
    if (!canEdit) return;
    const ctx = studioEngine.getContext();
    pushUndo(tracks);
    const newTracks: StudioTrack[] = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      try {
        const arr = await file.arrayBuffer();
        const decoded = await ctx.decodeAudioData(arr);
        const base = createEmptyTrack(
          tracks.length + i,
          project.id,
          user?.uid || project.ownerId,
          user?.displayName || project.ownerName
        );
        const cleanName = file.name.replace(/\.[^/.]+$/, '').slice(0, 60);
        const { cleanedBuffer, vocalRetentionPct } = await applyVocalPreservingDenoise(decoded, {
          highpassHz: 70,
          humNotchHz: 0,
          denoiseStrength: 0.35,
          vocalPreserveMode: true,
          deEssDb: 1.0,
        });
        const telemetry = extractAcousticTelemetry(decoded);

        newTracks.push({
          ...base,
          name: cleanName || base.name,
          instrument: 'Imported Stem',
          rawBuffer: decoded,
          cleanedBuffer,
          durationSec: decoded.duration,
          sampleRate: decoded.sampleRate,
          channels: decoded.numberOfChannels,
          trimStartSec: 0,
          trimEndSec: decoded.duration,
          aiDenoiseEnabled: false, // Default imported finished tracks to Raw until user toggles AI Clean
          aiDenoiseStrength: 0.35,
          peaks: computePeaks(decoded, 180),
          isDirtyAudio: true,
          aiNoiseProfile: {
            ...telemetry,
            highpassHz: 70,
            humNotchHz: 0,
            denoiseStrength: 0.35,
            deEssDb: 1.0,
            vocalRetentionPct,
            detectedNoiseSources: ['Imported stem baseline'],
            voicePreservationNotes: 'Ready for optional AI cleanup or direct mixing.',
            recommendedPresetName: 'Gentle Stem Clean',
          },
        });
      } catch (err) {
        setAiNoiseError(`Could not decode "${file.name}": ${err instanceof Error ? err.message : 'Unsupported format'}`);
      }
    }

    if (newTracks.length > 0) {
      setTracks((prev) => [...prev, ...newTracks]);
      setSelectedTrackId(newTracks[0].id);
    }
  };

  const handleUpdateTrack = (id: string, patch: Partial<StudioTrack>) => {
    setTracks((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  };

  const handleDeleteTrack = (id: string) => {
    if (!canEdit) return;
    pushUndo(tracks);
    setTracks((prev) => prev.filter((t) => t.id !== id));
    if (selectedTrackId === id) setSelectedTrackId(null);
    if (armedTrackId === id) setArmedTrackId(null);
  };

  const handleDuplicateTrack = (id: string) => {
    if (!canEdit) return;
    const src = tracks.find((t) => t.id === id);
    if (!src) return;
    pushUndo(tracks);
    const clone: StudioTrack = {
      ...src,
      id: `trk_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      name: `${src.name} (Copy)`.slice(0, 75),
      startOffsetSec: src.startOffsetSec + 0.5,
      isDirtyAudio: Boolean(src.rawBuffer),
    };
    setTracks((prev) => [...prev, clone]);
    setSelectedTrackId(clone.id);
  };

  const handleSplitTrackAtPlayhead = (id: string) => {
    if (!canEdit) return;
    const t = tracks.find((tr) => tr.id === id);
    if (!t || !t.rawBuffer) return;
    const clipEnd = t.startOffsetSec + (t.trimEndSec - t.trimStartSec);
    if (playheadSec <= t.startOffsetSec + 0.1 || playheadSec >= clipEnd - 0.1) {
      setStatusBanner('Move the playhead inside the selected clip to split it.');
      return;
    }

    pushUndo(tracks);
    const splitLocal = t.trimStartSec + (playheadSec - t.startOffsetSec);
    const leftClip: StudioTrack = {
      ...t,
      trimEndSec: Number(splitLocal.toFixed(3)),
    };
    const rightClip: StudioTrack = {
      ...t,
      id: `trk_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      name: `${t.name} Pt.2`.slice(0, 75),
      startOffsetSec: Number(playheadSec.toFixed(3)),
      trimStartSec: Number(splitLocal.toFixed(3)),
      isDirtyAudio: true,
    };

    setTracks((prev) => prev.flatMap((tr) => (tr.id === id ? [leftClip, rightClip] : [tr])));
    setSelectedTrackId(rightClip.id);
  };

  // --- AI Noise Removal & Re-filtering ---
  const denoiseDebounceRef = useRef<number | null>(null);

  const reprocessTrackDenoise = useCallback(
    async (trackId: string, override?: Partial<StudioTrack>) => {
      const target = tracksRef.current.find((t) => t.id === trackId);
      if (!target || !target.rawBuffer) return;
      const merged = { ...target, ...override };
      setIsDenoising(true);
      try {
        const { cleanedBuffer, vocalRetentionPct } = await applyVocalPreservingDenoise(
          target.rawBuffer,
          {
            highpassHz: merged.highpassHz,
            humNotchHz: merged.humNotchHz,
            denoiseStrength: merged.aiDenoiseStrength,
            vocalPreserveMode: merged.vocalPreserveMode,
            deEssDb: merged.deEssDb,
          },
          noisePrintSpectrum
        );

        const peaks = computePeaks(merged.aiDenoiseEnabled ? cleanedBuffer : target.rawBuffer, 180);
        setTracks((prev) =>
          prev.map((t) =>
            t.id === trackId
              ? {
                  ...t,
                  cleanedBuffer,
                  peaks,
                  aiNoiseProfile: t.aiNoiseProfile
                    ? { ...t.aiNoiseProfile, vocalRetentionPct }
                    : undefined,
                }
              : t
          )
        );
      } finally {
        setIsDenoising(false);
      }
    },
    [noisePrintSpectrum]
  );

  const handleToggleDenoise = async (trackId: string, enabled: boolean) => {
    const t = tracks.find((tr) => tr.id === trackId);
    if (!t) return;
    if (enabled && t.rawBuffer && !t.cleanedBuffer) {
      handleUpdateTrack(trackId, { aiDenoiseEnabled: true });
      await reprocessTrackDenoise(trackId, { aiDenoiseEnabled: true });
    } else {
      const activeBuf = enabled ? t.cleanedBuffer ?? t.rawBuffer : t.rawBuffer;
      handleUpdateTrack(trackId, {
        aiDenoiseEnabled: enabled,
        peaks: activeBuf ? computePeaks(activeBuf, 180) : t.peaks,
      });
    }
  };

  const handleUpdateDenoiseParam = (
    trackId: string,
    patch: Partial<
      Pick<StudioTrack, 'aiDenoiseStrength' | 'highpassHz' | 'humNotchHz' | 'deEssDb' | 'vocalPreserveMode'>
    >
  ) => {
    handleUpdateTrack(trackId, { ...patch, aiDenoiseEnabled: true });
    if (denoiseDebounceRef.current) clearTimeout(denoiseDebounceRef.current);
    denoiseDebounceRef.current = window.setTimeout(() => {
      reprocessTrackDenoise(trackId, { ...patch, aiDenoiseEnabled: true });
    }, 220);
  };

  const handleRunAiNoiseScan = async (trackId: string) => {
    const t = tracks.find((tr) => tr.id === trackId);
    if (!t || !t.rawBuffer) return;

    setIsAnalyzingAI(true);
    setAiNoiseError(null);
    try {
      const telemetry = extractAcousticTelemetry(t.rawBuffer);
      const aiResult = await analyzeTrackNoiseWithAI({
        trackName: t.name,
        instrument: t.instrument,
        durationSec: t.rawBuffer.duration,
        sampleRate: t.rawBuffer.sampleRate,
        telemetry,
      });

      const { cleanedBuffer, vocalRetentionPct } = await applyVocalPreservingDenoise(
        t.rawBuffer,
        {
          highpassHz: aiResult.highpassHz,
          humNotchHz: aiResult.humNotchHz,
          denoiseStrength: aiResult.denoiseStrength,
          vocalPreserveMode: aiResult.vocalPreserveMode,
          deEssDb: aiResult.deEssDb,
        },
        noisePrintSpectrum
      );

      setTracks((prev) =>
        prev.map((tr) =>
          tr.id === trackId
            ? {
                ...tr,
                aiDenoiseEnabled: true,
                highpassHz: aiResult.highpassHz,
                humNotchHz: aiResult.humNotchHz,
                aiDenoiseStrength: aiResult.denoiseStrength,
                vocalPreserveMode: aiResult.vocalPreserveMode,
                deEssDb: aiResult.deEssDb,
                cleanedBuffer,
                peaks: computePeaks(cleanedBuffer, 180),
                aiNoiseProfile: {
                  ...telemetry,
                  highpassHz: aiResult.highpassHz,
                  humNotchHz: aiResult.humNotchHz,
                  denoiseStrength: aiResult.denoiseStrength,
                  deEssDb: aiResult.deEssDb,
                  vocalRetentionPct,
                  detectedNoiseSources: aiResult.detectedNoiseSources,
                  voicePreservationNotes: aiResult.voicePreservationNotes,
                  recommendedPresetName: aiResult.recommendedPresetName,
                },
              }
            : tr
        )
      );
    } catch (err) {
      setAiNoiseError(err instanceof Error ? err.message : 'AI Noise Scan failed.');
    } finally {
      setIsAnalyzingAI(false);
    }
  };

  // --- AI Mastering Calibration ---
  const handleRunAiMaster = async () => {
    setIsGeneratingMasterAI(true);
    setAiMasterError(null);
    try {
      const preMaster = await renderMasterOffline(tracks, project.masterSettings, {
        sampleRate: 48000,
        includeMasterChain: false,
        normalizeToTargetLufs: false,
        bpm: project.bpm,
      });
      const hasVocals = tracks.some((t) => /vocal|voice|sing/i.test(`${t.name} ${t.instrument}`));
      const telemetry = analyzeMixdownTelemetry(preMaster, hasVocals);

      const preset = await generateMasteringPresetWithAI({
        projectTitle: project.title,
        genre: project.genre,
        targetLufs: project.masterSettings.targetLufs,
        telemetry,
      });

      setProject((p) => ({
        ...p,
        masterSettings: {
          eqLowDb: preset.eqLowDb,
          eqMidDb: preset.eqMidDb,
          eqHighDb: preset.eqHighDb,
          eqAirDb: preset.eqAirDb,
          stereoWidth: preset.stereoWidth,
          compThresholdDb: preset.compThresholdDb,
          compRatio: preset.compRatio,
          limiterCeilingDb: preset.limiterCeilingDb,
          limiterDriveDb: preset.limiterDriveDb,
          targetLufs: project.masterSettings.targetLufs,
          presetName: preset.presetName,
        },
      }));
      setAiMasterNotes({
        summary: preset.engineerSummary,
        vocalAdvice: preset.vocalClarityAdvice,
      });
    } catch (err) {
      setAiMasterError(err instanceof Error ? err.message : 'AI Master calibration failed.');
    } finally {
      setIsGeneratingMasterAI(false);
    }
  };

  // --- Cloud Auth & Sync Handlers ---
  const handleSignIn = async () => {
    setCloudError(null);
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err) {
      setCloudError(err instanceof Error ? err.message : 'Google Sign-In failed.');
    }
  };

  const handleSignOut = async () => {
    await signOut(auth);
  };

  const handleSaveToCloud = async () => {
    if (!user) {
      setActiveTab('collaborate');
      return;
    }
    setIsSavingCloud(true);
    setCloudError(null);
    try {
      const memberUids = members.map((m) => m.userId);
      const result = await saveSessionToCloud(user, project, tracks, memberUids);
      setProject(result.project);
      setTracks(result.tracks);
      setStatusBanner(`Synced "${result.project.title}" and ${result.tracks.length} track(s) to Cloud Vault.`);
    } catch (err) {
      setCloudError(err instanceof Error ? err.message : 'Failed to save session to cloud.');
    } finally {
      setIsSavingCloud(false);
    }
  };

  const handleOpenCloudProject = async (projectId: string) => {
    if (!user) return;
    studioEngine.stopPlayback();
    setIsPlaying(false);
    setIsLoadingCloud(true);
    setCloudError(null);
    try {
      const ctx = studioEngine.getContext();
      const loaded = await loadCloudProject(projectId, user, ctx);
      setProject(loaded.project);
      setTracks(loaded.tracks);
      setSelectedTrackId(loaded.tracks[0]?.id ?? null);
      setArmedTrackId(loaded.tracks[0]?.id ?? null);
      setPlayheadSec(0);
      setUndoStack([]);
      setActiveTab('studio');
      setStatusBanner(`Loaded "${loaded.project.title}" from Cloud Vault.`);
    } catch (err) {
      setCloudError(err instanceof Error ? err.message : 'Failed to load cloud project.');
    } finally {
      setIsLoadingCloud(false);
    }
  };

  const handleNewLocalSession = () => {
    studioEngine.stopPlayback();
    setIsPlaying(false);
    const uid = user?.uid || 'local_artist';
    const name = user?.displayName || 'Studio Artist';
    const freshProj = createInitialProject(uid, name);
    const freshTracks = [
      createEmptyTrack(0, freshProj.id, uid, name),
      createEmptyTrack(1, freshProj.id, uid, name),
    ];
    setProject(freshProj);
    setTracks(freshTracks);
    setSelectedTrackId(freshTracks[0].id);
    setArmedTrackId(freshTracks[0].id);
    setPlayheadSec(0);
    setUndoStack([]);
    setActiveTab('studio');
  };

  // --- Exports ---
  const handleExportMaster = async (options: {
    filename: string;
    format: ExportFormat;
    sampleRate: number;
    includeMasterChain: boolean;
    normalizeToTargetLufs: boolean;
  }) => {
    setIsExporting(true);
    setExportProgressText('Rendering multi-track mixdown & mastering chain...');
    try {
      const rendered = await renderMasterOffline(tracks, project.masterSettings, {
        sampleRate: options.sampleRate,
        includeMasterChain: options.includeMasterChain,
        normalizeToTargetLufs: options.normalizeToTargetLufs,
        bpm: project.bpm,
      });

      setExportProgressText(`Encoding ${options.format.toUpperCase()}...`);
      const { blob, ext } = await encodeBufferByFormat(rendered, options.format);
      const fullFilename = `${options.filename}.${ext}`;
      const url = URL.createObjectURL(blob);

      const a = document.createElement('a');
      a.href = url;
      a.download = fullFilename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);

      setExportHistory((prev) => [
        {
          id: `exp_${Date.now().toString(36)}`,
          filename: fullFilename,
          format: options.format,
          sampleRate: options.sampleRate,
          durationSec: rendered.duration,
          fileSizeBytes: blob.size,
          downloadUrl: url,
          createdAtMs: Date.now(),
        },
        ...prev,
      ]);
      setExportProgressText('');
    } catch (err) {
      setStatusBanner(err instanceof Error ? err.message : 'Export failed.');
    } finally {
      setIsExporting(false);
    }
  };

  const handleExportStem = async (trackId: string, sampleRate: number) => {
    const track = tracks.find((t) => t.id === trackId);
    if (!track) return;
    setIsExporting(true);
    setExportProgressText(`Rendering 24-bit WAV stem for ${track.name}...`);
    try {
      const stemBuf = await renderSingleTrackStem(track, sampleRate);
      const blob = encodeToWav(stemBuf, 24);
      const cleanSlug = track.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      const fullFilename = `${cleanSlug}-stem-24bit.wav`;
      const url = URL.createObjectURL(blob);

      const a = document.createElement('a');
      a.href = url;
      a.download = fullFilename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);

      setExportHistory((prev) => [
        {
          id: `stem_${Date.now().toString(36)}`,
          filename: fullFilename,
          format: 'wav24',
          sampleRate,
          durationSec: stemBuf.duration,
          fileSizeBytes: blob.size,
          downloadUrl: url,
          createdAtMs: Date.now(),
        },
        ...prev,
      ]);
    } finally {
      setIsExporting(false);
      setExportProgressText('');
    }
  };

  const pendingInviteCount = incomingInvites.filter((i) => i.status === 'pending').length;

  return (
    <div className="min-h-screen bg-[#0E1116] text-slate-100 flex flex-col">
      {/* Top Bar Contract: 3 zones separated by gap-8 */}
      <header className="border-b border-[#2A3241] bg-[#12161D] px-6 h-14 flex items-center justify-between gap-8 shrink-0">
        {/* Zone 1: Single text element wordmark */}
        <span className="font-display text-lg font-bold tracking-tight text-slate-100 whitespace-nowrap shrink-0">
          SonaVault
        </span>

        {/* Zone 2: 4 clean single-line navigation links */}
        <nav className="flex items-center gap-6 overflow-x-auto">
          {(
            [
              { id: 'studio', label: 'Studio' },
              { id: 'mixer', label: 'Mixer & Master' },
              {
                id: 'collaborate',
                label: pendingInviteCount > 0 ? `Collaborate (${pendingInviteCount})` : 'Collaborate',
              },
              { id: 'exports', label: 'Exports' },
            ] as const
          ).map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setActiveTab(item.id)}
              className={`py-4 text-sm font-medium border-b-2 transition-colors whitespace-nowrap shrink-0 ${
                activeTab === item.id
                  ? 'border-[#E59A3C] text-slate-100'
                  : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              {item.label}
            </button>
          ))}
        </nav>

        {/* Zone 3: 1 Primary Action */}
        <div className="shrink-0">
          {user ? (
            <button
              type="button"
              onClick={handleSignOut}
              className="inline-flex items-center gap-2 px-3.5 py-1.5 text-xs font-medium bg-[#1B212B] text-slate-200 border border-[#2A3241] rounded-md hover:border-slate-500 transition-colors whitespace-nowrap shrink-0"
            >
              <LogOut className="w-3.5 h-3.5" />
              {user.displayName?.split(' ')[0] || 'Account'} · Sign Out
            </button>
          ) : (
            <button
              type="button"
              onClick={handleSignIn}
              className="inline-flex items-center gap-2 px-4 py-1.5 text-xs font-semibold bg-[#E59A3C] text-[#0E1116] rounded-md hover:bg-amber-400 transition-colors whitespace-nowrap shrink-0"
            >
              <LogIn className="w-3.5 h-3.5" />
              Sign In
            </button>
          )}
        </div>
      </header>

      {/* Workspace Transport & Session Toolbar */}
      <div className="border-b border-[#2A3241] bg-[#161B22] px-6 py-2.5 flex flex-wrap items-center justify-between gap-4">
        {/* Session Info */}
        <div className="flex flex-wrap items-center gap-3 min-w-0">
          <input
            type="text"
            value={project.title}
            disabled={!canEdit}
            onChange={(e) => setProject((p) => ({ ...p, title: e.target.value }))}
            className="bg-transparent font-display text-base font-semibold text-slate-100 border-b border-transparent hover:border-[#2A3241] focus:border-[#E59A3C] focus:outline-none px-1 py-0.5 max-w-[210px]"
            aria-label="Project title"
          />

          <div className="flex items-center gap-2 text-xs text-slate-400">
            <label className="flex items-center gap-1">
              <span>BPM</span>
              <input
                type="number"
                min={40}
                max={240}
                disabled={!canEdit}
                value={project.bpm}
                onChange={(e) => setProject((p) => ({ ...p, bpm: Number(e.target.value) || 110 }))}
                className="w-14 bg-[#0E1116] border border-[#2A3241] rounded px-1.5 py-1 font-mono-tabular text-xs text-slate-200"
              />
            </label>

            <select
              disabled={!canEdit}
              value={project.timeSignature}
              onChange={(e) => setProject((p) => ({ ...p, timeSignature: e.target.value }))}
              className="bg-[#0E1116] border border-[#2A3241] rounded px-2 py-1 font-mono-tabular text-xs text-slate-200"
              aria-label="Time Signature"
            >
              <option value="4/4">4/4</option>
              <option value="3/4">3/4</option>
              <option value="6/8">6/8</option>
            </select>

            <select
              disabled={!canEdit}
              value={project.genre}
              onChange={(e) => setProject((p) => ({ ...p, genre: e.target.value }))}
              className="bg-[#0E1116] border border-[#2A3241] rounded px-2 py-1 text-xs text-slate-200"
              aria-label="Project Genre"
            >
              <option value="Indie / Acoustic">Indie / Acoustic</option>
              <option value="Pop / Vocal">Pop / Vocal</option>
              <option value="Hip-Hop / R&B">Hip-Hop / R&amp;B</option>
              <option value="Rock / Band">Rock / Band</option>
              <option value="Electronic">Electronic</option>
              <option value="Jazz / Classical">Jazz / Classical</option>
            </select>
          </div>
        </div>

        {/* Center Transport Controls */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={isRecording}
            onClick={() => handleSeek(0)}
            title="Return to start"
            className="w-9 h-9 rounded-md bg-[#0E1116] border border-[#2A3241] flex items-center justify-center text-slate-300 hover:text-white disabled:opacity-40"
          >
            <SkipBack className="w-4 h-4" />
          </button>

          <button
            type="button"
            disabled={isRecording}
            onClick={handleTogglePlay}
            className={`inline-flex items-center gap-1.5 px-4 h-9 rounded-md text-xs font-semibold transition-colors whitespace-nowrap ${
              isPlaying && !isRecording
                ? 'bg-emerald-600 text-white'
                : 'bg-[#1B212B] text-slate-100 border border-[#2A3241] hover:border-slate-500'
            }`}
          >
            {isPlaying && !isRecording ? (
              <>
                <Pause className="w-4 h-4" />
                Stop
              </>
            ) : (
              <>
                <Play className="w-4 h-4" />
                Play
              </>
            )}
          </button>

          <button
            type="button"
            disabled={!canEdit}
            onClick={handleToggleRecord}
            className={`inline-flex items-center gap-1.5 px-4 h-9 rounded-md text-xs font-semibold transition-colors whitespace-nowrap ${
              isRecording
                ? 'bg-red-600 text-white'
                : 'bg-red-950/60 text-red-200 border border-red-700/60 hover:bg-red-900/70'
            }`}
          >
            <Disc className={`w-4 h-4 ${isRecording ? 'animate-spin' : ''}`} />
            {isRecording ? 'Stop Recording' : 'Record Mic'}
          </button>

          <button
            type="button"
            onClick={() => setLoopEnabled((v) => !v)}
            title="Toggle loop region"
            className={`w-9 h-9 rounded-md border flex items-center justify-center transition-colors ${
              loopEnabled
                ? 'bg-amber-500/15 border-amber-500/50 text-amber-300'
                : 'bg-[#0E1116] border-[#2A3241] text-slate-400 hover:text-slate-200'
            }`}
          >
            <Repeat className="w-4 h-4" />
          </button>

          <button
            type="button"
            onClick={() => setMetronomeEnabled((v) => !v)}
            className={`px-2.5 h-9 rounded-md border text-xs font-medium transition-colors whitespace-nowrap ${
              metronomeEnabled
                ? 'bg-amber-500/15 border-amber-500/50 text-amber-300'
                : 'bg-[#0E1116] border-[#2A3241] text-slate-400 hover:text-slate-200'
            }`}
          >
            Click {metronomeEnabled ? 'On' : 'Off'}
          </button>

          {undoStack.length > 0 && (
            <button
              type="button"
              onClick={handleUndo}
              title="Undo last timeline edit"
              className="w-9 h-9 rounded-md bg-[#0E1116] border border-[#2A3241] flex items-center justify-center text-slate-300 hover:text-white"
            >
              <Undo2 className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Right: Timecode & Cloud Sync */}
        <div className="flex items-center gap-3 shrink-0">
          <div className="px-3 py-1.5 bg-[#0E1116] border border-[#2A3241] rounded-md font-mono-tabular text-xs text-amber-300">
            {formatTimeDisplay(playheadSec, project.bpm, project.timeSignature)}
          </div>

          <button
            type="button"
            disabled={isSavingCloud || !canEdit}
            onClick={handleSaveToCloud}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-[#1B212B] text-slate-200 border border-[#2A3241] rounded-md hover:border-[#E59A3C] disabled:opacity-40 transition-colors whitespace-nowrap"
          >
            <Cloud className="w-3.5 h-3.5 text-[#E59A3C]" />
            {isSavingCloud
              ? 'Syncing...'
              : project.isCloudBacked
              ? 'Sync Cloud'
              : 'Save to Cloud'}
          </button>
        </div>
      </div>

      {/* Dismissible Action Feedback */}
      {statusBanner && (
        <div className="bg-[#121821] border-b border-[#2A3241] px-6 py-2 flex items-center justify-between text-xs text-slate-300">
          <span>{statusBanner}</span>
          <button
            type="button"
            onClick={() => setStatusBanner(null)}
            className="text-slate-400 hover:text-white inline-flex items-center gap-1"
          >
            <RotateCcw className="w-3 h-3" />
            Dismiss
          </button>
        </div>
      )}

      {/* Main Viewport Content */}
      <main className="flex-1 max-w-[1440px] w-full mx-auto p-5 space-y-5">
        {activeTab === 'studio' && (
          <>
            <TimelineEditor
              tracks={tracks}
              selectedTrackId={selectedTrackId}
              playheadSec={playheadSec}
              isPlaying={isPlaying}
              isRecording={isRecording}
              armedTrackId={armedTrackId}
              liveRecordingPeaks={liveRecordingPeaks}
              recordingStartSec={recordingStartSec}
              bpm={project.bpm}
              timeSignature={project.timeSignature}
              loopEnabled={loopEnabled}
              loopStartSec={loopStartSec}
              loopEndSec={loopEndSec}
              canEdit={canEdit}
              onSelectTrack={setSelectedTrackId}
              onSeek={handleSeek}
              onAddTrack={handleAddTrack}
              onImportFiles={handleImportFiles}
              onUpdateTrack={handleUpdateTrack}
              onDeleteTrack={handleDeleteTrack}
              onDuplicateTrack={handleDuplicateTrack}
              onSplitTrackAtPlayhead={handleSplitTrackAtPlayhead}
              onArmTrack={setArmedTrackId}
              onUpdateLoop={(s, e) => {
                setLoopStartSec(s);
                setLoopEndSec(e);
              }}
            />

            <VocalDenoisePanel
              selectedTrack={selectedTrack}
              micDevices={micDevices}
              selectedDeviceId={selectedDeviceId}
              micArmed={micArmed}
              micMonitor={micMonitor}
              micInputGain={micInputGain}
              micInputLevel={micInputLevel}
              isRecording={isRecording}
              isCapturingNoisePrint={isCapturingNoisePrint}
              hasNoisePrint={Boolean(noisePrintSpectrum)}
              isAnalyzingAI={isAnalyzingAI}
              isDenoising={isDenoising}
              aiError={aiNoiseError}
              canEdit={canEdit}
              onSelectDevice={handleSelectDevice}
              onToggleArmMic={handleToggleArmMic}
              onToggleMonitor={() => {
                const next = !micMonitor;
                setMicMonitor(next);
                studioEngine.setMicMonitor(next);
              }}
              onChangeMicGain={(g) => {
                setMicInputGain(g);
                studioEngine.setMicInputGain(g);
              }}
              onCaptureNoisePrint={handleCaptureNoisePrint}
              onRunAiNoiseScan={handleRunAiNoiseScan}
              onToggleDenoise={handleToggleDenoise}
              onUpdateDenoiseParam={handleUpdateDenoiseParam}
            />
          </>
        )}

        {activeTab === 'mixer' && (
          <MixerMasteringView
            tracks={tracks}
            masterSettings={project.masterSettings}
            bypassMaster={bypassMaster}
            isPlaying={isPlaying}
            isGeneratingMasterAI={isGeneratingMasterAI}
            aiMasterNotes={aiMasterNotes}
            aiMasterError={aiMasterError}
            canEdit={canEdit}
            onUpdateTrack={handleUpdateTrack}
            onUpdateMaster={(patch) =>
              setProject((p) => ({
                ...p,
                masterSettings: { ...p.masterSettings, ...patch },
              }))
            }
            onToggleBypassMaster={() => setBypassMaster((v) => !v)}
            onRunAiMaster={handleRunAiMaster}
          />
        )}

        {activeTab === 'collaborate' && (
          <CollaborateView
            user={user}
            project={project}
            memberships={memberships}
            members={members}
            incomingInvites={incomingInvites}
            sentInvites={sentInvites}
            comments={comments}
            currentPlayheadSec={playheadSec}
            isSavingCloud={isSavingCloud}
            isLoadingCloud={isLoadingCloud}
            cloudError={cloudError}
            onSignIn={handleSignIn}
            onSaveToCloud={handleSaveToCloud}
            onNewLocalSession={handleNewLocalSession}
            onOpenCloudProject={handleOpenCloudProject}
            onSendInvite={async (email, role) => {
              if (!user) return;
              await sendProjectInvite(user, project, email, role);
              setStatusBanner(`Invitation sent to ${email}.`);
            }}
            onAcceptInvite={async (inv) => {
              if (!user) return;
              await acceptProjectInvite(user, inv);
              await handleOpenCloudProject(inv.projectId);
            }}
            onRevokeInvite={revokeInvite}
            onUpdateMemberRole={async (uid, role) => {
              await updateMemberRole(project.id, uid, role);
            }}
            onRemoveMember={async (uid) => {
              await removeProjectMember(project.id, uid);
            }}
            onPostComment={async (text) => {
              if (!user) return;
              await postSessionComment(
                user,
                project,
                members.map((m) => m.userId),
                playheadSec,
                text
              );
            }}
            onSeekToTimecode={(sec) => {
              handleSeek(sec);
              setActiveTab('studio');
            }}
          />
        )}

        {activeTab === 'exports' && (
          <ExportsView
            projectTitle={project.title}
            tracks={tracks}
            targetLufs={project.masterSettings.targetLufs}
            exportHistory={exportHistory}
            isExporting={isExporting}
            exportProgressText={exportProgressText}
            onExportMaster={handleExportMaster}
            onExportStem={handleExportStem}
          />
        )}
      </main>
    </div>
  );
}
