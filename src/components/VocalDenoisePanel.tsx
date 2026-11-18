import React from 'react';
import { Headphones, Mic, MicOff, ShieldCheck, Sparkles, Waves } from 'lucide-react';
import type { StudioTrack } from '../types/studio';

interface VocalDenoisePanelProps {
  selectedTrack: StudioTrack | null;
  micDevices: MediaDeviceInfo[];
  selectedDeviceId: string;
  micArmed: boolean;
  micMonitor: boolean;
  micInputGain: number;
  micInputLevel: { peakDb: number; normalized: number };
  isRecording: boolean;
  isCapturingNoisePrint: boolean;
  hasNoisePrint: boolean;
  isAnalyzingAI: boolean;
  isDenoising: boolean;
  aiError: string | null;
  canEdit: boolean;
  onSelectDevice: (id: string) => void;
  onToggleArmMic: () => void;
  onToggleMonitor: () => void;
  onChangeMicGain: (gain: number) => void;
  onCaptureNoisePrint: () => void;
  onRunAiNoiseScan: (trackId: string) => void;
  onToggleDenoise: (trackId: string, enabled: boolean) => void;
  onUpdateDenoiseParam: (
    trackId: string,
    patch: Partial<
      Pick<
        StudioTrack,
        'aiDenoiseStrength' | 'highpassHz' | 'humNotchHz' | 'deEssDb' | 'vocalPreserveMode'
      >
    >
  ) => void;
}

export const VocalDenoisePanel: React.FC<VocalDenoisePanelProps> = ({
  selectedTrack,
  micDevices,
  selectedDeviceId,
  micArmed,
  micMonitor,
  micInputGain,
  micInputLevel,
  isRecording,
  isCapturingNoisePrint,
  hasNoisePrint,
  isAnalyzingAI,
  isDenoising,
  aiError,
  canEdit,
  onSelectDevice,
  onToggleArmMic,
  onToggleMonitor,
  onChangeMicGain,
  onCaptureNoisePrint,
  onRunAiNoiseScan,
  onToggleDenoise,
  onUpdateDenoiseParam,
}) => {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
      {/* Left: Raw Microphone Input & Studio Capture */}
      <div className="lg:col-span-5 bg-[#161B22] border border-[#2A3241] rounded-lg p-5 flex flex-col justify-between gap-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-slate-100">
              Raw Microphone Input
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">
              Uncompressed PCM capture · Browser voice-call processing disabled
            </p>
          </div>
          <button
            type="button"
            disabled={!canEdit || isRecording}
            onClick={onToggleArmMic}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border transition-colors whitespace-nowrap shrink-0 ${
              micArmed
                ? 'bg-red-600/20 border-red-500/60 text-red-300'
                : 'bg-[#1B212B] border-[#2A3241] text-slate-200 hover:border-slate-500'
            }`}
          >
            {micArmed ? <Mic className="w-3.5 h-3.5" /> : <MicOff className="w-3.5 h-3.5" />}
            {micArmed ? 'Mic Live' : 'Enable Mic'}
          </button>
        </div>

        <div className="space-y-3">
          <div>
            <label className="block text-xs text-slate-400 mb-1">Audio Input Device</label>
            <select
              value={selectedDeviceId}
              onChange={(e) => onSelectDevice(e.target.value)}
              className="w-full bg-[#0E1116] border border-[#2A3241] rounded-md px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-[#E59A3C]"
            >
              {micDevices.length === 0 ? (
                <option value="">Default System Microphone</option>
              ) : (
                micDevices.map((d, i) => (
                  <option key={d.deviceId || i} value={d.deviceId}>
                    {d.label || `Microphone Input ${i + 1}`}
                  </option>
                ))
              )}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3 items-center">
            <div>
              <div className="flex items-center justify-between text-xs mb-1">
                <span className="text-slate-400">Input Trim</span>
                <span className="font-mono-tabular text-slate-200">
                  {micInputGain.toFixed(2)}x
                </span>
              </div>
              <input
                type="range"
                min={0.3}
                max={2.5}
                step={0.05}
                value={micInputGain}
                onChange={(e) => onChangeMicGain(Number(e.target.value))}
                className="studio-slider w-full"
              />
            </div>

            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={onToggleMonitor}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border transition-colors whitespace-nowrap ${
                  micMonitor
                    ? 'bg-amber-500/15 border-amber-500/50 text-amber-300'
                    : 'bg-[#0E1116] border-[#2A3241] text-slate-400 hover:text-slate-200'
                }`}
              >
                <Headphones className="w-3.5 h-3.5" />
                Monitor {micMonitor ? 'On' : 'Off'}
              </button>
            </div>
          </div>

          {/* Live Input Level Meter */}
          <div className="space-y-1">
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-400">Live Mic Signal</span>
              <span
                className={`font-mono-tabular ${
                  micInputLevel.peakDb > -2 ? 'text-red-400' : 'text-slate-300'
                }`}
              >
                {micArmed ? `${micInputLevel.peakDb.toFixed(1)} dBFS` : 'Mic Inactive'}
              </span>
            </div>
            <div className="h-2.5 bg-[#0E1116] border border-[#2A3241] rounded-sm overflow-hidden">
              <div
                style={{ width: `${Math.round(micInputLevel.normalized * 100)}%` }}
                className={`h-full transition-[width] duration-75 ${
                  micInputLevel.normalized > 0.9
                    ? 'bg-red-500'
                    : micInputLevel.normalized > 0.7
                    ? 'bg-amber-400'
                    : 'bg-emerald-500'
                }`}
              />
            </div>
          </div>
        </div>

        <div className="pt-2 border-t border-[#2A3241] flex items-center justify-between gap-3">
          <span className="text-xs text-slate-400">
            {hasNoisePrint ? 'Room noise print captured' : 'Optional: sample 1.5s of quiet room'}
          </span>
          <button
            type="button"
            disabled={!micArmed || isRecording || isCapturingNoisePrint}
            onClick={onCaptureNoisePrint}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-[#1B212B] text-slate-200 border border-[#2A3241] rounded-md hover:border-slate-500 disabled:opacity-40 transition-colors whitespace-nowrap shrink-0"
          >
            <Waves className="w-3.5 h-3.5" />
            {isCapturingNoisePrint ? 'Sampling Room...' : 'Sample Room Noise'}
          </button>
        </div>
      </div>

      {/* Right: AI Noise Removal & Real Voice Preservation */}
      <div className="lg:col-span-7 bg-[#161B22] border border-[#2A3241] rounded-lg p-5 flex flex-col justify-between gap-4">
        {!selectedTrack ? (
          <div className="flex-1 flex items-center justify-center text-xs text-slate-400 py-8">
            Select a track in the timeline to inspect or apply AI noise removal.
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-semibold text-slate-100">
                    AI Noise Removal &amp; Voice Retention
                  </h3>
                  <span className="text-xs text-slate-400">
                    · {selectedTrack.name}
                  </span>
                </div>
                <p className="text-xs text-slate-400 mt-0.5">
                  Spectral Wiener subtraction with 180 Hz–4.2 kHz formant protection preserves the artist&apos;s natural voice
                </p>
              </div>

              <div className="flex items-center gap-2">
                {/* Raw vs AI Clean A/B Switch */}
                <div className="flex items-center p-0.5 bg-[#0E1116] border border-[#2A3241] rounded-md">
                  <button
                    type="button"
                    disabled={!canEdit}
                    onClick={() => onToggleDenoise(selectedTrack.id, false)}
                    className={`px-2.5 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap ${
                      !selectedTrack.aiDenoiseEnabled
                        ? 'bg-[#262F3D] text-slate-100'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    Original Raw
                  </button>
                  <button
                    type="button"
                    disabled={!canEdit}
                    onClick={() => onToggleDenoise(selectedTrack.id, true)}
                    className={`px-2.5 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap ${
                      selectedTrack.aiDenoiseEnabled
                        ? 'bg-emerald-600 text-white'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    AI Cleaned
                  </button>
                </div>

                <button
                  type="button"
                  disabled={!canEdit || !selectedTrack.rawBuffer || isAnalyzingAI || isDenoising}
                  onClick={() => onRunAiNoiseScan(selectedTrack.id)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-[#E59A3C] text-[#0E1116] rounded-md hover:bg-amber-400 disabled:opacity-40 transition-colors whitespace-nowrap shrink-0"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  {isAnalyzingAI ? 'Scanning Audio...' : isDenoising ? 'Filtering...' : 'Run AI Noise Scan'}
                </button>
              </div>
            </div>

            {aiError && (
              <div className="px-3 py-2 bg-red-950/50 border border-red-800/70 rounded-md text-xs text-red-200">
                {aiError}
              </div>
            )}

            {/* DSP Parameters Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div>
                <div className="flex items-center justify-between text-xs mb-1">
                  <span className="text-slate-400">Noise Reduction</span>
                  <span className="font-mono-tabular text-slate-200">
                    {Math.round(selectedTrack.aiDenoiseStrength * 100)}%
                  </span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={0.95}
                  step={0.05}
                  disabled={!canEdit}
                  value={selectedTrack.aiDenoiseStrength}
                  onChange={(e) =>
                    onUpdateDenoiseParam(selectedTrack.id, {
                      aiDenoiseStrength: Number(e.target.value),
                    })
                  }
                  className="studio-slider w-full"
                />
              </div>

              <div>
                <div className="flex items-center justify-between text-xs mb-1">
                  <span className="text-slate-400">Rumble High-Pass</span>
                  <span className="font-mono-tabular text-slate-200">
                    {selectedTrack.highpassHz} Hz
                  </span>
                </div>
                <input
                  type="range"
                  min={20}
                  max={140}
                  step={5}
                  disabled={!canEdit}
                  value={selectedTrack.highpassHz}
                  onChange={(e) =>
                    onUpdateDenoiseParam(selectedTrack.id, {
                      highpassHz: Number(e.target.value),
                    })
                  }
                  className="studio-slider w-full"
                />
              </div>

              <div>
                <div className="flex items-center justify-between text-xs mb-1">
                  <span className="text-slate-400">De-Esser</span>
                  <span className="font-mono-tabular text-slate-200">
                    -{selectedTrack.deEssDb.toFixed(1)} dB
                  </span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={8}
                  step={0.5}
                  disabled={!canEdit}
                  value={selectedTrack.deEssDb}
                  onChange={(e) =>
                    onUpdateDenoiseParam(selectedTrack.id, {
                      deEssDb: Number(e.target.value),
                    })
                  }
                  className="studio-slider w-full"
                />
              </div>

              <div>
                <label className="block text-xs text-slate-400 mb-1">Mains Hum Notch</label>
                <select
                  disabled={!canEdit}
                  value={selectedTrack.humNotchHz}
                  onChange={(e) =>
                    onUpdateDenoiseParam(selectedTrack.id, {
                      humNotchHz: Number(e.target.value),
                    })
                  }
                  className="w-full bg-[#0E1116] border border-[#2A3241] rounded px-2 py-1 text-xs text-slate-200"
                >
                  <option value={0}>Off</option>
                  <option value={50}>50 Hz (EU/UK)</option>
                  <option value={60}>60 Hz (US)</option>
                </select>
              </div>
            </div>

            {/* Voice Preservation Readout & Engineer Notes */}
            <div className="pt-3 border-t border-[#2A3241] flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-4">
                <button
                  type="button"
                  disabled={!canEdit}
                  onClick={() =>
                    onUpdateDenoiseParam(selectedTrack.id, {
                      vocalPreserveMode: !selectedTrack.vocalPreserveMode,
                    })
                  }
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded border transition-colors ${
                    selectedTrack.vocalPreserveMode
                      ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300'
                      : 'bg-[#0E1116] border-[#2A3241] text-slate-400'
                  }`}
                >
                  <ShieldCheck className="w-3.5 h-3.5" />
                  Formant Lock: {selectedTrack.vocalPreserveMode ? 'On' : 'Off'}
                </button>

                {selectedTrack.aiNoiseProfile && (
                  <div className="text-xs text-slate-300 flex items-center gap-2">
                    <span className="text-slate-400">Vocal Timbre Retention:</span>
                    <span className="font-mono-tabular font-semibold text-emerald-400">
                      {selectedTrack.aiNoiseProfile.vocalRetentionPct.toFixed(1)}%
                    </span>
                    <span aria-hidden="true" className="text-slate-600">·</span>
                    <span className="text-slate-400">
                      {selectedTrack.aiNoiseProfile.recommendedPresetName}
                    </span>
                  </div>
                )}
              </div>

              {selectedTrack.aiNoiseProfile && (
                <p className="text-xs text-slate-400 max-w-2xl">
                  {selectedTrack.aiNoiseProfile.voicePreservationNotes}
                </p>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
};
