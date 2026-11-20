import { API_ENDPOINT, DEMO_MODE, LINK_IMPORT_TIMEOUT_MS } from '../config/linkImport';
import { BRAND_CONFIG } from '../config/brand';
import { createAudioBuffer, decodeAudioFile, exportToWav } from './audioEngine';

export type DetectedPlatform =
  | 'youtube'
  | 'youtube_shorts'
  | 'instagram_reel'
  | 'instagram_video'
  | 'direct_media'
  | 'tiktok'
  | 'soundcloud'
  | 'vimeo'
  | 'facebook';

export interface PlatformDetectionResult {
  valid: boolean;
  normalizedUrl: string;
  platform?: DetectedPlatform;
  platformLabel?: string;
  error?: string;
}

const DIRECT_MEDIA_EXT_RE = /\.(mp3|wav|m4a|aac|ogg|flac|webm|opus|mp4|mov)(\?.*)?$/i;

export function detectLinkPlatform(rawInput: string): PlatformDetectionResult {
  const trimmed = rawInput.trim();
  if (!trimmed) {
    return {
      valid: false,
      normalizedUrl: '',
      error: 'Please paste a video or audio link first.',
    };
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return {
      valid: false,
      normalizedUrl: trimmed,
      error: 'Invalid URL. Please enter a complete link starting with https:// or http://.',
    };
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return {
      valid: false,
      normalizedUrl: trimmed,
      error: 'Unsupported URL protocol. Please use a valid http:// or https:// media link.',
    };
  }

  const host = parsed.hostname.toLowerCase().replace(/^www\./, '').replace(/^m\./, '');
  const path = parsed.pathname.toLowerCase();

  if (host === 'youtube.com' || host === 'music.youtube.com' || host === 'youtu.be') {
    const isShort = path.startsWith('/shorts/');
    return {
      valid: true,
      normalizedUrl: parsed.toString(),
      platform: isShort ? 'youtube_shorts' : 'youtube',
      platformLabel: isShort ? 'YouTube Shorts' : 'YouTube',
    };
  }

  if (host === 'instagram.com' || host === 'instagr.am') {
    const isReel = path.includes('/reel/') || path.includes('/reels/');
    return {
      valid: true,
      normalizedUrl: parsed.toString(),
      platform: isReel ? 'instagram_reel' : 'instagram_video',
      platformLabel: isReel ? 'Instagram Reel' : 'Instagram Video',
    };
  }

  if (DIRECT_MEDIA_EXT_RE.test(path)) {
    return {
      valid: true,
      normalizedUrl: parsed.toString(),
      platform: 'direct_media',
      platformLabel: 'Direct Media Link',
    };
  }

  if (host === 'tiktok.com' || host.endsWith('.tiktok.com')) {
    return {
      valid: true,
      normalizedUrl: parsed.toString(),
      platform: 'tiktok',
      platformLabel: 'TikTok Video',
    };
  }

  if (host === 'soundcloud.com') {
    return {
      valid: true,
      normalizedUrl: parsed.toString(),
      platform: 'soundcloud',
      platformLabel: 'SoundCloud',
    };
  }

  if (host === 'vimeo.com' || host === 'player.vimeo.com') {
    return {
      valid: true,
      normalizedUrl: parsed.toString(),
      platform: 'vimeo',
      platformLabel: 'Vimeo',
    };
  }

  if (host === 'facebook.com' || host === 'fb.watch') {
    return {
      valid: true,
      normalizedUrl: parsed.toString(),
      platform: 'facebook',
      platformLabel: 'Facebook Video',
    };
  }

  return {
    valid: false,
    normalizedUrl: parsed.toString(),
    error:
      'Unsupported platform or link. Paste a YouTube, YouTube Shorts, Instagram Reel/Video, TikTok, SoundCloud, Vimeo, or direct audio/media URL.',
  };
}

/**
 * Generates a realistic 10-second musical demo track (warm chords + soft stage beat)
 * encoded as a valid WAV File so Demo Mode passes through the exact same decode pipeline.
 */
function createDemoSampleFile(platformLabel: string): File {
  const sampleRate = 44100;
  const durationSec = 10;
  const totalSamples = sampleRate * durationSec;
  const buffer = createAudioBuffer(2, totalSamples, sampleRate);

  const left = buffer.getChannelData(0);
  const right = buffer.getChannelData(1);

  // Warm 4-chord progression (Am7 -> Fmaj7 -> Cmaj7 -> G6)
  const chords = [
    [220.0, 261.63, 329.63, 392.0],
    [174.61, 220.0, 261.63, 329.63],
    [130.81, 196.0, 246.94, 329.63],
    [196.0, 246.94, 293.66, 329.63],
  ];

  for (let i = 0; i < totalSamples; i++) {
    const t = i / sampleRate;
    const chordIdx = Math.min(3, Math.floor((t / durationSec) * 4));
    const chord = chords[chordIdx];

    // Smooth chord pad
    let pad = 0;
    for (let k = 0; k < chord.length; k++) {
      pad += Math.sin(2 * Math.PI * chord[k] * t) * (0.14 / (k * 0.35 + 1));
    }

    // Soft rhythmic pulse every 0.5s (120 BPM)
    const beatPhase = t % 0.5;
    const kickEnv = Math.exp(-beatPhase * 18);
    const kickFreq = 52 + 90 * Math.exp(-beatPhase * 32);
    const kick = Math.sin(2 * Math.PI * kickFreq * beatPhase) * kickEnv * 0.35;

    // Gentle fade in & fade out on edges
    const edgeIn = Math.min(1, t / 0.3);
    const edgeOut = Math.min(1, (durationSec - t) / 0.4);
    const env = edgeIn * edgeOut;

    const stereoShimmer = 0.04 * Math.sin(2 * Math.PI * 0.5 * t);
    left[i] = Math.max(-0.95, Math.min(0.95, (pad * (1 + stereoShimmer) + kick) * env));
    right[i] = Math.max(-0.95, Math.min(0.95, (pad * (1 - stereoShimmer) + kick) * env));
  }

  const wavBlob = exportToWav(buffer);
  const slug = platformLabel.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  return new File([wavBlob], `demo-${slug}-sample.wav`, { type: 'audio/wav' });
}

export interface LinkImportResult {
  buffer: AudioBuffer;
  fileName: string;
  platformLabel: string;
  isDemo: boolean;
}

export async function importAudioFromLink(
  rawUrl: string,
  onStatus?: (status: string) => void,
  signal?: AbortSignal
): Promise<LinkImportResult> {
  const detection = detectLinkPlatform(rawUrl);
  if (!detection.valid || !detection.platform || !detection.platformLabel) {
    throw new Error(detection.error || 'Please enter a valid supported link.');
  }

  if (DEMO_MODE) {
    onStatus?.(`Detected ${detection.platformLabel} link...`);
    await waitWithAbort(550, signal);

    onStatus?.('Demo Mode: Preparing bundled sample audio...');
    await waitWithAbort(650, signal);

    onStatus?.('Loading waveform...');
    const demoFile = createDemoSampleFile(detection.platformLabel);
    const decoded = await decodeAudioFile(demoFile);
    return {
      buffer: decoded,
      fileName: demoFile.name,
      platformLabel: detection.platformLabel,
      isDemo: true,
    };
  }

  // Real Backend Integration
  if (!API_ENDPOINT || API_ENDPOINT === 'YOUR_BACKEND_URL_HERE') {
    throw new Error(
      'Backend extraction endpoint is not configured. Set API_ENDPOINT in src/config/linkImport.ts or enable DEMO_MODE.'
    );
  }

  onStatus?.(`Detected ${detection.platformLabel}. Requesting audio from backend...`);

  const timeoutController = new AbortController();
  const timeoutId = window.setTimeout(() => timeoutController.abort(), LINK_IMPORT_TIMEOUT_MS);

  const forwardAbort = () => timeoutController.abort();
  signal?.addEventListener('abort', forwardAbort);

  try {
    let response: Response;
    try {
      response = await fetch(API_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          url: detection.normalizedUrl,
          platform: detection.platform,
          format: 'mp3',
        }),
        signal: timeoutController.signal,
      });
    } catch (fetchErr) {
      if (fetchErr instanceof DOMException && fetchErr.name === 'AbortError') {
        throw new Error('Request timed out or was cancelled. Please check your connection and try again.');
      }
      throw new Error(
        'Unable to reach the audio extraction backend. Please verify your network connection and backend URL.'
      );
    }

    if (!response.ok) {
      let serverMsg = '';
      try {
        const contentType = response.headers.get('content-type') || '';
        if (contentType.includes('application/json')) {
          const data = (await response.json()) as { error?: string; message?: string };
          serverMsg = data.error || data.message || '';
        }
      } catch {
        // ignore JSON parse failure on error responses
      }

      if (response.status === 404) {
        throw new Error(serverMsg || 'Video or audio source was not found or is unavailable.');
      }
      if (response.status === 401 || response.status === 403) {
        throw new Error(serverMsg || 'This video is private or restricted and cannot be imported.');
      }
      if (response.status === 422) {
        throw new Error(serverMsg || 'No playable audio stream was found or conversion failed.');
      }
      throw new Error(serverMsg || `Backend extraction failed (status ${response.status}).`);
    }

    const contentLengthHeader = response.headers.get('content-length');
    if (contentLengthHeader) {
      const declaredBytes = Number(contentLengthHeader);
      if (Number.isFinite(declaredBytes) && declaredBytes > BRAND_CONFIG.maxUploadBytes) {
        throw new Error('Returned audio exceeds the 50 MB maximum file size limit.');
      }
    }

    const contentType = (response.headers.get('content-type') || '').toLowerCase();
    if (contentType.includes('application/json') || contentType.includes('text/html')) {
      let msg = 'Backend returned an unexpected non-audio response.';
      if (contentType.includes('application/json')) {
        try {
          const payload = (await response.json()) as { error?: string; message?: string };
          if (payload.error || payload.message) {
            msg = payload.error || payload.message || msg;
          }
        } catch {
          // ignore
        }
      }
      throw new Error(msg);
    }

    onStatus?.('Downloading extracted audio...');
    const blob = await response.blob();
    if (!blob || blob.size === 0) {
      throw new Error('Backend returned an empty audio file.');
    }
    if (blob.size > BRAND_CONFIG.maxUploadBytes) {
      throw new Error('Extracted audio exceeds the 50 MB maximum file size limit.');
    }

    onStatus?.('Loading waveform...');
    const ext = contentType.includes('wav')
      ? 'wav'
      : contentType.includes('ogg')
        ? 'ogg'
        : contentType.includes('mp4') || contentType.includes('aac')
          ? 'm4a'
          : 'mp3';
    const file = new File([blob], `imported-${detection.platform}.${ext}`, {
      type: blob.type || `audio/${ext}`,
    });
    const decoded = await decodeAudioFile(file);

    return {
      buffer: decoded,
      fileName: file.name,
      platformLabel: detection.platformLabel,
      isDemo: false,
    };
  } finally {
    window.clearTimeout(timeoutId);
    signal?.removeEventListener('abort', forwardAbort);
  }
}

function waitWithAbort(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    const id = window.setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      window.clearTimeout(id);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    signal?.addEventListener('abort', onAbort);
  });
}
