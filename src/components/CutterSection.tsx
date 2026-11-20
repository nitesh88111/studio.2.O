import { useEffect, useState } from 'react';
import {
  ArrowRight,
  Download,
  Play,
  Scissors,
  Sparkles,
  Trash2,
  Upload,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import {
  applyFade,
  formatTime,
  parseTimeInput,
  removeAudioRegion,
  sliceAudioBuffer,
  splitAudioBufferKeepSegment,
} from '../audio/audioEngine';
import type { CutterParams, TimeSelection } from '../types/audio';
import { WaveformCanvas } from './WaveformCanvas';

interface CutterSectionProps {
  activeBuffer: AudioBuffer | null;
  currentTime: number;
  selection: TimeSelection | null;
  cutterParams: CutterParams;
  onSeek: (time: number) => void;
  onSelectionChange: (sel: TimeSelection | null) => void;
  onCutterParamsChange: (patch: Partial<CutterParams>) => void;
  onBeginDragHistory: (label: string) => void;
  onEndDragHistory: () => void;
  onRecordDiscreteHistory: (label: string) => void;
  onRecordCoalescedHistory: (key: string, label: string) => void;
  onPreviewRegion: (start: number, end: number) => void;
  onCommitEdit: (newBuffer: AudioBuffer, label: string, newSelection?: TimeSelection | null) => void;
  onExport: () => void;
  onNext: () => void;
  onUploadRequest: () => void;
}

export function CutterSection({
  activeBuffer,
  currentTime,
  selection,
  cutterParams,
  onSeek,
  onSelectionChange,
  onCutterParamsChange,
  onBeginDragHistory,
  onEndDragHistory,
  onRecordDiscreteHistory,
  onRecordCoalescedHistory,
  onPreviewRegion,
  onCommitEdit,
  onExport,
  onNext,
  onUploadRequest,
}: CutterSectionProps) {
  const [zoom, setZoom] = useState(1);
  const [startInput, setStartInput] = useState('00:00.00');
  const [endInput, setEndInput] = useState('00:00.00');
  const [localError, setLocalError] = useState<string | null>(null);

  const { fadeInDur, fadeOutDur } = cutterParams;

  useEffect(() => {
    if (selection) {
      setStartInput(formatTime(selection.start));
      setEndInput(formatTime(selection.end));
    } else if (activeBuffer) {
      setStartInput('00:00.00');
      setEndInput(formatTime(activeBuffer.duration));
    }
  }, [selection, activeBuffer]);

  if (!activeBuffer) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-12 text-center">
        <div className="rounded-3xl border border-[#D4AF37]/30 bg-[#101014]/82 backdrop-blur-xl p-10">
          <Scissors className="mx-auto h-10 w-10 text-[#E5C158] mb-3" />
          <h2 className="font-display text-2xl font-bold text-[#F5F3EE]">Audio Cutter</h2>
          <p className="mt-2 text-sm text-[#B8B2A6]">
            Upload an audio file first to view its waveform, select regions, trim, split, and add fades.
          </p>
          <button
            type="button"
            onClick={onUploadRequest}
            className="mt-6 inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-[#E5C158]/70 bg-gradient-to-b from-[#E5C158] to-[#C59B27] px-6 py-2.5 text-sm font-semibold text-[#09090C] cursor-pointer"
          >
            <Upload className="h-4 w-4" />
            <span>Add Audio File</span>
          </button>
        </div>
      </div>
    );
  }

  const hasSelection = Boolean(selection && selection.end - selection.start >= 0.05);
  const selectionTooltip = 'Select a region on the waveform first.';
  const canSplit = currentTime > 0.05 && currentTime < activeBuffer.duration - 0.05;

  const applyManualTimestamps = () => {
    setLocalError(null);
    const s = parseTimeInput(startInput);
    const e = parseTimeInput(endInput);
    if (s === null || e === null) {
      setLocalError('Use mm:ss.ms (e.g. 00:15.50) or seconds (e.g. 15.5).');
      return;
    }
    const clampedStart = Math.max(0, Math.min(activeBuffer.duration - 0.05, s));
    const clampedEnd = Math.max(clampedStart + 0.05, Math.min(activeBuffer.duration, e));
    onRecordDiscreteHistory('Set Selection Range');
    onSelectionChange({ start: clampedStart, end: clampedEnd });
  };

  const handleKeepSelected = () => {
    if (!selection) return;
    setLocalError(null);
    const sliced = sliceAudioBuffer(activeBuffer, selection.start, selection.end);
    onCommitEdit(sliced, 'Trim (Keep Selection)', null);
  };

  const handleRemoveSelected = () => {
    if (!selection) return;
    setLocalError(null);
    try {
      const updated = removeAudioRegion(activeBuffer, selection.start, selection.end);
      onCommitEdit(updated, 'Remove Selected Region', null);
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Unable to remove region.');
    }
  };

  const handleSplit = (keepSide: 'first' | 'second') => {
    if (!canSplit) return;
    setLocalError(null);
    const updated = splitAudioBufferKeepSegment(activeBuffer, currentTime, keepSide);
    onCommitEdit(
      updated,
      keepSide === 'first' ? 'Split (Keep Left)' : 'Split (Keep Right)',
      null
    );
  };

  const handleFadeSelection = (type: 'in' | 'out') => {
    if (!selection) return;
    setLocalError(null);
    const updated = applyFade(activeBuffer, type, selection.start, selection.end);
    onCommitEdit(updated, type === 'in' ? 'Fade In Selection' : 'Fade Out Selection', selection);
  };

  const handleFadeTrackEdge = (type: 'in' | 'out') => {
    setLocalError(null);
    const dur = Math.min(activeBuffer.duration * 0.9, type === 'in' ? fadeInDur : fadeOutDur);
    const start = type === 'in' ? 0 : Math.max(0, activeBuffer.duration - dur);
    const end = type === 'in' ? dur : activeBuffer.duration;
    const updated = applyFade(activeBuffer, type, start, end);
    onCommitEdit(updated, type === 'in' ? `Fade In (${dur.toFixed(1)}s)` : `Fade Out (${dur.toFixed(1)}s)`, selection);
  };

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-4 space-y-5">
      <div className="rounded-3xl border border-[#D4AF37]/30 bg-[#101014]/82 backdrop-blur-2xl p-5 sm:p-6 shadow-[0_24px_80px_rgba(0,0,0,0.75)] space-y-5">
        {/* Header & Zoom Controls */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-display text-xl sm:text-2xl font-bold text-[#F5F3EE]">
              Audio Cutter
            </h2>
            <p className="text-xs sm:text-sm text-[#9E988E]">
              Drag across the waveform to select a region, or click to move the playhead.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setZoom((z) => Math.max(1, z / 2))}
              disabled={zoom <= 1}
              aria-label="Zoom out"
              className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-white/15 bg-white/5 text-[#F5F3EE] hover:border-[#D4AF37]/50 disabled:opacity-35 cursor-pointer"
            >
              <ZoomOut className="h-4 w-4" />
            </button>
            <span className="min-w-[44px] text-center font-mono text-xs tabular-nums text-[#F4D97B]">
              {zoom}x
            </span>
            <button
              type="button"
              onClick={() => setZoom((z) => Math.min(16, z * 2))}
              disabled={zoom >= 16}
              aria-label="Zoom in"
              className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-white/15 bg-white/5 text-[#F5F3EE] hover:border-[#D4AF37]/50 disabled:opacity-35 cursor-pointer"
            >
              <ZoomIn className="h-4 w-4" />
            </button>
            {hasSelection && (
              <button
                type="button"
                onClick={() => {
                  onRecordDiscreteHistory('Clear Selection');
                  onSelectionChange(null);
                }}
                className="min-h-[40px] rounded-xl border border-white/15 bg-white/5 px-3 text-xs font-medium text-[#C8C2B6] hover:text-white cursor-pointer"
              >
                Clear Selection
              </button>
            )}
          </div>
        </div>

        {/* Main Interactive Waveform */}
        <WaveformCanvas
          buffer={activeBuffer}
          currentTime={currentTime}
          selection={selection}
          zoom={zoom}
          height={212}
          onSeek={onSeek}
          onSelectionChange={onSelectionChange}
          onInteractionStart={onBeginDragHistory}
          onInteractionEnd={onEndDragHistory}
        />

        {hasSelection && (
          <p className="text-[11px] text-[#B8B2A6]">
            Drag the top <span className="font-semibold text-[#F4D97B]">IN</span> or bottom{' '}
            <span className="font-semibold text-[#E5C158]">OUT</span> handle to fine-tune boundaries, or click the top time ruler to move the playhead.
          </p>
        )}

        {localError && (
          <p className="rounded-xl border border-red-500/40 bg-red-950/60 px-4 py-2.5 text-xs text-red-200">
            {localError}
          </p>
        )}

        {/* Middle Editing Area: Left/Center Precision + Trim/Split | Right Dedicated Fade In / Fade Out */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
          {/* Left & Center: Precision Timestamps + Cutting Controls */}
          <div className="lg:col-span-8 space-y-4 rounded-2xl border border-white/10 bg-[#0B0B0F]/75 p-4 sm:p-5">
            {/* Manual Start / End Timestamps */}
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <label htmlFor="sel-start" className="block text-[11px] font-medium text-[#9E988E] mb-1">
                  Selection Start
                </label>
                <input
                  id="sel-start"
                  type="text"
                  value={startInput}
                  onChange={(e) => setStartInput(e.target.value)}
                  className="w-28 min-h-[42px] rounded-xl border border-[#D4AF37]/25 bg-[#121216] px-3 py-2 font-mono text-xs tabular-nums text-[#F5F3EE] focus:border-[#E5C158] focus:outline-none"
                />
              </div>
              <div>
                <label htmlFor="sel-end" className="block text-[11px] font-medium text-[#9E988E] mb-1">
                  Selection End
                </label>
                <input
                  id="sel-end"
                  type="text"
                  value={endInput}
                  onChange={(e) => setEndInput(e.target.value)}
                  className="w-28 min-h-[42px] rounded-xl border border-[#D4AF37]/25 bg-[#121216] px-3 py-2 font-mono text-xs tabular-nums text-[#F5F3EE] focus:border-[#E5C158] focus:outline-none"
                />
              </div>
              <button
                type="button"
                onClick={applyManualTimestamps}
                className="min-h-[42px] rounded-xl border border-[#D4AF37]/35 bg-[#D4AF37]/15 px-4 py-2 text-xs font-semibold text-[#F4D97B] hover:bg-[#D4AF37]/25 transition-colors cursor-pointer"
              >
                Set Selection
              </button>
              {hasSelection && selection && (
                <span className="text-xs font-mono tabular-nums text-[#C8C2B6] pb-2.5">
                  Selected: {formatTime(selection.end - selection.start)}
                </span>
              )}
            </div>

            {/* Selection-Aware Cut & Trim Actions */}
            <div className="pt-2 border-t border-white/10">
              <div className="flex items-center justify-between mb-2.5">
                <span className="text-xs font-semibold text-[#C8C2B6]">Cut & Trim Operations</span>
                {!hasSelection && (
                  <span className="text-[11px] text-[#E5C158]/80">
                    Select a region on the waveform first
                  </span>
                )}
              </div>

              <div className="flex flex-wrap gap-2.5">
                <button
                  type="button"
                  disabled={!hasSelection}
                  title={hasSelection ? 'Preview only the selected region' : selectionTooltip}
                  onClick={() => selection && onPreviewRegion(selection.start, selection.end)}
                  className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-[#D4AF37]/35 bg-[#16161C] px-4 py-2 text-xs sm:text-sm font-medium text-[#F5F3EE] hover:border-[#E5C158] disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                >
                  <Play className="h-4 w-4 text-[#E5C158]" />
                  <span>Preview Selection</span>
                </button>

                <button
                  type="button"
                  disabled={!hasSelection}
                  title={hasSelection ? 'Keep only the selected region' : selectionTooltip}
                  onClick={handleKeepSelected}
                  className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-[#D4AF37]/45 bg-[#D4AF37]/18 px-4 py-2 text-xs sm:text-sm font-semibold text-[#F4D97B] hover:bg-[#D4AF37]/28 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                >
                  <Scissors className="h-4 w-4" />
                  <span>Trim (Keep Selected)</span>
                </button>

                <button
                  type="button"
                  disabled={!hasSelection}
                  title={hasSelection ? 'Delete the selected region from track' : selectionTooltip}
                  onClick={handleRemoveSelected}
                  className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-red-500/35 bg-red-500/12 px-4 py-2 text-xs sm:text-sm font-medium text-red-200 hover:bg-red-500/22 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                >
                  <Trash2 className="h-4 w-4" />
                  <span>Remove Selected</span>
                </button>
              </div>
            </div>

            {/* Split at Playhead */}
            <div className="pt-2 border-t border-white/10">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold text-[#C8C2B6]">
                  Split at Playhead ({formatTime(currentTime)})
                </span>
                {!canSplit && (
                  <span className="text-[11px] text-[#9E988E]">
                    Move playhead inside track to split
                  </span>
                )}
              </div>
              <div className="flex flex-wrap gap-2.5">
                <button
                  type="button"
                  disabled={!canSplit}
                  onClick={() => handleSplit('first')}
                  className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-white/15 bg-white/5 px-3.5 py-2 text-xs font-medium text-[#D8D3C8] hover:border-[#D4AF37]/40 hover:text-white disabled:opacity-35 disabled:cursor-not-allowed cursor-pointer"
                >
                  <span>Cut & Keep Before Playhead</span>
                </button>
                <button
                  type="button"
                  disabled={!canSplit}
                  onClick={() => handleSplit('second')}
                  className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-white/15 bg-white/5 px-3.5 py-2 text-xs font-medium text-[#D8D3C8] hover:border-[#D4AF37]/40 hover:text-white disabled:opacity-35 disabled:cursor-not-allowed cursor-pointer"
                >
                  <span>Cut & Keep After Playhead</span>
                </button>
              </div>
            </div>
          </div>

          {/* Right Side of Middle Area: Dedicated Fade In & Fade Out Controls */}
          <div className="lg:col-span-4 space-y-4 rounded-2xl border border-[#D4AF37]/30 bg-[#14141A]/85 p-4 sm:p-5">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-[#E5C158]" />
              <h3 className="font-display text-base font-semibold text-[#F5F3EE]">
                Fade Controls
              </h3>
            </div>

            {/* Fade In */}
            <div className="space-y-2 rounded-xl border border-white/10 bg-[#0B0B0F]/80 p-3.5">
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-[#F5F3EE]">Fade In</span>
                <span className="font-mono tabular-nums text-[#F4D97B]">
                  {fadeInDur.toFixed(1)}s
                </span>
              </div>
              <input
                type="range"
                min={0.5}
                max={10}
                step={0.5}
                value={fadeInDur}
                onPointerDown={() => onBeginDragHistory('Adjust Fade In Duration')}
                onPointerUp={onEndDragHistory}
                onPointerCancel={onEndDragHistory}
                onKeyDown={(e) => {
                  if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key)) {
                    onRecordCoalescedHistory('cutter-fade-in', 'Adjust Fade In Duration');
                  }
                }}
                onChange={(e) => onCutterParamsChange({ fadeInDur: Number(e.target.value) })}
                aria-label="Fade in duration"
                className="studio-slider w-full"
              />
              <div className="grid grid-cols-2 gap-2 pt-1">
                <button
                  type="button"
                  disabled={!hasSelection}
                  title={hasSelection ? 'Fade in selected region' : selectionTooltip}
                  onClick={() => handleFadeSelection('in')}
                  className="min-h-[42px] rounded-lg border border-[#D4AF37]/35 bg-[#D4AF37]/15 px-2.5 py-1.5 text-[11px] font-semibold text-[#F4D97B] hover:bg-[#D4AF37]/25 disabled:opacity-35 disabled:cursor-not-allowed cursor-pointer"
                >
                  Fade Selection
                </button>
                <button
                  type="button"
                  onClick={() => handleFadeTrackEdge('in')}
                  className="min-h-[42px] rounded-lg border border-white/15 bg-white/5 px-2.5 py-1.5 text-[11px] font-medium text-[#D8D3C8] hover:border-[#D4AF37]/40 hover:text-white cursor-pointer"
                >
                  Fade Intro ({fadeInDur.toFixed(1)}s)
                </button>
              </div>
            </div>

            {/* Fade Out */}
            <div className="space-y-2 rounded-xl border border-white/10 bg-[#0B0B0F]/80 p-3.5">
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-[#F5F3EE]">Fade Out</span>
                <span className="font-mono tabular-nums text-[#F4D97B]">
                  {fadeOutDur.toFixed(1)}s
                </span>
              </div>
              <input
                type="range"
                min={0.5}
                max={10}
                step={0.5}
                value={fadeOutDur}
                onPointerDown={() => onBeginDragHistory('Adjust Fade Out Duration')}
                onPointerUp={onEndDragHistory}
                onPointerCancel={onEndDragHistory}
                onKeyDown={(e) => {
                  if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key)) {
                    onRecordCoalescedHistory('cutter-fade-out', 'Adjust Fade Out Duration');
                  }
                }}
                onChange={(e) => onCutterParamsChange({ fadeOutDur: Number(e.target.value) })}
                aria-label="Fade out duration"
                className="studio-slider w-full"
              />
              <div className="grid grid-cols-2 gap-2 pt-1">
                <button
                  type="button"
                  disabled={!hasSelection}
                  title={hasSelection ? 'Fade out selected region' : selectionTooltip}
                  onClick={() => handleFadeSelection('out')}
                  className="min-h-[42px] rounded-lg border border-[#D4AF37]/35 bg-[#D4AF37]/15 px-2.5 py-1.5 text-[11px] font-semibold text-[#F4D97B] hover:bg-[#D4AF37]/25 disabled:opacity-35 disabled:cursor-not-allowed cursor-pointer"
                >
                  Fade Selection
                </button>
                <button
                  type="button"
                  onClick={() => handleFadeTrackEdge('out')}
                  className="min-h-[42px] rounded-lg border border-white/15 bg-white/5 px-2.5 py-1.5 text-[11px] font-medium text-[#D8D3C8] hover:border-[#D4AF37]/40 hover:text-white cursor-pointer"
                >
                  Fade Outro ({fadeOutDur.toFixed(1)}s)
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Cutter Bottom Controls: Export & Next */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-4 border-t border-white/10">
          <button
            type="button"
            onClick={onExport}
            className="inline-flex min-h-[46px] items-center gap-2 rounded-xl border border-[#D4AF37]/45 bg-[#D4AF37]/15 px-6 py-2.5 text-sm font-semibold text-[#F4D97B] hover:bg-[#D4AF37]/25 transition-colors cursor-pointer"
          >
            <Download className="h-4 w-4" />
            <span>Export</span>
          </button>

          <button
            type="button"
            onClick={onNext}
            className="inline-flex min-h-[46px] items-center gap-2 rounded-xl border border-[#E5C158]/70 bg-gradient-to-b from-[#E5C158] to-[#C59B27] px-6 py-2.5 text-sm font-semibold text-[#09090C] hover:brightness-105 transition-all cursor-pointer"
          >
            <span>Next: Joiner</span>
            <ArrowRight className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
