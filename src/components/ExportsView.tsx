import React, { useState } from 'react';
import { Download, FileAudio, Layers } from 'lucide-react';
import type { ExportFormat, ExportHistoryItem, StudioTrack } from '../types/studio';

interface ExportsViewProps {
  projectTitle: string;
  tracks: StudioTrack[];
  targetLufs: number;
  exportHistory: ExportHistoryItem[];
  isExporting: boolean;
  exportProgressText: string;
  onExportMaster: (options: {
    filename: string;
    format: ExportFormat;
    sampleRate: number;
    includeMasterChain: boolean;
    normalizeToTargetLufs: boolean;
  }) => Promise<void>;
  onExportStem: (trackId: string, sampleRate: number) => Promise<void>;
}

const FORMAT_OPTIONS: { value: ExportFormat; label: string; detail: string }[] = [
  { value: 'wav24', label: 'WAV · 24-bit PCM Lossless', detail: 'Studio Mastering Quality' },
  { value: 'wav16', label: 'WAV · 16-bit PCM', detail: 'CD & Broadcast Standard' },
  { value: 'aiff24', label: 'AIFF · 24-bit Lossless', detail: 'Apple / Studio Interchange' },
  { value: 'mp3_320', label: 'MP3 · 320 kbps CBR', detail: 'High-Bitrate Distribution' },
  { value: 'mp3_192', label: 'MP3 · 192 kbps CBR', detail: 'Compact Sharing' },
  { value: 'webm_opus', label: 'WebM · Opus 256 kbps', detail: 'Streaming & Web Preview' },
];

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export const ExportsView: React.FC<ExportsViewProps> = ({
  projectTitle,
  tracks,
  targetLufs,
  exportHistory,
  isExporting,
  exportProgressText,
  onExportMaster,
  onExportStem,
}) => {
  const [filename, setFilename] = useState(
    projectTitle.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'sonavault-master'
  );
  const [format, setFormat] = useState<ExportFormat>('wav24');
  const [sampleRate, setSampleRate] = useState<number>(48000);
  const [includeMasterChain, setIncludeMasterChain] = useState(true);
  const [normalizeToTargetLufs, setNormalizeToTargetLufs] = useState(true);

  const playableTracks = tracks.filter((t) => Boolean(t.rawBuffer || t.cleanedBuffer));

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
      {/* Left: Master Export Settings */}
      <div className="lg:col-span-7 bg-[#161B22] border border-[#2A3241] rounded-lg p-5 space-y-5">
        <div className="border-b border-[#2A3241] pb-3">
          <h2 className="text-base font-semibold text-slate-100">
            Master Mixdown Export
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Offline sample-accurate bounce preserving AI-cleaned real vocals, EQ, reverb, stereo imaging, and brickwall limiting
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs text-slate-400 mb-1">Output Filename</label>
            <input
              type="text"
              value={filename}
              onChange={(e) => setFilename(e.target.value)}
              className="w-full bg-[#0E1116] border border-[#2A3241] rounded-md px-3 py-2 text-xs text-slate-100 focus:outline-none focus:border-[#E59A3C]"
            />
          </div>

          <div>
            <label className="block text-xs text-slate-400 mb-1">Sample Rate</label>
            <select
              value={sampleRate}
              onChange={(e) => setSampleRate(Number(e.target.value))}
              className="w-full bg-[#0E1116] border border-[#2A3241] rounded-md px-3 py-2 text-xs text-slate-200"
            >
              <option value={48000}>48,000 Hz (Studio / Video Standard)</option>
              <option value={44100}>44,100 Hz (CD / Streaming Standard)</option>
            </select>
          </div>
        </div>

        <div className="space-y-2">
          <label className="block text-xs text-slate-400">Audio Format</label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            {FORMAT_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setFormat(opt.value)}
                className={`p-3 rounded-md border text-left transition-colors ${
                  format === opt.value
                    ? 'bg-[#1D2430] border-[#E59A3C] text-slate-100'
                    : 'bg-[#11151C] border-[#2A3241] text-slate-300 hover:border-slate-600'
                }`}
              >
                <div className="text-xs font-semibold">{opt.label}</div>
                <div className="text-[11px] text-slate-400 mt-0.5">{opt.detail}</div>
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-[#2A3241]">
          <label className="flex items-center gap-2.5 text-xs text-slate-200 cursor-pointer">
            <input
              type="checkbox"
              checked={includeMasterChain}
              onChange={(e) => setIncludeMasterChain(e.target.checked)}
              className="accent-[#E59A3C]"
            />
            Apply Mastering Chain (EQ, Stereo Width, Limiter)
          </label>

          <label className="flex items-center gap-2.5 text-xs text-slate-200 cursor-pointer">
            <input
              type="checkbox"
              checked={normalizeToTargetLufs}
              onChange={(e) => setNormalizeToTargetLufs(e.target.checked)}
              className="accent-[#E59A3C]"
            />
            Normalize to {targetLufs} LUFS Target
          </label>
        </div>

        <div className="pt-2 flex flex-wrap items-center justify-between gap-3">
          <span className="text-xs text-slate-400">
            {isExporting
              ? exportProgressText
              : `${playableTracks.length} active track(s) ready to bounce`}
          </span>
          <button
            type="button"
            disabled={isExporting || playableTracks.length === 0}
            onClick={() =>
              onExportMaster({
                filename: filename || 'sonavault-master',
                format,
                sampleRate,
                includeMasterChain,
                normalizeToTargetLufs,
              })
            }
            className="inline-flex items-center gap-2 px-5 py-2.5 text-xs font-semibold bg-[#E59A3C] text-[#0E1116] rounded-md hover:bg-amber-400 disabled:opacity-40 transition-colors whitespace-nowrap"
          >
            <Download className="w-4 h-4" />
            {isExporting ? 'Rendering Audio...' : 'Render & Download Master'}
          </button>
        </div>
      </div>

      {/* Right: Individual Stems + Export History */}
      <div className="lg:col-span-5 space-y-5">
        <div className="bg-[#161B22] border border-[#2A3241] rounded-lg p-5 space-y-3">
          <div className="flex items-center gap-2 border-b border-[#2A3241] pb-3">
            <Layers className="w-4 h-4 text-[#E59A3C]" />
            <h3 className="text-sm font-semibold text-slate-100">
              Individual 24-bit WAV Stems
            </h3>
          </div>

          {playableTracks.length === 0 ? (
            <p className="text-xs text-slate-400 py-2">No recorded or imported tracks available.</p>
          ) : (
            <div className="divide-y divide-[#2A3241]">
              {playableTracks.map((t) => (
                <div key={t.id} className="py-2.5 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-xs font-medium text-slate-100 truncate">{t.name}</div>
                    <div className="text-[11px] text-slate-400">
                      {t.aiDenoiseEnabled ? 'AI Noise Cleaned' : 'Original Raw'} · {(t.trimEndSec - t.trimStartSec).toFixed(1)}s
                    </div>
                  </div>
                  <button
                    type="button"
                    disabled={isExporting}
                    onClick={() => onExportStem(t.id, sampleRate)}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium bg-[#1B212B] text-slate-200 border border-[#2A3241] rounded hover:border-slate-500 disabled:opacity-40 whitespace-nowrap shrink-0"
                  >
                    <Download className="w-3 h-3" />
                    WAV Stem
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="bg-[#161B22] border border-[#2A3241] rounded-lg p-5 space-y-3">
          <div className="flex items-center gap-2 border-b border-[#2A3241] pb-3">
            <FileAudio className="w-4 h-4 text-[#E59A3C]" />
            <h3 className="text-sm font-semibold text-slate-100">
              Session Exports ({exportHistory.length})
            </h3>
          </div>

          {exportHistory.length === 0 ? (
            <p className="text-xs text-slate-400 py-2">
              Rendered audio files from this session will appear here for instant re-download.
            </p>
          ) : (
            <div className="divide-y divide-[#2A3241] max-h-[220px] overflow-y-auto">
              {exportHistory.map((item) => (
                <div key={item.id} className="py-2.5 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-xs font-medium text-slate-100 truncate">
                      {item.filename}
                    </div>
                    <div className="font-mono-tabular text-[11px] text-slate-400">
                      {item.sampleRate / 1000} kHz · {formatBytes(item.fileSizeBytes)} · {item.durationSec.toFixed(1)}s
                    </div>
                  </div>
                  <a
                    href={item.downloadUrl}
                    download={item.filename}
                    className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-amber-300 hover:underline shrink-0"
                  >
                    <Download className="w-3.5 h-3.5" />
                    Save
                  </a>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
