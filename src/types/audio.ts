export type ToolSection = 'home' | 'cutter' | 'joiner' | 'overlay' | 'more';

export type MoreTab = 'automation' | 'eq' | 'region' | 'mastering';

export type ExportFormat = 'wav' | 'mp3';

export interface TimeSelection {
  start: number;
  end: number;
}

export interface JoinerClip {
  id: string;
  name: string;
  buffer: AudioBuffer;
  trimStart: number;
  trimEnd: number;
  volume: number; // 0 to 1.5
  crossfadeSec: number; // 0 to 5
}

export interface OverlayTrack {
  id: string;
  name: string;
  buffer: AudioBuffer;
  startOffsetSec: number;
  trimStart: number;
  trimEnd: number;
  volume: number; // 0 to 1.5
}

export interface AutomationPoint {
  id: string;
  time: number; // normalized 0..1 of track duration
  gain: number; // 0..1.5
}

export interface EqBand {
  frequency: number;
  label: string;
  type: BiquadFilterType;
  gain: number; // -12 to +12 dB
}

export interface CutterParams {
  fadeInDur: number;
  fadeOutDur: number;
}

export interface MoreParams {
  automationPoints: AutomationPoint[];
  eqBands: EqBand[];
  loopCount: number;
  speed: number;
  pitchSemitones: number;
  fadeSec: number;
  compThreshold: number;
  compRatio: number;
  silenceDb: number;
}

export interface OverlayState {
  mainVolume: number;
  overlays: OverlayTrack[];
}

export interface ProjectSnapshot {
  buffer: AudioBuffer;
  selection: TimeSelection | null;
  cutterParams: CutterParams;
  moreParams: MoreParams;
  joinerClips: JoinerClip[];
  overlayState: OverlayState;
}

export interface HistoryEntry {
  id: string;
  label: string;
  snapshot: ProjectSnapshot;
}
