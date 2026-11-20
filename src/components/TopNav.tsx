import { useState } from 'react';
import { Download, Menu, Upload, X } from 'lucide-react';
import type { ToolSection } from '../types/audio';

interface TopNavProps {
  activeSection: ToolSection;
  hasAudio: boolean;
  onSelectSection: (section: ToolSection) => void;
  onContactClick: () => void;
  onPrimaryAction: () => void;
}

const NAV_TOOLS: { id: ToolSection; label: string }[] = [
  { id: 'home', label: 'Home' },
  { id: 'cutter', label: 'Cutter' },
  { id: 'joiner', label: 'Joiner' },
  { id: 'overlay', label: 'Overlay' },
  { id: 'more', label: 'More' },
];

export function TopNav({
  activeSection,
  hasAudio,
  onSelectSection,
  onContactClick,
  onPrimaryAction,
}: TopNavProps) {
  const [mobileOpen, setMobileOpen] = useState(false);

  const handleNav = (id: ToolSection) => {
    setMobileOpen(false);
    onSelectSection(id);
  };

  const handleContact = () => {
    setMobileOpen(false);
    onContactClick();
  };

  return (
    <header className="sticky top-0 z-40 w-full border-b border-[#D4AF37]/20 bg-[#09090C]/75 backdrop-blur-xl">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 sm:gap-6 px-4 sm:px-6 h-16">
        {/* Zone 1: Upper-Left Studio.2.O by Nitesh Brand Wordmark */}
        <button
          type="button"
          onClick={() => handleNav('home')}
          aria-label="Studio.2.O by Nitesh Home"
          className="group inline-flex items-baseline gap-1.5 font-display text-lg sm:text-2xl font-bold tracking-tight text-[#F5F3EE] transition-colors whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#D4AF37] cursor-pointer"
        >
          <span className="inline-flex items-baseline">
            <span className="bg-gradient-to-b from-[#FFFFFF] via-[#F5F3EE] to-[#C8C0B0] bg-clip-text text-transparent group-hover:from-[#F4D97B] group-hover:to-[#D4AF37] transition-all">
              Studio
            </span>
            <span className="text-[#E5C158] drop-shadow-[0_0_10px_rgba(212,175,55,0.35)]">
              .2.O
            </span>
          </span>
          <span className="font-sans text-[11px] sm:text-xs font-medium tracking-wide text-[#9E988E] group-hover:text-[#D8D3C8] transition-colors">
            by Nitesh
          </span>
        </button>

        {/* Zone 2: Dark/Gold Navigation Items */}
        <nav
          aria-label="Studio sections"
          className="hidden md:flex items-center gap-1.5 rounded-xl border border-[#D4AF37]/25 bg-[#121216]/80 p-1 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]"
        >
          {NAV_TOOLS.map((item) => {
            const isActive = activeSection === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => handleNav(item.id)}
                className={`px-3.5 py-1.5 rounded-lg text-sm font-medium transition-all duration-200 whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-[#D4AF37] ${
                  isActive
                    ? 'bg-[#D4AF37]/20 text-[#F4D97B] border border-[#D4AF37]/50 shadow-[0_0_18px_rgba(212,175,55,0.18)]'
                    : 'text-[#B8B2A6] hover:text-[#F5F3EE] hover:bg-white/5 border border-transparent'
                }`}
              >
                {item.label}
              </button>
            );
          })}
          <button
            type="button"
            onClick={handleContact}
            className="px-3.5 py-1.5 rounded-lg text-sm font-medium text-[#B8B2A6] hover:text-[#F5F3EE] hover:bg-white/5 border border-transparent transition-all duration-200 whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-[#D4AF37]"
          >
            Contact
          </button>
        </nav>

        {/* Zone 3: Single Primary Action + Mobile Trigger */}
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={onPrimaryAction}
            className="inline-flex items-center gap-2 rounded-xl border border-[#D4AF37]/50 bg-[#D4AF37]/15 px-4 py-2 text-sm font-semibold text-[#F4D97B] hover:bg-[#D4AF37]/25 hover:border-[#E5C158] transition-all duration-200 whitespace-nowrap shrink-0 cursor-pointer min-h-[40px] focus-visible:outline-2 focus-visible:outline-[#D4AF37]"
          >
            {hasAudio ? (
              <>
                <Download className="h-4 w-4" />
                <span>Export</span>
              </>
            ) : (
              <>
                <Upload className="h-4 w-4" />
                <span>Upload Audio</span>
              </>
            )}
          </button>

          <button
            type="button"
            aria-label={mobileOpen ? 'Close menu' : 'Open menu'}
            onClick={() => setMobileOpen((prev) => !prev)}
            className="md:hidden inline-flex items-center justify-center rounded-xl border border-[#D4AF37]/25 bg-[#121216]/80 min-h-[44px] min-w-[44px] text-[#F5F3EE] hover:border-[#D4AF37]/50 transition-colors cursor-pointer"
          >
            {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </div>

      {/* Mobile Navigation Drawer */}
      {mobileOpen && (
        <div className="md:hidden border-t border-[#D4AF37]/20 bg-[#0B0B0F]/95 backdrop-blur-2xl px-4 py-3">
          <div className="grid grid-cols-3 gap-2">
            {NAV_TOOLS.map((item) => {
              const isActive = activeSection === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => handleNav(item.id)}
                  className={`min-h-[44px] rounded-xl border px-3 py-2 text-sm font-medium transition-all whitespace-nowrap ${
                    isActive
                      ? 'border-[#D4AF37]/60 bg-[#D4AF37]/20 text-[#F4D97B]'
                      : 'border-white/10 bg-white/5 text-[#C8C2B6] hover:text-white'
                  }`}
                >
                  {item.label}
                </button>
              );
            })}
            <button
              type="button"
              onClick={handleContact}
              className="min-h-[44px] rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm font-medium text-[#C8C2B6] hover:text-white whitespace-nowrap"
            >
              Contact
            </button>
          </div>
        </div>
      )}
    </header>
  );
}
