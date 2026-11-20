import { useEffect, useRef, useState } from 'react';
import {
  Activity,
  Clipboard,
  Copy,
  Download,
  Gauge,
  Loader2,
  Play,
  Repeat,
  RotateCcw,
  Scissors,
  Sliders,
  Sparkles,
  Square,
  Trash2,
  Upload,
  Volume2,
} from 'lucide-react';
import {
  applyAudioCompression,
  applyCrossfadeAtSelection,
  applyFade,
  applyFiveBandEq,
  applySpeedAndPitch,
  applyVolumeAutomation,
  formatTime,
  getAudioContext,
  insertAudioBufferAt,
  loopAudioBuffer,
  normalizeAudioBuffer,
  removeAudioRegion,
  removeSilence,
  reverseAudioBuffer,
  sliceAudioBuffer,
  splitAudioBufferKeepSegment,
} from '../audio/audioEngine';
import type { AutomationPoint, MoreParams, MoreTab, TimeSelection } from '../types/audio';
import { WaveformCanvas } from './WaveformCanvas';

interface MoreSectionProps {
  activeBuffer: AudioBuffer | null;
  currentTime: number;
  selection: TimeSelection | null;
  clipboardBuffer: AudioBuffer | null;
  moreParams: MoreParams;
  isGlobalPlaying: boolean;
  onSeek: (time: number) => void;
  onSyncPlaybackTime: (time: number) => void;
  onStopGlobalPlayback: () => void;
  onSelectionChange: (sel: TimeSelection | null) => void;
  onMoreParamsChange: (patch: Partial<MoreParams>) => void;
  onBeginDragHistory: (label: string) => void;
  onEndDragHistory: () => void;
  onRecordDiscreteHistory: (label: string) => void;
  onRecordCoalescedHistory: (key: string, label: string) => void;
  onCopyRegion: (buffer: AudioBuffer) => void;
  onCommitEdit: (newBuffer: AudioBuffer, label: string, newSelection?: TimeSelection | null) => void;
  onExport: () => void;
  onUploadRequest: () => void;
}

const EQ_PRESETS: Record<string, number[]> = {
  Flat: [0, 0, 0, 0, 0],
  'Stage Bass': [6, 3.5, -1, 1.5, 2],
  'Vocal Clarity': [-3, -1.5, 3, 5, 2.5],
  'Dance Punch': [5, 1.5, 0, 3.5, 4.5],
  Warm: [3.5, 2.5, 0.5, -2, -3.5],
};

function interpolateAutomationGain(points: AutomationPoint[], normTime: number): number {
  const sorted = [...points].sort((a, b) => a.time - b.time);
  if (sorted.length === 0) return 1;
  if (normTime <= sorted[0].time) return sorted[0].gain;
  if (normTime >= sorted[sorted.length - 1].time) return sorted[sorted.length - 1].gain;
  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i];
    const b = sorted[i + 1];
    if (normTime >= a.time && normTime <= b.time) {
      const span = Math.max(0.0001, b.time - a.time);
      const frac = (normTime - a.time) / span;
      return a.gain + (b.gain - a.gain) * frac;
    }
  }
  return 1;
}

function scheduleAutomationCurve(
  gainNode: GainNode,
  points: AutomationPoint[],
  bufferDuration: number,
  ctxNow: number,
  trackOffsetSec: number
) {
  const safeDur = Math.max(0.05, bufferDuration);
  const clampedOffset = Math.max(0, Math.min(safeDur, trackOffsetSec));
  const sorted = [...points].sort((a, b) => a.time - b.time);

  gainNode.gain.cancelScheduledValues(ctxNow);
  const currentGain = interpolateAutomationGain(sorted, clampedOffset / safeDur);
  gainNode.gain.setValueAtTime(currentGain, ctxNow);

  for (const pt of sorted) {
    const ptSec = pt.time * safeDur;
    if (ptSec > clampedOffset + 0.005) {
      gainNode.gain.linearRampToValueAtTime(pt.gain, ctxNow + (ptSec - clampedOffset));
    }
  }
}

export function MoreSection({
  activeBuffer,
  currentTime,
  selection,
  clipboardBuffer,
  moreParams,
  isGlobalPlaying,
  onSeek,
  onSyncPlaybackTime,
  onStopGlobalPlayback,
  onSelectionChange,
  onMoreParamsChange,
  onBeginDragHistory,
  onEndDragHistory,
  onRecordDiscreteHistory,
  onRecordCoalescedHistory,
  onCopyRegion,
  onCommitEdit,
  onExport,
  onUploadRequest,
}: MoreSectionProps) {
  const [activeTab, setActiveTab] = useState<MoreTab>('automation');
  const [isBusy, setIsBusy] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const {
    automationPoints,
    eqBands,
    loopCount,
    speed,
    pitchSemitones,
    fadeSec,
    compThreshold,
    compRatio,
    silenceDb,
  } = moreParams;

  const [isPreviewingAuto, setIsPreviewingAuto] = useState(false);
  const [isPreviewingEq, setIsPreviewingEq] = useState(false);
  const [isEqBypassed, setIsEqBypassed] = useState(false);

  const autoSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const autoGainRef = useRef<GainNode | null>(null);
  const eqSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const eqFilterNodesRef = useRef<BiquadFilterNode[]>([]);
  const limiterNodeRef = useRef<DynamicsCompressorNode | null>(null);
  const previewRafRef = useRef<number | null>(null);
  const seekThrottleTimerRef = useRef<number | null>(null);
  const previewTimingRef = useRef<{
    kind: 'auto' | 'eq';
    ctxStartTime: number;
    offsetSec: number;
  } | null>(null);
  const previewTokenRef = useRef(0);
  const isMountedRef = useRef(true);

  const stopAllMorePreviews = (resetCursor = false) => {
    previewTokenRef.current += 1;
    if (seekThrottleTimerRef.current !== null) {
      window.clearTimeout(seekThrottleTimerRef.current);
      seekThrottleTimerRef.current = null;
    }
    if (previewRafRef.current !== null) {
      cancelAnimationFrame(previewRafRef.current);
      previewRafRef.current = null;
    }

    let pausedPos: number | null = null;
    if (!resetCursor && previewTimingRef.current && activeBuffer) {
      try {
        const ctx = getAudioContext();
        const elapsed = Math.max(0, ctx.currentTime - previewTimingRef.current.ctxStartTime);
        pausedPos = Math.max(
          0,
          Math.min(activeBuffer.duration, previewTimingRef.current.offsetSec + elapsed)
        );
      } catch {
        pausedPos = null;
      }
    }
    previewTimingRef.current = null;

    if (autoSourceRef.current) {
      try {
        autoSourceRef.current.onended = null;
        autoSourceRef.current.stop();
      } catch {
        // ignore
      }
      try {
        autoSourceRef.current.disconnect();
      } catch {
        // ignore
      }
      autoSourceRef.current = null;
    }
    if (autoGainRef.current) {
      try {
        autoGainRef.current.disconnect();
      } catch {
        // ignore
      }
      autoGainRef.current = null;
    }

    if (eqSourceRef.current) {
      try {
        eqSourceRef.current.onended = null;
        eqSourceRef.current.stop();
      } catch {
        // ignore
      }
      try {
        eqSourceRef.current.disconnect();
      } catch {
        // ignore
      }
      eqSourceRef.current = null;
    }
    for (const f of eqFilterNodesRef.current) {
      try {
        f.disconnect();
      } catch {
        // ignore
      }
    }
    eqFilterNodesRef.current = [];
    if (limiterNodeRef.current) {
      try {
        limiterNodeRef.current.disconnect();
      } catch {
        // ignore
      }
      limiterNodeRef.current = null;
    }

    if (isMountedRef.current) {
      setIsPreviewingAuto(false);
      setIsPreviewingEq(false);
      if (resetCursor) {
        onSyncPlaybackTime(0);
      } else if (pausedPos !== null) {
        onSyncPlaybackTime(pausedPos);
      }
    }
  };

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      stopAllMorePreviews(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Stop More previews if the underlying buffer swaps (e.g. Undo/Redo or edit commit)
  useEffect(() => {
    stopAllMorePreviews(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeBuffer]);

  // Cleanly stop tab-specific preview when switching away from that tab
  useEffect(() => {
    if (activeTab !== 'automation' && isPreviewingAuto) {
      stopAllMorePreviews(false);
    } else if (activeTab !== 'eq' && isPreviewingEq) {
      stopAllMorePreviews(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  // If the global transport play button starts playing, cleanly stop any More preview
  useEffect(() => {
    if (isGlobalPlaying && (isPreviewingAuto || isPreviewingEq)) {
      stopAllMorePreviews(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isGlobalPlaying]);

  // Update live EQ filters (and Bypass state) smoothly without restarting playback or AudioContext
  useEffect(() => {
    if (isPreviewingEq && eqFilterNodesRef.current.length === eqBands.length) {
      const ctx = getAudioContext();
      const now = ctx.currentTime;
      eqBands.forEach((band, i) => {
        const targetGain = isEqBypassed ? 0 : band.gain;
        eqFilterNodesRef.current[i].gain.cancelScheduledValues(now);
        eqFilterNodesRef.current[i].gain.setTargetAtTime(targetGain, now, 0.015);
      });
    }
  }, [eqBands, isPreviewingEq, isEqBypassed]);

  // Update live automation gain curve smoothly during playback if points change (drag or Undo/Redo)
  useEffect(() => {
    if (
      isPreviewingAuto &&
      autoGainRef.current &&
      previewTimingRef.current?.kind === 'auto' &&
      activeBuffer
    ) {
      const ctx = getAudioContext();
      const now = ctx.currentTime;
      const elapsed = Math.max(0, now - previewTimingRef.current.ctxStartTime);
      const currOffset = previewTimingRef.current.offsetSec + elapsed;
      scheduleAutomationCurve(
        autoGainRef.current,
        automationPoints,
        activeBuffer.duration,
        now,
        currOffset
      );
    }
  }, [automationPoints, isPreviewingAuto, activeBuffer]);

  if (!activeBuffer) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-12 text-center">
        <div className="rounded-3xl border border-[#D4AF37]/30 bg-[#101014]/82 backdrop-blur-xl p-10">
          <Sliders className="mx-auto h-10 w-10 text-[#E5C158] mb-3" />
          <h2 className="font-display text-2xl font-bold text-[#F5F3EE]">
            Advanced Audio Tools
          </h2>
          <p className="mt-2 text-sm text-[#B8B2A6]">
            Upload an audio track first to unlock Volume Automation, 5-Band Equalizer, Reverse, Loop, Compression, and Mastering tools.
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
  const selectionHint = 'Select a region on the waveform first.';

  const showToast = (msg: string) => {
    setError(null);
    setStatusMessage(msg);
    setTimeout(() => setStatusMessage((curr) => (curr === msg ? null : curr)), 2600);
  };

  const runAsyncEdit = async (fn: () => Promise<AudioBuffer> | AudioBuffer, label: string, clearSelection = false) => {
    setIsBusy(true);
    setError(null);
    stopAllMorePreviews(true);
    try {
      await new Promise((r) => setTimeout(r, 10));
      const next = await fn();
      onCommitEdit(next, label, clearSelection ? null : selection);
      showToast(`Applied: ${label}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Operation failed.');
    } finally {
      setIsBusy(false);
    }
  };

  const createSafetyLimiter = (ctx: AudioContext): DynamicsCompressorNode => {
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -2;
    limiter.knee.value = 4;
    limiter.ratio.value = 12;
    limiter.attack.value = 0.002;
    limiter.release.value = 0.1;
    return limiter;
  };

  const startAutoPreviewAt = async (offsetSec: number) => {
    onStopGlobalPlayback();
    stopAllMorePreviews(false);
    const token = previewTokenRef.current;

    const ctx = getAudioContext();
    if (ctx.state === 'suspended') {
      await ctx.resume();
    }
    if (!isMountedRef.current || previewTokenRef.current !== token) return;

    const safeOffset = Math.max(0, Math.min(activeBuffer.duration - 0.02, offsetSec));
    const src = ctx.createBufferSource();
    src.buffer = activeBuffer;
    const gain = ctx.createGain();
    const limiter = createSafetyLimiter(ctx);
    const startAt = ctx.currentTime;

    scheduleAutomationCurve(gain, automationPoints, activeBuffer.duration, startAt, safeOffset);

    src.connect(gain);
    gain.connect(limiter);
    limiter.connect(ctx.destination);
    src.start(startAt, safeOffset);

    autoSourceRef.current = src;
    autoGainRef.current = gain;
    limiterNodeRef.current = limiter;
    previewTimingRef.current = { kind: 'auto', ctxStartTime: startAt, offsetSec: safeOffset };
    setIsPreviewingAuto(true);
    onSyncPlaybackTime(safeOffset);

    const tick = () => {
      if (autoSourceRef.current !== src || !isMountedRef.current) return;
      const elapsed = Math.max(0, ctx.currentTime - startAt);
      const pos = safeOffset + elapsed;
      if (pos >= activeBuffer.duration) {
        stopAllMorePreviews(true);
        return;
      }
      onSyncPlaybackTime(pos);
      previewRafRef.current = requestAnimationFrame(tick);
    };
    previewRafRef.current = requestAnimationFrame(tick);

    src.onended = () => {
      if (autoSourceRef.current === src) {
        stopAllMorePreviews(true);
      }
    };
  };

  const handleToggleAutoPreview = () => {
    if (isPreviewingAuto) {
      stopAllMorePreviews(false);
      return;
    }
    const startPos = currentTime >= activeBuffer.duration - 0.05 ? 0 : currentTime;
    void startAutoPreviewAt(startPos);
  };

  const startEqPreviewAt = async (offsetSec: number) => {
    onStopGlobalPlayback();
    stopAllMorePreviews(false);
    const token = previewTokenRef.current;

    const ctx = getAudioContext();
    if (ctx.state === 'suspended') {
      await ctx.resume();
    }
    if (!isMountedRef.current || previewTokenRef.current !== token) return;

    const safeOffset = Math.max(0, Math.min(activeBuffer.duration - 0.02, offsetSec));
    const src = ctx.createBufferSource();
    src.buffer = activeBuffer;

    const filters: BiquadFilterNode[] = [];
    let currentNode: AudioNode = src;
    for (const band of eqBands) {
      const f = ctx.createBiquadFilter();
      f.type = band.type;
      f.frequency.value = band.frequency;
      f.Q.value = 1.1;
      f.gain.value = isEqBypassed ? 0 : band.gain;
      currentNode.connect(f);
      currentNode = f;
      filters.push(f);
    }
    const limiter = createSafetyLimiter(ctx);
    currentNode.connect(limiter);
    limiter.connect(ctx.destination);

    const startAt = ctx.currentTime;
    eqFilterNodesRef.current = filters;
    eqSourceRef.current = src;
    limiterNodeRef.current = limiter;
    previewTimingRef.current = { kind: 'eq', ctxStartTime: startAt, offsetSec: safeOffset };

    src.start(startAt, safeOffset);
    setIsPreviewingEq(true);
    onSyncPlaybackTime(safeOffset);

    const tick = () => {
      if (eqSourceRef.current !== src || !isMountedRef.current) return;
      const elapsed = Math.max(0, ctx.currentTime - startAt);
      const pos = safeOffset + elapsed;
      if (pos >= activeBuffer.duration) {
        stopAllMorePreviews(true);
        return;
      }
      onSyncPlaybackTime(pos);
      previewRafRef.current = requestAnimationFrame(tick);
    };
    previewRafRef.current = requestAnimationFrame(tick);

    src.onended = () => {
      if (eqSourceRef.current === src) {
        stopAllMorePreviews(true);
      }
    };
  };

  const handleToggleEqPreview = () => {
    if (isPreviewingEq) {
      stopAllMorePreviews(false);
      return;
    }
    const startPos = currentTime >= activeBuffer.duration - 0.05 ? 0 : currentTime;
    void startEqPreviewAt(startPos);
  };

  const handleWaveformSeek = (timeSec: number) => {
    if (isPreviewingAuto) {
      onSyncPlaybackTime(timeSec);
      if (seekThrottleTimerRef.current !== null) {
        window.clearTimeout(seekThrottleTimerRef.current);
      }
      seekThrottleTimerRef.current = window.setTimeout(() => {
        seekThrottleTimerRef.current = null;
        void startAutoPreviewAt(timeSec);
      }, 45);
      return;
    }
    if (isPreviewingEq) {
      onSyncPlaybackTime(timeSec);
      if (seekThrottleTimerRef.current !== null) {
        window.clearTimeout(seekThrottleTimerRef.current);
      }
      seekThrottleTimerRef.current = window.setTimeout(() => {
        seekThrottleTimerRef.current = null;
        void startEqPreviewAt(timeSec);
      }, 45);
      return;
    }
    onSeek(timeSec);
  };

  // Build SVG path for 5-band EQ visual curve
  const eqCurvePoints = eqBands.map((b, idx) => {
    const x = 30 + (idx / (eqBands.length - 1)) * 440;
    const y = 60 - (b.gain / 12) * 44;
    return { x, y };
  });

  const buildSmoothCurvePath = (pts: { x: number; y: number }[]) => {
    if (pts.length === 0) return '';
    let d = `M ${pts[0].x} ${pts[0].y}`;
    for (let i = 0; i < pts.length - 1; i++) {
      const curr = pts[i];
      const next = pts[i + 1];
      const cx = (curr.x + next.x) / 2;
      d += ` C ${cx} ${curr.y}, ${cx} ${next.y}, ${next.x} ${next.y}`;
    }
    return d;
  };

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-4">
      <div className="rounded-3xl border border-[#D4AF37]/30 bg-[#101014]/82 backdrop-blur-2xl p-5 sm:p-6 shadow-[0_24px_80px_rgba(0,0,0,0.75)] space-y-5">
        {/* Header & Category Tabs */}
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="font-display text-xl sm:text-2xl font-bold text-[#F5F3EE]">
              Advanced Audio Studio
            </h2>
            <p className="text-xs sm:text-sm text-[#9E988E]">
              Volume automation, 5-band equalizer, region editing, and mastering tools.
            </p>
          </div>

          <div
            role="tablist"
            aria-label="Advanced audio tool categories"
            className="flex flex-wrap gap-1.5 rounded-xl border border-[#D4AF37]/25 bg-[#09090C]/85 p-1"
          >
            {[
              { id: 'automation' as MoreTab, label: 'Volume Automation' },
              { id: 'eq' as MoreTab, label: '5-Band EQ' },
              { id: 'region' as MoreTab, label: 'Region & Clip' },
              { id: 'mastering' as MoreTab, label: 'Mastering & FX' },
            ].map((tab) => (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={activeTab === tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`min-h-[38px] rounded-lg px-3.5 py-1.5 text-xs sm:text-sm font-medium transition-all whitespace-nowrap cursor-pointer ${
                  activeTab === tab.id
                    ? 'bg-[#D4AF37]/22 text-[#F4D97B] border border-[#D4AF37]/50'
                    : 'text-[#B8B2A6] hover:text-white border border-transparent'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {/* Interactive Waveform (with Automation Node Overlay when on Automation tab) */}
        <WaveformCanvas
          buffer={activeBuffer}
          currentTime={currentTime}
          selection={selection}
          height={170}
          showAutomation={activeTab === 'automation'}
          automationPoints={automationPoints}
          onSeek={handleWaveformSeek}
          onSelectionChange={onSelectionChange}
          onAutomationChange={(pts) => onMoreParamsChange({ automationPoints: pts })}
          onInteractionStart={onBeginDragHistory}
          onInteractionEnd={onEndDragHistory}
        />

        {error && (
          <div
            role="alert"
            className="rounded-xl border border-red-500/40 bg-red-950/60 px-4 py-2.5 text-xs sm:text-sm text-red-200"
          >
            {error}
          </div>
        )}

        {statusMessage && (
          <div className="rounded-xl border border-[#D4AF37]/40 bg-[#D4AF37]/15 px-4 py-2.5 text-xs sm:text-sm text-[#F4D97B]">
            {statusMessage}
          </div>
        )}

        {/* TAB 1: VOLUME AUTOMATION */}
        {activeTab === 'automation' && (
          <div className="rounded-2xl border border-white/10 bg-[#0B0B0F]/80 p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="font-display text-base font-semibold text-[#F5F3EE] flex items-center gap-2">
                  <Activity className="h-4 w-4 text-[#E5C158]" />
                  <span>Volume Automation Curve</span>
                </h3>
                <p className="text-xs text-[#9E988E] mt-0.5">
                  Click the top time ruler to scrub playback position, click the waveform to add a volume node, and drag blue nodes up or down to shape smooth volume ramps.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    onRecordDiscreteHistory('Reset Automation Curve');
                    onMoreParamsChange({
                      automationPoints: [
                        { id: 'start', time: 0, gain: 1 },
                        { id: 'mid', time: 0.5, gain: 1 },
                        { id: 'end', time: 1, gain: 1 },
                      ],
                    });
                  }}
                  className="min-h-[40px] rounded-xl border border-white/15 bg-white/5 px-3.5 text-xs font-medium text-[#C8C2B6] hover:text-white cursor-pointer"
                >
                  Reset Flat
                </button>
                <button
                  type="button"
                  onClick={handleToggleAutoPreview}
                  className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl border border-[#D4AF37]/40 bg-[#D4AF37]/15 px-4 text-xs font-semibold text-[#F4D97B] cursor-pointer"
                >
                  {isPreviewingAuto ? <Square className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                  <span>{isPreviewingAuto ? 'Pause Preview' : 'Preview Automation'}</span>
                </button>
                <button
                  type="button"
                  disabled={isBusy}
                  onClick={() =>
                    void runAsyncEdit(
                      () => applyVolumeAutomation(activeBuffer, automationPoints),
                      'Volume Automation'
                    )
                  }
                  className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl border border-[#E5C158]/70 bg-gradient-to-b from-[#E5C158] to-[#C59B27] px-4 text-xs font-semibold text-[#09090C] disabled:opacity-50 cursor-pointer"
                >
                  <span>Apply Automation</span>
                </button>
              </div>
            </div>

            {/* Active Nodes List */}
            <div className="flex flex-wrap gap-2 pt-2 border-t border-white/10">
              {automationPoints.map((pt, index) => (
                <div
                  key={pt.id}
                  className="flex items-center gap-2 rounded-lg border border-white/10 bg-[#14141A] px-2.5 py-1.5 text-xs font-mono tabular-nums"
                >
                  <span className="text-[#93C5FD]">#{index + 1}</span>
                  <span className="text-[#C8C2B6]">{formatTime(pt.time * activeBuffer.duration)}</span>
                  <span className="text-[#F4D97B]">{Math.round(pt.gain * 100)}%</span>
                  {automationPoints.length > 2 && (
                    <button
                      type="button"
                      aria-label="Remove automation point"
                      onClick={() => {
                        onRecordDiscreteHistory('Remove Automation Point');
                        onMoreParamsChange({
                          automationPoints: automationPoints.filter((p) => p.id !== pt.id),
                        });
                      }}
                      className="text-red-300 hover:text-red-200 cursor-pointer"
                    >
                      ×
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* TAB 2: 5-BAND EQUALIZER */}
        {activeTab === 'eq' && (
          <div className="rounded-2xl border border-white/10 bg-[#0B0B0F]/80 p-5 space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="font-display text-base font-semibold text-[#F5F3EE] flex items-center gap-2">
                  <Sliders className="h-4 w-4 text-[#E5C158]" />
                  <span>5-Band Graphic Equalizer</span>
                </h3>
                <p className="text-xs text-[#9E988E]">
                  Shape bass, vocals, and stage presence in real time before rendering to your track.
                </p>
              </div>

              <div className="flex flex-wrap gap-1.5">
                {Object.entries(EQ_PRESETS).map(([presetName, gains]) => (
                  <button
                    key={presetName}
                    type="button"
                    onClick={() => {
                      onRecordDiscreteHistory(`EQ Preset: ${presetName}`);
                      onMoreParamsChange({
                        eqBands: eqBands.map((b, i) => ({ ...b, gain: gains[i] })),
                      });
                    }}
                    className="min-h-[34px] rounded-lg border border-white/15 bg-white/5 px-3 text-xs font-medium text-[#D8D3C8] hover:border-[#D4AF37]/50 hover:text-[#F4D97B] cursor-pointer"
                  >
                    {presetName}
                  </button>
                ))}
              </div>
            </div>

            {/* Live EQ Response Curve */}
            <div className="rounded-xl border border-[#D4AF37]/20 bg-[#070709] p-3">
              <svg viewBox="0 0 500 120" className="h-28 w-full">
                <line x1="20" y1="60" x2="480" y2="60" stroke="rgba(255,255,255,0.12)" strokeDasharray="4 4" />
                <line x1="20" y1="16" x2="480" y2="16" stroke="rgba(255,255,255,0.05)" />
                <line x1="20" y1="104" x2="480" y2="104" stroke="rgba(255,255,255,0.05)" />
                <path
                  d={buildSmoothCurvePath(eqCurvePoints)}
                  fill="none"
                  stroke="#E5C158"
                  strokeWidth="2.5"
                />
                {eqCurvePoints.map((pt, i) => (
                  <g key={eqBands[i].label}>
                    <circle cx={pt.x} cy={pt.y} r="5" fill="#09090C" stroke="#E5C158" strokeWidth="2" />
                    <text
                      x={pt.x}
                      y="115"
                      textAnchor="middle"
                      fill="#9E988E"
                      fontSize="10"
                      fontFamily="JetBrains Mono, monospace"
                    >
                      {eqBands[i].label}
                    </text>
                  </g>
                ))}
              </svg>
            </div>

            {/* 5 Independent Band Sliders */}
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
              {eqBands.map((band, idx) => (
                <div
                  key={band.label}
                  className="rounded-xl border border-white/10 bg-[#14141A] p-3 text-center space-y-2"
                >
                  <div className="text-xs font-semibold text-[#F5F3EE]">{band.label}</div>
                  <div className="font-mono text-xs tabular-nums text-[#F4D97B]">
                    {band.gain > 0 ? `+${band.gain.toFixed(1)}` : band.gain.toFixed(1)} dB
                  </div>
                  <input
                    type="range"
                    min={-12}
                    max={12}
                    step={0.5}
                    value={band.gain}
                    onPointerDown={() => onBeginDragHistory(`EQ ${band.label}`)}
                    onPointerUp={() => onEndDragHistory()}
                    onPointerCancel={() => onEndDragHistory()}
                    onChange={(e) => {
                      const val = Number(e.target.value);
                      onRecordCoalescedHistory(`eq-band-${idx}`, `EQ ${band.label}`);
                      onMoreParamsChange({
                        eqBands: eqBands.map((b, i) => (i === idx ? { ...b, gain: val } : b)),
                      });
                    }}
                    aria-label={`${band.label} gain`}
                    className="studio-slider w-full"
                  />
                </div>
              ))}
            </div>

            <div className="flex flex-wrap items-center justify-end gap-2.5 pt-2 border-t border-white/10">
              <button
                type="button"
                aria-pressed={!isEqBypassed}
                onClick={() => setIsEqBypassed((b) => !b)}
                className={`inline-flex min-h-[42px] items-center gap-2 rounded-xl border px-3.5 text-xs sm:text-sm font-medium transition-colors cursor-pointer ${
                  isEqBypassed
                    ? 'border-white/15 bg-white/5 text-[#9E988E] hover:text-white'
                    : 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300'
                }`}
              >
                <span>{isEqBypassed ? 'EQ: Bypassed' : 'EQ: Active'}</span>
              </button>
              <button
                type="button"
                onClick={handleToggleEqPreview}
                className="inline-flex min-h-[42px] items-center gap-2 rounded-xl border border-[#D4AF37]/40 bg-[#D4AF37]/15 px-4 text-xs sm:text-sm font-semibold text-[#F4D97B] cursor-pointer"
              >
                {isPreviewingEq ? <Square className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                <span>{isPreviewingEq ? 'Pause EQ Preview' : 'Live Preview EQ'}</span>
              </button>
              <button
                type="button"
                disabled={isBusy}
                onClick={() => void runAsyncEdit(() => applyFiveBandEq(activeBuffer, eqBands), '5-Band EQ')}
                className="inline-flex min-h-[42px] items-center gap-2 rounded-xl border border-[#E5C158]/70 bg-gradient-to-b from-[#E5C158] to-[#C59B27] px-5 text-xs sm:text-sm font-semibold text-[#09090C] disabled:opacity-50 cursor-pointer"
              >
                {isBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                <span>Apply EQ to Track</span>
              </button>
            </div>
          </div>
        )}

        {/* TAB 3: REGION & CLIP OPERATIONS */}
        {activeTab === 'region' && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Copy, Paste, Delete, Trim, Split */}
            <div className="rounded-2xl border border-white/10 bg-[#0B0B0F]/80 p-5 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="font-display text-base font-semibold text-[#F5F3EE]">
                  Copy, Paste, Split & Trim
                </h3>
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
                  title={hasSelection ? 'Copy selected region' : selectionHint}
                  onClick={() => {
                    if (!selection) return;
                    const copied = sliceAudioBuffer(activeBuffer, selection.start, selection.end);
                    onCopyRegion(copied);
                    showToast(`Copied ${formatTime(copied.duration)} to clipboard`);
                  }}
                  className="inline-flex min-h-[42px] items-center gap-2 rounded-xl border border-[#D4AF37]/35 bg-[#16161C] px-3.5 text-xs font-medium text-[#F5F3EE] hover:border-[#E5C158] disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                >
                  <Copy className="h-3.5 w-3.5 text-[#E5C158]" />
                  <span>Copy Selection</span>
                </button>

                <button
                  type="button"
                  disabled={!clipboardBuffer || isBusy}
                  title={clipboardBuffer ? 'Insert copied region at playhead' : 'Copy a region first'}
                  onClick={() =>
                    clipboardBuffer &&
                    void runAsyncEdit(
                      () => insertAudioBufferAt(activeBuffer, clipboardBuffer, currentTime),
                      'Paste Audio at Playhead'
                    )
                  }
                  className="inline-flex min-h-[42px] items-center gap-2 rounded-xl border border-[#D4AF37]/35 bg-[#16161C] px-3.5 text-xs font-medium text-[#F5F3EE] hover:border-[#E5C158] disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                >
                  <Clipboard className="h-3.5 w-3.5 text-[#E5C158]" />
                  <span>Paste at Playhead</span>
                </button>

                <button
                  type="button"
                  disabled={!hasSelection || isBusy}
                  title={hasSelection ? 'Delete selected region' : selectionHint}
                  onClick={() =>
                    selection &&
                    void runAsyncEdit(
                      () => removeAudioRegion(activeBuffer, selection.start, selection.end),
                      'Delete Selection',
                      true
                    )
                  }
                  className="inline-flex min-h-[42px] items-center gap-2 rounded-xl border border-red-500/35 bg-red-500/12 px-3.5 text-xs font-medium text-red-200 hover:bg-red-500/22 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  <span>Delete Selection</span>
                </button>

                <button
                  type="button"
                  disabled={!hasSelection || isBusy}
                  title={hasSelection ? 'Trim & crop to selected region' : selectionHint}
                  onClick={() =>
                    selection &&
                    void runAsyncEdit(
                      () => sliceAudioBuffer(activeBuffer, selection.start, selection.end),
                      'Trim / Crop Selection',
                      true
                    )
                  }
                  className="inline-flex min-h-[42px] items-center gap-2 rounded-xl border border-[#D4AF37]/45 bg-[#D4AF37]/18 px-3.5 text-xs font-semibold text-[#F4D97B] disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                >
                  <Scissors className="h-3.5 w-3.5" />
                  <span>Trim / Crop</span>
                </button>

                <button
                  type="button"
                  disabled={currentTime <= 0.05 || currentTime >= activeBuffer.duration - 0.05 || isBusy}
                  onClick={() =>
                    void runAsyncEdit(
                      () => splitAudioBufferKeepSegment(activeBuffer, currentTime, 'first'),
                      'Split (Keep Before Playhead)',
                      true
                    )
                  }
                  className="inline-flex min-h-[42px] items-center gap-2 rounded-xl border border-white/15 bg-white/5 px-3.5 text-xs font-medium text-[#D8D3C8] disabled:opacity-35 cursor-pointer"
                >
                  <span>Split: Keep Left</span>
                </button>

                <button
                  type="button"
                  disabled={currentTime <= 0.05 || currentTime >= activeBuffer.duration - 0.05 || isBusy}
                  onClick={() =>
                    void runAsyncEdit(
                      () => splitAudioBufferKeepSegment(activeBuffer, currentTime, 'second'),
                      'Split (Keep After Playhead)',
                      true
                    )
                  }
                  className="inline-flex min-h-[42px] items-center gap-2 rounded-xl border border-white/15 bg-white/5 px-3.5 text-xs font-medium text-[#D8D3C8] disabled:opacity-35 cursor-pointer"
                >
                  <span>Split: Keep Right</span>
                </button>
              </div>
            </div>

            {/* Reverse & Loop / Repeat */}
            <div className="rounded-2xl border border-white/10 bg-[#0B0B0F]/80 p-5 space-y-4">
              <h3 className="font-display text-base font-semibold text-[#F5F3EE]">
                Reverse & Loop / Repeat
              </h3>

              <div className="flex flex-wrap gap-2.5">
                <button
                  type="button"
                  disabled={isBusy}
                  onClick={() =>
                    void runAsyncEdit(() => reverseAudioBuffer(activeBuffer), 'Reverse Full Track')
                  }
                  className="inline-flex min-h-[42px] items-center gap-2 rounded-xl border border-white/15 bg-white/5 px-3.5 text-xs font-medium text-[#F5F3EE] hover:border-[#E5C158] cursor-pointer"
                >
                  <RotateCcw className="h-3.5 w-3.5 text-[#E5C158]" />
                  <span>Reverse Full Track</span>
                </button>

                <button
                  type="button"
                  disabled={!hasSelection || isBusy}
                  title={hasSelection ? 'Reverse only the selected region' : selectionHint}
                  onClick={() =>
                    selection &&
                    void runAsyncEdit(
                      () => reverseAudioBuffer(activeBuffer, selection.start, selection.end),
                      'Reverse Selection'
                    )
                  }
                  className="inline-flex min-h-[42px] items-center gap-2 rounded-xl border border-[#D4AF37]/35 bg-[#16161C] px-3.5 text-xs font-medium text-[#F5F3EE] disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                >
                  <RotateCcw className="h-3.5 w-3.5 text-[#E5C158]" />
                  <span>Reverse Selection</span>
                </button>
              </div>

              <div className="pt-3 border-t border-white/10 space-y-3">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-[#C8C2B6]">Repeat / Loop Count</span>
                  <span className="font-mono tabular-nums text-[#F4D97B]">{loopCount}x</span>
                </div>
                <input
                  type="range"
                  min={2}
                  max={8}
                  step={1}
                  value={loopCount}
                  onPointerDown={() => onBeginDragHistory('Repeat Loop Count')}
                  onPointerUp={() => onEndDragHistory()}
                  onPointerCancel={() => onEndDragHistory()}
                  onChange={(e) => {
                    onRecordCoalescedHistory('more-loop-count', 'Repeat Loop Count');
                    onMoreParamsChange({ loopCount: Number(e.target.value) });
                  }}
                  aria-label="Repeat loop count"
                  className="studio-slider w-full"
                />
                <div className="flex flex-wrap gap-2.5">
                  <button
                    type="button"
                    disabled={isBusy}
                    onClick={() =>
                      void runAsyncEdit(
                        () => loopAudioBuffer(activeBuffer, loopCount),
                        `Loop Full Track (${loopCount}x)`,
                        true
                      )
                    }
                    className="inline-flex min-h-[42px] items-center gap-2 rounded-xl border border-white/15 bg-white/5 px-3.5 text-xs font-medium text-[#F5F3EE] hover:border-[#E5C158] cursor-pointer"
                  >
                    <Repeat className="h-3.5 w-3.5 text-[#E5C158]" />
                    <span>Loop Full Track ({loopCount}x)</span>
                  </button>

                  <button
                    type="button"
                    disabled={!hasSelection || isBusy}
                    title={hasSelection ? 'Repeat the selected region in place' : selectionHint}
                    onClick={() =>
                      selection &&
                      void runAsyncEdit(
                        () =>
                          loopAudioBuffer(activeBuffer, loopCount, selection.start, selection.end),
                        `Repeat Selection (${loopCount}x)`,
                        true
                      )
                    }
                    className="inline-flex min-h-[42px] items-center gap-2 rounded-xl border border-[#D4AF37]/35 bg-[#D4AF37]/15 px-3.5 text-xs font-semibold text-[#F4D97B] disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                  >
                    <Repeat className="h-3.5 w-3.5" />
                    <span>Repeat Selection ({loopCount}x)</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* TAB 4: MASTERING & FX */}
        {activeTab === 'mastering' && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {/* Speed & Pitch */}
            <div className="rounded-2xl border border-white/10 bg-[#0B0B0F]/80 p-4 space-y-3">
              <h3 className="font-display text-sm font-semibold text-[#F5F3EE] flex items-center gap-2">
                <Gauge className="h-4 w-4 text-[#E5C158]" />
                <span>Speed & Pitch Control</span>
              </h3>
              <div>
                <div className="flex justify-between text-xs text-[#9E988E] mb-1">
                  <span>Speed</span>
                  <span className="font-mono tabular-nums text-[#F4D97B]">{speed.toFixed(2)}x</span>
                </div>
                <input
                  type="range"
                  min={0.5}
                  max={2.0}
                  step={0.05}
                  value={speed}
                  onPointerDown={() => onBeginDragHistory('Speed Multiplier')}
                  onPointerUp={() => onEndDragHistory()}
                  onPointerCancel={() => onEndDragHistory()}
                  onChange={(e) => {
                    onRecordCoalescedHistory('more-speed', 'Speed Multiplier');
                    onMoreParamsChange({ speed: Number(e.target.value) });
                  }}
                  aria-label="Speed multiplier"
                  className="studio-slider w-full"
                />
              </div>
              <div>
                <div className="flex justify-between text-xs text-[#9E988E] mb-1">
                  <span>Pitch Shift</span>
                  <span className="font-mono tabular-nums text-[#F4D97B]">
                    {pitchSemitones > 0 ? `+${pitchSemitones}` : pitchSemitones} st
                  </span>
                </div>
                <input
                  type="range"
                  min={-6}
                  max={6}
                  step={1}
                  value={pitchSemitones}
                  onPointerDown={() => onBeginDragHistory('Pitch Shift')}
                  onPointerUp={() => onEndDragHistory()}
                  onPointerCancel={() => onEndDragHistory()}
                  onChange={(e) => {
                    onRecordCoalescedHistory('more-pitch', 'Pitch Shift');
                    onMoreParamsChange({ pitchSemitones: Number(e.target.value) });
                  }}
                  aria-label="Pitch shift semitones"
                  className="studio-slider w-full"
                />
              </div>
              <button
                type="button"
                disabled={isBusy || (speed === 1 && pitchSemitones === 0)}
                onClick={() =>
                  void runAsyncEdit(
                    () => applySpeedAndPitch(activeBuffer, speed, pitchSemitones),
                    `Speed ${speed.toFixed(2)}x / Pitch ${pitchSemitones}st`,
                    true
                  )
                }
                className="w-full min-h-[40px] rounded-xl border border-[#D4AF37]/45 bg-[#D4AF37]/18 text-xs font-semibold text-[#F4D97B] disabled:opacity-40 cursor-pointer"
              >
                Apply Speed & Pitch
              </button>
            </div>

            {/* Normalize & Compression */}
            <div className="rounded-2xl border border-white/10 bg-[#0B0B0F]/80 p-4 space-y-3">
              <h3 className="font-display text-sm font-semibold text-[#F5F3EE] flex items-center gap-2">
                <Volume2 className="h-4 w-4 text-[#E5C158]" />
                <span>Normalize & Compression</span>
              </h3>
              <button
                type="button"
                disabled={isBusy}
                onClick={() =>
                  void runAsyncEdit(() => normalizeAudioBuffer(activeBuffer, -0.5), 'Normalize (-0.5 dB)')
                }
                className="w-full min-h-[40px] rounded-xl border border-[#D4AF37]/40 bg-[#D4AF37]/15 text-xs font-semibold text-[#F4D97B] hover:bg-[#D4AF37]/25 cursor-pointer"
              >
                Normalize Peak Volume (-0.5 dB)
              </button>
              <div className="pt-2 border-t border-white/10 space-y-2">
                <div className="flex justify-between text-xs text-[#9E988E]">
                  <span>Compressor Threshold</span>
                  <span className="font-mono tabular-nums text-[#F4D97B]">{compThreshold} dB</span>
                </div>
                <input
                  type="range"
                  min={-36}
                  max={-6}
                  step={2}
                  value={compThreshold}
                  onPointerDown={() => onBeginDragHistory('Compressor Threshold')}
                  onPointerUp={() => onEndDragHistory()}
                  onPointerCancel={() => onEndDragHistory()}
                  onChange={(e) => {
                    onRecordCoalescedHistory('more-comp-thresh', 'Compressor Threshold');
                    onMoreParamsChange({ compThreshold: Number(e.target.value) });
                  }}
                  aria-label="Compressor threshold"
                  className="studio-slider w-full"
                />
                <div className="flex justify-between text-xs text-[#9E988E]">
                  <span>Ratio</span>
                  <span className="font-mono tabular-nums text-[#F4D97B]">{compRatio}:1</span>
                </div>
                <input
                  type="range"
                  min={2}
                  max={12}
                  step={1}
                  value={compRatio}
                  onPointerDown={() => onBeginDragHistory('Compressor Ratio')}
                  onPointerUp={() => onEndDragHistory()}
                  onPointerCancel={() => onEndDragHistory()}
                  onChange={(e) => {
                    onRecordCoalescedHistory('more-comp-ratio', 'Compressor Ratio');
                    onMoreParamsChange({ compRatio: Number(e.target.value) });
                  }}
                  aria-label="Compressor ratio"
                  className="studio-slider w-full"
                />
                <button
                  type="button"
                  disabled={isBusy}
                  onClick={() =>
                    void runAsyncEdit(
                      () => applyAudioCompression(activeBuffer, compThreshold, compRatio, 2),
                      `Compress (${compThreshold}dB, ${compRatio}:1)`
                    )
                  }
                  className="w-full min-h-[40px] rounded-xl border border-white/15 bg-white/5 text-xs font-medium text-[#F5F3EE] hover:border-[#E5C158] cursor-pointer"
                >
                  Apply Dynamics Compression
                </button>
              </div>
            </div>

            {/* Fades, Crossfade & Silence Removal */}
            <div className="rounded-2xl border border-white/10 bg-[#0B0B0F]/80 p-4 space-y-3">
              <h3 className="font-display text-sm font-semibold text-[#F5F3EE] flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-[#E5C158]" />
                <span>Fades & Silence Removal</span>
              </h3>
              <div>
                <div className="flex justify-between text-xs text-[#9E988E] mb-1">
                  <span>Fade Duration</span>
                  <span className="font-mono tabular-nums text-[#F4D97B]">{fadeSec.toFixed(1)}s</span>
                </div>
                <input
                  type="range"
                  min={0.5}
                  max={8}
                  step={0.5}
                  value={fadeSec}
                  onPointerDown={() => onBeginDragHistory('Fade Duration')}
                  onPointerUp={() => onEndDragHistory()}
                  onPointerCancel={() => onEndDragHistory()}
                  onChange={(e) => {
                    onRecordCoalescedHistory('more-fade-sec', 'Fade Duration');
                    onMoreParamsChange({ fadeSec: Number(e.target.value) });
                  }}
                  aria-label="Fade duration"
                  className="studio-slider w-full"
                />
                <div className="grid grid-cols-2 gap-2 mt-2">
                  <button
                    type="button"
                    disabled={isBusy}
                    onClick={() =>
                      void runAsyncEdit(
                        () =>
                          applyFade(
                            activeBuffer,
                            'in',
                            0,
                            Math.min(activeBuffer.duration, fadeSec)
                          ),
                        `Fade In (${fadeSec.toFixed(1)}s)`
                      )
                    }
                    className="min-h-[38px] rounded-lg border border-white/15 bg-white/5 text-xs font-medium text-[#F5F3EE] hover:border-[#E5C158] cursor-pointer"
                  >
                    Fade In
                  </button>
                  <button
                    type="button"
                    disabled={isBusy}
                    onClick={() =>
                      void runAsyncEdit(
                        () =>
                          applyFade(
                            activeBuffer,
                            'out',
                            Math.max(0, activeBuffer.duration - fadeSec),
                            activeBuffer.duration
                          ),
                        `Fade Out (${fadeSec.toFixed(1)}s)`
                      )
                    }
                    className="min-h-[38px] rounded-lg border border-white/15 bg-white/5 text-xs font-medium text-[#F5F3EE] hover:border-[#E5C158] cursor-pointer"
                  >
                    Fade Out
                  </button>
                </div>
              </div>

              <button
                type="button"
                disabled={!hasSelection || isBusy}
                title={hasSelection ? 'Apply dip crossfade over selected transition' : selectionHint}
                onClick={() =>
                  selection &&
                  void runAsyncEdit(
                    () => applyCrossfadeAtSelection(activeBuffer, selection.start, selection.end),
                    'Crossfade Selection'
                  )
                }
                className="w-full min-h-[38px] rounded-lg border border-[#D4AF37]/35 bg-[#16161C] text-xs font-medium text-[#F5F3EE] disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
              >
                Crossfade Selection
              </button>

              <div className="pt-2 border-t border-white/10 space-y-2">
                <div className="flex justify-between text-xs text-[#9E988E]">
                  <span>Silence Threshold</span>
                  <span className="font-mono tabular-nums text-[#F4D97B]">{silenceDb} dB</span>
                </div>
                <input
                  type="range"
                  min={-60}
                  max={-24}
                  step={2}
                  value={silenceDb}
                  onPointerDown={() => onBeginDragHistory('Silence Threshold')}
                  onPointerUp={() => onEndDragHistory()}
                  onPointerCancel={() => onEndDragHistory()}
                  onChange={(e) => {
                    onRecordCoalescedHistory('more-silence-db', 'Silence Threshold');
                    onMoreParamsChange({ silenceDb: Number(e.target.value) });
                  }}
                  aria-label="Silence threshold"
                  className="studio-slider w-full"
                />
                <button
                  type="button"
                  disabled={isBusy}
                  onClick={() =>
                    void runAsyncEdit(
                      () => removeSilence(activeBuffer, silenceDb, 0.35),
                      `Remove Silence (< ${silenceDb} dB)`,
                      true
                    )
                  }
                  className="w-full min-h-[38px] rounded-lg border border-white/15 bg-white/5 text-xs font-medium text-[#F5F3EE] hover:border-[#E5C158] cursor-pointer"
                >
                  Remove Long Silences
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Prominent Export Footer */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-4 border-t border-white/10">
          <span className="text-xs text-[#9E988E]">
            Ready to save your final track in WAV or MP3 format.
          </span>
          <button
            type="button"
            onClick={onExport}
            className="inline-flex min-h-[46px] items-center gap-2 rounded-xl border border-[#E5C158]/70 bg-gradient-to-b from-[#E5C158] to-[#C59B27] px-6 py-2.5 text-sm font-semibold text-[#09090C] hover:brightness-105 cursor-pointer"
          >
            <Download className="h-4 w-4" />
            <span>Download / Export Audio</span>
          </button>
        </div>
      </div>
    </div>
  );
}
