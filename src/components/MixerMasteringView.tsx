import React, { useEffect, useRef } from 'react';
import { Sliders, Sparkles } from 'lucide-react';
import { studioEngine } from '../audio/liveEngine';
import type { MasterSettings, StudioTrack } from '../types/studio';

interface MixerMasteringViewProps {
  tracks: StudioTrack[];
  masterSettings: MasterSettings;
  bypassMaster: boolean;
  isPlaying: boolean;
  isGeneratingMasterAI: boolean;
  aiMasterNotes: { summary: string; vocalAdvice: string } | null;
  aiMasterError: string | null;
  canEdit: boolean;
  onUpdateTrack: (id: string, patch: Partial<StudioTrack>) => void;
  onUpdateMaster: (patch: Partial<MasterSettings>) => void;
  onToggleBypassMaster: () => void;
  onRunAiMaster: () => void;
}

export const MixerMasteringView: React.FC<MixerMasteringViewProps> = ({
  tracks,
  masterSettings,
  bypassMaster,
  isPlaying,
  isGeneratingMasterAI,
  aiMasterNotes,
  aiMasterError,
  canEdit,
  onUpdateTrack,
  onUpdateMaster,
  onToggleBypassMaster,
  onRunAiMaster,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const meterLRef = useRef<HTMLDivElement>(null);
  const meterRRef = useRef<HTMLDivElement>(null);
  const lufsReadoutRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    let rafId = 0;

    const draw = () => {
      const meters = studioEngine.getLiveMeters();
      if (meterLRef.current) {
        meterLRef.current.style.height = `${Math.round(meters.peakL * 100)}%`;
      }
      if (meterRRef.current) {
        meterRRef.current.style.height = `${Math.round(meters.peakR * 100)}%`;
      }
      if (lufsReadoutRef.current) {
        lufsReadoutRef.current.textContent = isPlaying
          ? `${meters.shortTermLufs.toFixed(1)} LUFS`
          : 'Idle';
      }

      const canvas = canvasRef.current;
      if (canvas) {
        const ctx = canvas.getContext('2d');
        if (ctx) {
          const w = canvas.width;
          const h = canvas.height;
          ctx.fillStyle = '#0E1116';
          ctx.fillRect(0, 0, w, h);

          // Subtle grid lines
          ctx.strokeStyle = '#1E2532';
          ctx.lineWidth = 1;
          for (let y = 1; y < 4; y++) {
            const yy = Math.round((h / 4) * y);
            ctx.beginPath();
            ctx.moveTo(0, yy);
            ctx.lineTo(w, yy);
            ctx.stroke();
          }

          const bins = meters.fftBins;
          const barCount = 56;
          const barW = w / barCount;
          for (let i = 0; i < barCount; i++) {
            // Logarithmic frequency sampling across 20Hz..20kHz
            const logIdx = Math.min(
              bins.length - 1,
              Math.floor(Math.pow(i / barCount, 1.85) * (bins.length * 0.65))
            );
            const val = isPlaying ? bins[logIdx] / 255 : 0.03;
            const barH = Math.max(2, val * (h - 8));
            ctx.fillStyle = val > 0.85 ? '#DC2626' : val > 0.6 ? '#E59A3C' : '#64748B';
            ctx.fillRect(i * barW + 1, h - barH, Math.max(2, barW - 2), barH);
          }
        }
      }

      rafId = requestAnimationFrame(draw);
    };

    rafId = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(rafId);
  }, [isPlaying]);

  return (
    <div className="grid grid-cols-1 xl:grid-cols-12 gap-5">
      {/* Left: Multi-Track Channel Strips */}
      <div className="xl:col-span-8 bg-[#161B22] border border-[#2A3241] rounded-lg p-5 flex flex-col gap-4">
        <div className="flex items-center justify-between border-b border-[#2A3241] pb-3">
          <div>
            <h2 className="text-base font-semibold text-slate-100">Channel Mixing Console</h2>
            <p className="text-xs text-slate-400">
              3-Band EQ · Dynamics Compressor · Studio Plate Reverb &amp; Tempo Delay Sends
            </p>
          </div>
          <span className="font-mono-tabular text-xs text-slate-400">
            {tracks.length} Channels
          </span>
        </div>

        {tracks.length === 0 ? (
          <div className="py-16 text-center text-sm text-slate-400">
            Record or import a track in the Studio tab to mix its channel strip.
          </div>
        ) : (
          <div className="flex gap-3 overflow-x-auto pb-2">
            {tracks.map((track) => (
              <div
                key={track.id}
                className="w-[178px] shrink-0 bg-[#11151C] border border-[#2A3241] rounded-md p-3 flex flex-col gap-3"
              >
                {/* Channel Header */}
                <div className="flex items-center justify-between gap-1.5 border-b border-[#2A3241] pb-2">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span
                      className="w-2 h-2 rounded-xs shrink-0"
                      style={{ backgroundColor: track.color }}
                    />
                    <span className="text-xs font-semibold text-slate-100 truncate">
                      {track.name}
                    </span>
                  </div>
                  <span className="font-mono-tabular text-[10px] text-slate-400 shrink-0">
                    {track.aiDenoiseEnabled ? 'Clean' : 'Raw'}
                  </span>
                </div>

                {/* 3-Band EQ */}
                <div className="space-y-1.5">
                  <span className="text-[11px] font-medium text-slate-400">3-Band EQ</span>
                  {[
                    { label: 'High 8k', key: 'eqHighDb' as const, val: track.eqHighDb },
                    { label: 'Mid 1.2k', key: 'eqMidDb' as const, val: track.eqMidDb },
                    { label: 'Low 110', key: 'eqLowDb' as const, val: track.eqLowDb },
                  ].map((band) => (
                    <div key={band.key} className="space-y-0.5">
                      <div className="flex justify-between text-[10px] text-slate-400">
                        <span>{band.label}</span>
                        <span className="font-mono-tabular text-slate-200">
                          {band.val > 0 ? `+${band.val.toFixed(1)}` : band.val.toFixed(1)} dB
                        </span>
                      </div>
                      <input
                        type="range"
                        min={-12}
                        max={12}
                        step={0.5}
                        disabled={!canEdit}
                        value={band.val}
                        onChange={(e) =>
                          onUpdateTrack(track.id, { [band.key]: Number(e.target.value) })
                        }
                        className="studio-slider w-full"
                      />
                    </div>
                  ))}
                </div>

                {/* Compressor & FX Sends */}
                <div className="space-y-1.5 pt-2 border-t border-[#2A3241]">
                  <div className="flex justify-between text-[10px] text-slate-400">
                    <span>Comp Thresh</span>
                    <span className="font-mono-tabular text-slate-200">
                      {track.compThresholdDb.toFixed(0)} dB
                    </span>
                  </div>
                  <input
                    type="range"
                    min={-42}
                    max={0}
                    step={1}
                    disabled={!canEdit}
                    value={track.compThresholdDb}
                    onChange={(e) =>
                      onUpdateTrack(track.id, { compThresholdDb: Number(e.target.value) })
                    }
                    className="studio-slider w-full"
                  />

                  <div className="flex justify-between text-[10px] text-slate-400">
                    <span>Reverb Send</span>
                    <span className="font-mono-tabular text-slate-200">
                      {Math.round(track.reverbSend * 100)}%
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={0.85}
                    step={0.05}
                    disabled={!canEdit}
                    value={track.reverbSend}
                    onChange={(e) =>
                      onUpdateTrack(track.id, { reverbSend: Number(e.target.value) })
                    }
                    className="studio-slider w-full"
                  />

                  <div className="flex justify-between text-[10px] text-slate-400">
                    <span>Delay Send</span>
                    <span className="font-mono-tabular text-slate-200">
                      {Math.round(track.delaySend * 100)}%
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={0.75}
                    step={0.05}
                    disabled={!canEdit}
                    value={track.delaySend}
                    onChange={(e) =>
                      onUpdateTrack(track.id, { delaySend: Number(e.target.value) })
                    }
                    className="studio-slider w-full"
                  />
                </div>

                {/* Pan & Fader */}
                <div className="space-y-2 pt-2 border-t border-[#2A3241]">
                  <div className="flex justify-between text-[10px] text-slate-400">
                    <span>Pan</span>
                    <span className="font-mono-tabular text-slate-200">
                      {track.pan === 0
                        ? 'C'
                        : track.pan < 0
                        ? `L${Math.round(Math.abs(track.pan) * 100)}`
                        : `R${Math.round(track.pan * 100)}`}
                    </span>
                  </div>
                  <input
                    type="range"
                    min={-1}
                    max={1}
                    step={0.05}
                    disabled={!canEdit}
                    value={track.pan}
                    onChange={(e) => onUpdateTrack(track.id, { pan: Number(e.target.value) })}
                    className="studio-slider w-full"
                  />

                  <div className="flex justify-between text-[10px] text-slate-400">
                    <span>Fader</span>
                    <span className="font-mono-tabular text-amber-300">
                      {track.volumeDb > 0 ? `+${track.volumeDb.toFixed(1)}` : track.volumeDb.toFixed(1)} dB
                    </span>
                  </div>
                  <input
                    type="range"
                    min={-48}
                    max={6}
                    step={0.5}
                    disabled={!canEdit}
                    value={track.volumeDb}
                    onChange={(e) => onUpdateTrack(track.id, { volumeDb: Number(e.target.value) })}
                    className="studio-slider w-full"
                  />

                  <div className="grid grid-cols-2 gap-1.5 pt-1">
                    <button
                      type="button"
                      onClick={() => onUpdateTrack(track.id, { muted: !track.muted })}
                      className={`py-1 text-xs font-semibold rounded border ${
                        track.muted
                          ? 'bg-amber-600/80 border-amber-500 text-white'
                          : 'bg-[#161B22] border-[#2A3241] text-slate-300'
                      }`}
                    >
                      Mute
                    </button>
                    <button
                      type="button"
                      onClick={() => onUpdateTrack(track.id, { solo: !track.solo })}
                      className={`py-1 text-xs font-semibold rounded border ${
                        track.solo
                          ? 'bg-emerald-600 border-emerald-500 text-white'
                          : 'bg-[#161B22] border-[#2A3241] text-slate-300'
                      }`}
                    >
                      Solo
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Right: Master Bus & AI Mastering Rack */}
      <div className="xl:col-span-4 bg-[#161B22] border border-[#2A3241] rounded-lg p-5 flex flex-col gap-4">
        <div className="flex items-start justify-between gap-2 border-b border-[#2A3241] pb-3">
          <div>
            <h2 className="text-base font-semibold text-slate-100">Master Bus &amp; Limiter</h2>
            <p className="text-xs text-slate-400">
              Preset: {masterSettings.presetName}
            </p>
          </div>
          <button
            type="button"
            onClick={onToggleBypassMaster}
            className={`px-2.5 py-1 text-xs font-medium rounded border transition-colors whitespace-nowrap ${
              bypassMaster
                ? 'bg-amber-500/20 border-amber-500 text-amber-300'
                : 'bg-[#11151C] border-[#2A3241] text-slate-300 hover:text-white'
            }`}
          >
            {bypassMaster ? 'Master Bypassed' : 'Master Active'}
          </button>
        </div>

        {/* Real-Time Spectrum & Stereo Peak/LUFS Analyzer */}
        <div className="bg-[#0E1116] border border-[#2A3241] rounded-md p-3 space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="text-slate-400">Real-Time FFT &amp; Loudness</span>
            <span ref={lufsReadoutRef} className="font-mono-tabular text-amber-300">
              Idle
            </span>
          </div>
          <div className="flex items-stretch gap-2 h-24">
            <canvas
              ref={canvasRef}
              width={280}
              height={96}
              className="flex-1 h-full rounded-sm border border-[#1E2532]"
            />
            <div className="flex gap-1.5 w-7 shrink-0">
              <div className="flex-1 bg-[#161B22] border border-[#2A3241] rounded-xs relative overflow-hidden flex items-end">
                <div
                  ref={meterLRef}
                  style={{ height: '0%' }}
                  className="w-full bg-emerald-500 transition-[height] duration-75"
                />
              </div>
              <div className="flex-1 bg-[#161B22] border border-[#2A3241] rounded-xs relative overflow-hidden flex items-end">
                <div
                  ref={meterRRef}
                  style={{ height: '0%' }}
                  className="w-full bg-emerald-500 transition-[height] duration-75"
                />
              </div>
            </div>
          </div>
        </div>

        {/* AI Mastering Calibration */}
        <div className="bg-[#11151C] border border-[#2A3241] rounded-md p-3 space-y-2.5">
          <div className="flex items-center justify-between gap-2">
            <div>
              <label className="block text-[11px] text-slate-400">Target Loudness</label>
              <select
                disabled={!canEdit}
                value={masterSettings.targetLufs}
                onChange={(e) => onUpdateMaster({ targetLufs: Number(e.target.value) })}
                className="mt-0.5 bg-[#0E1116] border border-[#2A3241] rounded px-2 py-1 text-xs text-slate-200"
              >
                <option value={-14}>-14 LUFS (Streaming Standard)</option>
                <option value={-16}>-16 LUFS (Acoustic / Dynamic)</option>
                <option value={-11}>-11 LUFS (Pop / Radio)</option>
                <option value={-9}>-9 LUFS (Club / Electronic)</option>
              </select>
            </div>

            <button
              type="button"
              disabled={!canEdit || tracks.length === 0 || isGeneratingMasterAI}
              onClick={onRunAiMaster}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium bg-[#E59A3C] text-[#0E1116] rounded-md hover:bg-amber-400 disabled:opacity-40 transition-colors whitespace-nowrap shrink-0"
            >
              <Sparkles className="w-3.5 h-3.5" />
              {isGeneratingMasterAI ? 'Analyzing Mix...' : 'AI Master Chain'}
            </button>
          </div>

          {aiMasterError && (
            <div className="text-xs text-red-300 bg-red-950/50 border border-red-800/60 rounded p-2">
              {aiMasterError}
            </div>
          )}

          {aiMasterNotes && (
            <div className="text-xs text-slate-300 space-y-1 pt-1 border-t border-[#2A3241]">
              <p>{aiMasterNotes.summary}</p>
              <p className="text-emerald-300">{aiMasterNotes.vocalAdvice}</p>
            </div>
          )}
        </div>

        {/* Master EQ, Stereo Width & Limiter Controls */}
        <div className="space-y-3">
          <div className="flex items-center gap-1.5 text-xs font-medium text-slate-300">
            <Sliders className="w-3.5 h-3.5 text-[#E59A3C]" />
            <span>Master EQ &amp; Mid-Side Imager</span>
          </div>

          <div className="grid grid-cols-2 gap-3">
            {[
              { label: 'Low (85Hz)', key: 'eqLowDb' as const, val: masterSettings.eqLowDb },
              { label: 'Mid (950Hz)', key: 'eqMidDb' as const, val: masterSettings.eqMidDb },
              { label: 'Presence (4.8k)', key: 'eqHighDb' as const, val: masterSettings.eqHighDb },
              { label: 'Air (12kHz)', key: 'eqAirDb' as const, val: masterSettings.eqAirDb },
            ].map((b) => (
              <div key={b.key}>
                <div className="flex justify-between text-[11px] text-slate-400 mb-0.5">
                  <span>{b.label}</span>
                  <span className="font-mono-tabular text-slate-200">
                    {b.val > 0 ? `+${b.val.toFixed(1)}` : b.val.toFixed(1)} dB
                  </span>
                </div>
                <input
                  type="range"
                  min={-6}
                  max={6}
                  step={0.5}
                  disabled={!canEdit}
                  value={b.val}
                  onChange={(e) => onUpdateMaster({ [b.key]: Number(e.target.value) })}
                  className="studio-slider w-full"
                />
              </div>
            ))}
          </div>

          <div>
            <div className="flex justify-between text-[11px] text-slate-400 mb-0.5">
              <span>Mid-Side Stereo Width</span>
              <span className="font-mono-tabular text-slate-200">
                {Math.round(masterSettings.stereoWidth * 100)}%
              </span>
            </div>
            <input
              type="range"
              min={0.5}
              max={1.6}
              step={0.05}
              disabled={!canEdit}
              value={masterSettings.stereoWidth}
              onChange={(e) => onUpdateMaster({ stereoWidth: Number(e.target.value) })}
              className="studio-slider w-full"
            />
          </div>

          <div className="grid grid-cols-2 gap-3 pt-2 border-t border-[#2A3241]">
            <div>
              <div className="flex justify-between text-[11px] text-slate-400 mb-0.5">
                <span>Glue Thresh</span>
                <span className="font-mono-tabular text-slate-200">
                  {masterSettings.compThresholdDb.toFixed(0)} dB
                </span>
              </div>
              <input
                type="range"
                min={-30}
                max={0}
                step={1}
                disabled={!canEdit}
                value={masterSettings.compThresholdDb}
                onChange={(e) => onUpdateMaster({ compThresholdDb: Number(e.target.value) })}
                className="studio-slider w-full"
              />
            </div>

            <div>
              <div className="flex justify-between text-[11px] text-slate-400 mb-0.5">
                <span>Glue Ratio</span>
                <span className="font-mono-tabular text-slate-200">
                  {masterSettings.compRatio.toFixed(1)}:1
                </span>
              </div>
              <input
                type="range"
                min={1}
                max={8}
                step={0.5}
                disabled={!canEdit}
                value={masterSettings.compRatio}
                onChange={(e) => onUpdateMaster({ compRatio: Number(e.target.value) })}
                className="studio-slider w-full"
              />
            </div>

            <div>
              <div className="flex justify-between text-[11px] text-slate-400 mb-0.5">
                <span>Limiter Drive</span>
                <span className="font-mono-tabular text-slate-200">
                  +{masterSettings.limiterDriveDb.toFixed(1)} dB
                </span>
              </div>
              <input
                type="range"
                min={0}
                max={12}
                step={0.5}
                disabled={!canEdit}
                value={masterSettings.limiterDriveDb}
                onChange={(e) => onUpdateMaster({ limiterDriveDb: Number(e.target.value) })}
                className="studio-slider w-full"
              />
            </div>

            <div>
              <div className="flex justify-between text-[11px] text-slate-400 mb-0.5">
                <span>True-Peak Ceiling</span>
                <span className="font-mono-tabular text-slate-200">
                  {masterSettings.limiterCeilingDb.toFixed(1)} dBFS
                </span>
              </div>
              <input
                type="range"
                min={-3.0}
                max={-0.1}
                step={0.1}
                disabled={!canEdit}
                value={masterSettings.limiterCeilingDb}
                onChange={(e) => onUpdateMaster({ limiterCeilingDb: Number(e.target.value) })}
                className="studio-slider w-full"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
