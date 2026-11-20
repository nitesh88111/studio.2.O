import { useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowDown,
  ArrowRight,
  ArrowUp,
  Check,
  Combine,
  Download,
  Loader2,
  Play,
  Plus,
  Square,
  Trash2,
} from 'lucide-react';
import {
  decodeAudioFile,
  formatTime,
  getAudioContext,
  joinAudioClips,
} from '../audio/audioEngine';
import type { JoinerClip } from '../types/audio';
import { WaveformCanvas } from './WaveformCanvas';

export function makeMainJoinClip(buf: AudioBuffer, name: string): JoinerClip {
  return {
    id: `main-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
    name: name || 'Main Track',
    buffer: buf,
    trimStart: 0,
    trimEnd: buf.duration,
    volume: 1,
    crossfadeSec: 0.5,
  };
}

interface JoinerSectionProps {
  activeBuffer: AudioBuffer | null;
  activeFileName: string;
  clips: JoinerClip[];
  onClipsChange: (clips: JoinerClip[]) => void;
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
    overrides?: { joinerClips?: JoinerClip[] }
  ) => void;
  onExportCustomBuffer: (buffer: AudioBuffer, fileName: string) => void;
  onNext: () => void;
}

export function JoinerSection({
  activeBuffer,
  activeFileName,
  clips,
  onClipsChange,
  onBeginDragHistory,
  onEndDragHistory,
  onRecordDiscreteHistory,
  onRecordCoalescedHistory,
  commitPendingRef,
  getExportBufferRef,
  onCommitEdit,
  onExportCustomBuffer,
  onNext,
}: JoinerSectionProps) {
  const [isLoadingClip, setIsLoadingClip] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewClipId, setPreviewClipId] = useState<string | null>(null);
  const [clipPlayheads, setClipPlayheads] = useState<Record<string, number>>({});
  const [isPreviewJoined, setIsPreviewJoined] = useState(false);
  const [joinedTime, setJoinedTime] = useState(0);
  const [appliedFlash, setAppliedFlash] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const previewSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const rafRef = useRef<number | null>(null);

  const stopPreview = () => {
    if (previewSourceRef.current) {
      try {
        previewSourceRef.current.onended = null;
        previewSourceRef.current.stop();
      } catch {
        // ignore already stopped
      }
      try {
        previewSourceRef.current.disconnect();
      } catch {
        // ignore
      }
      previewSourceRef.current = null;
    }
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    setPreviewClipId(null);
    setIsPreviewJoined(false);
    setJoinedTime(0);
  };

  useEffect(() => {
    return () => stopPreview();
  }, []);

  // Only auto-commit on tool navigation when multiple clips are queued to join;
  // a single-clip selection range must NEVER silently replace the full project audio on navigation.
  const hasMultipleClips = clips.length > 1;
  const hasExplicitSingleClipEdits =
    clips.length === 1 &&
    (clips[0].trimStart > 0.01 ||
      Math.abs(clips[0].trimEnd - clips[0].buffer.duration) > 0.05 ||
      Math.abs(clips[0].volume - 1) > 0.01 ||
      (activeBuffer !== null && clips[0].buffer !== activeBuffer));

  const commitJoinerChanges = (label?: string, forceCommit = false): boolean => {
    if (clips.length === 0 || (!hasMultipleClips && !(forceCommit && hasExplicitSingleClipEdits))) {
      return true;
    }
    setError(null);
    stopPreview();
    try {
      const joined = joinAudioClips(clips);
      onCommitEdit(
        joined,
        label || (clips.length > 1 ? `Join ${clips.length} Songs` : 'Joiner Track Edit'),
        { joinerClips: [makeMainJoinClip(joined, activeFileName || 'Joined Track')] }
      );
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to join clips.');
      return false;
    }
  };

  useEffect(() => {
    if (commitPendingRef) {
      commitPendingRef.current = () => commitJoinerChanges(undefined, false);
    }
    if (getExportBufferRef) {
      getExportBufferRef.current = () => {
        if (clips.length <= 1) return null;
        try {
          const joined = joinAudioClips(clips);
          return { buffer: joined, name: 'joined-event-mix' };
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

  const handleAddSongs = async (files: File[]) => {
    if (!files || files.length === 0 || isLoadingClip) return;
    setIsLoadingClip(true);
    setError(null);
    try {
      const added: JoinerClip[] = [];
      for (let i = 0; i < files.length; i++) {
        const decoded = await decodeAudioFile(files[i]);
        added.push({
          id: `clip-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 6)}`,
          name: files[i].name,
          buffer: decoded,
          trimStart: 0,
          trimEnd: decoded.duration,
          volume: 1,
          crossfadeSec: 0.5,
        });
      }
      onRecordDiscreteHistory(added.length > 1 ? `Add ${added.length} Songs` : 'Add Song to Joiner');
      onClipsChange([...clips, ...added]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to decode selected audio file.');
    } finally {
      setIsLoadingClip(false);
    }
  };

  const moveClip = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= clips.length) return;
    onRecordDiscreteHistory('Reorder Clips');
    const copy = [...clips];
    const [item] = copy.splice(index, 1);
    copy.splice(target, 0, item);
    onClipsChange(copy);
  };

  const updateClip = (id: string, patch: Partial<JoinerClip>) => {
    onClipsChange(clips.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  };

  const removeClip = (id: string) => {
    stopPreview();
    onRecordDiscreteHistory('Remove Clip from Joiner');
    onClipsChange(clips.filter((c) => c.id !== id));
  };

  const clipPreviewTimingRef = useRef<{
    clipId: string;
    ctxStart: number;
    startOffset: number;
    duration: number;
  } | null>(null);

  const pauseActiveClipPreview = (clipId: string) => {
    const timing = clipPreviewTimingRef.current;
    if (timing && timing.clipId === clipId) {
      try {
        const ctx = getAudioContext();
        const pausedPos = Math.max(
          0,
          Math.min(timing.duration, timing.startOffset + (ctx.currentTime - timing.ctxStart))
        );
        setClipPlayheads((prev) => ({ ...prev, [clipId]: pausedPos }));
      } catch {
        // ignore
      }
    }
    clipPreviewTimingRef.current = null;
    stopPreview();
  };

  const startClipPreviewAt = async (clip: JoinerClip, startOffsetSec: number) => {
    stopPreview();
    clipPreviewTimingRef.current = null;
    const ctx = getAudioContext();
    if (ctx.state === 'suspended') {
      await ctx.resume();
    }
    const totalDur = Math.max(0.05, clip.buffer.duration);
    const safeStart = Math.max(0, Math.min(totalDur - 0.05, startOffsetSec));

    const src = ctx.createBufferSource();
    src.buffer = clip.buffer;
    const gain = ctx.createGain();
    gain.gain.value = clip.volume;
    src.connect(gain);
    gain.connect(ctx.destination);

    const ctxStart = ctx.currentTime;
    src.start(0, safeStart);
    previewSourceRef.current = src;
    clipPreviewTimingRef.current = {
      clipId: clip.id,
      ctxStart,
      startOffset: safeStart,
      duration: totalDur,
    };
    setPreviewClipId(clip.id);
    setClipPlayheads((prev) => ({ ...prev, [clip.id]: safeStart }));

    const tick = () => {
      if (previewSourceRef.current !== src) return;
      const elapsed = Math.max(0, ctx.currentTime - ctxStart);
      const pos = safeStart + elapsed;
      if (pos >= totalDur) {
        clipPreviewTimingRef.current = null;
        stopPreview();
        setClipPlayheads((prev) => ({ ...prev, [clip.id]: 0 }));
        return;
      }
      setClipPlayheads((prev) => ({ ...prev, [clip.id]: pos }));
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);

    src.onended = () => {
      if (previewSourceRef.current === src) {
        clipPreviewTimingRef.current = null;
        stopPreview();
        setClipPlayheads((prev) => ({ ...prev, [clip.id]: 0 }));
      }
    };
  };

  const previewSingleClip = (clip: JoinerClip) => {
    if (previewClipId === clip.id) {
      pauseActiveClipPreview(clip.id);
      return;
    }
    const currentPos = clipPlayheads[clip.id] ?? 0;
    const startAt = currentPos >= clip.buffer.duration - 0.05 ? 0 : currentPos;
    void startClipPreviewAt(clip, startAt);
  };

  const handleSeekClip = (clip: JoinerClip, targetTimeSec: number) => {
    const clamped = Math.max(0, Math.min(clip.buffer.duration, targetTimeSec));
    setClipPlayheads((prev) => ({ ...prev, [clip.id]: clamped }));
    if (previewClipId === clip.id) {
      if (clamped < clip.buffer.duration - 0.05) {
        void startClipPreviewAt(clip, clamped);
      } else {
        clipPreviewTimingRef.current = null;
        stopPreview();
      }
    }
  };

  const handlePreviewJoined = async () => {
    if (isPreviewJoined) {
      stopPreview();
      return;
    }
    if (clips.length === 0) return;
    setError(null);
    stopPreview();
    try {
      const joined = joinAudioClips(clips);
      const ctx = getAudioContext();
      if (ctx.state === 'suspended') {
        await ctx.resume();
      }
      const src = ctx.createBufferSource();
      src.buffer = joined;
      src.connect(ctx.destination);
      const startAt = ctx.currentTime;
      src.start(0);
      previewSourceRef.current = src;
      setIsPreviewJoined(true);

      const tick = () => {
        if (previewSourceRef.current !== src) return;
        const elapsed = ctx.currentTime - startAt;
        if (elapsed >= joined.duration) {
          stopPreview();
          return;
        }
        setJoinedTime(elapsed);
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
      src.onended = () => {
        if (previewSourceRef.current === src) stopPreview();
      };
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to preview joined audio.');
    }
  };

  const handleApplyToStudio = () => {
    if (clips.length === 0) return;
    if (commitJoinerChanges(undefined, true)) {
      if (!hasMultipleClips && !hasExplicitSingleClipEdits) {
        setError(null);
        stopPreview();
        try {
          const joined = joinAudioClips(clips);
          onCommitEdit(joined, `Join ${clips.length} Songs`, {
            joinerClips: [makeMainJoinClip(joined, activeFileName || 'Joined Track')],
          });
        } catch (err) {
          setError(err instanceof Error ? err.message : 'Failed to join clips.');
          return;
        }
      }
      setAppliedFlash(true);
      setTimeout(() => setAppliedFlash(false), 2000);
    }
  };

  const handleExportJoined = () => {
    if (clips.length === 0) return;
    setError(null);
    try {
      const joined = joinAudioClips(clips);
      onExportCustomBuffer(joined, 'joined-event-mix');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to build joined export.');
    }
  };

  const handleNextStep = () => {
    if (commitJoinerChanges(undefined, false)) {
      onNext();
    }
  };

  const estimatedTotalDuration = clips.reduce((acc, clip, idx) => {
    const dur = Math.max(0.05, clip.trimEnd - clip.trimStart);
    const fade = idx < clips.length - 1 ? Math.min(clip.crossfadeSec, dur * 0.45) : 0;
    return acc + dur - fade;
  }, 0);

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-4">
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept="audio/*,.mp3,.wav,.m4a,.ogg,.aac,.flac"
        className="hidden"
        onChange={(e) => {
          const picked = Array.from(e.target.files ?? []);
          e.target.value = '';
          if (picked.length > 0) {
            void handleAddSongs(picked);
          }
        }}
      />

      <div className="rounded-3xl border border-[#D4AF37]/30 bg-[#101014]/82 backdrop-blur-2xl p-5 sm:p-6 shadow-[0_24px_80px_rgba(0,0,0,0.75)] space-y-5">
        {/* Top Row */}
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="font-display text-xl sm:text-2xl font-bold text-[#F5F3EE]">
              Song Joiner
            </h2>
            <p className="text-xs sm:text-sm text-[#9E988E]">
              Arrange songs in order, trim with the IN/OUT handles, click the top ruler or waveform to position the playhead independently, and merge smoothly.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <span className="text-xs font-mono tabular-nums text-[#C8C2B6]">
              {clips.length} {clips.length === 1 ? 'clip' : 'clips'} · Total ~{formatTime(Math.max(0, estimatedTotalDuration))}
            </span>
            <button
              type="button"
              disabled={isLoadingClip}
              onClick={() => fileInputRef.current?.click()}
              className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-[#E5C158]/60 bg-[#D4AF37]/18 px-4 py-2 text-sm font-semibold text-[#F4D97B] hover:bg-[#D4AF37]/28 disabled:opacity-50 cursor-pointer"
            >
              {isLoadingClip ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>Loading waveform...</span>
                </>
              ) : (
                <>
                  <Plus className="h-4 w-4" />
                  <span>Add Song</span>
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
            <AlertCircle className="h-5 w-5 shrink-0 text-red-400" />
            <span>{error}</span>
          </div>
        )}

        {/* Clips Queue */}
        {clips.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-[#D4AF37]/30 bg-[#0B0B0F]/60 p-10 text-center">
            <Combine className="mx-auto h-9 w-9 text-[#E5C158] mb-3" />
            <p className="text-sm text-[#C8C2B6]">
              No songs in the join queue yet. Click <strong className="text-[#F4D97B]">Add Song</strong> to start merging tracks.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {clips.map((clip, idx) => {
              const trimmedDur = Math.max(0.05, clip.trimEnd - clip.trimStart);
              const isPlayingThis = previewClipId === clip.id;
              const playheadSec = clipPlayheads[clip.id] ?? 0;

              return (
                <div
                  key={clip.id}
                  className="rounded-2xl border border-[#D4AF37]/25 bg-[#0B0B0F]/80 p-4 space-y-3"
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-[#D4AF37]/40 bg-[#D4AF37]/15 font-mono text-xs font-bold text-[#F4D97B]">
                        {idx + 1}
                      </span>
                      <div className="min-w-0">
                        <p className="truncate max-w-[240px] sm:max-w-[380px] text-sm font-semibold text-[#F5F3EE]">
                          {clip.name}
                        </p>
                        <p className="text-xs text-[#9E988E] font-mono tabular-nums">
                          Clip length: {formatTime(trimmedDur)} · Playhead: {formatTime(playheadSec)} · Original: {formatTime(clip.buffer.duration)}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => previewSingleClip(clip)}
                        className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-[#D4AF37]/35 bg-[#D4AF37]/15 px-3 text-xs font-medium text-[#F4D97B] hover:bg-[#D4AF37]/25 cursor-pointer"
                      >
                        {isPlayingThis ? <Square className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                        <span>{isPlayingThis ? 'Stop' : 'Preview'}</span>
                      </button>
                      <button
                        type="button"
                        disabled={idx === 0}
                        onClick={() => moveClip(idx, -1)}
                        aria-label="Move clip up"
                        className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-white/15 bg-white/5 text-[#D8D3C8] hover:text-white disabled:opacity-30 cursor-pointer"
                      >
                        <ArrowUp className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        disabled={idx === clips.length - 1}
                        onClick={() => moveClip(idx, 1)}
                        aria-label="Move clip down"
                        className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-white/15 bg-white/5 text-[#D8D3C8] hover:text-white disabled:opacity-30 cursor-pointer"
                      >
                        <ArrowDown className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => removeClip(clip.id)}
                        aria-label="Remove clip"
                        className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-red-500/25 bg-red-500/10 text-red-300 hover:bg-red-500/20 cursor-pointer"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>

                  {/* Independent Playhead + IN/OUT Selection Range Waveform */}
                  <WaveformCanvas
                    buffer={clip.buffer}
                    currentTime={playheadSec}
                    selection={{ start: clip.trimStart, end: clip.trimEnd }}
                    height={96}
                    onSeek={(t) => handleSeekClip(clip, t)}
                    onSelectionChange={(sel) => {
                      if (sel) {
                        const safeStart = Math.max(0, Math.min(clip.buffer.duration - 0.1, sel.start));
                        const safeEnd = Math.max(safeStart + 0.1, Math.min(clip.buffer.duration, sel.end));
                        updateClip(clip.id, { trimStart: safeStart, trimEnd: safeEnd });
                      }
                    }}
                    onInteractionStart={onBeginDragHistory}
                    onInteractionEnd={onEndDragHistory}
                  />

                  {/* Per-Clip Controls */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 pt-1">
                    <div>
                      <div className="flex justify-between text-[11px] text-[#9E988E] mb-1">
                        <span>Start Trim</span>
                        <span className="font-mono tabular-nums text-[#F4D97B]">
                          {formatTime(clip.trimStart)}
                        </span>
                      </div>
                      <input
                        type="range"
                        min={0}
                        max={Math.max(0, clip.trimEnd - 0.2)}
                        step={0.05}
                        value={clip.trimStart}
                        onPointerDown={() => onBeginDragHistory('Adjust Clip Start Trim')}
                        onPointerUp={onEndDragHistory}
                        onKeyDown={(e) => {
                          if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
                            onRecordCoalescedHistory(`join-start-${clip.id}`, 'Adjust Clip Start Trim');
                          }
                        }}
                        onChange={(e) =>
                          updateClip(clip.id, {
                            trimStart: Math.min(Number(e.target.value), clip.trimEnd - 0.2),
                          })
                        }
                        className="studio-slider w-full"
                      />
                    </div>

                    <div>
                      <div className="flex justify-between text-[11px] text-[#9E988E] mb-1">
                        <span>End Trim</span>
                        <span className="font-mono tabular-nums text-[#F4D97B]">
                          {formatTime(clip.trimEnd)}
                        </span>
                      </div>
                      <input
                        type="range"
                        min={Math.min(clip.buffer.duration, clip.trimStart + 0.2)}
                        max={clip.buffer.duration}
                        step={0.05}
                        value={clip.trimEnd}
                        onPointerDown={() => onBeginDragHistory('Adjust Clip End Trim')}
                        onPointerUp={onEndDragHistory}
                        onKeyDown={(e) => {
                          if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
                            onRecordCoalescedHistory(`join-end-${clip.id}`, 'Adjust Clip End Trim');
                          }
                        }}
                        onChange={(e) =>
                          updateClip(clip.id, {
                            trimEnd: Math.max(Number(e.target.value), clip.trimStart + 0.2),
                          })
                        }
                        className="studio-slider w-full"
                      />
                    </div>

                    <div>
                      <div className="flex justify-between text-[11px] text-[#9E988E] mb-1">
                        <span>Clip Volume</span>
                        <span className="font-mono tabular-nums text-[#F4D97B]">
                          {Math.round(clip.volume * 100)}%
                        </span>
                      </div>
                      <input
                        type="range"
                        min={0}
                        max={1.5}
                        step={0.05}
                        value={clip.volume}
                        onPointerDown={() => onBeginDragHistory('Adjust Clip Volume')}
                        onPointerUp={onEndDragHistory}
                        onKeyDown={(e) => {
                          if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
                            onRecordCoalescedHistory(`join-vol-${clip.id}`, 'Adjust Clip Volume');
                          }
                        }}
                        onChange={(e) => updateClip(clip.id, { volume: Number(e.target.value) })}
                        className="studio-slider w-full"
                      />
                    </div>

                    {idx < clips.length - 1 ? (
                      <div>
                        <div className="flex justify-between text-[11px] text-[#9E988E] mb-1">
                          <span>Crossfade to Next</span>
                          <span className="font-mono tabular-nums text-[#F4D97B]">
                            {clip.crossfadeSec.toFixed(1)}s
                          </span>
                        </div>
                        <input
                          type="range"
                          min={0}
                          max={5}
                          step={0.2}
                          value={clip.crossfadeSec}
                          onPointerDown={() => onBeginDragHistory('Adjust Crossfade Duration')}
                          onPointerUp={onEndDragHistory}
                          onKeyDown={(e) => {
                            if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
                              onRecordCoalescedHistory(`join-xfade-${clip.id}`, 'Adjust Crossfade Duration');
                            }
                          }}
                          onChange={(e) => updateClip(clip.id, { crossfadeSec: Number(e.target.value) })}
                          className="studio-slider w-full"
                        />
                      </div>
                    ) : (
                      <div className="flex items-center text-[11px] text-[#9E988E]">
                        Final track in sequence
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Sequence Preview & Apply Bar */}
        {clips.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[#D4AF37]/25 bg-[#0B0B0F]/80 p-4">
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => void handlePreviewJoined()}
                className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-[#D4AF37]/50 bg-[#D4AF37]/20 px-4 py-2 text-sm font-semibold text-[#F4D97B] hover:bg-[#D4AF37]/30 cursor-pointer"
              >
                {isPreviewJoined ? <Square className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                <span>{isPreviewJoined ? 'Stop Joined Preview' : 'Preview Joined Result'}</span>
              </button>
              {isPreviewJoined && (
                <span className="font-mono text-xs tabular-nums text-[#F4D97B]">
                  Playing {formatTime(joinedTime)}
                </span>
              )}
            </div>

            <button
              type="button"
              onClick={handleApplyToStudio}
              className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-white/20 bg-white/10 px-4 py-2 text-sm font-medium text-[#F5F3EE] hover:border-[#E5C158] hover:text-[#F4D97B] transition-colors cursor-pointer"
            >
              {appliedFlash ? <Check className="h-4 w-4 text-emerald-400" /> : <Combine className="h-4 w-4" />}
              <span>{appliedFlash ? 'Saved to Active Project' : 'Set Joined Mix as Active Track'}</span>
            </button>
          </div>
        )}

        {/* Joiner Bottom Controls */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-4 border-t border-white/10">
          <button
            type="button"
            disabled={clips.length === 0}
            onClick={handleExportJoined}
            className="inline-flex min-h-[46px] items-center gap-2 rounded-xl border border-[#D4AF37]/45 bg-[#D4AF37]/15 px-6 py-2.5 text-sm font-semibold text-[#F4D97B] hover:bg-[#D4AF37]/25 disabled:opacity-40 cursor-pointer"
          >
            <Download className="h-4 w-4" />
            <span>Export Joined Audio</span>
          </button>

          <button
            type="button"
            onClick={handleNextStep}
            className="inline-flex min-h-[46px] items-center gap-2 rounded-xl border border-[#E5C158]/70 bg-gradient-to-b from-[#E5C158] to-[#C59B27] px-6 py-2.5 text-sm font-semibold text-[#09090C] hover:brightness-105 cursor-pointer"
          >
            <span>Next: Overlay</span>
            <ArrowRight className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
