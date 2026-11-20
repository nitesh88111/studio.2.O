import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { computeWaveformPeaks, formatTime } from '../audio/audioEngine';
import type { AutomationPoint, TimeSelection } from '../types/audio';

interface WaveformCanvasProps {
  buffer: AudioBuffer;
  currentTime: number;
  selection: TimeSelection | null;
  zoom?: number;
  height?: number;
  readOnly?: boolean;
  showAutomation?: boolean;
  automationPoints?: AutomationPoint[];
  onSeek: (timeSec: number) => void;
  onSelectionChange?: (selection: TimeSelection | null) => void;
  onAutomationChange?: (points: AutomationPoint[]) => void;
  onInteractionStart?: (label: string) => void;
  onInteractionEnd?: () => void;
}

type DragHandle = 'start' | 'end' | null;

const RULER_H = 26;

export function WaveformCanvas({
  buffer,
  currentTime,
  selection,
  zoom = 1,
  height = 176,
  readOnly = false,
  showAutomation = false,
  automationPoints = [],
  onSeek,
  onSelectionChange,
  onAutomationChange,
  onInteractionStart,
  onInteractionEnd,
}: WaveformCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const offscreenCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const offscreenPlayedRef = useRef<HTMLCanvasElement | null>(null);
  const cachedKeyRef = useRef<string>('');
  const [scrollStartRatio, setScrollStartRatio] = useState(0);
  const [containerWidth, setContainerWidth] = useState(0);
  const [activeHandle, setActiveHandle] = useState<DragHandle>(null);
  const [hoverHandle, setHoverHandle] = useState<DragHandle>(null);

  const dragModeRef = useRef<
    | { type: 'none' }
    | { type: 'scrub-playhead' }
    | { type: 'select'; anchorTime: number; startX: number; moved: boolean }
    | { type: 'resize-start'; grabOffsetSec: number }
    | { type: 'resize-end'; grabOffsetSec: number }
    | { type: 'automation-node'; id: string }
  >({ type: 'none' });

  const peaks = useMemo(() => computeWaveformPeaks(buffer, 1800), [buffer]);

  const safeDuration = Math.max(0.05, Number.isFinite(buffer.duration) ? buffer.duration : 0.05);
  const minSelectionSec = Math.min(0.1, safeDuration * 0.05);

  const visibleDuration = safeDuration / Math.max(1, zoom);
  const maxStartRatio = Math.max(0, 1 - 1 / Math.max(1, zoom));
  const clampedScrollRatio = Math.min(maxStartRatio, Math.max(0, scrollStartRatio));
  const viewStartSec = clampedScrollRatio * safeDuration;
  const viewEndSec = Math.min(safeDuration, viewStartSec + visibleDuration);

  // Track responsive container width via ResizeObserver
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    setContainerWidth(el.clientWidth);
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerWidth(Math.floor(entry.contentRect.width));
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Keep playhead in view when zoomed during playback
  useEffect(() => {
    if (zoom <= 1) {
      setScrollStartRatio(0);
      return;
    }
    if (currentTime < viewStartSec || currentTime > viewEndSec) {
      const targetRatio = Math.max(
        0,
        Math.min(maxStartRatio, (currentTime - visibleDuration * 0.25) / safeDuration)
      );
      setScrollStartRatio(targetRatio);
    }
  }, [currentTime, zoom, safeDuration, maxStartRatio, visibleDuration, viewStartSec, viewEndSec]);

  const clientXToTime = useCallback(
    (clientX: number): number => {
      const canvas = canvasRef.current;
      if (!canvas) return 0;
      const rect = canvas.getBoundingClientRect();
      const rel = Math.max(0, Math.min(1, (clientX - rect.left) / Math.max(1, rect.width)));
      return viewStartSec + rel * (viewEndSec - viewStartSec);
    },
    [viewStartSec, viewEndSec]
  );

  // Generous invisible touch/mouse hit area (32px mouse, 44px touch) + tab bounding box check, strictly below ruler
  const detectHandleHit = useCallback(
    (x: number, y: number, rectWidth: number, pointerType: string): DragHandle => {
      if (!selection || readOnly || y <= RULER_H) return null;
      const viewSpan = Math.max(0.001, viewEndSec - viewStartSec);
      const selStartX = ((selection.start - viewStartSec) / viewSpan) * rectWidth;
      const selEndX = ((selection.end - viewStartSec) / viewSpan) * rectWidth;

      const hitRadius = pointerType === 'touch' ? 44 : 32;
      const tabW = 34;
      const tabH = 24;
      const pad = pointerType === 'touch' ? 14 : 8;

      const startTabX = Math.max(2, Math.min(rectWidth - tabW - 2, selStartX - 2));
      const startTabY = RULER_H + 4;
      const endTabX = Math.max(2, Math.min(rectWidth - tabW - 2, selEndX - tabW + 2));
      const endTabY = height - tabH - 4;

      const hitStartTab =
        x >= startTabX - pad &&
        x <= startTabX + tabW + pad &&
        y >= startTabY - pad &&
        y <= startTabY + tabH + pad;
      const hitEndTab =
        x >= endTabX - pad &&
        x <= endTabX + tabW + pad &&
        y >= endTabY - pad &&
        y <= endTabY + tabH + pad;

      if (hitStartTab && !hitEndTab) return 'start';
      if (hitEndTab && !hitStartTab) return 'end';

      const distStart = Math.abs(x - selStartX);
      const distEnd = Math.abs(x - selEndX);

      const inStart =
        hitStartTab ||
        (selStartX >= -hitRadius && selStartX <= rectWidth + hitRadius && distStart <= hitRadius);
      const inEnd =
        hitEndTab ||
        (selEndX >= -hitRadius && selEndX <= rectWidth + hitRadius && distEnd <= hitRadius);

      if (inStart && inEnd) {
        const midY = RULER_H + (height - RULER_H) / 2;
        if (Math.abs(distStart - distEnd) < 16) {
          return y <= midY ? 'start' : 'end';
        }
        return distStart <= distEnd ? 'start' : 'end';
      }
      if (inStart) return 'start';
      if (inEnd) return 'end';
      return null;
    },
    [selection, readOnly, viewStartSec, viewEndSec, height]
  );

  // Draw waveform, ruler, selection, distinct IN/OUT handles, playhead, and optional automation curve
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const width = containerWidth || container.clientWidth;
    if (width <= 0) return;

    const targetW = Math.floor(width * dpr);
    const targetH = Math.floor(height * dpr);
    if (canvas.width !== targetW || canvas.height !== targetH) {
      canvas.width = targetW;
      canvas.height = targetH;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const waveTop = RULER_H;
    const waveH = height - RULER_H;
    const centerY = waveTop + waveH / 2;
    const viewSpan = Math.max(0.001, viewEndSec - viewStartSec);
    const playRatio = (currentTime - viewStartSec) / viewSpan;
    const playX = playRatio * width;

    // Cache static background + unplayed bars and played bright gold bars in two offscreen canvases
    const cacheKey = `${width}x${height}@${dpr}|${safeDuration.toFixed(4)}|${viewStartSec.toFixed(4)}-${viewEndSec.toFixed(4)}|${peaks.maxs.length}|${buffer.length}`;
    if (!offscreenCanvasRef.current) {
      offscreenCanvasRef.current = document.createElement('canvas');
    }
    if (!offscreenPlayedRef.current) {
      offscreenPlayedRef.current = document.createElement('canvas');
    }
    const offscreen = offscreenCanvasRef.current;
    const offscreenPlayed = offscreenPlayedRef.current;
    if (
      offscreen.width !== targetW ||
      offscreen.height !== targetH ||
      offscreenPlayed.width !== targetW ||
      offscreenPlayed.height !== targetH ||
      cachedKeyRef.current !== cacheKey
    ) {
      offscreen.width = targetW;
      offscreen.height = targetH;
      offscreenPlayed.width = targetW;
      offscreenPlayed.height = targetH;
      const octx = offscreen.getContext('2d');
      const pctx = offscreenPlayed.getContext('2d');
      if (octx && pctx) {
        octx.setTransform(dpr, 0, 0, dpr, 0, 0);
        octx.clearRect(0, 0, width, height);
        pctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        pctx.clearRect(0, 0, width, height);

        // Background subtle grid
        octx.fillStyle = 'rgba(9, 9, 12, 0.72)';
        octx.fillRect(0, 0, width, height);

        octx.strokeStyle = 'rgba(212, 175, 55, 0.08)';
        octx.lineWidth = 1;
        octx.beginPath();
        octx.moveTo(0, centerY);
        octx.lineTo(width, centerY);
        octx.stroke();

        // Playhead Ruler strip
        octx.fillStyle = 'rgba(255, 255, 255, 0.04)';
        octx.fillRect(0, 0, width, RULER_H);
        octx.strokeStyle = 'rgba(212, 175, 55, 0.22)';
        octx.beginPath();
        octx.moveTo(0, RULER_H);
        octx.lineTo(width, RULER_H);
        octx.stroke();

        const tickCount = Math.max(4, Math.min(10, Math.floor(width / 110)));
        octx.fillStyle = 'rgba(200, 194, 182, 0.78)';
        octx.font = '500 10px "JetBrains Mono", monospace';
        octx.textBaseline = 'middle';
        for (let i = 0; i <= tickCount; i++) {
          const ratio = i / tickCount;
          const x = ratio * width;
          const t = viewStartSec + ratio * viewSpan;
          octx.strokeStyle = 'rgba(212, 175, 55, 0.24)';
          octx.beginPath();
          octx.moveTo(x, RULER_H - 6);
          octx.lineTo(x, RULER_H);
          octx.stroke();
          if (i < tickCount) {
            octx.fillText(formatTime(t), Math.min(width - 54, x + 4), RULER_H / 2);
          }
        }

        // Waveform bars (unplayed in base layer, bright gold in played overlay)
        const totalBuckets = peaks.maxs.length;
        const startBucketFloat = (viewStartSec / safeDuration) * totalBuckets;
        const endBucketFloat = (viewEndSec / safeDuration) * totalBuckets;
        const barWidth = Math.max(1.5, width / 260);
        const stepPx = barWidth + 1;

        octx.fillStyle = 'rgba(212, 175, 55, 0.42)';
        pctx.fillStyle = '#E5C158';
        for (let x = 0; x < width; x += stepPx) {
          const frac = x / width;
          const bStart = Math.floor(startBucketFloat + frac * (endBucketFloat - startBucketFloat));
          const bEnd = Math.max(
            bStart + 1,
            Math.floor(
              startBucketFloat + ((x + stepPx) / width) * (endBucketFloat - startBucketFloat)
            )
          );

          let min = 0;
          let max = 0;
          for (let b = Math.max(0, bStart); b < Math.min(totalBuckets, bEnd); b++) {
            if (peaks.mins[b] < min) min = peaks.mins[b];
            if (peaks.maxs[b] > max) max = peaks.maxs[b];
          }

          const amp = Math.max(Math.abs(min), Math.abs(max));
          const barH = Math.max(2, amp * (waveH * 0.84));
          const barY = centerY - barH / 2;
          octx.fillRect(x, barY, barWidth, barH);
          pctx.fillRect(x, barY, barWidth, barH);
        }
        cachedKeyRef.current = cacheKey;
      }
    }

    // Blit cached base waveform + clip-blit played gold bars cleanly
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(offscreen, 0, 0);
    if (playX > 0) {
      ctx.beginPath();
      ctx.rect(0, Math.floor(waveTop * dpr), Math.floor(Math.min(width, playX) * dpr), Math.ceil(waveH * dpr));
      ctx.clip();
      ctx.drawImage(offscreenPlayed, 0, 0);
    }
    ctx.restore();

    // Selection shading
    if (selection) {
      const selStartX = ((selection.start - viewStartSec) / viewSpan) * width;
      const selEndX = ((selection.end - viewStartSec) / viewSpan) * width;
      const drawStart = Math.max(0, selStartX);
      const drawEnd = Math.min(width, selEndX);
      if (drawEnd > drawStart) {
        ctx.fillStyle = 'rgba(212, 175, 55, 0.18)';
        ctx.fillRect(drawStart, waveTop, drawEnd - drawStart, waveH);
      }
    }

    // Optional Volume Automation Overlay
    if (showAutomation && automationPoints.length > 0) {
      const sorted = [...automationPoints].sort((a, b) => a.time - b.time);
      const gainToY = (g: number) => {
        const clampedG = Math.max(0, Math.min(1.5, g));
        return waveTop + waveH - (clampedG / 1.5) * (waveH - 12) - 6;
      };
      const normToX = (normT: number) => {
        const sec = normT * safeDuration;
        return ((sec - viewStartSec) / viewSpan) * width;
      };

      ctx.strokeStyle = '#60A5FA';
      ctx.lineWidth = 2;
      ctx.beginPath();
      sorted.forEach((pt, idx) => {
        const px = normToX(pt.time);
        const py = gainToY(pt.gain);
        if (idx === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      });
      ctx.stroke();

      for (const pt of sorted) {
        const px = normToX(pt.time);
        const py = gainToY(pt.gain);
        ctx.fillStyle = '#09090C';
        ctx.strokeStyle = '#93C5FD';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(px, py, 6, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
    }

    // Draw professional Start (IN) and End (OUT) selection handles ON TOP of waveform
    if (selection && !readOnly) {
      const selStartX = ((selection.start - viewStartSec) / viewSpan) * width;
      const selEndX = ((selection.end - viewStartSec) / viewSpan) * width;

      const drawHandleTab = (
        x: number,
        kind: 'start' | 'end',
        isActive: boolean,
        isHovered: boolean
      ) => {
        if (x < -16 || x > width + 16) return;
        const clampedX = Math.max(1, Math.min(width - 1, x));
        const isStart = kind === 'start';
        const lineColor = isActive
          ? '#FFF2B2'
          : isStart
            ? '#F4D97B'
            : '#D9A73E';

        ctx.save();
        if (isActive || isHovered) {
          ctx.shadowColor = 'rgba(229, 193, 88, 0.7)';
          ctx.shadowBlur = isActive ? 12 : 6;
        }

        // Crisp vertical boundary line
        ctx.strokeStyle = lineColor;
        ctx.lineWidth = isActive ? 3.5 : isHovered ? 2.5 : 2;
        ctx.beginPath();
        ctx.moveTo(clampedX, waveTop);
        ctx.lineTo(clampedX, height);
        ctx.stroke();

        // Tab grip dimensions: sleek visual pill with generous 44px+ hit area underneath
        const tabW = isActive || isHovered ? 36 : 34;
        const tabH = 24;
        const tabX = isStart
          ? Math.max(2, Math.min(width - tabW - 2, clampedX - 2))
          : Math.max(2, Math.min(width - tabW - 2, clampedX - tabW + 2));
        const tabY = isStart ? waveTop + 4 : height - tabH - 4;

        ctx.fillStyle = isActive
          ? '#FFF2B2'
          : isHovered
            ? '#F7DB7F'
            : isStart
              ? '#E5C158'
              : '#C89B2D';
        ctx.beginPath();
        ctx.roundRect(tabX, tabY, tabW, tabH, 6);
        ctx.fill();

        if (isActive || isHovered) {
          ctx.strokeStyle = isActive ? '#FFFFFF' : 'rgba(255, 255, 255, 0.7)';
          ctx.lineWidth = isActive ? 2 : 1.25;
          ctx.stroke();
        }

        // Label inside tab ("IN" / "OUT")
        ctx.shadowBlur = 0;
        ctx.fillStyle = '#09090C';
        ctx.font = '700 9.5px "JetBrains Mono", monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(isStart ? 'IN' : 'OUT', tabX + tabW / 2, tabY + tabH / 2 + 0.5);

        // Opposite-end circular anchor so both edges stay visually anchored top-to-bottom
        const dotY = isStart ? height - 8 : waveTop + 8;
        ctx.fillStyle = lineColor;
        ctx.beginPath();
        ctx.arc(clampedX, dotY, isActive ? 5 : isHovered ? 4 : 3.5, 0, Math.PI * 2);
        ctx.fill();

        // Live floating timestamp badge while dragging or hovering
        if (isActive || isHovered) {
          const tsText = `${isStart ? 'Start' : 'End'}: ${formatTime(
            isStart ? selection.start : selection.end
          )}`;
          ctx.font = '600 11px "JetBrains Mono", monospace';
          const textW = ctx.measureText(tsText).width;
          const badgeW = textW + 16;
          const badgeH = 22;
          const badgeX = Math.max(6, Math.min(width - badgeW - 6, clampedX - badgeW / 2));
          const badgeY = isStart ? waveTop + 32 : height - badgeH - 32;

          ctx.fillStyle = 'rgba(12, 12, 16, 0.94)';
          ctx.strokeStyle = isActive ? '#FFF2B2' : '#F4D97B';
          ctx.lineWidth = 1.25;
          ctx.beginPath();
          ctx.roundRect(badgeX, badgeY, badgeW, badgeH, 6);
          ctx.fill();
          ctx.stroke();

          ctx.fillStyle = '#F4D97B';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(tsText, badgeX + badgeW / 2, badgeY + badgeH / 2 + 0.5);
        }

        ctx.restore();
      };

      drawHandleTab(selStartX, 'start', activeHandle === 'start', hoverHandle === 'start');
      drawHandleTab(selEndX, 'end', activeHandle === 'end', hoverHandle === 'end');
    }

    // Playhead (drawn cleanly with subtle dark contrast halo so it never blurs into IN/OUT handles)
    if (playX >= 0 && playX <= width) {
      ctx.save();
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.7)';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(playX, 0);
      ctx.lineTo(playX, height);
      ctx.stroke();

      ctx.strokeStyle = '#FFFFFF';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(playX, 0);
      ctx.lineTo(playX, height);
      ctx.stroke();

      ctx.fillStyle = '#FFFFFF';
      ctx.beginPath();
      ctx.moveTo(playX - 6, 0);
      ctx.lineTo(playX + 6, 0);
      ctx.lineTo(playX, 9);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  }, [
    peaks,
    safeDuration,
    currentTime,
    selection,
    height,
    containerWidth,
    viewStartSec,
    viewEndSec,
    showAutomation,
    automationPoints,
    readOnly,
    activeHandle,
    hoverHandle,
  ]);

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.stopPropagation();
    if (readOnly) {
      onSeek(clientXToTime(e.clientX));
      return;
    }

    const canvas = canvasRef.current;
    if (!canvas) return;
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {
      // ignore if pointer cannot be captured
    }
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    // Dedicated Playhead Seek/Scrub zone in the top time ruler (never grabs selection handles or automation nodes)
    if (y <= RULER_H) {
      dragModeRef.current = { type: 'scrub-playhead' };
      onSeek(clientXToTime(e.clientX));
      return;
    }

    // Automation node hit detection
    if (showAutomation && onAutomationChange) {
      const waveH = height - RULER_H;
      const viewSpan = Math.max(0.001, viewEndSec - viewStartSec);
      const gainToY = (g: number) =>
        RULER_H + waveH - (Math.max(0, Math.min(1.5, g)) / 1.5) * (waveH - 12) - 6;
      const yToGain = (py: number) =>
        Math.max(0, Math.min(1.5, ((RULER_H + waveH - 6 - py) / (waveH - 12)) * 1.5));

      for (const pt of automationPoints) {
        const ptSec = pt.time * safeDuration;
        const ptX = ((ptSec - viewStartSec) / viewSpan) * rect.width;
        const ptY = gainToY(pt.gain);
        if (Math.hypot(x - ptX, y - ptY) <= 22) {
          onInteractionStart?.('Adjust Volume Automation');
          dragModeRef.current = { type: 'automation-node', id: pt.id };
          return;
        }
      }

      const tSec = clientXToTime(e.clientX);
      const normTime = Math.max(0, Math.min(1, tSec / safeDuration));
      const newPt: AutomationPoint = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        time: normTime,
        gain: Number(yToGain(y).toFixed(2)),
      };
      onInteractionStart?.('Add Automation Point');
      onAutomationChange([...automationPoints, newPt].sort((a, b) => a.time - b.time));
      dragModeRef.current = { type: 'automation-node', id: newPt.id };
      return;
    }

    // Generous handle hit detection (with smooth zero-jump grabOffsetSec)
    if (selection && onSelectionChange) {
      const hit = detectHandleHit(x, y, rect.width, e.pointerType);
      const pointerTime = clientXToTime(e.clientX);
      if (hit === 'start') {
        onInteractionStart?.('Adjust Selection Start');
        setActiveHandle('start');
        dragModeRef.current = {
          type: 'resize-start',
          grabOffsetSec: pointerTime - selection.start,
        };
        return;
      }
      if (hit === 'end') {
        onInteractionStart?.('Adjust Selection End');
        setActiveHandle('end');
        dragModeRef.current = {
          type: 'resize-end',
          grabOffsetSec: pointerTime - selection.end,
        };
        return;
      }
    }

    const anchorTime = clientXToTime(e.clientX);
    dragModeRef.current = {
      type: 'select',
      anchorTime,
      startX: e.clientX,
      moved: false,
    };
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const mode = dragModeRef.current;

    if (mode.type === 'none') {
      if (!readOnly && selection && e.pointerType !== 'touch') {
        const hit = detectHandleHit(e.clientX - rect.left, e.clientY - rect.top, rect.width, e.pointerType);
        if (hit !== hoverHandle) setHoverHandle(hit);
      }
      return;
    }

    e.stopPropagation();

    if (mode.type === 'scrub-playhead') {
      onSeek(clientXToTime(e.clientX));
      return;
    }

    if (mode.type === 'automation-node' && onAutomationChange) {
      const waveH = height - RULER_H;
      const y = e.clientY - rect.top;
      const gain = Math.max(0, Math.min(1.5, ((RULER_H + waveH - 6 - y) / (waveH - 12)) * 1.5));
      const tSec = clientXToTime(e.clientX);
      const normTime = Math.max(0, Math.min(1, tSec / safeDuration));

      onAutomationChange(
        automationPoints
          .map((p) =>
            p.id === mode.id
              ? { ...p, time: Number(normTime.toFixed(4)), gain: Number(gain.toFixed(2)) }
              : p
          )
          .sort((a, b) => a.time - b.time)
      );
      return;
    }

    const t = clientXToTime(e.clientX);
    if (mode.type === 'resize-start' && selection && onSelectionChange) {
      const adjusted = t - mode.grabOffsetSec;
      const maxStart = Math.max(0, selection.end - minSelectionSec);
      const newStart = Math.max(0, Math.min(maxStart, adjusted));
      onSelectionChange({ start: newStart, end: selection.end });
      return;
    }
    if (mode.type === 'resize-end' && selection && onSelectionChange) {
      const adjusted = t - mode.grabOffsetSec;
      const minEnd = Math.min(safeDuration, selection.start + minSelectionSec);
      const newEnd = Math.min(safeDuration, Math.max(minEnd, adjusted));
      onSelectionChange({ start: selection.start, end: newEnd });
      return;
    }

    if (mode.type === 'select' && onSelectionChange) {
      if (!mode.moved && Math.abs(e.clientX - mode.startX) > 4) {
        mode.moved = true;
        onInteractionStart?.('Select Region');
      }
      if (mode.moved) {
        const start = Math.max(0, Math.min(mode.anchorTime, t));
        const end = Math.min(safeDuration, Math.max(mode.anchorTime, t));
        if (end - start >= minSelectionSec) {
          onSelectionChange({ start, end });
        }
      }
    }
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const mode = dragModeRef.current;
    if (mode.type === 'none') return;
    e.stopPropagation();

    if (mode.type === 'select' && !mode.moved) {
      onSeek(clientXToTime(e.clientX));
    } else if (
      mode.type === 'resize-start' ||
      mode.type === 'resize-end' ||
      mode.type === 'automation-node' ||
      (mode.type === 'select' && mode.moved)
    ) {
      onInteractionEnd?.();
    }

    dragModeRef.current = { type: 'none' };
    setActiveHandle(null);
  };

  const cursorClass = readOnly
    ? 'cursor-pointer'
    : activeHandle || hoverHandle
      ? 'cursor-ew-resize'
      : 'cursor-crosshair';

  return (
    <div
      ref={containerRef}
      data-gesture-lock="true"
      className="w-full select-none touch-none rounded-xl border border-[#D4AF37]/25 bg-[#09090C]/80 overflow-hidden"
    >
      <canvas
        ref={canvasRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onPointerLeave={() => {
          if (dragModeRef.current.type === 'none') setHoverHandle(null);
        }}
        className={`block w-full touch-none ${cursorClass}`}
      />
      {zoom > 1 && (
        <div className="flex items-center gap-3 border-t border-white/10 bg-[#0D0D11] px-3 py-2">
          <span className="text-[11px] text-[#9E988E] whitespace-nowrap">Pan View</span>
          <input
            type="range"
            min={0}
            max={maxStartRatio}
            step={0.002}
            value={clampedScrollRatio}
            onChange={(e) => setScrollStartRatio(Number(e.target.value))}
            aria-label="Pan waveform horizontal view"
            className="studio-slider w-full"
          />
        </div>
      )}
    </div>
  );
}
