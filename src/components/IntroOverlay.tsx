import { useEffect, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { BRAND_CONFIG } from '../config/brand';

interface IntroOverlayProps {
  onComplete: () => void;
}

export function IntroOverlay({ onComplete }: IntroOverlayProps) {
  const [phase, setPhase] = useState<'center' | 'exit' | 'done'>('center');
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  useEffect(() => {
    // Enter from right (~450ms) + remain clearly visible in center for 2 seconds (2000ms)
    const exitTimer = window.setTimeout(() => {
      setPhase('exit');
    }, 2450);

    // Finish sliding out to left (~450ms) and unmount completely
    const doneTimer = window.setTimeout(() => {
      setPhase('done');
      onCompleteRef.current();
    }, 2950);

    return () => {
      window.clearTimeout(exitTimer);
      window.clearTimeout(doneTimer);
    };
  }, []);

  if (phase === 'done') return null;

  return (
    <div
      className="fixed inset-0 z-50 pointer-events-none flex items-center justify-center px-4 overflow-hidden"
      aria-live="polite"
      aria-hidden={phase === 'exit'}
    >
      <motion.div
        initial={{ x: '105vw', opacity: 0.92 }}
        animate={
          phase === 'center'
            ? { x: 0, opacity: 1 }
            : { x: '-110vw', opacity: 0.85 }
        }
        transition={{
          duration: 0.45,
          ease: phase === 'center' ? [0.16, 1, 0.3, 1] : [0.4, 0, 0.2, 1],
        }}
        className="pointer-events-none relative max-w-md w-full rounded-2xl border border-[#D4AF37]/50 bg-[#0C0C10]/94 backdrop-blur-2xl px-7 py-7 sm:px-9 sm:py-8 shadow-[0_24px_90px_rgba(0,0,0,0.9),0_0_48px_rgba(212,175,55,0.18)] text-center"
      >
        <div className="mx-auto mb-3.5 h-px w-24 bg-gradient-to-r from-transparent via-[#E5C158] to-transparent" />
        <p className="font-display text-xl sm:text-2xl font-semibold tracking-wide text-[#F5F3EE] text-balance">
          {BRAND_CONFIG.sponsorCredit}
        </p>
        <div className="mt-5 h-0.5 w-full overflow-hidden rounded-full bg-white/10">
          <motion.div
            initial={{ scaleX: 0 }}
            animate={{ scaleX: 1 }}
            transition={{ duration: 2, delay: 0.45, ease: 'linear' }}
            style={{ transformOrigin: 'left' }}
            className="h-full w-full bg-gradient-to-r from-[#A68323] via-[#E5C158] to-[#D4AF37]"
          />
        </div>
      </motion.div>
    </div>
  );
}
