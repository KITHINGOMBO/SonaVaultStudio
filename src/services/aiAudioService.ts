import type { AcousticTelemetry } from '../audio/dspEngine';
import type { MasterSettings, MixdownTelemetry } from '../types/studio';

export interface AiNoiseAnalysisResponse {
  highpassHz: number;
  humNotchHz: number;
  denoiseStrength: number;
  vocalPreserveMode: boolean;
  deEssDb: number;
  detectedNoiseSources: string[];
  voicePreservationNotes: string;
  recommendedPresetName: string;
}

export interface AiMasteringPresetResponse extends MasterSettings {
  engineerSummary: string;
  vocalClarityAdvice: string;
}

export async function analyzeTrackNoiseWithAI(payload: {
  trackName: string;
  instrument: string;
  durationSec: number;
  sampleRate: number;
  telemetry: AcousticTelemetry;
}): Promise<AiNoiseAnalysisResponse> {
  const res = await fetch('/api/ai/analyze-noise', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      trackName: payload.trackName,
      instrument: payload.instrument,
      durationSec: payload.durationSec,
      sampleRate: payload.sampleRate,
      ...payload.telemetry,
    }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `AI Noise Analysis failed (${res.status})`);
  }
  return data as AiNoiseAnalysisResponse;
}

export async function generateMasteringPresetWithAI(payload: {
  projectTitle: string;
  genre: string;
  targetLufs: number;
  telemetry: MixdownTelemetry;
}): Promise<AiMasteringPresetResponse> {
  const res = await fetch('/api/ai/mastering-preset', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      projectTitle: payload.projectTitle,
      genre: payload.genre,
      targetLufs: payload.targetLufs,
      ...payload.telemetry,
    }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `AI Mastering failed (${res.status})`);
  }
  return {
    ...data,
    targetLufs: payload.targetLufs,
  } as AiMasteringPresetResponse;
}
