import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  decodeAudioFile,
  getAudioContext,
} from './audio/audioEngine';
import { importAudioFromLink } from './audio/linkImport';
import { ContactSection } from './components/ContactSection';
import { CutterSection } from './components/CutterSection';
import { ErrorBoundary } from './components/ErrorBoundary';
import { ExportModal } from './components/ExportModal';
import { GlobalWorkspaceHeader } from './components/GlobalWorkspaceHeader';
import { HomeSection } from './components/HomeSection';
import { IntroOverlay } from './components/IntroOverlay';
import { JoinerSection, makeMainJoinClip } from './components/JoinerSection';
import { MoreSection } from './components/MoreSection';
import { OverlaySection } from './components/OverlaySection';
import { TopNav } from './components/TopNav';
import { BRAND_CONFIG } from './config/brand';
import type {
  CutterParams,
  HistoryEntry,
  JoinerClip,
  MoreParams,
  OverlayState,
  ProjectSnapshot,
  TimeSelection,
  ToolSection,
} from './types/audio';

const SECTION_ORDER: ToolSection[] = ['home', 'cutter', 'joiner', 'overlay', 'more'];

const DEFAULT_CUTTER_PARAMS: CutterParams = {
  fadeInDur: 1.5,
  fadeOutDur: 1.5,
};

function createDefaultMoreParams(): MoreParams {
  return {
    automationPoints: [
      { id: 'start', time: 0, gain: 1 },
      { id: 'mid', time: 0.5, gain: 1 },
      { id: 'end', time: 1, gain: 1 },
    ],
    eqBands: [
      { frequency: 60, label: '60 Hz', type: 'lowshelf', gain: 0 },
      { frequency: 230, label: '230 Hz', type: 'peaking', gain: 0 },
      { frequency: 910, label: '910 Hz', type: 'peaking', gain: 0 },
      { frequency: 3600, label: '3.6 kHz', type: 'peaking', gain: 0 },
      { frequency: 14000, label: '14 kHz', type: 'highshelf', gain: 0 },
    ],
    loopCount: 2,
    speed: 1,
    pitchSemitones: 0,
    fadeSec: 2.0,
    compThreshold: -18,
    compRatio: 4,
    silenceDb: -42,
  };
}

const DEFAULT_OVERLAY_STATE: OverlayState = {
  mainVolume: 1,
  overlays: [],
};

function cloneSnapshot(s: ProjectSnapshot): ProjectSnapshot {
  return {
    buffer: s.buffer,
    selection: s.selection ? { ...s.selection } : null,
    cutterParams: { ...s.cutterParams },
    moreParams: {
      ...s.moreParams,
      automationPoints: s.moreParams.automationPoints.map((p) => ({ ...p })),
      eqBands: s.moreParams.eqBands.map((b) => ({ ...b })),
    },
    joinerClips: s.joinerClips.map((c) => ({ ...c })),
    overlayState: {
      mainVolume: s.overlayState.mainVolume,
      overlays: s.overlayState.overlays.map((o) => ({ ...o })),
    },
  };
}

function snapshotsEqual(a: ProjectSnapshot, b: ProjectSnapshot): boolean {
  if (a.buffer !== b.buffer) return false;
  if ((a.selection === null) !== (b.selection === null)) return false;
  if (
    a.selection &&
    b.selection &&
    (Math.abs(a.selection.start - b.selection.start) > 1e-4 ||
      Math.abs(a.selection.end - b.selection.end) > 1e-4)
  ) {
    return false;
  }
  if (
    a.cutterParams.fadeInDur !== b.cutterParams.fadeInDur ||
    a.cutterParams.fadeOutDur !== b.cutterParams.fadeOutDur
  ) {
    return false;
  }
  const ma = a.moreParams;
  const mb = b.moreParams;
  if (
    ma.loopCount !== mb.loopCount ||
    ma.speed !== mb.speed ||
    ma.pitchSemitones !== mb.pitchSemitones ||
    ma.fadeSec !== mb.fadeSec ||
    ma.compThreshold !== mb.compThreshold ||
    ma.compRatio !== mb.compRatio ||
    ma.silenceDb !== mb.silenceDb ||
    ma.automationPoints.length !== mb.automationPoints.length ||
    ma.eqBands.length !== mb.eqBands.length
  ) {
    return false;
  }
  for (let i = 0; i < ma.automationPoints.length; i++) {
    if (
      ma.automationPoints[i].id !== mb.automationPoints[i].id ||
      Math.abs(ma.automationPoints[i].time - mb.automationPoints[i].time) > 1e-4 ||
      Math.abs(ma.automationPoints[i].gain - mb.automationPoints[i].gain) > 1e-4
    ) {
      return false;
    }
  }
  for (let i = 0; i < ma.eqBands.length; i++) {
    if (ma.eqBands[i].gain !== mb.eqBands[i].gain) return false;
  }
  if (a.joinerClips.length !== b.joinerClips.length) return false;
  for (let i = 0; i < a.joinerClips.length; i++) {
    const ca = a.joinerClips[i];
    const cb = b.joinerClips[i];
    if (
      ca.id !== cb.id ||
      ca.buffer !== cb.buffer ||
      ca.trimStart !== cb.trimStart ||
      ca.trimEnd !== cb.trimEnd ||
      ca.volume !== cb.volume ||
      ca.crossfadeSec !== cb.crossfadeSec
    ) {
      return false;
    }
  }
  if (a.overlayState.mainVolume !== b.overlayState.mainVolume) return false;
  if (a.overlayState.overlays.length !== b.overlayState.overlays.length) return false;
  for (let i = 0; i < a.overlayState.overlays.length; i++) {
    const oa = a.overlayState.overlays[i];
    const ob = b.overlayState.overlays[i];
    if (
      oa.id !== ob.id ||
      oa.buffer !== ob.buffer ||
      oa.startOffsetSec !== ob.startOffsetSec ||
      oa.trimStart !== ob.trimStart ||
      oa.trimEnd !== ob.trimEnd ||
      oa.volume !== ob.volume
    ) {
      return false;
    }
  }
  return true;
}

function trimHistoryByCaps(entries: HistoryEntry[]): HistoryEntry[] {
  let next = entries;
  if (next.length > BRAND_CONFIG.maxUndoSteps) {
    next = next.slice(next.length - BRAND_CONFIG.maxUndoSteps);
  }
  let startIdx = 0;
  const distinctBuffers = new Set<AudioBuffer>();
  for (let i = next.length - 1; i >= 0; i--) {
    distinctBuffers.add(next[i].snapshot.buffer);
    if (distinctBuffers.size > BRAND_CONFIG.maxBufferUndoSteps) {
      startIdx = i + 1;
      break;
    }
  }
  return startIdx > 0 ? next.slice(startIdx) : next;
}

export default function App() {
  const [showIntro, setShowIntro] = useState(true);
  const [activeSection, setActiveSection] = useState<ToolSection>('home');
  const [slideDirection, setSlideDirection] = useState<1 | -1>(1);

  // Active Audio Project State
  const [activeBuffer, setActiveBuffer] = useState<AudioBuffer | null>(null);
  const [fileName, setFileName] = useState<string>('');
  const [selection, setSelection] = useState<TimeSelection | null>(null);
  const [cutterParams, setCutterParams] = useState<CutterParams>(DEFAULT_CUTTER_PARAMS);
  const [moreParams, setMoreParams] = useState<MoreParams>(createDefaultMoreParams);
  const [joinerClips, setJoinerClips] = useState<JoinerClip[]>([]);
  const [overlayState, setOverlayState] = useState<OverlayState>(DEFAULT_OVERLAY_STATE);
  const [clipboardBuffer, setClipboardBuffer] = useState<AudioBuffer | null>(null);
  const [, setBufferVersion] = useState(0);

  // Unified Undo/Redo History (up to 20 logical steps, capped at 10 distinct AudioBuffers)
  const [historyPast, setHistoryPast] = useState<HistoryEntry[]>([]);
  const [historyFuture, setHistoryFuture] = useState<HistoryEntry[]>([]);

  // Upload & Link Import State
  const [isDecoding, setIsDecoding] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [isImportingLink, setIsImportingLink] = useState(false);
  const [linkStatus, setLinkStatus] = useState<string | null>(null);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [demoNotice, setDemoNotice] = useState<string | null>(null);
  const [focusLinkTrigger, setFocusLinkTrigger] = useState(0);

  // Shared Transport Playback State
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);

  // Export Modal State
  const [exportTarget, setExportTarget] = useState<{
    buffer: AudioBuffer;
    fileName: string;
  } | null>(null);

  const globalFileInputRef = useRef<HTMLInputElement>(null);
  const playbackSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const playbackStartCtxTimeRef = useRef(0);
  const playbackOffsetRef = useRef(0);
  const playbackRafRef = useRef<number | null>(null);
  const swipeStartRef = useRef<{ x: number; y: number; locked: boolean } | null>(null);
  const linkAbortRef = useRef<AbortController | null>(null);
  const commitPendingRef = useRef<(() => boolean) | null>(null);
  const getExportBufferRef = useRef<(() => { buffer: AudioBuffer; name: string } | null) | null>(
    null
  );

  // Live synchronous ref to full editable project snapshot for drag-coalesced Undo/Redo
  const stateRef = useRef<{
    activeBuffer: AudioBuffer | null;
    selection: TimeSelection | null;
    cutterParams: CutterParams;
    moreParams: MoreParams;
    joinerClips: JoinerClip[];
    overlayState: OverlayState;
  }>({
    activeBuffer,
    selection,
    cutterParams,
    moreParams,
    joinerClips,
    overlayState,
  });
  stateRef.current = {
    activeBuffer,
    selection,
    cutterParams,
    moreParams,
    joinerClips,
    overlayState,
  };

  const pendingDragRef = useRef<{ label: string; baseline: ProjectSnapshot } | null>(null);
  const coalesceRef = useRef<{ key: string; timestamp: number } | null>(null);

  const stopPlayback = useCallback((resetCursor = false) => {
    if (playbackSourceRef.current) {
      try {
        playbackSourceRef.current.onended = null;
        playbackSourceRef.current.stop();
      } catch {
        // ignore if already stopped
      }
      playbackSourceRef.current.disconnect();
      playbackSourceRef.current = null;
    }
    if (playbackRafRef.current !== null) {
      cancelAnimationFrame(playbackRafRef.current);
      playbackRafRef.current = null;
    }
    setIsPlaying(false);
    if (resetCursor) {
      playbackOffsetRef.current = 0;
      setCurrentTime(0);
    }
  }, []);

  useEffect(() => {
    const canonicalUrl = window.location.origin + window.location.pathname;
    let canonical = document.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    if (!canonical) {
      canonical = document.createElement('link');
      canonical.rel = 'canonical';
      document.head.appendChild(canonical);
    }
    canonical.href = canonicalUrl;

    let ogUrl = document.querySelector<HTMLMetaElement>('meta[property="og:url"]');
    if (!ogUrl) {
      ogUrl = document.createElement('meta');
      ogUrl.setAttribute('property', 'og:url');
      document.head.appendChild(ogUrl);
    }
    ogUrl.content = canonicalUrl;
  }, []);

  useEffect(() => {
    return () => {
      stopPlayback(false);
      linkAbortRef.current?.abort();
    };
  }, [stopPlayback]);

  const startPlaybackAt = useCallback(
    (offsetSec: number, durationLimitSec?: number) => {
      if (!activeBuffer) return;
      stopPlayback(false);

      const safeOffset = Math.max(0, Math.min(activeBuffer.duration - 0.01, offsetSec));
      const ctx = getAudioContext();
      if (ctx.state === 'suspended') {
        void ctx.resume();
      }
      const src = ctx.createBufferSource();
      src.buffer = activeBuffer;
      src.connect(ctx.destination);

      const startAt = ctx.currentTime;
      playbackStartCtxTimeRef.current = startAt;
      playbackOffsetRef.current = safeOffset;

      if (durationLimitSec !== undefined) {
        src.start(0, safeOffset, durationLimitSec);
      } else {
        src.start(0, safeOffset);
      }

      playbackSourceRef.current = src;
      setIsPlaying(true);

      const endLimit =
        durationLimitSec !== undefined
          ? Math.min(activeBuffer.duration, safeOffset + durationLimitSec)
          : activeBuffer.duration;

      const tick = () => {
        const elapsed = ctx.currentTime - playbackStartCtxTimeRef.current;
        const pos = playbackOffsetRef.current + elapsed;
        if (pos >= endLimit) {
          stopPlayback(false);
          playbackOffsetRef.current = durationLimitSec !== undefined ? safeOffset : 0;
          setCurrentTime(durationLimitSec !== undefined ? safeOffset : 0);
          return;
        }
        setCurrentTime(pos);
        playbackRafRef.current = requestAnimationFrame(tick);
      };
      playbackRafRef.current = requestAnimationFrame(tick);

      src.onended = () => {
        if (playbackSourceRef.current === src) {
          stopPlayback(false);
        }
      };
    },
    [activeBuffer, stopPlayback]
  );

  const handleTogglePlay = useCallback(() => {
    if (!activeBuffer) return;
    if (isPlaying) {
      const ctx = getAudioContext();
      const elapsed = ctx.currentTime - playbackStartCtxTimeRef.current;
      const pausedAt = Math.min(activeBuffer.duration, playbackOffsetRef.current + elapsed);
      stopPlayback(false);
      playbackOffsetRef.current = pausedAt;
      setCurrentTime(pausedAt);
    } else {
      const startPos = currentTime >= activeBuffer.duration - 0.05 ? 0 : currentTime;
      startPlaybackAt(startPos);
    }
  }, [activeBuffer, isPlaying, currentTime, stopPlayback, startPlaybackAt]);

  const handleSeek = useCallback(
    (timeSec: number) => {
      if (!activeBuffer) return;
      const clamped = Math.max(0, Math.min(activeBuffer.duration, timeSec));
      playbackOffsetRef.current = clamped;
      setCurrentTime(clamped);
      if (isPlaying) {
        startPlaybackAt(clamped);
      }
    },
    [activeBuffer, isPlaying, startPlaybackAt]
  );

  const handlePreviewRegion = useCallback(
    (startSec: number, endSec: number) => {
      const dur = Math.max(0.05, endSec - startSec);
      startPlaybackAt(startSec, dur);
    },
    [startPlaybackAt]
  );

  const handleSyncPlaybackTime = useCallback((timeSec: number) => {
    const dur = stateRef.current.activeBuffer?.duration ?? timeSec;
    const clamped = Math.max(0, Math.min(dur, timeSec));
    playbackOffsetRef.current = clamped;
    setCurrentTime(clamped);
  }, []);

  const captureCurrentSnapshot = useCallback((): ProjectSnapshot | null => {
    const cur = stateRef.current;
    if (!cur.activeBuffer) return null;
    return cloneSnapshot({
      buffer: cur.activeBuffer,
      selection: cur.selection,
      cutterParams: cur.cutterParams,
      moreParams: cur.moreParams,
      joinerClips: cur.joinerClips,
      overlayState: cur.overlayState,
    });
  }, []);

  const pushHistorySnapshot = useCallback((label: string, snapshot: ProjectSnapshot) => {
    const entry: HistoryEntry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      label,
      snapshot: cloneSnapshot(snapshot),
    };
    setHistoryPast((prev) => trimHistoryByCaps([...prev, entry]));
    setHistoryFuture([]);
  }, []);

  const handleEndDragHistory = useCallback(() => {
    const pending = pendingDragRef.current;
    if (!pending) return;
    pendingDragRef.current = null;
    const currentSnap = captureCurrentSnapshot();
    if (!currentSnap) return;
    if (!snapshotsEqual(pending.baseline, currentSnap)) {
      pushHistorySnapshot(pending.label, pending.baseline);
    }
  }, [captureCurrentSnapshot, pushHistorySnapshot]);

  const handleBeginDragHistory = useCallback(
    (label: string) => {
      // Finalize any open drag cleanly before starting a new one
      if (pendingDragRef.current) {
        handleEndDragHistory();
      }
      coalesceRef.current = null;
      const snap = captureCurrentSnapshot();
      if (!snap) return;
      pendingDragRef.current = { label, baseline: snap };
    },
    [captureCurrentSnapshot, handleEndDragHistory]
  );

  // Fallback global pointerup/pointercancel so a release outside the slider always commits 1 step
  useEffect(() => {
    const onGlobalPointerEnd = () => {
      if (pendingDragRef.current) {
        handleEndDragHistory();
      }
    };
    window.addEventListener('pointerup', onGlobalPointerEnd);
    window.addEventListener('pointercancel', onGlobalPointerEnd);
    return () => {
      window.removeEventListener('pointerup', onGlobalPointerEnd);
      window.removeEventListener('pointercancel', onGlobalPointerEnd);
    };
  }, [handleEndDragHistory]);

  const handleRecordDiscreteHistory = useCallback(
    (label: string) => {
      coalesceRef.current = null;
      pendingDragRef.current = null;
      const snap = captureCurrentSnapshot();
      if (!snap) return;
      pushHistorySnapshot(label, snap);
    },
    [captureCurrentSnapshot, pushHistorySnapshot]
  );

  const handleRecordCoalescedHistory = useCallback(
    (key: string, label: string) => {
      // Pointer drags are already handled cleanly by begin/endDragHistory
      if (pendingDragRef.current) return;
      const now = Date.now();
      const prev = coalesceRef.current;
      if (prev && prev.key === key && now - prev.timestamp < 500) {
        coalesceRef.current = { key, timestamp: now };
        return;
      }
      const snap = captureCurrentSnapshot();
      if (!snap) return;
      coalesceRef.current = { key, timestamp: now };
      pushHistorySnapshot(label, snap);
    },
    [captureCurrentSnapshot, pushHistorySnapshot]
  );

  // Lifted state updaters that also keep stateRef synchronously up-to-date for same-frame drags
  const handleSelectionChange = useCallback((next: TimeSelection | null) => {
    stateRef.current.selection = next;
    setSelection(next);
  }, []);

  const handleCutterParamsChange = useCallback((patch: Partial<CutterParams>) => {
    const next = { ...stateRef.current.cutterParams, ...patch };
    stateRef.current.cutterParams = next;
    setCutterParams(next);
  }, []);

  const handleMoreParamsChange = useCallback((patch: Partial<MoreParams>) => {
    const next = { ...stateRef.current.moreParams, ...patch };
    stateRef.current.moreParams = next;
    setMoreParams(next);
  }, []);

  const handleJoinerClipsChange = useCallback((next: JoinerClip[]) => {
    stateRef.current.joinerClips = next;
    setJoinerClips(next);
  }, []);

  const handleOverlayStateChange = useCallback((next: OverlayState) => {
    stateRef.current.overlayState = next;
    setOverlayState(next);
  }, []);

  const navigateToSection = useCallback(
    (next: ToolSection) => {
      if (next === activeSection) return;
      // Auto-commit any pending edits in the current section (e.g. Joiner or Overlay)
      if (commitPendingRef.current) {
        const committedOk = commitPendingRef.current();
        if (!committedOk) return;
      }
      stopPlayback(false);
      const currIdx = SECTION_ORDER.indexOf(activeSection);
      const nextIdx = SECTION_ORDER.indexOf(next);
      setSlideDirection(nextIdx >= currIdx ? 1 : -1);
      setActiveSection(next);
    },
    [activeSection, stopPlayback]
  );

  const initializeProjectWithBuffer = useCallback((decoded: AudioBuffer, name: string) => {
    const nextClips = [makeMainJoinClip(decoded, name)];
    const nextMore = createDefaultMoreParams();

    pendingDragRef.current = null;
    coalesceRef.current = null;
    setHistoryPast([]);
    setHistoryFuture([]);
    setClipboardBuffer(null);

    stateRef.current = {
      activeBuffer: decoded,
      selection: null,
      cutterParams: { ...DEFAULT_CUTTER_PARAMS },
      moreParams: nextMore,
      joinerClips: nextClips,
      overlayState: { ...DEFAULT_OVERLAY_STATE, overlays: [] },
    };

    setSelection(null);
    setCutterParams({ ...DEFAULT_CUTTER_PARAMS });
    setMoreParams(nextMore);
    setJoinerClips(nextClips);
    setOverlayState({ ...DEFAULT_OVERLAY_STATE, overlays: [] });
    setActiveBuffer(decoded);
    setFileName(name);
    setCurrentTime(0);
    setBufferVersion((n) => n + 1);
  }, []);

  const handleFileUpload = useCallback(
    async (file: File) => {
      if (isDecoding || isImportingLink) return;
      stopPlayback(true);
      setIsDecoding(true);
      setUploadError(null);
      setLinkError(null);

      try {
        const decoded = await decodeAudioFile(file);
        setDemoNotice(null);
        initializeProjectWithBuffer(decoded, file.name);
      } catch (err) {
        setUploadError(
          err instanceof Error
            ? err.message
            : 'Unable to process this audio file. Please try another file.'
        );
      } finally {
        setIsDecoding(false);
      }
    },
    [isDecoding, isImportingLink, stopPlayback, initializeProjectWithBuffer]
  );

  const handleImportLink = useCallback(
    async (rawUrl: string) => {
      if (isDecoding || isImportingLink) return;
      stopPlayback(true);
      linkAbortRef.current?.abort();
      const controller = new AbortController();
      linkAbortRef.current = controller;

      setIsImportingLink(true);
      setLinkStatus('Validating link...');
      setLinkError(null);
      setUploadError(null);

      try {
        const result = await importAudioFromLink(
          rawUrl,
          (status) => setLinkStatus(status),
          controller.signal
        );
        if (controller.signal.aborted) return;

        initializeProjectWithBuffer(result.buffer, result.fileName);
        setDemoNotice(
          result.isDemo
            ? `Demo Mode: Loaded a bundled 10s sample track (${result.platformLabel} link validated). Configure API_ENDPOINT and set DEMO_MODE = false in src/config/linkImport.ts when connecting a real backend.`
            : null
        );
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setLinkError(
          err instanceof Error
            ? err.message
            : 'Unable to import audio from this link. Please check the URL and try again.'
        );
      } finally {
        if (linkAbortRef.current === controller) {
          linkAbortRef.current = null;
        }
        setIsImportingLink(false);
        setLinkStatus(null);
      }
    },
    [isDecoding, isImportingLink, stopPlayback, initializeProjectWithBuffer]
  );

  const handleCommitEdit = useCallback(
    (
      newBuffer: AudioBuffer,
      label: string,
      newSelection: TimeSelection | null = null,
      overrides?: { joinerClips?: JoinerClip[]; overlayState?: OverlayState }
    ) => {
      if (!stateRef.current.activeBuffer) {
        initializeProjectWithBuffer(newBuffer, fileName || 'edited-studio-track.wav');
        handleSelectionChange(newSelection);
        return;
      }

      stopPlayback(true);
      pendingDragRef.current = null;
      coalesceRef.current = null;

      const baseline = captureCurrentSnapshot();
      if (baseline) {
        pushHistorySnapshot(label, baseline);
      }

      const nextJoinerClips =
        overrides?.joinerClips ??
        (stateRef.current.joinerClips.length > 0
          ? stateRef.current.joinerClips.map((c) =>
              c.id.startsWith('main-') ? makeMainJoinClip(newBuffer, c.name) : c
            )
          : [makeMainJoinClip(newBuffer, fileName || 'Main Track')]);
      const nextOverlayState = overrides?.overlayState ?? stateRef.current.overlayState;

      stateRef.current = {
        ...stateRef.current,
        activeBuffer: newBuffer,
        selection: newSelection,
        joinerClips: nextJoinerClips,
        overlayState: nextOverlayState,
      };

      setActiveBuffer(newBuffer);
      setSelection(newSelection);
      setJoinerClips(nextJoinerClips);
      if (overrides?.overlayState) {
        setOverlayState(nextOverlayState);
      }
      setCurrentTime(0);
      setBufferVersion((n) => n + 1);
    },
    [
      captureCurrentSnapshot,
      fileName,
      handleSelectionChange,
      initializeProjectWithBuffer,
      pushHistorySnapshot,
      stopPlayback,
    ]
  );

  const applySnapshot = useCallback(
    (target: ProjectSnapshot) => {
      const bufferChanged = target.buffer !== stateRef.current.activeBuffer;
      if (bufferChanged) {
        stopPlayback(true);
        setBufferVersion((n) => n + 1);
      }
      const cloned = cloneSnapshot(target);
      stateRef.current = {
        activeBuffer: cloned.buffer,
        selection: cloned.selection,
        cutterParams: cloned.cutterParams,
        moreParams: cloned.moreParams,
        joinerClips: cloned.joinerClips,
        overlayState: cloned.overlayState,
      };
      setActiveBuffer(cloned.buffer);
      setSelection(cloned.selection);
      setCutterParams(cloned.cutterParams);
      setMoreParams(cloned.moreParams);
      setJoinerClips(cloned.joinerClips);
      setOverlayState(cloned.overlayState);
    },
    [stopPlayback]
  );

  const handleUndo = useCallback(() => {
    if (!stateRef.current.activeBuffer || historyPast.length === 0) return;
    pendingDragRef.current = null;
    coalesceRef.current = null;

    const currentSnap = captureCurrentSnapshot();
    if (!currentSnap) return;

    const previous = historyPast[historyPast.length - 1];
    const redoEntry: HistoryEntry = {
      id: `${Date.now()}-redo`,
      label: previous.label,
      snapshot: currentSnap,
    };

    setHistoryPast((prev) => prev.slice(0, -1));
    setHistoryFuture((prev) => [redoEntry, ...prev].slice(0, BRAND_CONFIG.maxUndoSteps));
    applySnapshot(previous.snapshot);
  }, [applySnapshot, captureCurrentSnapshot, historyPast]);

  const handleRedo = useCallback(() => {
    if (!stateRef.current.activeBuffer || historyFuture.length === 0) return;
    pendingDragRef.current = null;
    coalesceRef.current = null;

    const currentSnap = captureCurrentSnapshot();
    if (!currentSnap) return;

    const nextEntry = historyFuture[0];
    const undoEntry: HistoryEntry = {
      id: `${Date.now()}-undo`,
      label: nextEntry.label,
      snapshot: currentSnap,
    };

    setHistoryFuture((prev) => prev.slice(1));
    setHistoryPast((prev) => trimHistoryByCaps([...prev, undoEntry]));
    applySnapshot(nextEntry.snapshot);
  }, [applySnapshot, captureCurrentSnapshot, historyFuture]);

  const handleClearProject = useCallback(() => {
    stopPlayback(true);
    pendingDragRef.current = null;
    coalesceRef.current = null;
    const defaultMore = createDefaultMoreParams();

    stateRef.current = {
      activeBuffer: null,
      selection: null,
      cutterParams: { ...DEFAULT_CUTTER_PARAMS },
      moreParams: defaultMore,
      joinerClips: [],
      overlayState: { ...DEFAULT_OVERLAY_STATE, overlays: [] },
    };

    setActiveBuffer(null);
    setFileName('');
    setSelection(null);
    setCutterParams({ ...DEFAULT_CUTTER_PARAMS });
    setMoreParams(defaultMore);
    setJoinerClips([]);
    setOverlayState({ ...DEFAULT_OVERLAY_STATE, overlays: [] });
    setClipboardBuffer(null);
    setHistoryPast([]);
    setHistoryFuture([]);
    setUploadError(null);
    setLinkError(null);
    setDemoNotice(null);
    setBufferVersion((n) => n + 1);
    commitPendingRef.current = null;
    getExportBufferRef.current = null;
    setSlideDirection(-1);
    setActiveSection('home');
  }, [stopPlayback]);

  const handleScrollToContact = useCallback(() => {
    const el = document.getElementById('contact');
    el?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  // Keyboard shortcuts (Space = Play/Pause, Ctrl/Cmd+Z = Undo/Redo, Alt+Arrows = Section navigation)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isTextInput =
        target &&
        ((target.tagName === 'INPUT' && (target as HTMLInputElement).type !== 'range') ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT');
      if (isTextInput) return;

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && activeBuffer && !exportTarget) {
        e.preventDefault();
        if (e.shiftKey) {
          handleRedo();
        } else {
          handleUndo();
        }
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y' && activeBuffer && !exportTarget) {
        e.preventDefault();
        handleRedo();
        return;
      }

      if (e.code === 'Space' && activeBuffer && !exportTarget) {
        e.preventDefault();
        handleTogglePlay();
      } else if (e.altKey && e.key === 'ArrowRight') {
        const idx = SECTION_ORDER.indexOf(activeSection);
        if (idx < SECTION_ORDER.length - 1) navigateToSection(SECTION_ORDER[idx + 1]);
      } else if (e.altKey && e.key === 'ArrowLeft') {
        const idx = SECTION_ORDER.indexOf(activeSection);
        if (idx > 0) navigateToSection(SECTION_ORDER[idx - 1]);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [activeBuffer, activeSection, exportTarget, handleRedo, handleTogglePlay, handleUndo, navigateToSection]);

  // Swipe-based horizontal navigation (yields when interacting with waveform/controls)
  const onWorkspacePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement | null;
    const isLocked = Boolean(
      target?.closest('[data-gesture-lock="true"], input, button, select, textarea, a')
    );
    swipeStartRef.current = { x: e.clientX, y: e.clientY, locked: isLocked };
  };

  const onWorkspacePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const start = swipeStartRef.current;
    swipeStartRef.current = null;
    if (!start || start.locked) return;

    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    if (Math.abs(dx) < 75 || Math.abs(dx) < Math.abs(dy) * 1.5) return;

    const currIdx = SECTION_ORDER.indexOf(activeSection);
    if (dx < 0 && currIdx < SECTION_ORDER.length - 1) {
      navigateToSection(SECTION_ORDER[currIdx + 1]);
    } else if (dx > 0 && currIdx > 0) {
      navigateToSection(SECTION_ORDER[currIdx - 1]);
    }
  };

  const isEditingView = Boolean(activeBuffer) || activeSection !== 'home';

  return (
    <div className="relative min-h-screen flex flex-col bg-[#070709] text-[#F5F3EE]">
      {/* Opening 2-Second Right -> Center -> Left Swipe Card */}
      {showIntro && <IntroOverlay onComplete={() => setShowIntro(false)} />}

      {/* Hidden Global Audio Upload Input */}
      <input
        ref={globalFileInputRef}
        type="file"
        accept="audio/*,.mp3,.wav,.m4a,.ogg,.aac,.flac"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) void handleFileUpload(f);
        }}
      />

      {/* Provided Dark Drum-Kit Stage Background + Dynamic Dark/Blur Overlay */}
      <div className="fixed inset-0 z-0 pointer-events-none">
        <img
          src={BRAND_CONFIG.heroBackgroundImage}
          alt="Stage drum kit atmospheric studio background"
          className="h-full w-full object-cover object-center"
          referrerPolicy="no-referrer"
        />
        <div
          className={`absolute inset-0 transition-all duration-500 ${
            isEditingView
              ? 'bg-[#070709]/80 backdrop-blur-md'
              : 'bg-gradient-to-b from-[#070709]/55 via-[#070709]/45 to-[#070709]/90'
          }`}
        />
      </div>

      {/* Top Navigation Bar */}
      <TopNav
        activeSection={activeSection}
        hasAudio={Boolean(activeBuffer)}
        onSelectSection={navigateToSection}
        onContactClick={handleScrollToContact}
        onPrimaryAction={() => {
          if (activeBuffer) {
            const custom = getExportBufferRef.current?.();
            if (custom) {
              setExportTarget({ buffer: custom.buffer, fileName: custom.name });
            } else {
              setExportTarget({ buffer: activeBuffer, fileName: fileName || 'event-audio' });
            }
          } else {
            globalFileInputRef.current?.click();
          }
        }}
      />

      {/* Main Studio Workspace & Swipe Container */}
      <main
        onPointerDown={onWorkspacePointerDown}
        onPointerUp={onWorkspacePointerUp}
        className="relative z-10 flex-1 flex flex-col"
      >
        {/* Global Workspace Header (Visible once audio is loaded) */}
        <AnimatePresence>
          {activeBuffer && (
            <motion.div
              initial={{ opacity: 0, y: -14, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -14 }}
              transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
              className="mx-auto w-full max-w-6xl px-4 pt-5"
            >
              <GlobalWorkspaceHeader
                fileName={fileName}
                duration={activeBuffer.duration}
                currentTime={currentTime}
                sampleRate={activeBuffer.sampleRate}
                channels={activeBuffer.numberOfChannels}
                isPlaying={isPlaying}
                canUndo={historyPast.length > 0}
                canRedo={historyFuture.length > 0}
                undoLabel={historyPast[historyPast.length - 1]?.label}
                redoLabel={historyFuture[0]?.label}
                undoCount={historyPast.length}
                onUndo={handleUndo}
                onRedo={handleRedo}
                onTogglePlay={handleTogglePlay}
                onStop={() => stopPlayback(true)}
                onReplaceFile={() => globalFileInputRef.current?.click()}
                onClearProject={handleClearProject}
              />
            </motion.div>
          )}
        </AnimatePresence>

        {/* Smooth Swipe-Transitioned Active Tool Section */}
        <div className="flex-1 overflow-x-hidden">
          <AnimatePresence mode="wait" custom={slideDirection}>
            <motion.section
              key={activeSection}
              custom={slideDirection}
              initial={{ opacity: 0, x: slideDirection * 48 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: slideDirection * -48 }}
              transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
              className="w-full"
            >
              <ErrorBoundary
                resetKey={activeSection}
                sectionName={activeSection.charAt(0).toUpperCase() + activeSection.slice(1)}
                onResetToHome={() => navigateToSection('home')}
              >
                {activeSection === 'home' && (
                  <HomeSection
                    activeBuffer={activeBuffer}
                    fileName={fileName}
                    currentTime={currentTime}
                    isDecoding={isDecoding}
                    error={uploadError}
                    isImportingLink={isImportingLink}
                    linkStatus={linkStatus}
                    linkError={linkError}
                    demoNotice={demoNotice}
                    focusLinkTrigger={focusLinkTrigger}
                    onFileSelected={(f) => void handleFileUpload(f)}
                    onImportLink={(url) => void handleImportLink(url)}
                    onClearLinkError={() => setLinkError(null)}
                    onNavigateTool={navigateToSection}
                    onSeek={handleSeek}
                  />
                )}

                {activeSection === 'cutter' && (
                  <CutterSection
                    activeBuffer={activeBuffer}
                    currentTime={currentTime}
                    selection={selection}
                    cutterParams={cutterParams}
                    onSeek={handleSeek}
                    onSelectionChange={handleSelectionChange}
                    onCutterParamsChange={handleCutterParamsChange}
                    onBeginDragHistory={handleBeginDragHistory}
                    onEndDragHistory={handleEndDragHistory}
                    onRecordDiscreteHistory={handleRecordDiscreteHistory}
                    onRecordCoalescedHistory={handleRecordCoalescedHistory}
                    onPreviewRegion={handlePreviewRegion}
                    onCommitEdit={handleCommitEdit}
                    onExport={() =>
                      activeBuffer &&
                      setExportTarget({ buffer: activeBuffer, fileName: fileName || 'cut-audio' })
                    }
                    onNext={() => navigateToSection('joiner')}
                    onUploadRequest={() => globalFileInputRef.current?.click()}
                  />
                )}

                {activeSection === 'joiner' && (
                  <JoinerSection
                    activeBuffer={activeBuffer}
                    activeFileName={fileName}
                    clips={joinerClips}
                    onClipsChange={handleJoinerClipsChange}
                    onBeginDragHistory={handleBeginDragHistory}
                    onEndDragHistory={handleEndDragHistory}
                    onRecordDiscreteHistory={handleRecordDiscreteHistory}
                    onRecordCoalescedHistory={handleRecordCoalescedHistory}
                    commitPendingRef={commitPendingRef}
                    getExportBufferRef={getExportBufferRef}
                    onCommitEdit={(buf, label, overrides) =>
                      handleCommitEdit(buf, label, null, overrides)
                    }
                    onExportCustomBuffer={(buf, name) =>
                      setExportTarget({ buffer: buf, fileName: name })
                    }
                    onNext={() => navigateToSection('overlay')}
                  />
                )}

                {activeSection === 'overlay' && (
                  <OverlaySection
                    activeBuffer={activeBuffer}
                    activeFileName={fileName}
                    overlayState={overlayState}
                    onOverlayStateChange={handleOverlayStateChange}
                    onBeginDragHistory={handleBeginDragHistory}
                    onEndDragHistory={handleEndDragHistory}
                    onRecordDiscreteHistory={handleRecordDiscreteHistory}
                    onRecordCoalescedHistory={handleRecordCoalescedHistory}
                    commitPendingRef={commitPendingRef}
                    getExportBufferRef={getExportBufferRef}
                    onCommitEdit={(buf, label, overrides) =>
                      handleCommitEdit(buf, label, null, overrides)
                    }
                    onExportCustomBuffer={(buf, name) =>
                      setExportTarget({ buffer: buf, fileName: name })
                    }
                    onNext={() => navigateToSection('more')}
                    onUploadRequest={() => globalFileInputRef.current?.click()}
                  />
                )}

                {activeSection === 'more' && (
                  <MoreSection
                    activeBuffer={activeBuffer}
                    currentTime={currentTime}
                    selection={selection}
                    clipboardBuffer={clipboardBuffer}
                    moreParams={moreParams}
                    isGlobalPlaying={isPlaying}
                    onSeek={handleSeek}
                    onSyncPlaybackTime={handleSyncPlaybackTime}
                    onStopGlobalPlayback={() => stopPlayback(false)}
                    onSelectionChange={handleSelectionChange}
                    onMoreParamsChange={handleMoreParamsChange}
                    onBeginDragHistory={handleBeginDragHistory}
                    onEndDragHistory={handleEndDragHistory}
                    onRecordDiscreteHistory={handleRecordDiscreteHistory}
                    onRecordCoalescedHistory={handleRecordCoalescedHistory}
                    onCopyRegion={setClipboardBuffer}
                    onCommitEdit={handleCommitEdit}
                    onExport={() =>
                      activeBuffer &&
                      setExportTarget({ buffer: activeBuffer, fileName: fileName || 'mastered-audio' })
                    }
                    onUploadRequest={() => globalFileInputRef.current?.click()}
                  />
                )}
              </ErrorBoundary>
            </motion.section>
          </AnimatePresence>
        </div>

        {/* Subtle Swipe Indicator Dots */}
        <div className="mx-auto mt-4 flex items-center justify-center gap-2 px-4">
          {SECTION_ORDER.map((sec) => (
            <button
              key={sec}
              type="button"
              onClick={() => navigateToSection(sec)}
              aria-label={`Switch to ${sec}`}
              className={`h-2 rounded-full transition-all cursor-pointer ${
                activeSection === sec
                  ? 'w-7 bg-[#E5C158]'
                  : 'w-2 bg-white/25 hover:bg-white/45'
              }`}
            />
          ))}
        </div>
      </main>

      {/* Contact Section at Bottom */}
      <ContactSection />

      {/* WAV & MP3 Export Dialog */}
      <ExportModal
        isOpen={Boolean(exportTarget)}
        buffer={exportTarget?.buffer ?? null}
        defaultFileName={exportTarget?.fileName ?? 'event-audio'}
        onClose={() => setExportTarget(null)}
        onImportFromLink={() => {
          setExportTarget(null);
          navigateToSection('home');
          setFocusLinkTrigger((n) => n + 1);
        }}
      />
    </div>
  );
}
