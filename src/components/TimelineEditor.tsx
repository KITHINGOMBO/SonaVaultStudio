import React, { useRef, useState } from 'react';
import {
  Copy,
  Mic,
  Plus,
  Scissors,
  Sparkles,
  Trash2,
  Upload,
  Volume2,
  VolumeX,
} from 'lucide-react';
import type { StudioTrack } from '../types/studio';

interface TimelineEditorProps {
  tracks: StudioTrack[];
  selectedTrackId: string | null;
  playheadSec: number;
  isPlaying: boolean;
  isRecording: boolean;
  armedTrackId: string | null;
  liveRecordingPeaks: number[];
  recordingStartSec: number;
  bpm: number;
  timeSignature: string;
  loopEnabled: boolean;
  loopStartSec: number;
  loopEndSec: number;
  canEdit: boolean;
  onSelectTrack: (id: string) => void;
  onSeek: (sec: number) => void;
  onAddTrack: (instrument?: string) => void;
  onImportFiles: (files: FileList) => void;
  onUpdateTrack: (id: string, patch: Partial<StudioTrack>) => void;
  onDeleteTrack: (id: string) => void;
  onDuplicateTrack: (id: string) => void;
  onSplitTrackAtPlayhead: (id: string) => void;
  onArmTrack: (id: string) => void;
  onUpdateLoop: (startSec: number, endSec: number) => void;
}

const TRACK_ROW_HEIGHT = 88;
const RULER_HEIGHT = 36;

export const TimelineEditor: React.FC<TimelineEditorProps> = ({
  tracks,
  selectedTrackId,
  playheadSec,
  isRecording,
  armedTrackId,
  liveRecordingPeaks,
  recordingStartSec,
  bpm,
  timeSignature,
  loopEnabled,
  loopStartSec,
  loopEndSec,
  canEdit,
  onSelectTrack,
  onSeek,
  onAddTrack,
  onImportFiles,
  onUpdateTrack,
  onDeleteTrack,
  onDuplicateTrack,
  onSplitTrackAtPlayhead,
  onArmTrack,
  onUpdateLoop,
}) => {
  const [pxPerSec, setPxPerSec] = useState(48);
  const [snapToBeat, setSnapToBeat] = useState(true);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const laneContainerRef = useRef<HTMLDivElement>(null);

  const [dragState, setDragState] = useState<{
    trackId: string;
    mode: 'move' | 'trimStart' | 'trimEnd';
    startX: number;
    origOffset: number;
    origTrimStart: number;
    origTrimEnd: number;
    maxDuration: number;
  } | null>(null);

  const beatsPerBar = Math.max(2, parseInt(timeSignature.split('/')[0] || '4', 10));
  const secPerBeat = 60 / Math.max(40, bpm);
  const secPerBar = secPerBeat * beatsPerBar;

  const maxTrackEnd = tracks.reduce((max, t) => {
    const end = t.startOffsetSec + Math.max(0, t.trimEndSec - t.trimStartSec);
    return Math.max(max, end);
  }, 32);

  const totalTimelineSec = Math.max(45, Math.ceil(maxTrackEnd + 16), Math.ceil(playheadSec + 12));
  const timelineWidth = Math.max(900, Math.ceil(totalTimelineSec * pxPerSec));

  const snapSec = (sec: number) => {
    if (!snapToBeat) return Math.max(0, sec);
    const step = secPerBeat / 2; // 8th note snap
    return Math.max(0, Math.round(sec / step) * step);
  };

  const handleRulerPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!laneContainerRef.current) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const targetSec = Math.max(0, x / pxPerSec);
    onSeek(targetSec);
  };

  const handleClipPointerDown = (
    e: React.PointerEvent,
    track: StudioTrack,
    mode: 'move' | 'trimStart' | 'trimEnd'
  ) => {
    e.stopPropagation();
    onSelectTrack(track.id);
    if (!canEdit) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setDragState({
      trackId: track.id,
      mode,
      startX: e.clientX,
      origOffset: track.startOffsetSec,
      origTrimStart: track.trimStartSec,
      origTrimEnd: track.trimEndSec,
      maxDuration: track.durationSec,
    });
  };

  const handleClipPointerMove = (e: React.PointerEvent) => {
    if (!dragState) return;
    const dx = e.clientX - dragState.startX;
    const dSec = dx / pxPerSec;

    if (dragState.mode === 'move') {
      const nextOffset = snapSec(Math.max(0, dragState.origOffset + dSec));
      onUpdateTrack(dragState.trackId, { startOffsetSec: Number(nextOffset.toFixed(3)) });
    } else if (dragState.mode === 'trimStart') {
      const maxShift = dragState.origTrimEnd - dragState.origTrimStart - 0.1;
      const clampedShift = Math.max(-dragState.origTrimStart, Math.min(maxShift, dSec));
      const nextTrimStart = Math.max(0, dragState.origTrimStart + clampedShift);
      const nextOffset = Math.max(0, dragState.origOffset + clampedShift);
      onUpdateTrack(dragState.trackId, {
        trimStartSec: Number(nextTrimStart.toFixed(3)),
        startOffsetSec: Number(nextOffset.toFixed(3)),
      });
    } else if (dragState.mode === 'trimEnd') {
      const nextTrimEnd = Math.max(
        dragState.origTrimStart + 0.1,
        Math.min(dragState.maxDuration, dragState.origTrimEnd + dSec)
      );
      onUpdateTrack(dragState.trackId, { trimEndSec: Number(nextTrimEnd.toFixed(3)) });
    }
  };

  const handleClipPointerUp = (e: React.PointerEvent) => {
    if (!dragState) return;
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      // Ignore
    }
    setDragState(null);
  };

  // Build bar markers
  const barMarkers: { bar: number; sec: number }[] = [];
  for (let b = 0; b * secPerBar <= totalTimelineSec; b++) {
    barMarkers.push({ bar: b + 1, sec: b * secPerBar });
  }

  return (
    <div className="bg-[#161B22] border border-[#2A3241] rounded-lg overflow-hidden flex flex-col">
      {/* Timeline Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 border-b border-[#2A3241] bg-[#12161D]">
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={!canEdit}
            onClick={() => onAddTrack('Lead Vocal')}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-[#E59A3C] text-[#0E1116] rounded-md hover:bg-amber-400 disabled:opacity-40 transition-colors whitespace-nowrap shrink-0"
          >
            <Plus className="w-3.5 h-3.5" />
            Add Track
          </button>

          <button
            type="button"
            disabled={!canEdit}
            onClick={() => fileInputRef.current?.click()}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-[#1B212B] text-slate-200 border border-[#2A3241] rounded-md hover:border-slate-500 disabled:opacity-40 transition-colors whitespace-nowrap shrink-0"
          >
            <Upload className="w-3.5 h-3.5" />
            Import Audio
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="audio/*"
            multiple
            className="hidden"
            onChange={(e) => {
              if (e.target.files && e.target.files.length > 0) {
                onImportFiles(e.target.files);
                e.target.value = '';
              }
            }}
          />

          {selectedTrackId && (
            <button
              type="button"
              disabled={!canEdit}
              onClick={() => onSplitTrackAtPlayhead(selectedTrackId)}
              title="Split selected clip at playhead"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-[#1B212B] text-slate-200 border border-[#2A3241] rounded-md hover:border-slate-500 disabled:opacity-40 transition-colors whitespace-nowrap shrink-0"
            >
              <Scissors className="w-3.5 h-3.5" />
              Split at Playhead
            </button>
          )}
        </div>

        <div className="flex items-center gap-4 text-xs text-slate-300">
          <button
            type="button"
            onClick={() => setSnapToBeat((v) => !v)}
            className={`px-2.5 py-1 rounded border text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
              snapToBeat
                ? 'bg-amber-500/15 border-amber-500/50 text-amber-300'
                : 'bg-[#1B212B] border-[#2A3241] text-slate-400'
            }`}
          >
            Snap: {snapToBeat ? '8th Beat' : 'Free'}
          </button>

          {loopEnabled && (
            <div className="flex items-center gap-1.5 font-mono-tabular text-xs text-slate-300">
              <span>Loop</span>
              <input
                type="number"
                min={0}
                step={0.5}
                value={loopStartSec}
                onChange={(e) => onUpdateLoop(Math.max(0, Number(e.target.value)), loopEndSec)}
                className="w-14 bg-[#0E1116] border border-[#2A3241] rounded px-1.5 py-0.5 text-xs text-slate-200"
              />
              <span>–</span>
              <input
                type="number"
                min={loopStartSec + 0.5}
                step={0.5}
                value={loopEndSec}
                onChange={(e) => onUpdateLoop(loopStartSec, Math.max(loopStartSec + 0.5, Number(e.target.value)))}
                className="w-14 bg-[#0E1116] border border-[#2A3241] rounded px-1.5 py-0.5 text-xs text-slate-200"
              />
              <span>s</span>
            </div>
          )}

          <div className="flex items-center gap-2">
            <span className="text-slate-400 whitespace-nowrap">Zoom</span>
            <input
              type="range"
              min={20}
              max={140}
              value={pxPerSec}
              onChange={(e) => setPxPerSec(Number(e.target.value))}
              className="studio-slider w-24"
              aria-label="Timeline horizontal zoom"
            />
          </div>
        </div>
      </div>

      {/* Main Split: Track Headers (280px) + Scrollable Lanes */}
      <div className="flex min-h-[280px] max-h-[420px] overflow-y-auto">
        {/* Left Track Headers */}
        <div className="w-[280px] shrink-0 border-r border-[#2A3241] bg-[#141920] flex flex-col">
          <div
            style={{ height: RULER_HEIGHT }}
            className="px-3 flex items-center justify-between border-b border-[#2A3241] text-xs font-medium text-slate-400 shrink-0"
          >
            <span>Tracks ({tracks.length})</span>
            <span className="font-mono-tabular">dB / Pan</span>
          </div>

          {tracks.length === 0 ? (
            <div className="p-4 text-xs text-slate-400">
              No tracks yet. Add a track or import audio.
            </div>
          ) : (
            tracks.map((track) => {
              const isSelected = track.id === selectedTrackId;
              const isArmed = track.id === armedTrackId;
              return (
                <div
                  key={track.id}
                  onClick={() => onSelectTrack(track.id)}
                  style={{ height: TRACK_ROW_HEIGHT }}
                  className={`px-3 py-2 border-b border-[#2A3241] flex flex-col justify-between cursor-pointer transition-colors ${
                    isSelected ? 'bg-[#1D2430]' : 'hover:bg-[#181E27]'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span
                        className="w-2.5 h-2.5 rounded-xs shrink-0"
                        style={{ backgroundColor: track.color }}
                      />
                      <input
                        type="text"
                        value={track.name}
                        disabled={!canEdit}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => onUpdateTrack(track.id, { name: e.target.value })}
                        className="bg-transparent text-xs font-semibold text-slate-100 truncate focus:outline-none focus:bg-[#0E1116] px-1 rounded max-w-[125px]"
                      />
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        disabled={!canEdit}
                        onClick={(e) => {
                          e.stopPropagation();
                          onArmTrack(track.id);
                        }}
                        title="Arm track for microphone recording"
                        className={`w-6 h-6 rounded text-[11px] font-semibold flex items-center justify-center border transition-colors ${
                          isArmed
                            ? 'bg-red-600 border-red-500 text-white'
                            : 'bg-[#0E1116] border-[#2A3241] text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        <Mic className="w-3 h-3" />
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onUpdateTrack(track.id, { muted: !track.muted });
                        }}
                        title="Mute track"
                        className={`w-6 h-6 rounded text-[11px] font-semibold border transition-colors ${
                          track.muted
                            ? 'bg-amber-600/80 border-amber-500 text-white'
                            : 'bg-[#0E1116] border-[#2A3241] text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        M
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onUpdateTrack(track.id, { solo: !track.solo });
                        }}
                        title="Solo track"
                        className={`w-6 h-6 rounded text-[11px] font-semibold border transition-colors ${
                          track.solo
                            ? 'bg-emerald-600 border-emerald-500 text-white'
                            : 'bg-[#0E1116] border-[#2A3241] text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        S
                      </button>
                    </div>
                  </div>

                  {/* Row 2: Fader + AI Denoise + Actions */}
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 flex-1 min-w-0">
                      {track.muted ? (
                        <VolumeX className="w-3 h-3 text-slate-500 shrink-0" />
                      ) : (
                        <Volume2 className="w-3 h-3 text-slate-400 shrink-0" />
                      )}
                      <input
                        type="range"
                        min={-48}
                        max={6}
                        step={0.5}
                        disabled={!canEdit}
                        value={track.volumeDb}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => onUpdateTrack(track.id, { volumeDb: Number(e.target.value) })}
                        className="studio-slider w-20"
                        aria-label={`${track.name} volume`}
                      />
                      <span className="font-mono-tabular text-[11px] text-slate-400 w-10 text-right">
                        {track.volumeDb > 0 ? `+${track.volumeDb.toFixed(0)}` : track.volumeDb.toFixed(0)}
                      </span>
                    </div>

                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        disabled={!canEdit}
                        onClick={(e) => {
                          e.stopPropagation();
                          onUpdateTrack(track.id, { aiDenoiseEnabled: !track.aiDenoiseEnabled });
                        }}
                        title={
                          track.aiDenoiseEnabled
                            ? 'AI Noise Removal Active (Voice Preserved)'
                            : 'Original Raw Mic Audio'
                        }
                        className={`px-1.5 h-6 rounded text-[10px] font-medium border inline-flex items-center gap-1 transition-colors ${
                          track.aiDenoiseEnabled
                            ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300'
                            : 'bg-[#0E1116] border-[#2A3241] text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        <Sparkles className="w-2.5 h-2.5" />
                        {track.aiDenoiseEnabled ? 'Clean' : 'Raw'}
                      </button>

                      {canEdit && (
                        <>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onDuplicateTrack(track.id);
                            }}
                            title="Duplicate track"
                            className="w-6 h-6 rounded flex items-center justify-center text-slate-400 hover:text-slate-200 hover:bg-[#0E1116]"
                          >
                            <Copy className="w-3 h-3" />
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onDeleteTrack(track.id);
                            }}
                            title="Delete track"
                            className="w-6 h-6 rounded flex items-center justify-center text-slate-400 hover:text-red-400 hover:bg-[#0E1116]"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Right Scrollable Waveform Lanes */}
        <div
          ref={laneContainerRef}
          className="flex-1 overflow-x-auto relative bg-[#0E1116]"
        >
          <div style={{ width: timelineWidth }} className="relative min-h-full">
            {/* Bar/Beat Ruler */}
            <div
              style={{ height: RULER_HEIGHT }}
              onPointerDown={handleRulerPointerDown}
              className="sticky top-0 z-20 bg-[#12161D] border-b border-[#2A3241] relative cursor-pointer select-none"
            >
              {loopEnabled && (
                <div
                  style={{
                    left: loopStartSec * pxPerSec,
                    width: Math.max(4, (loopEndSec - loopStartSec) * pxPerSec),
                  }}
                  className="absolute top-0 bottom-0 bg-amber-500/20 border-x border-amber-400/70 pointer-events-none"
                />
              )}

              {barMarkers.map((m) => (
                <div
                  key={m.bar}
                  style={{ left: m.sec * pxPerSec }}
                  className="absolute top-0 bottom-0 border-l border-[#2A3241] pl-1.5 flex items-center"
                >
                  <span className="font-mono-tabular text-[11px] text-slate-400">
                    {m.bar}
                  </span>
                </div>
              ))}
            </div>

            {/* Vertical Bar Gridlines */}
            <div className="relative">
              {barMarkers.map((m) => (
                <div
                  key={`grid-${m.bar}`}
                  style={{ left: m.sec * pxPerSec }}
                  className="absolute top-0 bottom-0 border-l border-[#1C222D] pointer-events-none"
                />
              ))}

              {/* Track Lanes */}
              {tracks.map((track) => {
                const isSelected = track.id === selectedTrackId;
                const hasAudio = Boolean(track.rawBuffer || track.cleanedBuffer);
                const clipDur = Math.max(0, track.trimEndSec - track.trimStartSec);
                const clipLeft = track.startOffsetSec * pxPerSec;
                const clipWidth = Math.max(24, clipDur * pxPerSec);
                const isThisTrackRecording = isRecording && armedTrackId === track.id;

                return (
                  <div
                    key={track.id}
                    onClick={() => onSelectTrack(track.id)}
                    style={{ height: TRACK_ROW_HEIGHT }}
                    className={`relative border-b border-[#2A3241] transition-colors ${
                      isSelected ? 'bg-[#151A22]' : 'bg-[#0E1116]'
                    }`}
                  >
                    {hasAudio && (
                      <div
                        onPointerDown={(e) => handleClipPointerDown(e, track, 'move')}
                        onPointerMove={handleClipPointerMove}
                        onPointerUp={handleClipPointerUp}
                        style={{
                          left: clipLeft,
                          width: clipWidth,
                          borderColor: isSelected ? track.color : '#334155',
                        }}
                        className={`absolute top-2 bottom-2 rounded-md border bg-[#1B222D] overflow-hidden select-none group ${
                          canEdit ? 'cursor-grab active:cursor-grabbing' : 'cursor-default'
                        }`}
                      >
                        {/* Top Clip Label */}
                        <div
                          style={{ backgroundColor: `${track.color}24` }}
                          className="h-5 px-2 flex items-center justify-between text-[11px] font-medium text-slate-200 border-b border-white/5"
                        >
                          <span className="truncate">
                            {track.name} · {track.aiDenoiseEnabled ? 'AI Clean' : 'Raw'}
                          </span>
                          <span className="font-mono-tabular text-[10px] text-slate-400 shrink-0 ml-2">
                            {clipDur.toFixed(1)}s
                          </span>
                        </div>

                        {/* Peak Waveform SVG */}
                        <div className="h-[calc(100%-20px)] w-full px-1 flex items-center">
                          <svg
                            viewBox={`0 0 ${Math.max(1, track.peaks.length)} 40`}
                            preserveAspectRatio="none"
                            className="w-full h-full"
                          >
                            {track.peaks.map((pk, idx) => {
                              const h = Math.max(2, pk * 36);
                              const y = (40 - h) / 2;
                              return (
                                <rect
                                  key={idx}
                                  x={idx}
                                  y={y}
                                  width={0.75}
                                  height={h}
                                  fill={track.muted ? '#475569' : track.color}
                                  opacity={track.muted ? 0.45 : 0.9}
                                />
                              );
                            })}
                          </svg>
                        </div>

                        {/* Left & Right Trim Handles */}
                        {canEdit && (
                          <>
                            <div
                              onPointerDown={(e) => handleClipPointerDown(e, track, 'trimStart')}
                              title="Drag to trim start"
                              className="absolute left-0 top-0 bottom-0 w-2 cursor-ew-resize bg-transparent hover:bg-amber-400/50 transition-colors"
                            />
                            <div
                              onPointerDown={(e) => handleClipPointerDown(e, track, 'trimEnd')}
                              title="Drag to trim end"
                              className="absolute right-0 top-0 bottom-0 w-2 cursor-ew-resize bg-transparent hover:bg-amber-400/50 transition-colors"
                            />
                          </>
                        )}
                      </div>
                    )}

                    {/* Empty armed track prompt */}
                    {!hasAudio && !isThisTrackRecording && (
                      <div className="h-full flex items-center px-4 text-xs text-slate-500">
                        {armedTrackId === track.id
                          ? 'Armed for microphone capture — press Record in the transport bar.'
                          : 'Empty track — arm mic to record or import an audio file.'}
                      </div>
                    )}

                    {/* Live Recording Waveform Strip */}
                    {isThisTrackRecording && (
                      <div
                        style={{
                          left: recordingStartSec * pxPerSec,
                          width: Math.max(36, (playheadSec - recordingStartSec) * pxPerSec),
                        }}
                        className="absolute top-2 bottom-2 rounded-md border border-red-500 bg-red-950/40 overflow-hidden px-1 flex items-center"
                      >
                        <div className="flex items-center gap-0.5 w-full h-10">
                          {liveRecordingPeaks.map((p, i) => (
                            <div
                              key={i}
                              style={{ height: `${Math.max(8, p * 100)}%` }}
                              className="flex-1 bg-red-400 rounded-xs"
                            />
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}

              {/* Playhead Line */}
              <div
                style={{ left: playheadSec * pxPerSec }}
                className="absolute top-0 bottom-0 w-[2px] bg-[#E59A3C] pointer-events-none z-30"
              >
                <div className="w-2.5 h-2.5 -ml-[4px] -mt-1 bg-[#E59A3C] rotate-45" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
