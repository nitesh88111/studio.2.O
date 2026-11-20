import { ExternalLink, Mail } from 'lucide-react';
import { BRAND_CONFIG, CONTACT_INFO } from '../config/brand';

export function ContactSection() {
  return (
    <footer
      id="contact"
      className="relative z-10 mt-16 border-t border-[#D4AF37]/20 bg-[#08080B]/88 backdrop-blur-2xl"
    >
      <div className="mx-auto max-w-6xl px-4 sm:px-6 py-12">
        <div className="max-w-xl">
          <h2 className="font-display text-2xl sm:text-3xl font-bold text-[#F5F3EE]">
            Contact
          </h2>
          <p className="mt-2 text-sm text-[#B8B2A6]">
            Reach out for event audio editing, stage track preparation, and performance mixes.
          </p>
        </div>

        <div className="mt-8 grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Card 1: Contact Email */}
          <div className="rounded-2xl border border-[#D4AF37]/25 bg-[#111116]/80 p-5 flex flex-col justify-between gap-2">
            <div>
              <p className="text-xs font-semibold tracking-wide text-[#E5C158]">
                Email Address
              </p>
              <p className="mt-1 text-xs text-[#9E988E]">
                Direct contact for projects & support
              </p>
            </div>
            <a
              href={`mailto:${CONTACT_INFO.email}`}
              className="mt-2 inline-flex items-center gap-2 text-sm font-medium text-[#F5F3EE] hover:text-[#F4D97B] transition-colors break-all"
            >
              <Mail className="h-4 w-4 shrink-0 text-[#E5C158]" />
              <span>{CONTACT_INFO.email}</span>
            </a>
          </div>

          {/* Card 2: Central Event Enquiry */}
          <div className="rounded-2xl border border-[#D4AF37]/25 bg-[#111116]/80 p-5 flex flex-col justify-between gap-2">
            <div>
              <p className="text-xs font-semibold tracking-wide text-[#E5C158]">
                Event Enquiry
              </p>
              <p className="mt-2 text-sm text-[#C8C2B6] leading-relaxed">
                {CONTACT_INFO.enquiryText}
              </p>
            </div>
            <a
              href={`mailto:${CONTACT_INFO.email}?subject=Event%20Audio%20Enquiry`}
              className="mt-1 inline-flex items-center gap-2 text-sm font-medium text-[#F4D97B] hover:text-[#FFF2B2] transition-colors break-all"
            >
              <Mail className="h-4 w-4 shrink-0" />
              <span>{CONTACT_INFO.email}</span>
            </a>
          </div>

          {/* Card 3: Social / Instagram */}
          <div className="rounded-2xl border border-[#D4AF37]/25 bg-[#111116]/80 p-5 flex flex-col justify-between gap-2">
            <div>
              <p className="text-xs font-semibold tracking-wide text-[#E5C158]">
                Instagram
              </p>
              <p className="mt-1 text-xs text-[#9E988E]">
                Connect for studio updates & mixes
              </p>
            </div>
            <a
              href={CONTACT_INFO.instagramUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 inline-flex items-center gap-2 text-sm font-medium text-[#F5F3EE] hover:text-[#F4D97B] transition-colors"
            >
              <span>@{CONTACT_INFO.instagramUsername}</span>
              <ExternalLink className="h-3.5 w-3.5 text-[#E5C158]" />
            </a>
          </div>
        </div>

        <div className="mt-10 flex flex-wrap items-center justify-between gap-4 border-t border-white/10 pt-6 text-xs text-[#9E988E]">
          <span className="font-medium text-[#D8D3C8]">{BRAND_CONFIG.brandWithAuthor}</span>
          <span>{BRAND_CONFIG.sponsorCredit}</span>
        </div>
      </div>
    </footer>
  );
}
