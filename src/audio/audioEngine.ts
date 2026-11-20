import { Mp3Encoder } from '@breezystack/lamejs';
import { BRAND_CONFIG } from '../config/brand';
import type { AutomationPoint, EqBand, JoinerClip, OverlayTrack } from '../types/audio';

let sharedAudioCtx: AudioContext | null = null;

export function getAudioContext(): AudioContext {
  if (!sharedAudioCtx || sharedAudioCtx.state === 'closed') {
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) {
      throw new Error('Web Audio API is not supported in this browser.');
    }
    sharedAudioCtx = new AudioCtx();
  }
  if (sharedAudioCtx.state === 'suspended') {
    void sharedAudioCtx.resume().catch(() => {
      // Browser autoplay policy may delay resume until user gesture
    });
  }
  return sharedAudioCtx;
}

export function createAudioBuffer(
  numberOfChannels: number,
  length: number,
  sampleRate: number
): AudioBuffer {
  const ctx = getAudioContext();
  return ctx.createBuffer(
    Math.max(1, numberOfChannels),
    Math.max(1, Math.floor(length)),
    sampleRate
  );
}

export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '00:00.00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  const hundredths = Math.floor((seconds % 1) * 100);
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(hundredths).padStart(2, '0')}`;
}

export function parseTimeInput(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.includes(':')) {
    const parts = trimmed.split(':');
    if (parts.length !== 2) return null;
    const mins = Number(parts[0]);
    const secs = Number(parts[1]);
    if (!Number.isFinite(mins) || !Number.isFinite(secs) || mins < 0 || secs < 0) return null;
    return mins * 60 + secs;
  }
  const num = Number(trimmed);
  if (!Number.isFinite(num) || num < 0) return null;
  return num;
}

export async function decodeAudioFile(file: File): Promise<AudioBuffer> {
  if (!file || file.size === 0) {
    throw new Error('The selected file is empty. Please choose a valid audio file.');
  }

  if (file.size > BRAND_CONFIG.maxUploadBytes) {
    throw new Error('File exceeds the 50 MB maximum size limit. Please choose a smaller audio file.');
  }

  const validExtensions = /\.(mp3|wav|ogg|m4a|aac|flac|webm|opus)$/i;
  if (file.type && !file.type.startsWith('audio/') && !validExtensions.test(file.name)) {
    throw new Error('Unsupported file format. Please upload an audio file (MP3, WAV, M4A, OGG, AAC, FLAC).');
  }

  const arrayBuffer = await file.arrayBuffer();
  if (!arrayBuffer || arrayBuffer.byteLength === 0) {
    throw new Error('Could not read audio data from the selected file.');
  }

  const ctx = getAudioContext();
  let decoded: AudioBuffer;
  try {
    decoded = await ctx.decodeAudioData(arrayBuffer);
  } catch {
    throw new Error('Could not decode this audio file. It may be corrupted or use an unsupported codec.');
  }

  if (
    !decoded ||
    !Number.isFinite(decoded.duration) ||
    decoded.duration <= 0 ||
    decoded.length <= 0 ||
    decoded.numberOfChannels <= 0
  ) {
    throw new Error('This audio file contains no playable audio samples.');
  }

  return decoded;
}

export interface WaveformPeaks {
  mins: Float32Array;
  maxs: Float32Array;
}

export function computeWaveformPeaks(buffer: AudioBuffer, bucketCount = 1400): WaveformPeaks {
  if (!buffer || buffer.length <= 0 || buffer.numberOfChannels <= 0) {
    return { mins: new Float32Array(1), maxs: new Float32Array(1) };
  }

  const count = Math.max(1, Math.min(bucketCount, buffer.length));
  const mins = new Float32Array(count);
  const maxs = new Float32Array(count);
  const channels = buffer.numberOfChannels;
  const channelData: Float32Array[] = [];
  for (let c = 0; c < channels; c++) {
    channelData.push(buffer.getChannelData(c));
  }

  const samplesPerBucket = buffer.length / count;
  for (let i = 0; i < count; i++) {
    const start = Math.floor(i * samplesPerBucket);
    const end = Math.min(buffer.length, Math.max(start + 1, Math.floor((i + 1) * samplesPerBucket)));
    let min = 1;
    let max = -1;
    // Stride inside very large buckets so peak calculation remains instant (<15ms)
    const step = Math.max(1, Math.floor((end - start) / 64));
    for (let s = start; s < end; s += step) {
      let mixed = 0;
      for (let c = 0; c < channels; c++) {
        const sample = channelData[c][s];
        mixed += Number.isFinite(sample) ? sample : 0;
      }
      mixed /= channels;
      if (mixed < min) min = mixed;
      if (mixed > max) max = mixed;
    }
    if (min > max) {
      min = 0;
      max = 0;
    }
    mins[i] = min;
    maxs[i] = max;
  }

  return { mins, maxs };
}

export function sliceAudioBuffer(
  buffer: AudioBuffer,
  startSec: number,
  endSec: number
): AudioBuffer {
  const sr = buffer.sampleRate;
  const safeStartSec = Number.isFinite(startSec) ? startSec : 0;
  const safeEndSec = Number.isFinite(endSec) ? endSec : buffer.duration;
  const startSample = Math.max(0, Math.min(buffer.length - 1, Math.floor(safeStartSec * sr)));
  const endSample = Math.max(startSample + 1, Math.min(buffer.length, Math.floor(safeEndSec * sr)));
  const newLength = Math.max(1, endSample - startSample);

  const out = createAudioBuffer(buffer.numberOfChannels, newLength, sr);
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const src = buffer.getChannelData(c);
    const dst = out.getChannelData(c);
    dst.set(src.subarray(startSample, Math.min(src.length, startSample + newLength)));
  }
  return out;
}

export function removeAudioRegion(
  buffer: AudioBuffer,
  startSec: number,
  endSec: number
): AudioBuffer {
  const sr = buffer.sampleRate;
  const startSample = Math.max(0, Math.min(buffer.length, Math.floor(startSec * sr)));
  const endSample = Math.max(startSample, Math.min(buffer.length, Math.floor(endSec * sr)));
  const removedLen = endSample - startSample;
  const newLength = buffer.length - removedLen;

  if (newLength <= 0) {
    throw new Error('Cannot remove the entire track. Leave at least a small section.');
  }

  const out = createAudioBuffer(buffer.numberOfChannels, newLength, sr);
  const fadeSamples = Math.min(Math.floor(sr * 0.005), startSample, buffer.length - endSample);

  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const src = buffer.getChannelData(c);
    const dst = out.getChannelData(c);
    if (startSample > 0) {
      dst.set(src.subarray(0, startSample), 0);
    }
    if (endSample < buffer.length) {
      dst.set(src.subarray(endSample), startSample);
    }
    // Micro-crossfade at splice boundary to prevent audible click
    for (let i = 0; i < fadeSamples; i++) {
      const t = i / Math.max(1, fadeSamples);
      const idx = startSample - fadeSamples + i;
      if (idx >= 0 && idx < newLength) {
        dst[idx] *= 1 - t * 0.25;
      }
      const idxAfter = startSample + i;
      if (idxAfter >= 0 && idxAfter < newLength) {
        dst[idxAfter] *= 0.75 + t * 0.25;
      }
    }
  }
  return out;
}

export function splitAudioBufferKeepSegment(
  buffer: AudioBuffer,
  splitSec: number,
  keepSide: 'first' | 'second'
): AudioBuffer {
  const clamped = Math.max(0.05, Math.min(buffer.duration - 0.05, splitSec));
  if (keepSide === 'first') {
    return sliceAudioBuffer(buffer, 0, clamped);
  }
  return sliceAudioBuffer(buffer, clamped, buffer.duration);
}

export function insertAudioBufferAt(
  base: AudioBuffer,
  insert: AudioBuffer,
  insertSec: number
): AudioBuffer {
  const sr = base.sampleRate;
  const channels = Math.max(base.numberOfChannels, insert.numberOfChannels);
  const resampledInsert = insert.sampleRate === sr ? insert : resampleBufferSync(insert, sr);
  const splitSample = Math.max(0, Math.min(base.length, Math.floor(insertSec * sr)));
  const totalLen = base.length + resampledInsert.length;

  const out = createAudioBuffer(channels, totalLen, sr);
  for (let c = 0; c < channels; c++) {
    const baseChan = base.getChannelData(Math.min(c, base.numberOfChannels - 1));
    const insChan = resampledInsert.getChannelData(Math.min(c, resampledInsert.numberOfChannels - 1));
    const dst = out.getChannelData(c);
    dst.set(baseChan.subarray(0, splitSample), 0);
    dst.set(insChan, splitSample);
    dst.set(baseChan.subarray(splitSample), splitSample + resampledInsert.length);
  }
  return out;
}

export function applyFade(
  buffer: AudioBuffer,
  type: 'in' | 'out',
  startSec: number,
  endSec: number
): AudioBuffer {
  const sr = buffer.sampleRate;
  const startSample = Math.max(0, Math.min(buffer.length - 1, Math.floor(startSec * sr)));
  const endSample = Math.max(startSample + 1, Math.min(buffer.length, Math.floor(endSec * sr)));
  const fadeLen = endSample - startSample;

  const out = cloneAudioBuffer(buffer);
  for (let c = 0; c < out.numberOfChannels; c++) {
    const data = out.getChannelData(c);
    for (let i = 0; i < fadeLen; i++) {
      const ratio = i / Math.max(1, fadeLen - 1);
      // Equal-power smooth curve
      const gain = type === 'in' ? Math.sin(ratio * (Math.PI / 2)) : Math.cos(ratio * (Math.PI / 2));
      data[startSample + i] *= gain;
    }
  }
  return out;
}

export function reverseAudioBuffer(
  buffer: AudioBuffer,
  startSec?: number,
  endSec?: number
): AudioBuffer {
  const sr = buffer.sampleRate;
  const startSample = startSec !== undefined ? Math.max(0, Math.floor(startSec * sr)) : 0;
  const endSample =
    endSec !== undefined ? Math.min(buffer.length, Math.floor(endSec * sr)) : buffer.length;

  const out = cloneAudioBuffer(buffer);
  for (let c = 0; c < out.numberOfChannels; c++) {
    const data = out.getChannelData(c);
    let left = startSample;
    let right = endSample - 1;
    while (left < right) {
      const tmp = data[left];
      data[left] = data[right];
      data[right] = tmp;
      left++;
      right--;
    }
  }
  return out;
}

export function loopAudioBuffer(
  buffer: AudioBuffer,
  repeatCount: number,
  startSec?: number,
  endSec?: number
): AudioBuffer {
  const count = Math.max(2, Math.min(12, Math.floor(repeatCount)));
  const segment =
    startSec !== undefined && endSec !== undefined
      ? sliceAudioBuffer(buffer, startSec, endSec)
      : buffer;

  if (startSec !== undefined && endSec !== undefined) {
    const sr = buffer.sampleRate;
    const startSample = Math.max(0, Math.floor(startSec * sr));
    const endSample = Math.min(buffer.length, Math.floor(endSec * sr));
    const tailLen = buffer.length - endSample;
    const totalLen = startSample + segment.length * count + tailLen;
    const out = createAudioBuffer(buffer.numberOfChannels, totalLen, sr);
    for (let c = 0; c < buffer.numberOfChannels; c++) {
      const src = buffer.getChannelData(c);
      const seg = segment.getChannelData(c);
      const dst = out.getChannelData(c);
      dst.set(src.subarray(0, startSample), 0);
      for (let r = 0; r < count; r++) {
        dst.set(seg, startSample + r * segment.length);
      }
      if (tailLen > 0) {
        dst.set(src.subarray(endSample), startSample + segment.length * count);
      }
    }
    return out;
  }

  const out = createAudioBuffer(buffer.numberOfChannels, segment.length * count, buffer.sampleRate);
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const seg = segment.getChannelData(c);
    const dst = out.getChannelData(c);
    for (let r = 0; r < count; r++) {
      dst.set(seg, r * segment.length);
    }
  }
  return out;
}

export function joinAudioClips(clips: JoinerClip[]): AudioBuffer {
  if (clips.length === 0) {
    throw new Error('Add at least one audio clip to join.');
  }
  const sr = clips[0].buffer.sampleRate;
  const channels = Math.max(...clips.map((c) => c.buffer.numberOfChannels));

  const trimmedClips = clips.map((clip) => {
    const sliced = sliceAudioBuffer(clip.buffer, clip.trimStart, clip.trimEnd);
    const resampled = sliced.sampleRate === sr ? sliced : resampleBufferSync(sliced, sr);
    return {
      buffer: resampled,
      volume: clip.volume,
      crossfadeSec: clip.crossfadeSec,
    };
  });

  let totalSamples = trimmedClips[0].buffer.length;
  const startOffsets: number[] = [0];

  for (let i = 1; i < trimmedClips.length; i++) {
    const prev = trimmedClips[i - 1];
    const curr = trimmedClips[i];
    const maxFade = Math.min(prev.buffer.length, curr.buffer.length) / sr * 0.45;
    const fadeSec = Math.min(prev.crossfadeSec, maxFade);
    const overlapSamples = Math.floor(fadeSec * sr);
    const offset = Math.max(0, totalSamples - overlapSamples);
    startOffsets.push(offset);
    totalSamples = Math.max(totalSamples, offset + curr.buffer.length);
  }

  const out = createAudioBuffer(channels, totalSamples, sr);

  for (let i = 0; i < trimmedClips.length; i++) {
    const curr = trimmedClips[i];
    const offset = startOffsets[i];
    const fadeInSamples =
      i > 0 ? Math.max(0, startOffsets[i - 1] + trimmedClips[i - 1].buffer.length - offset) : 0;
    const fadeOutSamples =
      i < trimmedClips.length - 1
        ? Math.max(0, offset + curr.buffer.length - startOffsets[i + 1])
        : 0;

    for (let c = 0; c < channels; c++) {
      const src = curr.buffer.getChannelData(Math.min(c, curr.buffer.numberOfChannels - 1));
      const dst = out.getChannelData(c);
      for (let s = 0; s < curr.buffer.length; s++) {
        let gain = curr.volume;
        if (fadeInSamples > 0 && s < fadeInSamples) {
          gain *= Math.sin((s / fadeInSamples) * (Math.PI / 2));
        }
        if (fadeOutSamples > 0 && s >= curr.buffer.length - fadeOutSamples) {
          const rem = curr.buffer.length - 1 - s;
          gain *= Math.sin((rem / fadeOutSamples) * (Math.PI / 2));
        }
        dst[offset + s] += src[s] * gain;
      }
    }
  }

  softLimitBufferInPlace(out);
  return out;
}

export function mixOverlayTracks(
  mainBuffer: AudioBuffer,
  mainVolume: number,
  overlays: OverlayTrack[]
): AudioBuffer {
  const sr = mainBuffer.sampleRate;
  const channels = Math.max(
    1,
    mainBuffer.numberOfChannels,
    ...overlays.map((o) => o.buffer.numberOfChannels)
  );
  const safeMainVol = Number.isFinite(mainVolume) ? Math.max(0, mainVolume) : 1;

  const preparedOverlays = overlays.map((track) => {
    const safeStart = Math.max(0, Math.min(track.buffer.duration, Number.isFinite(track.trimStart) ? track.trimStart : 0));
    const safeEnd = Math.max(
      Math.min(track.buffer.duration, safeStart + 0.02),
      Math.min(track.buffer.duration, Number.isFinite(track.trimEnd) ? track.trimEnd : track.buffer.duration)
    );
    const trimmed = sliceAudioBuffer(track.buffer, safeStart, safeEnd);
    const resampled = trimmed.sampleRate === sr ? trimmed : resampleBufferSync(trimmed, sr);
    const safeOffset = Number.isFinite(track.startOffsetSec) ? Math.max(0, track.startOffsetSec) : 0;
    const offsetSample = Math.max(0, Math.floor(safeOffset * sr));
    const safeVol = Number.isFinite(track.volume) ? Math.max(0, track.volume) : 1;
    return {
      buffer: resampled,
      offsetSample,
      volume: safeVol,
    };
  });

  let totalSamples = Math.max(1, mainBuffer.length);
  for (const ov of preparedOverlays) {
    totalSamples = Math.max(totalSamples, ov.offsetSample + ov.buffer.length);
  }

  const out = createAudioBuffer(channels, totalSamples, sr);

  for (let c = 0; c < channels; c++) {
    const dst = out.getChannelData(c);
    const mainSrc = mainBuffer.getChannelData(Math.min(c, mainBuffer.numberOfChannels - 1));
    for (let s = 0; s < mainBuffer.length; s++) {
      dst[s] += mainSrc[s] * safeMainVol;
    }

    for (const ov of preparedOverlays) {
      const ovSrc = ov.buffer.getChannelData(Math.min(c, ov.buffer.numberOfChannels - 1));
      for (let s = 0; s < ov.buffer.length && ov.offsetSample + s < totalSamples; s++) {
        dst[ov.offsetSample + s] += ovSrc[s] * ov.volume;
      }
    }
  }

  softLimitBufferInPlace(out);
  return out;
}

export function applyVolumeAutomation(
  buffer: AudioBuffer,
  points: AutomationPoint[]
): AudioBuffer {
  if (points.length === 0) return cloneAudioBuffer(buffer);
  const sorted = [...points].sort((a, b) => a.time - b.time);
  const out = cloneAudioBuffer(buffer);
  const len = out.length;

  for (let c = 0; c < out.numberOfChannels; c++) {
    const data = out.getChannelData(c);
    let ptr = 0;
    for (let s = 0; s < len; s++) {
      const t = s / Math.max(1, len - 1);
      while (ptr < sorted.length - 1 && sorted[ptr + 1].time < t) {
        ptr++;
      }
      let gain = 1;
      if (t <= sorted[0].time) {
        gain = sorted[0].gain;
      } else if (t >= sorted[sorted.length - 1].time) {
        gain = sorted[sorted.length - 1].gain;
      } else {
        const p0 = sorted[ptr];
        const p1 = sorted[ptr + 1];
        const span = Math.max(1e-6, p1.time - p0.time);
        const alpha = (t - p0.time) / span;
        gain = p0.gain + (p1.gain - p0.gain) * alpha;
      }
      data[s] *= gain;
    }
  }
  softLimitBufferInPlace(out);
  return out;
}

export async function applyFiveBandEq(
  buffer: AudioBuffer,
  bands: EqBand[]
): Promise<AudioBuffer> {
  const offline = new OfflineAudioContext(
    buffer.numberOfChannels,
    buffer.length,
    buffer.sampleRate
  );
  const src = offline.createBufferSource();
  src.buffer = buffer;

  let currentNode: AudioNode = src;
  for (const band of bands) {
    const filter = offline.createBiquadFilter();
    filter.type = band.type;
    filter.frequency.value = band.frequency;
    filter.Q.value = 1.1;
    filter.gain.value = band.gain;
    currentNode.connect(filter);
    currentNode = filter;
  }
  currentNode.connect(offline.destination);
  src.start(0);

  const rendered = await offline.startRendering();
  softLimitBufferInPlace(rendered);
  return rendered;
}

export function normalizeAudioBuffer(
  buffer: AudioBuffer,
  targetDb = -0.5
): AudioBuffer {
  let maxAbs = 0;
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const data = buffer.getChannelData(c);
    for (let i = 0; i < data.length; i++) {
      const v = Math.abs(data[i]);
      if (v > maxAbs) maxAbs = v;
    }
  }
  if (maxAbs < 1e-6) return cloneAudioBuffer(buffer);
  const targetLinear = Math.pow(10, targetDb / 20);
  const scale = targetLinear / maxAbs;

  const out = cloneAudioBuffer(buffer);
  for (let c = 0; c < out.numberOfChannels; c++) {
    const data = out.getChannelData(c);
    for (let i = 0; i < data.length; i++) {
      data[i] *= scale;
    }
  }
  return out;
}

export async function applyAudioCompression(
  buffer: AudioBuffer,
  threshold = -18,
  ratio = 4,
  makeupGainDb = 2
): Promise<AudioBuffer> {
  const offline = new OfflineAudioContext(
    buffer.numberOfChannels,
    buffer.length,
    buffer.sampleRate
  );
  const src = offline.createBufferSource();
  src.buffer = buffer;

  const comp = offline.createDynamicsCompressor();
  comp.threshold.value = threshold;
  comp.knee.value = 12;
  comp.ratio.value = ratio;
  comp.attack.value = 0.005;
  comp.release.value = 0.18;

  const gain = offline.createGain();
  gain.gain.value = Math.pow(10, makeupGainDb / 20);

  src.connect(comp);
  comp.connect(gain);
  gain.connect(offline.destination);
  src.start(0);

  const rendered = await offline.startRendering();
  softLimitBufferInPlace(rendered);
  return rendered;
}

export function applyCrossfadeAtSelection(
  buffer: AudioBuffer,
  startSec: number,
  endSec: number
): AudioBuffer {
  const sr = buffer.sampleRate;
  const startSample = Math.max(0, Math.min(buffer.length - 1, Math.floor(startSec * sr)));
  const endSample = Math.max(startSample + 2, Math.min(buffer.length, Math.floor(endSec * sr)));
  const span = endSample - startSample;
  const mid = startSample + Math.floor(span / 2);

  const out = cloneAudioBuffer(buffer);
  for (let c = 0; c < out.numberOfChannels; c++) {
    const data = out.getChannelData(c);
    for (let s = startSample; s < mid; s++) {
      const r = (s - startSample) / Math.max(1, mid - startSample);
      data[s] *= Math.cos(r * (Math.PI / 2));
    }
    for (let s = mid; s < endSample; s++) {
      const r = (s - mid) / Math.max(1, endSample - mid);
      data[s] *= Math.sin(r * (Math.PI / 2));
    }
  }
  return out;
}

export function removeSilence(
  buffer: AudioBuffer,
  thresholdDb = -42,
  minSilenceSec = 0.35
): AudioBuffer {
  const sr = buffer.sampleRate;
  const threshold = Math.pow(10, thresholdDb / 20);
  const windowSize = Math.max(64, Math.floor(sr * 0.02));
  const minSilentWindows = Math.max(1, Math.floor((minSilenceSec * sr) / windowSize));
  const totalWindows = Math.ceil(buffer.length / windowSize);

  const silentFlags = new Uint8Array(totalWindows);
  for (let w = 0; w < totalWindows; w++) {
    const start = w * windowSize;
    const end = Math.min(buffer.length, start + windowSize);
    let peak = 0;
    for (let c = 0; c < buffer.numberOfChannels; c++) {
      const data = buffer.getChannelData(c);
      for (let s = start; s < end; s++) {
        const a = Math.abs(data[s]);
        if (a > peak) peak = a;
      }
    }
    if (peak < threshold) silentFlags[w] = 1;
  }

  // Mark runs of silent windows >= minSilentWindows for removal
  const removeWindow = new Uint8Array(totalWindows);
  let runStart = -1;
  for (let w = 0; w <= totalWindows; w++) {
    const isSilent = w < totalWindows && silentFlags[w] === 1;
    if (isSilent && runStart === -1) {
      runStart = w;
    } else if (!isSilent && runStart !== -1) {
      const runLen = w - runStart;
      if (runLen >= minSilentWindows) {
        // Keep 1 window padding on edges for natural breathing
        for (let k = runStart + 1; k < w - 1; k++) {
          removeWindow[k] = 1;
        }
      }
      runStart = -1;
    }
  }

  let keptSamples = 0;
  for (let w = 0; w < totalWindows; w++) {
    if (removeWindow[w] === 0) {
      const start = w * windowSize;
      const end = Math.min(buffer.length, start + windowSize);
      keptSamples += end - start;
    }
  }

  if (keptSamples < sr * 0.1) {
    throw new Error('Almost the entire file fell below the silence threshold. Try a lower threshold (e.g. -50 dB).');
  }

  const out = createAudioBuffer(buffer.numberOfChannels, keptSamples, sr);
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const src = buffer.getChannelData(c);
    const dst = out.getChannelData(c);
    let writeIdx = 0;
    for (let w = 0; w < totalWindows; w++) {
      if (removeWindow[w] === 0) {
        const start = w * windowSize;
        const end = Math.min(buffer.length, start + windowSize);
        dst.set(src.subarray(start, end), writeIdx);
        writeIdx += end - start;
      }
    }
  }
  return out;
}

export function applySpeedAndPitch(
  buffer: AudioBuffer,
  speed: number,
  pitchSemitones: number
): AudioBuffer {
  const clampedSpeed = Math.max(0.5, Math.min(2.0, speed));
  const pitchFactor = Math.pow(2, pitchSemitones / 12);

  // Step 1: Time-stretch with OLA to isolate tempo vs pitch
  const stretchRatio = pitchFactor / clampedSpeed;
  let working = buffer;
  if (Math.abs(stretchRatio - 1) > 0.01) {
    working = timeStretchOLA(buffer, stretchRatio);
  }

  // Step 2: Resample by pitchFactor so pitch shifts cleanly
  if (Math.abs(pitchFactor - 1) > 0.005) {
    return resampleSpeedSync(working, pitchFactor);
  }
  return working;
}

function timeStretchOLA(buffer: AudioBuffer, stretchRatio: number): AudioBuffer {
  const sr = buffer.sampleRate;
  const winSize = 2048;
  const hopOut = 512;
  const hopIn = Math.max(64, Math.round(hopOut / stretchRatio));
  const outLength = Math.max(winSize, Math.round(buffer.length * stretchRatio));
  const out = createAudioBuffer(buffer.numberOfChannels, outLength, sr);

  const hann = new Float32Array(winSize);
  for (let i = 0; i < winSize; i++) {
    hann[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (winSize - 1)));
  }

  const norm = new Float32Array(outLength);
  for (let outPos = 0, inPos = 0; outPos + winSize < outLength && inPos + winSize < buffer.length; outPos += hopOut, inPos += hopIn) {
    for (let i = 0; i < winSize; i++) {
      norm[outPos + i] += hann[i] * hann[i];
    }
  }

  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const src = buffer.getChannelData(c);
    const dst = out.getChannelData(c);
    for (let outPos = 0, inPos = 0; outPos + winSize < outLength && inPos + winSize < buffer.length; outPos += hopOut, inPos += hopIn) {
      for (let i = 0; i < winSize; i++) {
        dst[outPos + i] += src[inPos + i] * hann[i] * hann[i];
      }
    }
    for (let i = 0; i < outLength; i++) {
      if (norm[i] > 1e-4) {
        dst[i] /= norm[i];
      }
    }
  }
  return out;
}

function resampleSpeedSync(buffer: AudioBuffer, factor: number): AudioBuffer {
  const outLength = Math.max(1, Math.floor(buffer.length / factor));
  const out = createAudioBuffer(buffer.numberOfChannels, outLength, buffer.sampleRate);
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const src = buffer.getChannelData(c);
    const dst = out.getChannelData(c);
    for (let i = 0; i < outLength; i++) {
      const pos = i * factor;
      const idx = Math.floor(pos);
      const frac = pos - idx;
      const s0 = src[Math.min(buffer.length - 1, idx)];
      const s1 = src[Math.min(buffer.length - 1, idx + 1)];
      dst[i] = s0 + (s1 - s0) * frac;
    }
  }
  return out;
}

function resampleBufferSync(buffer: AudioBuffer, targetSampleRate: number): AudioBuffer {
  if (buffer.sampleRate === targetSampleRate) return buffer;
  const ratio = buffer.sampleRate / targetSampleRate;
  const outLength = Math.max(1, Math.floor(buffer.length / ratio));
  const out = createAudioBuffer(buffer.numberOfChannels, outLength, targetSampleRate);
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const src = buffer.getChannelData(c);
    const dst = out.getChannelData(c);
    for (let i = 0; i < outLength; i++) {
      const pos = i * ratio;
      const idx = Math.floor(pos);
      const frac = pos - idx;
      const s0 = src[Math.min(buffer.length - 1, idx)];
      const s1 = src[Math.min(buffer.length - 1, idx + 1)];
      dst[i] = s0 + (s1 - s0) * frac;
    }
  }
  return out;
}

export function cloneAudioBuffer(buffer: AudioBuffer): AudioBuffer {
  const out = createAudioBuffer(buffer.numberOfChannels, buffer.length, buffer.sampleRate);
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    out.getChannelData(c).set(buffer.getChannelData(c));
  }
  return out;
}

function softLimitBufferInPlace(buffer: AudioBuffer): void {
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const data = buffer.getChannelData(c);
    for (let i = 0; i < data.length; i++) {
      const x = data[i];
      if (x > 0.99 || x < -0.99) {
        data[i] = Math.tanh(x);
      }
    }
  }
}

export function exportToWav(buffer: AudioBuffer): Blob {
  const numChannels = Math.min(2, buffer.numberOfChannels);
  const sampleRate = buffer.sampleRate;
  const bytesPerSample = 2;
  const blockAlign = numChannels * bytesPerSample;
  const dataSize = buffer.length * blockAlign;
  const arrayBuffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(arrayBuffer);

  const writeString = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);
  writeString(36, 'data');
  view.setUint32(40, dataSize, true);

  const ch0 = buffer.getChannelData(0);
  const ch1 = numChannels > 1 ? buffer.getChannelData(1) : ch0;

  let offset = 44;
  for (let i = 0; i < buffer.length; i++) {
    const s0 = Math.max(-1, Math.min(1, ch0[i]));
    view.setInt16(offset, s0 < 0 ? s0 * 0x8000 : s0 * 0x7fff, true);
    offset += 2;
    if (numChannels > 1) {
      const s1 = Math.max(-1, Math.min(1, ch1[i]));
      view.setInt16(offset, s1 < 0 ? s1 * 0x8000 : s1 * 0x7fff, true);
      offset += 2;
    }
  }

  return new Blob([arrayBuffer], { type: 'audio/wav' });
}

export async function exportToMp3(
  buffer: AudioBuffer,
  kbps = 192,
  onProgress?: (percent: number) => void
): Promise<Blob> {
  const numChannels = Math.min(2, buffer.numberOfChannels);
  const sampleRate = buffer.sampleRate;
  const encoder = new Mp3Encoder(numChannels, sampleRate, kbps);
  const mp3Chunks: BlobPart[] = [];

  const leftFloat = buffer.getChannelData(0);
  const rightFloat = numChannels > 1 ? buffer.getChannelData(1) : leftFloat;
  const blockSize = 1152;
  const totalSamples = buffer.length;

  const leftInt16 = new Int16Array(blockSize);
  const rightInt16 = new Int16Array(blockSize);

  let blocksProcessed = 0;
  for (let i = 0; i < totalSamples; i += blockSize) {
    const len = Math.min(blockSize, totalSamples - i);
    for (let j = 0; j < len; j++) {
      const l = Math.max(-1, Math.min(1, leftFloat[i + j]));
      leftInt16[j] = l < 0 ? l * 0x8000 : l * 0x7fff;
      if (numChannels > 1) {
        const r = Math.max(-1, Math.min(1, rightFloat[i + j]));
        rightInt16[j] = r < 0 ? r * 0x8000 : r * 0x7fff;
      }
    }

    const leftSlice = len === blockSize ? leftInt16 : leftInt16.subarray(0, len);
    const rightSlice =
      numChannels > 1 ? (len === blockSize ? rightInt16 : rightInt16.subarray(0, len)) : undefined;

    const encoded = encoder.encodeBuffer(leftSlice, rightSlice);
    if (encoded.length > 0) {
      mp3Chunks.push(new Uint8Array(encoded));
    }

    blocksProcessed++;
    if (blocksProcessed % 40 === 0) {
      onProgress?.(Math.min(98, Math.round((i / totalSamples) * 100)));
      // Yield back to main thread so animations & UI remain completely responsive
      await new Promise((r) => setTimeout(r, 0));
    }
  }

  const flushed = encoder.flush();
  if (flushed.length > 0) {
    mp3Chunks.push(new Uint8Array(flushed));
  }
  onProgress?.(100);

  return new Blob(mp3Chunks, { type: 'audio/mp3' });
}

export function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Release Blob URL memory promptly
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
