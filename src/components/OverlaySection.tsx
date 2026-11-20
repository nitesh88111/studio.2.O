import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowRight,
  Check,
  Download,
  GripHorizontal,
  Layers,
  Loader2,
  Play,
  Plus,
  Square,
  Trash2,
  Upload,
} from 'lucide-react';
import {
  computeWaveformPeaks,
  decodeAudioFile,
  formatTime,
  getAudioContext,
  mixOverlayTracks,
  sliceAudioBuffer,
} from '../audio/audioEngine';
import { BRAND_CONFIG } from '../config/brand';
import type { OverlayState, OverlayTrack } from '../types/audio';

interface OverlaySectionProps {
  activeBuffer: AudioBuffer | null;
  activeFileName: string;
  overlayState: OverlayState;
  onOverlayStateChange: (next: OverlayState) => void;
  onBeginDragHistory: (label: string) => void;
  onEndDragHistory: () => void;
  onRecordDiscreteHistory: (label: string) => void;
  onRecordCoalescedHistory: (key: string, label: string) => void;
  commitPendingRef?: React.MutableRefObject<(() => boolean) | null>;
  getExportBufferRef?: React.MutableRefObject<
    (() => { buffer: AudioBuffer; name: string } | null) | null
  >;
  onCommitEdit: (
    newBuffer: AudioBuffer,
    label: string,
    overrides?: { overlayState?: OverlayState }
  ) => void;
  onExportCustomBuffer: (buffer: AudioBuffer, fileName: string) => void;
  onNext: () => void;
  onUploadRequest: () => void;
}

function MiniWaveformStrip({
  buffer,
  trimStart,
  trimEnd,
  color = '#E5C158',
}: {
  buffer: AudioBuffer;
  trimStart: number;
  trimEnd: number;
  color?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const peaks = useMemo(() => computeWaveformPeaks(buffer, 280), [buffer]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const width = Math.max(40, canvas.clientWidth || 240);
    const height = Math.max(24, canvas.clientHeight || 40);
    const dpr = Math.min(2, window.devicePixelRatio || 1);

    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, width, height);

    const duration = Number.isFinite(buffer.duration) && buffer.duration > 0 ? buffer.duration : 1;
    const total = peaks.maxs.length;
    if (total <= 0) return;

    const safeTrimStart = Math.max(0, Math.min(duration, Number.isFinite(trimStart) ? trimStart : 0));
    const safeTrimEnd = Math.max(
      safeTrimStart,
      Math.min(duration, Number.isFinite(trimEnd) ? trimEnd : duration)
    );

    const startIdx = Math.max(0, Math.min(total - 1, Math.floor((safeTrimStart / duration) * total)));
    const endIdx = Math.max(startIdx + 1, Math.min(total, Math.floor((safeTrimEnd / duration) * total)));
    const sliceCount = Math.max(1, endIdx - startIdx);

    const midY = height / 2;
    const barStep = Math.max(2, width / 120);
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.85;

    for (let x = 0; x < width; x += barStep) {
      const idx = Math.min(total - 1, startIdx + Math.floor((x / width) * sliceCount));
      const amp = Math.max(Math.abs(peaks.mins[idx] || 0), Math.abs(peaks.maxs[idx] || 0));
      const barH = Math.max(2, amp * (height * 0.86));
      ctx.fillRect(x, midY - barH / 2, Math.max(1, barStep - 1), barH);
    }
  }, [peaks, buffer.duration, trimStart, trimEnd, color]);

  return <canvas ref={canvasRef} className="h-full w-full block pointer-events-none" />;
}

export function OverlaySection({
  activeBuffer,
  activeFileName,
  overlayState,
  onOverlayStateChange,
  onBeginDragHistory,
  onEndDragHistory,
  onRecordDiscreteHistory,
  onRecordCoalescedHistory,
  commitPendingRef,
  getExportBufferRef,
  onCommitEdit,
  onExportCustomBuffer,
  onNext,
  onUploadRequest,
}: OverlaySectionProps) {
  const { mainVolume, overlays } = overlayState;
  const [isLoadingOverlay, setIsLoadingOverlay] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [playheadSec, setPlayheadSec] = useState(0);
  const [appliedFlash, setAppliedFlash] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const timelineRef = useRef<HTMLDivElement>(null);
  const activeSourcesRef = useRef<AudioBufferSourceNode[]>([]);
  const activeGainsRef = useRef<GainNode[]>([]);
  const rafRef = useRef<number | null>(null);
  const isMountedRef = useRef(true);
  const dragRef = useRef<{ id: string; startX: number; initialOffset: number } | null>(null);
  const overlayStateRef = useRef(overlayState);
  overlayStateRef.current = overlayState;

  const stopPreview = () => {
    for (const node of activeSourcesRef.current) {
      try {
        node.onended = null;
        node.stop();
      } catch {
        // ignore already stopped sources
      }
      try {
        node.disconnect();
      } catch {
        // ignore
      }
    }
    for (const gain of activeGainsRef.current) {
      try {
        gain.disconnect();
      } catch {
        // ignore
      }
    }
    activeSourcesRef.current = [];
    activeGainsRef.current = [];

    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (isMountedRef.current) {
      setIsPreviewing(false);
      setPlayheadSec(0);
    }
  };

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      stopPreview();
    };
  }, []);

  // Stop active preview cleanly if the underlying buffer swaps (e.g. Undo/Redo or Clear)
  useEffect(() => {
    stopPreview();
    setError(null);
  }, [activeBuffer]);

  const hasPendingOverlayChanges =
    Boolean(activeBuffer) && (overlays.length > 0 || Math.abs(mainVolume - 1) > 0.01);

  const commitOverlayChanges = (): boolean => {
    if (!activeBuffer || !hasPendingOverlayChanges) {
      return true;
    }
    setError(null);
    stopPreview();
    try {
      const mixed = mixOverlayTracks(activeBuffer, mainVolume, overlays);
      const label =
        overlays.length > 0
          ? `Overlay Mix (${overlays.length} ${overlays.length === 1 ? 'overlay' : 'overlays'})`
          : 'Main Track Volume';
      onCommitEdit(mixed, label, {
        overlayState: { mainVolume: 1, overlays: [] },
      });
      return true;
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Failed to mix overlay tracks into the active track.'
      );
      return false;
    }
  };

  useEffect(() => {
    if (commitPendingRef) {
      commitPendingRef.current = () => commitOverlayChanges();
    }
    if (getExportBufferRef) {
      getExportBufferRef.current = () => {
        if (!activeBuffer || !hasPendingOverlayChanges) return null;
        try {
          const mixed = mixOverlayTracks(activeBuffer, mainVolume, overlays);
          return { buffer: mixed, name: 'overlaid-event-mix' };
        } catch {
          return null;
        }
      };
    }
    return () => {
      if (commitPendingRef) commitPendingRef.current = null;
      if (getExportBufferRef) getExportBufferRef.current = null;
    };
  });

  if (!activeBuffer) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-12 text-center">
        <div className="rounded-3xl border border-[#D4AF37]/30 bg-[#101014]/82 backdrop-blur-xl p-10">
          <Layers className="mx-auto h-10 w-10 text-[#E5C158] mb-3" />
          <h2 className="font-display text-2xl font-bold text-[#F5F3EE]">Audio Overlay & Mixing</h2>
          <p className="mt-2 text-sm text-[#B8B2A6]">
            Upload a main song first, then layer up to 2 voiceovers, announcements, or sound effects on top.
          </p>
          <button
            type="button"
            onClick={onUploadRequest}
            className="mt-6 inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-[#E5C158]/70 bg-gradient-to-b from-[#E5C158] to-[#C59B27] px-6 py-2.5 text-sm font-semibold text-[#09090C] cursor-pointer"
          >
            <Upload className="h-4 w-4" />
            <span>Add Main Track</span>
          </button>
        </div>
      </div>
    );
  }

  const maxOverlays = BRAND_CONFIG.maxOverlayTracks;
  const isAtLimit = overlays.length >= maxOverlays;
  const safeMainDuration =
    Number.isFinite(activeBuffer.duration) && activeBuffer.duration > 0 ? activeBuffer.duration : 0.1;

  const timelineDuration = Math.max(
    0.1,
    safeMainDuration,
    ...overlays.map((o) => {
      const offset = Number.isFinite(o.startOffsetSec) ? Math.max(0, o.startOffsetSec) : 0;
      const span = Math.max(0.05, (Number.isFinite(o.trimEnd) ? o.trimEnd : o.buffer.duration) - (Number.isFinite(o.trimStart) ? o.trimStart : 0));
      return offset + span;
    })
  );

  const handleAddOverlayFile = async (file: File | null) => {
    if (!file || isLoadingOverlay || isAtLimit) return;
    stopPreview();
    setIsLoadingOverlay(true);
    setError(null);

    try {
      const decoded = await decodeAudioFile(file);
      if (!isMountedRef.current) return;

      const latest = overlayStateRef.current;
      if (latest.overlays.length >= maxOverlays) return;

      onRecordDiscreteHistory('Add Overlay Track');
      const safeDur = Math.max(0.05, decoded.duration);
      onOverlayStateChange({
        ...latest,
        overlays: [
          ...latest.overlays,
          {
            id: `ov-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            name: file.name || 'Overlay Track',
            buffer: decoded,
            startOffsetSec: 0,
            trimStart: 0,
            trimEnd: safeDur,
            volume: 0.9,
          },
        ],
      });
    } catch (err) {
      if (isMountedRef.current) {
        setError(
          err instanceof Error
            ? err.message
            : 'Unable to decode this overlay audio file. Please try another file.'
        );
      }
    } finally {
      if (isMountedRef.current) {
        setIsLoadingOverlay(false);
      }
    }
  };

  const updateOverlay = (id: string, patch: Partial<OverlayTrack>) => {
    const latest = overlayStateRef.current;
    onOverlayStateChange({
      ...latest,
      overlays: latest.overlays.map((o) => (o.id === id ? { ...o, ...patch } : o)),
    });
  };

  const removeOverlay = (id: string) => {
    stopPreview();
    setError(null);
    onRecordDiscreteHistory('Remove Overlay Track');
    const latest = overlayStateRef.current;
    onOverlayStateChange({
      ...latest,
      overlays: latest.overlays.filter((o) => o.id !== id),
    });
  };

  const handleTogglePreviewMix = async () => {
    if (isPreviewing) {
      stopPreview();
      return;
    }
    setError(null);
    stopPreview();

    try {
      const ctx = getAudioContext();
      if (ctx.state === 'suspended') {
        await ctx.resume();
      }
      if (!isMountedRef.current) return;
      const now = ctx.currentTime + 0.05;
      const sources: AudioBufferSourceNode[] = [];
      const gains: GainNode[] = [];

      // Main track
      const mainSrc = ctx.createBufferSource();
      mainSrc.buffer = activeBuffer;
      const mainGain = ctx.createGain();
      mainGain.gain.value = Number.isFinite(mainVolume) ? mainVolume : 1;
      mainSrc.connect(mainGain);
      mainGain.connect(ctx.destination);
      mainSrc.start(now, 0);
      sources.push(mainSrc);
      gains.push(mainGain);

      // Overlays
      for (const ov of overlays) {
        const trimmed = sliceAudioBuffer(ov.buffer, ov.trimStart, ov.trimEnd);
        const ovSrc = ctx.createBufferSource();
        ovSrc.buffer = trimmed;
        const ovGain = ctx.createGain();
        ovGain.gain.value = Number.isFinite(ov.volume) ? ov.volume : 1;
        ovSrc.connect(ovGain);
        ovGain.connect(ctx.destination);
        const safeOffset = Number.isFinite(ov.startOffsetSec) ? Math.max(0, ov.startOffsetSec) : 0;
        ovSrc.start(now + safeOffset, 0);
        sources.push(ovSrc);
        gains.push(ovGain);
      }

      activeSourcesRef.current = sources;
      activeGainsRef.current = gains;
      setIsPreviewing(true);

      const tick = () => {
        const elapsed = ctx.currentTime - now;
        if (elapsed >= timelineDuration) {
          stopPreview();
          return;
        }
        setPlayheadSec(Math.max(0, elapsed));
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
    } catch (err) {
      stopPreview();
      setError(
        err instanceof Error ? err.message : 'Unable to preview the overlay mix right now.'
      );
    }
  };

  const handleCommitMix = () => {
    if (!hasPendingOverlayChanges) return;
    if (commitOverlayChanges()) {
      setAppliedFlash(true);
      window.setTimeout(() => {
        if (isMountedRef.current) setAppliedFlash(false);
      }, 2000);
    }
  };

  const handleExportMix = () => {
    setError(null);
    stopPreview();
    try {
      const mixed = mixOverlayTracks(activeBuffer, mainVolume, overlays);
      onExportCustomBuffer(mixed, 'overlaid-event-mix');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to prepare overlay mix for export.');
    }
  };

  const handleNextStep = () => {
    if (commitOverlayChanges()) {
      onNext();
    }
  };

  // Horizontal timeline drag handlers (mouse + touch)
  const onClipPointerDown = (e: React.PointerEvent<HTMLDivElement>, track: OverlayTrack) => {
    e.stopPropagation();
    onBeginDragHistory('Move Overlay Position');
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // ignore if capture unsupported
    }
    dragRef.current = {
      id: track.id,
      startX: e.clientX,
      initialOffset: Number.isFinite(track.startOffsetSec) ? track.startOffsetSec : 0,
    };
  };

  const onClipPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || !timelineRef.current) return;
    e.stopPropagation();
    const laneWidth = Math.max(1, timelineRef.current.clientWidth);
    const deltaX = e.clientX - drag.startX;
    const deltaSec = (deltaX / laneWidth) * timelineDuration;
    const nextOffset = Math.max(0, Math.min(timelineDuration, drag.initialOffset + deltaSec));
    updateOverlay(drag.id, { startOffsetSec: Number(nextOffset.toFixed(2)) });
  };

  const onClipPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    e.stopPropagation();
    dragRef.current = null;
    onEndDragHistory();
  };

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-4">
      <input
        ref={fileInputRef}
        type="file"
        accept="audio/*,.mp3,.wav,.m4a,.ogg,.aac,.flac"
        className="hidden"
        onChange={(e) => {
          // Capture File reference BEFORE resetting input.value so live FileList isn't wiped
          const pickedFile = e.target.files?.[0] ?? null;
          e.target.value = '';
          if (pickedFile) {
            void handleAddOverlayFile(pickedFile);
          }
        }}
      />

      <div className="rounded-3xl border border-[#D4AF37]/30 bg-[#101014]/82 backdrop-blur-2xl p-5 sm:p-6 shadow-[0_24px_80px_rgba(0,0,0,0.75)] space-y-5">
        {/* Header & Limit Counter */}
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="font-display text-xl sm:text-2xl font-bold text-[#F5F3EE]">
              Audio Overlay & Mixing
            </h2>
            <p className="text-xs sm:text-sm text-[#9E988E]">
              Drag overlay tracks horizontally along the timeline to align voiceovers or sound cues over your main song.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <span className="text-xs font-mono tabular-nums text-[#F4D97B]">
              Overlay Tracks: {overlays.length} / {maxOverlays}
            </span>
            <button
              type="button"
              disabled={isAtLimit || isLoadingOverlay}
              title={
                isAtLimit
                  ? 'Maximum of 2 overlay tracks reached. Remove one to add another.'
                  : 'Add an overlay audio track'
              }
              onClick={() => fileInputRef.current?.click()}
              className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-[#E5C158]/60 bg-[#D4AF37]/18 px-4 py-2 text-sm font-semibold text-[#F4D97B] hover:bg-[#D4AF37]/28 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
            >
              {isLoadingOverlay ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>Loading waveform...</span>
                </>
              ) : (
                <>
                  <Plus className="h-4 w-4" />
                  <span>Add Overlay Track</span>
                </>
              )}
            </button>
          </div>
        </div>

        {error && (
          <div
            role="alert"
            className="flex items-start gap-3 rounded-xl border border-red-500/40 bg-red-950/60 px-4 py-3 text-xs sm:text-sm text-red-200"
          >
            <AlertCircle className="h-5 w-5 shrink-0 text-red-400 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {/* Multi-Track Timeline Canvas */}
        <div
          data-gesture-lock="true"
          className="rounded-2xl border border-[#D4AF37]/25 bg-[#09090C]/85 p-4 space-y-4"
        >
          {/* Timeline Scale Header */}
          <div className="flex items-center justify-between text-[11px] font-mono tabular-nums text-[#9E988E]">
            <span>00:00.00</span>
            <span>Timeline Span: {formatTime(timelineDuration)}</span>
          </div>

          <div ref={timelineRef} className="relative space-y-3">
            {/* Synchronized Playhead */}
            {isPreviewing && (
              <div
                className="pointer-events-none absolute top-0 bottom-0 z-20 w-0.5 bg-white shadow-[0_0_8px_#fff]"
                style={{
                  left: `${Math.max(0, Math.min(100, (playheadSec / timelineDuration) * 100))}%`,
                }}
              />
            )}

            {/* Main Track Lane */}
            <div className="space-y-1.5">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                <span className="font-semibold text-[#F5F3EE] truncate max-w-[260px]">
                  Main Track: {activeFileName}
                </span>
                <div className="flex items-center gap-2">
                  <span className="text-[11px] text-[#9E988E]">Volume</span>
                  <input
                    type="range"
                    min={0}
                    max={1.5}
                    step={0.05}
                    value={mainVolume}
                    onPointerDown={() => onBeginDragHistory('Main Track Volume')}
                    onPointerUp={() => onEndDragHistory()}
                    onPointerCancel={() => onEndDragHistory()}
                    onChange={(e) => {
                      onRecordCoalescedHistory('overlay-main-vol', 'Main Track Volume');
                      onOverlayStateChange({
                        ...overlayStateRef.current,
                        mainVolume: Number(e.target.value),
                      });
                    }}
                    aria-label="Main track volume"
                    className="studio-slider w-28"
                  />
                  <span className="font-mono text-[11px] tabular-nums text-[#F4D97B] w-10 text-right">
                    {Math.round(mainVolume * 100)}%
                  </span>
                </div>
              </div>

              <div className="relative h-16 w-full rounded-xl border border-[#D4AF37]/30 bg-[#141419] overflow-hidden">
                <div
                  className="h-full border-r border-[#E5C158]/50 bg-[#D4AF37]/12 px-1 py-2"
                  style={{
                    width: `${Math.max(2, Math.min(100, (safeMainDuration / timelineDuration) * 100))}%`,
                  }}
                >
                  <MiniWaveformStrip
                    buffer={activeBuffer}
                    trimStart={0}
                    trimEnd={safeMainDuration}
                    color="#E5C158"
                  />
                </div>
              </div>
            </div>

            {/* Overlay Lanes (Max 2) */}
            {overlays.length === 0 ? (
              <div className="rounded-xl border border-dashed border-white/15 bg-white/[0.02] p-5 text-center text-xs text-[#9E988E]">
                Click <strong className="text-[#F4D97B]">Add Overlay Track</strong> to place up to 2 extra audio layers on the timeline.
              </div>
            ) : (
              overlays.map((track, idx) => {
                const trackDuration = Math.max(0.05, track.buffer.duration);
                const minTrimStep = Math.min(0.1, trackDuration * 0.25);
                const activeDur = Math.max(0.05, track.trimEnd - track.trimStart);
                const leftPct = Math.max(
                  0,
                  Math.min(96, (track.startOffsetSec / timelineDuration) * 100)
                );
                const widthPct = Math.max(
                  6,
                  Math.min(100 - leftPct, (activeDur / timelineDuration) * 100)
                );
                const laneColor = idx === 0 ? '#60A5FA' : '#34D399';

                return (
                  <div
                    key={track.id}
                    className="space-y-2.5 rounded-xl border border-white/10 bg-[#111116]/90 p-3.5"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <span
                          className="h-2.5 w-2.5 rounded-full shrink-0"
                          style={{ backgroundColor: laneColor }}
                          aria-hidden="true"
                        />
                        <span className="text-xs font-semibold text-[#F5F3EE] truncate max-w-[220px] sm:max-w-[340px]">
                          Overlay {idx + 1}: {track.name}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => removeOverlay(track.id)}
                        className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg border border-red-500/25 bg-red-500/10 px-3 text-xs text-red-300 hover:bg-red-500/20 cursor-pointer"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        <span>Remove</span>
                      </button>
                    </div>

                    {/* Draggable Horizontal Lane */}
                    <div className="relative h-16 w-full rounded-lg border border-white/10 bg-[#08080B] overflow-hidden">
                      <div
                        onPointerDown={(e) => onClipPointerDown(e, track)}
                        onPointerMove={onClipPointerMove}
                        onPointerUp={onClipPointerUp}
                        onPointerCancel={onClipPointerUp}
                        title="Drag horizontally to position overlay start time"
                        className="absolute top-1.5 bottom-1.5 rounded-lg border bg-[#191B24]/95 px-1.5 py-1.5 cursor-grab active:cursor-grabbing touch-none select-none flex items-center"
                        style={{
                          left: `${leftPct}%`,
                          width: `${widthPct}%`,
                          borderColor: laneColor,
                        }}
                      >
                        <GripHorizontal
                          className="h-4 w-4 shrink-0 mr-1 opacity-75 pointer-events-none"
                          style={{ color: laneColor }}
                        />
                        <div className="h-full flex-1 min-w-0">
                          <MiniWaveformStrip
                            buffer={track.buffer}
                            trimStart={track.trimStart}
                            trimEnd={track.trimEnd}
                            color={laneColor}
                          />
                        </div>
                      </div>
                    </div>

                    {/* Fine-Tune Controls for Overlay */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 pt-1">
                      <div>
                        <label
                          htmlFor={`ov-offset-${track.id}`}
                          className="block text-[11px] text-[#9E988E] mb-1"
                        >
                          Start Position (sec)
                        </label>
                        <input
                          id={`ov-offset-${track.id}`}
                          type="number"
                          min={0}
                          max={Math.round(timelineDuration * 10) / 10}
                          step={0.1}
                          value={track.startOffsetSec}
                          onChange={(e) => {
                            onRecordCoalescedHistory(
                              `ov-offset-${track.id}`,
                              'Overlay Start Position'
                            );
                            updateOverlay(track.id, {
                              startOffsetSec: Math.max(0, Number(e.target.value) || 0),
                            });
                          }}
                          className="w-full rounded-lg border border-white/15 bg-[#09090C] px-2.5 py-2 font-mono text-xs tabular-nums text-[#F5F3EE] focus:border-[#E5C158] focus:outline-none"
                        />
                      </div>

                      <div>
                        <div className="flex justify-between text-[11px] text-[#9E988E] mb-1">
                          <span>Trim Start</span>
                          <span className="font-mono tabular-nums">{formatTime(track.trimStart)}</span>
                        </div>
                        <input
                          type="range"
                          min={0}
                          max={Math.max(0, track.trimEnd - minTrimStep)}
                          step={0.05}
                          value={track.trimStart}
                          onPointerDown={() => onBeginDragHistory('Overlay Trim Start')}
                          onPointerUp={() => onEndDragHistory()}
                          onPointerCancel={() => onEndDragHistory()}
                          onChange={(e) => {
                            onRecordCoalescedHistory(
                              `ov-trim-start-${track.id}`,
                              'Overlay Trim Start'
                            );
                            updateOverlay(track.id, { trimStart: Number(e.target.value) });
                          }}
                          aria-label={`Overlay ${idx + 1} trim start`}
                          className="studio-slider w-full"
                        />
                      </div>

                      <div>
                        <div className="flex justify-between text-[11px] text-[#9E988E] mb-1">
                          <span>Trim End</span>
                          <span className="font-mono tabular-nums">{formatTime(track.trimEnd)}</span>
                        </div>
                        <input
                          type="range"
                          min={Math.min(trackDuration, track.trimStart + minTrimStep)}
                          max={trackDuration}
                          step={0.05}
                          value={track.trimEnd}
                          onPointerDown={() => onBeginDragHistory('Overlay Trim End')}
                          onPointerUp={() => onEndDragHistory()}
                          onPointerCancel={() => onEndDragHistory()}
                          onChange={(e) => {
                            onRecordCoalescedHistory(
                              `ov-trim-end-${track.id}`,
                              'Overlay Trim End'
                            );
                            updateOverlay(track.id, { trimEnd: Number(e.target.value) });
                          }}
                          aria-label={`Overlay ${idx + 1} trim end`}
                          className="studio-slider w-full"
                        />
                      </div>

                      <div>
                        <div className="flex justify-between text-[11px] text-[#9E988E] mb-1">
                          <span>Track Volume</span>
                          <span className="font-mono tabular-nums text-[#F4D97B]">
                            {Math.round(track.volume * 100)}%
                          </span>
                        </div>
                        <input
                          type="range"
                          min={0}
                          max={1.5}
                          step={0.05}
                          value={track.volume}
                          onPointerDown={() => onBeginDragHistory('Overlay Volume')}
                          onPointerUp={() => onEndDragHistory()}
                          onPointerCancel={() => onEndDragHistory()}
                          onChange={(e) => {
                            onRecordCoalescedHistory(`ov-vol-${track.id}`, 'Overlay Volume');
                            updateOverlay(track.id, { volume: Number(e.target.value) });
                          }}
                          aria-label={`Overlay ${idx + 1} volume`}
                          className="studio-slider w-full"
                        />
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Mix Preview & Commit Bar */}
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[#D4AF37]/25 bg-[#0B0B0F]/80 p-4">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleTogglePreviewMix}
              className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-[#D4AF37]/50 bg-[#D4AF37]/20 px-4 py-2 text-sm font-semibold text-[#F4D97B] hover:bg-[#D4AF37]/30 cursor-pointer"
            >
              {isPreviewing ? <Square className="h-4 w-4" /> : <Play className="h-4 w-4" />}
              <span>{isPreviewing ? 'Stop Mix Preview' : 'Preview Tracks Together'}</span>
            </button>
            {isPreviewing && (
              <span className="font-mono text-xs tabular-nums text-[#F4D97B]">
                {formatTime(playheadSec)} / {formatTime(timelineDuration)}
              </span>
            )}
          </div>

          <button
            type="button"
            disabled={!hasPendingOverlayChanges}
            onClick={handleCommitMix}
            className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-white/20 bg-white/10 px-4 py-2 text-sm font-medium text-[#F5F3EE] hover:border-[#E5C158] hover:text-[#F4D97B] disabled:opacity-35 cursor-pointer"
          >
            {appliedFlash ? <Check className="h-4 w-4 text-emerald-400" /> : <Layers className="h-4 w-4" />}
            <span>{appliedFlash ? 'Mix Saved to Active Track' : 'Apply Mix to Active Track'}</span>
          </button>
        </div>

        {/* Overlay Bottom Controls */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-4 border-t border-white/10">
          <button
            type="button"
            onClick={handleExportMix}
            className="inline-flex min-h-[46px] items-center gap-2 rounded-xl border border-[#D4AF37]/45 bg-[#D4AF37]/15 px-6 py-2.5 text-sm font-semibold text-[#F4D97B] hover:bg-[#D4AF37]/25 cursor-pointer"
          >
            <Download className="h-4 w-4" />
            <span>Export Mixed Audio</span>
          </button>

          <button
            type="button"
            onClick={handleNextStep}
            className="inline-flex min-h-[46px] items-center gap-2 rounded-xl border border-[#E5C158]/70 bg-gradient-to-b from-[#E5C158] to-[#C59B27] px-6 py-2.5 text-sm font-semibold text-[#09090C] hover:brightness-105 cursor-pointer"
          >
            <span>Next: More Tools</span>
            <ArrowRight className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
