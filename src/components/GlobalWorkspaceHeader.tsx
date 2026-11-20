import { ArrowLeft, ArrowRight, Pause, Play, Square, Trash2, Upload } from 'lucide-react';
import { formatTime } from '../audio/audioEngine';

interface GlobalWorkspaceHeaderProps {
  fileName: string;
  duration: number;
  currentTime: number;
  sampleRate: number;
  channels: number;
  isPlaying: boolean;
  canUndo: boolean;
  canRedo: boolean;
  undoLabel?: string;
  redoLabel?: string;
  undoCount: number;
  onUndo: () => void;
  onRedo: () => void;
  onTogglePlay: () => void;
  onStop: () => void;
  onReplaceFile: () => void;
  onClearProject: () => void;
}

export function GlobalWorkspaceHeader({
  fileName,
  duration,
  currentTime,
  sampleRate,
  channels,
  isPlaying,
  canUndo,
  canRedo,
  undoLabel,
  redoLabel,
  undoCount,
  onUndo,
  onRedo,
  onTogglePlay,
  onStop,
  onReplaceFile,
  onClearProject,
}: GlobalWorkspaceHeaderProps) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-[#D4AF37]/25 bg-[#111115]/80 backdrop-blur-xl px-4 py-3 shadow-[0_12px_36px_rgba(0,0,0,0.45)]">
      {/* Upper-Left: Undo / Redo Arrows + File Metadata */}
      <div className="flex items-center gap-3 min-w-0">
        <div className="flex items-center gap-1.5 rounded-xl border border-[#D4AF37]/25 bg-[#09090C]/80 p-1">
          <button
            type="button"
            onClick={onUndo}
            disabled={!canUndo}
            title={canUndo ? `Undo: ${undoLabel ?? 'Last edit'}` : 'Nothing to undo'}
            aria-label="Undo"
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-[#F5F3EE] transition-colors hover:bg-[#D4AF37]/20 hover:text-[#F4D97B] disabled:opacity-30 disabled:pointer-events-none cursor-pointer"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={onRedo}
            disabled={!canRedo}
            title={canRedo ? `Redo: ${redoLabel ?? 'Next edit'}` : 'Nothing to redo'}
            aria-label="Redo"
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-[#F5F3EE] transition-colors hover:bg-[#D4AF37]/20 hover:text-[#F4D97B] disabled:opacity-30 disabled:pointer-events-none cursor-pointer"
          >
            <ArrowRight className="h-4 w-4" />
          </button>
        </div>

        <div className="min-w-0">
          <p className="truncate max-w-[200px] sm:max-w-[300px] text-sm font-semibold text-[#F5F3EE]">
            {fileName}
          </p>
          <p className="text-xs text-[#9E988E] tabular-nums flex items-center gap-2 whitespace-nowrap">
            <span>{formatTime(duration)}</span>
            <span aria-hidden="true">·</span>
            <span>{Math.round(sampleRate / 1000)} kHz</span>
            <span aria-hidden="true">·</span>
            <span>{channels === 1 ? 'Mono' : 'Stereo'}</span>
            {undoCount > 0 && (
              <>
                <span aria-hidden="true">·</span>
                <span>{undoCount} {undoCount === 1 ? 'step' : 'steps'}</span>
              </>
            )}
          </p>
        </div>
      </div>

      {/* Center: Global Transport & Timecode */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onTogglePlay}
          aria-label={isPlaying ? 'Pause' : 'Play'}
          className="inline-flex h-10 min-w-[44px] items-center justify-center gap-2 rounded-xl border border-[#D4AF37]/50 bg-[#D4AF37]/20 px-4 text-sm font-semibold text-[#F4D97B] hover:bg-[#D4AF37]/30 transition-colors cursor-pointer"
        >
          {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
          <span>{isPlaying ? 'Pause' : 'Play'}</span>
        </button>

        <button
          type="button"
          onClick={onStop}
          aria-label="Stop playback"
          className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-white/15 bg-white/5 text-[#D8D3C8] hover:border-[#D4AF37]/40 hover:text-white transition-colors cursor-pointer"
        >
          <Square className="h-4 w-4" />
        </button>

        <div className="rounded-xl border border-white/10 bg-[#09090C]/90 px-3 py-2 font-mono text-xs sm:text-sm tabular-nums text-[#F4D97B] whitespace-nowrap">
          <span>{formatTime(currentTime)}</span>
          <span className="mx-1.5 text-[#6D685F]">/</span>
          <span className="text-[#9E988E]">{formatTime(duration)}</span>
        </div>
      </div>

      {/* Right: Replace / Clear Project */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onReplaceFile}
          className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-white/15 bg-white/5 px-3 text-xs font-medium text-[#D8D3C8] hover:border-[#D4AF37]/40 hover:text-white transition-colors whitespace-nowrap cursor-pointer"
        >
          <Upload className="h-3.5 w-3.5" />
          <span>Change Song</span>
        </button>
        <button
          type="button"
          onClick={onClearProject}
          title="Close project and free memory"
          className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-red-500/25 bg-red-500/10 px-3 text-xs font-medium text-red-300 hover:bg-red-500/20 transition-colors whitespace-nowrap cursor-pointer"
        >
          <Trash2 className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Clear</span>
        </button>
      </div>
    </div>
  );
}
