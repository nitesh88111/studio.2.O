import { useEffect, useState } from 'react';
import { Download, Link2, Loader2, X } from 'lucide-react';
import { exportToMp3, exportToWav, formatTime, triggerDownload } from '../audio/audioEngine';
import type { ExportFormat } from '../types/audio';

interface ExportModalProps {
  isOpen: boolean;
  buffer: AudioBuffer | null;
  defaultFileName: string;
  onClose: () => void;
  onImportFromLink: () => void;
}

export function ExportModal({
  isOpen,
  buffer,
  defaultFileName,
  onClose,
  onImportFromLink,
}: ExportModalProps) {
  const baseName = defaultFileName.replace(/\.[^/.]+$/, '') || 'event-audio';
  const [outputName, setOutputName] = useState(`${baseName}-edited`);
  const [format, setFormat] = useState<ExportFormat>('wav');
  const [kbps, setKbps] = useState(192);
  const [isExporting, setIsExporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      const cleanBase = defaultFileName.replace(/\.[^/.]+$/, '') || 'event-audio';
      setOutputName(`${cleanBase}-edited`);
      setError(null);
      setProgress(0);
    }
  }, [isOpen, defaultFileName]);

  if (!isOpen || !buffer) return null;

  const handleExport = async () => {
    setIsExporting(true);
    setProgress(0);
    setError(null);
    try {
      const safeName = outputName.trim() || 'event-audio-edited';
      if (format === 'wav') {
        const wavBlob = exportToWav(buffer);
        triggerDownload(wavBlob, `${safeName}.wav`);
        onClose();
      } else {
        const mp3Blob = await exportToMp3(buffer, kbps, (p) => setProgress(p));
        triggerDownload(mp3Blob, `${safeName}.mp3`);
        onClose();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Export failed. Please try WAV format.');
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-md p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="export-title"
    >
      <div className="w-full max-w-md rounded-2xl border border-[#D4AF37]/35 bg-[#111116] p-6 shadow-[0_28px_80px_rgba(0,0,0,0.85)]">
        <div className="flex items-center justify-between mb-5">
          <div>
            <h2 id="export-title" className="font-display text-xl font-bold text-[#F5F3EE]">
              Export Audio
            </h2>
            <p className="text-xs text-[#9E988E] tabular-nums mt-0.5">
              Duration: {formatTime(buffer.duration)} · {Math.round(buffer.sampleRate / 1000)} kHz
            </p>
          </div>
          <button
            type="button"
            disabled={isExporting}
            onClick={onClose}
            aria-label="Close export dialog"
            className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-[#C8C2B6] hover:text-white cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label htmlFor="export-name" className="block text-xs font-medium text-[#C8C2B6] mb-1.5">
              Output File Name
            </label>
            <input
              id="export-name"
              type="text"
              value={outputName}
              onChange={(e) => setOutputName(e.target.value)}
              disabled={isExporting}
              className="w-full rounded-xl border border-[#D4AF37]/25 bg-[#09090C] px-3.5 py-2.5 text-sm text-[#F5F3EE] focus:border-[#E5C158] focus:outline-none"
            />
          </div>

          <div>
            <span className="block text-xs font-medium text-[#C8C2B6] mb-1.5">Format</span>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                disabled={isExporting}
                onClick={() => setFormat('wav')}
                className={`rounded-xl border px-3 py-2.5 text-left transition-all cursor-pointer ${
                  format === 'wav'
                    ? 'border-[#E5C158] bg-[#D4AF37]/20 text-[#F4D97B]'
                    : 'border-white/10 bg-white/5 text-[#C8C2B6] hover:border-white/25'
                }`}
              >
                <div className="text-sm font-semibold">WAV</div>
                <div className="text-[11px] opacity-80">Lossless PCM · Instant</div>
              </button>
              <button
                type="button"
                disabled={isExporting}
                onClick={() => setFormat('mp3')}
                className={`rounded-xl border px-3 py-2.5 text-left transition-all cursor-pointer ${
                  format === 'mp3'
                    ? 'border-[#E5C158] bg-[#D4AF37]/20 text-[#F4D97B]'
                    : 'border-white/10 bg-white/5 text-[#C8C2B6] hover:border-white/25'
                }`}
              >
                <div className="text-sm font-semibold">MP3</div>
                <div className="text-[11px] opacity-80">Compact · Stage ready</div>
              </button>
            </div>
          </div>

          {format === 'mp3' && (
            <div>
              <span className="block text-xs font-medium text-[#C8C2B6] mb-1.5">MP3 Quality</span>
              <div className="grid grid-cols-2 gap-2">
                {[192, 320].map((rate) => (
                  <button
                    key={rate}
                    type="button"
                    disabled={isExporting}
                    onClick={() => setKbps(rate)}
                    className={`rounded-xl border px-3 py-2 text-xs font-medium transition-all cursor-pointer ${
                      kbps === rate
                        ? 'border-[#E5C158] bg-[#D4AF37]/20 text-[#F4D97B]'
                        : 'border-white/10 bg-white/5 text-[#C8C2B6]'
                    }`}
                  >
                    {rate} kbps
                  </button>
                ))}
              </div>
            </div>
          )}

          {isExporting && format === 'mp3' && (
            <div className="rounded-xl border border-[#D4AF37]/25 bg-[#09090C] p-3">
              <div className="flex items-center justify-between text-xs text-[#F4D97B] mb-1.5">
                <span>Encoding MP3...</span>
                <span className="tabular-nums">{progress}%</span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-white/10">
                <div
                  className="h-full bg-gradient-to-r from-[#C59B27] to-[#E5C158] transition-all duration-150"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>
          )}

          {error && (
            <p className="rounded-xl border border-red-500/35 bg-red-950/50 px-3 py-2 text-xs text-red-200">
              {error}
            </p>
          )}
        </div>

        <div className="mt-6 flex items-center justify-end gap-2">
          <button
            type="button"
            disabled={isExporting}
            onClick={onClose}
            className="min-h-[44px] rounded-xl border border-white/15 px-4 py-2 text-sm font-medium text-[#C8C2B6] hover:text-white cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={isExporting}
            onClick={() => void handleExport()}
            className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-[#E5C158]/70 bg-gradient-to-b from-[#E5C158] to-[#C59B27] px-5 py-2 text-sm font-semibold text-[#09090C] hover:brightness-105 disabled:opacity-60 cursor-pointer"
          >
            {isExporting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>Exporting...</span>
              </>
            ) : (
              <>
                <Download className="h-4 w-4" />
                <span>Download {format.toUpperCase()}</span>
              </>
            )}
          </button>
        </div>

        <div className="mt-4 pt-3 border-t border-white/10 flex justify-center">
          <button
            type="button"
            disabled={isExporting}
            onClick={() => {
              onClose();
              onImportFromLink();
            }}
            className="inline-flex items-center gap-1.5 text-xs text-[#B8B2A6] hover:text-[#F4D97B] transition-colors disabled:opacity-40 cursor-pointer"
          >
            <Link2 className="h-3.5 w-3.5" />
            <span>Import audio from video link</span>
          </button>
        </div>
      </div>
    </div>
  );
}
