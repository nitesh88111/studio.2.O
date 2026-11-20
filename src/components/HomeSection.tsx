import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowRight,
  Combine,
  Info,
  Layers,
  Link2,
  Loader2,
  RefreshCw,
  Scissors,
  Sliders,
  Upload,
} from 'lucide-react';
import { formatTime } from '../audio/audioEngine';
import { detectLinkPlatform } from '../audio/linkImport';
import { BRAND_CONFIG } from '../config/brand';
import { DEMO_MODE } from '../config/linkImport';
import type { ToolSection } from '../types/audio';
import { WaveformCanvas } from './WaveformCanvas';

interface HomeSectionProps {
  activeBuffer: AudioBuffer | null;
  fileName: string;
  currentTime: number;
  isDecoding: boolean;
  error: string | null;
  isImportingLink: boolean;
  linkStatus: string | null;
  linkError: string | null;
  demoNotice: string | null;
  focusLinkTrigger: number;
  onFileSelected: (file: File) => void;
  onImportLink: (url: string) => void;
  onClearLinkError: () => void;
  onNavigateTool: (tool: ToolSection) => void;
  onSeek: (time: number) => void;
}

export function HomeSection({
  activeBuffer,
  fileName,
  currentTime,
  isDecoding,
  error,
  isImportingLink,
  linkStatus,
  linkError,
  demoNotice,
  focusLinkTrigger,
  onFileSelected,
  onImportLink,
  onClearLinkError,
  onNavigateTool,
  onSeek,
}: HomeSectionProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const linkInputRef = useRef<HTMLInputElement>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [linkUrl, setLinkUrl] = useState('');
  const [showLoadedLinkBox, setShowLoadedLinkBox] = useState(false);

  const isBusy = isDecoding || isImportingLink;

  const detection = useMemo(() => {
    if (!linkUrl.trim()) return null;
    return detectLinkPlatform(linkUrl);
  }, [linkUrl]);

  useEffect(() => {
    if (focusLinkTrigger > 0) {
      setShowLoadedLinkBox(true);
      const id = window.setTimeout(() => {
        linkInputRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        linkInputRef.current?.focus();
      }, 120);
      return () => window.clearTimeout(id);
    }
  }, [focusLinkTrigger]);

  const handleFiles = (files: FileList | null) => {
    if (isBusy || !files || files.length === 0) return;
    onFileSelected(files[0]);
  };

  const triggerPicker = () => {
    if (isBusy) return;
    inputRef.current?.click();
  };

  const handleSubmitLink = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (isBusy) return;
    onImportLink(linkUrl);
  };

  const renderLinkPaster = (compact = false) => (
    <div className={compact ? 'space-y-3' : 'mt-8 pt-6 border-t border-white/10 space-y-3 text-left'}>
      {!compact && (
        <div className="flex items-center justify-center gap-3">
          <span className="h-px flex-1 bg-white/10" aria-hidden="true" />
          <span className="text-[11px] font-semibold tracking-[0.14em] uppercase text-[#9E988E]">
            OR IMPORT FROM LINK
          </span>
          <span className="h-px flex-1 bg-white/10" aria-hidden="true" />
        </div>
      )}

      <form onSubmit={handleSubmitLink} className="flex flex-col sm:flex-row gap-2.5">
        <div className="relative flex-1">
          <Link2
            className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-[#9E988E]"
            aria-hidden="true"
          />
          <input
            ref={linkInputRef}
            type="text"
            inputMode="url"
            value={linkUrl}
            disabled={isImportingLink}
            onChange={(e) => {
              setLinkUrl(e.target.value);
              if (linkError) onClearLinkError();
            }}
            placeholder="Paste a video or audio link here..."
            aria-label="Paste a video or audio link"
            data-gesture-lock="true"
            className="w-full min-h-[46px] rounded-xl border border-[#D4AF37]/30 bg-[#121218]/90 pl-10 pr-3.5 py-2.5 text-sm text-[#F5F3EE] placeholder:text-[#7E786E] focus:border-[#E5C158] focus:outline-none disabled:opacity-60"
          />
        </div>

        <button
          type="submit"
          disabled={isBusy}
          className="inline-flex min-h-[46px] shrink-0 items-center justify-center gap-2 rounded-xl border border-[#E5C158]/70 bg-gradient-to-b from-[#E5C158] to-[#C59B27] px-5 py-2.5 text-sm font-semibold text-[#09090C] hover:brightness-105 active:scale-[0.98] transition-all disabled:opacity-55 disabled:cursor-wait cursor-pointer"
        >
          {isImportingLink ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>Importing...</span>
            </>
          ) : (
            <span>Get Audio</span>
          )}
        </button>
      </form>

      {/* Auto Platform Detection Readout */}
      {detection && !isImportingLink && !linkError && (
        <div className="flex items-center justify-between gap-2 text-xs px-1">
          {detection.valid && detection.platformLabel ? (
            <span className="text-[#F4D97B]">
              Detected: <strong className="font-semibold">{detection.platformLabel}</strong>
            </span>
          ) : (
            <span className="text-[#9E988E]">
              Supports YouTube, Shorts, Instagram Reels, TikTok, SoundCloud, Vimeo, or direct media URLs
            </span>
          )}
        </div>
      )}

      {/* Multi-step Loading Status */}
      {isImportingLink && linkStatus && (
        <div className="flex items-center gap-2 rounded-xl border border-[#D4AF37]/30 bg-[#D4AF37]/10 px-3.5 py-2.5 text-xs text-[#F4D97B]">
          <Loader2 className="h-4 w-4 animate-spin shrink-0" />
          <span>{linkStatus}</span>
        </div>
      )}

      {/* Link Import Error + Retry */}
      {linkError && (
        <div
          role="alert"
          className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-red-500/40 bg-red-950/60 px-3.5 py-3 text-xs sm:text-sm text-red-200"
        >
          <div className="flex items-start gap-2.5 min-w-0 flex-1">
            <AlertCircle className="h-4 w-4 shrink-0 text-red-400 mt-0.5" />
            <span>{linkError}</span>
          </div>
          {linkUrl.trim() && (
            <button
              type="button"
              disabled={isBusy}
              onClick={() => handleSubmitLink()}
              className="inline-flex min-h-[34px] shrink-0 items-center gap-1.5 rounded-lg border border-red-300/35 bg-red-500/15 px-3 py-1 text-xs font-semibold text-red-100 hover:bg-red-500/25 cursor-pointer"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              <span>Retry</span>
            </button>
          )}
        </div>
      )}

      {DEMO_MODE && !linkError && (
        <p className="text-[11px] text-[#9E988E]/90 text-center sm:text-left">
          Demo Mode is active: validates links and loads bundled sample audio until a backend server is connected.
        </p>
      )}
    </div>
  );

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:py-14">
      <input
        ref={inputRef}
        type="file"
        accept="audio/*,.mp3,.wav,.m4a,.ogg,.aac,.flac"
        className="hidden"
        onChange={(e) => {
          const picked = e.target.files?.[0];
          e.target.value = '';
          if (picked && !isBusy) {
            onFileSelected(picked);
          }
        }}
      />

      {!activeBuffer ? (
        /* Uncluttered Initial Home Landing State */
        <div className="mx-auto max-w-2xl text-center">
          <div
            onDragOver={(e) => {
              e.preventDefault();
              if (!isBusy) setIsDragOver(true);
            }}
            onDragLeave={() => setIsDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setIsDragOver(false);
              handleFiles(e.dataTransfer.files);
            }}
            className={`relative rounded-3xl border transition-all duration-300 backdrop-blur-xl px-6 py-10 sm:px-11 sm:py-12 shadow-[0_30px_90px_rgba(0,0,0,0.72)] ${
              isDragOver
                ? 'border-[#E5C158] bg-[#16161C]/90 scale-[1.01]'
                : 'border-[#D4AF37]/30 bg-[#0D0D11]/72 hover:border-[#D4AF37]/50'
            }`}
          >
            <h1 className="font-display text-3xl sm:text-5xl font-bold tracking-tight text-[#F5F3EE] text-balance">
              Event Audio Editing Studio
            </h1>
            <p className="mx-auto mt-4 max-w-lg text-sm sm:text-base text-[#C8C2B6] leading-relaxed">
              Add a song to begin cutting, joining, and mixing tracks for performances, weddings, and stage programs.
            </p>

            <div className="mt-8 flex flex-col items-center gap-4">
              <button
                type="button"
                disabled={isBusy}
                onClick={triggerPicker}
                className="inline-flex min-h-[52px] items-center justify-center gap-3 rounded-2xl border border-[#E5C158]/70 bg-gradient-to-b from-[#E5C158] to-[#C59B27] px-8 py-3.5 text-base font-semibold text-[#09090C] shadow-[0_10px_32px_rgba(212,175,55,0.28)] hover:brightness-105 active:scale-[0.98] transition-all disabled:opacity-60 disabled:cursor-wait cursor-pointer"
              >
                {isDecoding ? (
                  <>
                    <Loader2 className="h-5 w-5 animate-spin" />
                    <span>Loading waveform...</span>
                  </>
                ) : (
                  <>
                    <Upload className="h-5 w-5" />
                    <span>Add Audio File</span>
                  </>
                )}
              </button>

              <p className="text-xs text-[#9E988E]">
                Drag and drop an audio file here, or click above · Maximum file size: 50 MB
              </p>
            </div>

            {error && (
              <div
                role="alert"
                className="mt-6 flex items-start gap-3 rounded-xl border border-red-500/40 bg-red-950/60 px-4 py-3 text-left text-sm text-red-200"
              >
                <AlertCircle className="h-5 w-5 shrink-0 text-red-400 mt-0.5" />
                <span>{error}</span>
              </div>
            )}

            {/* Integrated Universal Video/Audio Link Paster */}
            {renderLinkPaster(false)}

            <p className="mt-8 text-xs tracking-wide text-[#9E988E]/80">
              {BRAND_CONFIG.sponsorCredit}
            </p>
          </div>
        </div>
      ) : (
        /* Compact Floating Studio Overview after Smooth Transition */
        <div className="rounded-3xl border border-[#D4AF37]/30 bg-[#101014]/82 backdrop-blur-2xl p-6 sm:p-8 shadow-[0_24px_80px_rgba(0,0,0,0.75)]">
          <div className="flex flex-wrap items-center justify-between gap-4 mb-5">
            <div>
              <h1 className="font-display text-2xl sm:text-3xl font-bold text-[#F5F3EE]">
                Active Studio Project
              </h1>
              <p className="mt-1 text-sm text-[#B8B2A6] tabular-nums">
                {fileName} · {formatTime(activeBuffer.duration)} ·{' '}
                {Math.round(activeBuffer.sampleRate / 1000)} kHz
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2.5">
              <button
                type="button"
                disabled={isBusy}
                onClick={() => setShowLoadedLinkBox((v) => !v)}
                className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-white/15 bg-white/5 px-4 py-2 text-sm font-medium text-[#D8D3C8] hover:border-[#D4AF37]/45 hover:text-[#F4D97B] transition-colors disabled:opacity-50 cursor-pointer"
              >
                <Link2 className="h-4 w-4 text-[#E5C158]" />
                <span>Import from Link</span>
              </button>

              <button
                type="button"
                disabled={isBusy}
                onClick={triggerPicker}
                className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-[#D4AF37]/40 bg-[#D4AF37]/15 px-4 py-2 text-sm font-medium text-[#F4D97B] hover:bg-[#D4AF37]/25 transition-colors disabled:opacity-50 cursor-pointer"
              >
                {isDecoding ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span>Loading waveform...</span>
                  </>
                ) : (
                  <>
                    <Upload className="h-4 w-4" />
                    <span>Upload Another Track</span>
                  </>
                )}
              </button>
            </div>
          </div>

          {demoNotice && (
            <div className="mb-4 flex items-start gap-2.5 rounded-xl border border-[#D4AF37]/35 bg-[#D4AF37]/10 px-4 py-2.5 text-xs sm:text-sm text-[#F4D97B]">
              <Info className="h-4 w-4 shrink-0 mt-0.5" />
              <span>{demoNotice}</span>
            </div>
          )}

          {showLoadedLinkBox && (
            <div className="mb-5 rounded-2xl border border-[#D4AF37]/25 bg-[#0B0B0F]/80 p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold tracking-wider uppercase text-[#F4D97B]">
                  Import Audio from Video or Media Link
                </span>
                <button
                  type="button"
                  onClick={() => setShowLoadedLinkBox(false)}
                  className="text-xs text-[#9E988E] hover:text-white cursor-pointer"
                >
                  Hide
                </button>
              </div>
              {renderLinkPaster(true)}
            </div>
          )}

          {error && (
            <div
              role="alert"
              className="mb-5 flex items-start gap-3 rounded-xl border border-red-500/40 bg-red-950/60 px-4 py-3 text-sm text-red-200"
            >
              <AlertCircle className="h-5 w-5 shrink-0 text-red-400 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <WaveformCanvas
            buffer={activeBuffer}
            currentTime={currentTime}
            selection={null}
            readOnly
            height={148}
            onSeek={onSeek}
          />

          <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <button
              type="button"
              onClick={() => onNavigateTool('cutter')}
              className="group flex items-center justify-between rounded-2xl border border-[#D4AF37]/30 bg-[#16161B]/80 p-4 text-left hover:border-[#E5C158] hover:bg-[#D4AF37]/10 transition-all cursor-pointer"
            >
              <div>
                <div className="flex items-center gap-2 text-sm font-semibold text-[#F5F3EE]">
                  <Scissors className="h-4 w-4 text-[#E5C158]" />
                  <span>Audio Cutter</span>
                </div>
                <p className="mt-1 text-xs text-[#9E988E]">Trim, split & fade song</p>
              </div>
              <ArrowRight className="h-4 w-4 text-[#9E988E] group-hover:text-[#E5C158] transition-colors" />
            </button>

            <button
              type="button"
              onClick={() => onNavigateTool('joiner')}
              className="group flex items-center justify-between rounded-2xl border border-[#D4AF37]/30 bg-[#16161B]/80 p-4 text-left hover:border-[#E5C158] hover:bg-[#D4AF37]/10 transition-all cursor-pointer"
            >
              <div>
                <div className="flex items-center gap-2 text-sm font-semibold text-[#F5F3EE]">
                  <Combine className="h-4 w-4 text-[#E5C158]" />
                  <span>Song Joiner</span>
                </div>
                <p className="mt-1 text-xs text-[#9E988E]">Merge & crossfade tracks</p>
              </div>
              <ArrowRight className="h-4 w-4 text-[#9E988E] group-hover:text-[#E5C158] transition-colors" />
            </button>

            <button
              type="button"
              onClick={() => onNavigateTool('overlay')}
              className="group flex items-center justify-between rounded-2xl border border-[#D4AF37]/30 bg-[#16161B]/80 p-4 text-left hover:border-[#E5C158] hover:bg-[#D4AF37]/10 transition-all cursor-pointer"
            >
              <div>
                <div className="flex items-center gap-2 text-sm font-semibold text-[#F5F3EE]">
                  <Layers className="h-4 w-4 text-[#E5C158]" />
                  <span>Audio Overlay</span>
                </div>
                <p className="mt-1 text-xs text-[#9E988E]">Layer up to 2 extra tracks</p>
              </div>
              <ArrowRight className="h-4 w-4 text-[#9E988E] group-hover:text-[#E5C158] transition-colors" />
            </button>

            <button
              type="button"
              onClick={() => onNavigateTool('more')}
              className="group flex items-center justify-between rounded-2xl border border-[#D4AF37]/30 bg-[#16161B]/80 p-4 text-left hover:border-[#E5C158] hover:bg-[#D4AF37]/10 transition-all cursor-pointer"
            >
              <div>
                <div className="flex items-center gap-2 text-sm font-semibold text-[#F5F3EE]">
                  <Sliders className="h-4 w-4 text-[#E5C158]" />
                  <span>More Tools</span>
                </div>
                <p className="mt-1 text-xs text-[#9E988E]">EQ, automation & FX</p>
              </div>
              <ArrowRight className="h-4 w-4 text-[#9E988E] group-hover:text-[#E5C158] transition-colors" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
