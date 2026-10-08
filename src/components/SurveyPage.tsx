import { useEffect, useState } from 'react';

// Tally's documented embed pattern: an iframe pointed at the embed URL, plus
// their widget script once per page. The script scans the page for iframes
// whose src contains tally.so and wires up postMessage-driven auto-resize -
// that's what dynamicHeight=1 in the URL actually uses to grow the iframe.
const TALLY_SRC = 'https://tally.so/embed/7R8689?alignLeft=1&hideTitle=1&transparentBackground=1&dynamicHeight=1';
const TALLY_SCRIPT_SRC = 'https://tally.so/widgets/embed.js';

declare global {
  interface Window {
    Tally?: { loadEmbeds: () => void };
  }
}

export function SurveyPage() {
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    // Already on the page from a previous mount (client-side back/forward) -
    // just re-scan for the iframe instead of injecting the script again.
    if (window.Tally) {
      window.Tally.loadEmbeds();
      return;
    }
    let script = document.querySelector<HTMLScriptElement>(`script[src="${TALLY_SCRIPT_SRC}"]`);
    if (!script) {
      script = document.createElement('script');
      script.src = TALLY_SCRIPT_SRC;
      script.async = true;
      document.body.appendChild(script);
    }
    // No cleanup/removal on unmount - Tally's script is harmless to leave
    // loaded, and removing it mid-resize-listener would just force a re-fetch
    // if the visitor comes back to this page in the same session.
  }, []);

  return (
    <section className="py-20 md:py-28">
      <div className="max-w-4xl mx-auto px-6 md:px-12 space-y-12">
        <div className="space-y-6 text-center">
          <h1 className="text-5xl md:text-6xl font-black font-display leading-[1.05] tracking-tighter uppercase italic">
            FAFO <span className="text-primary italic">Community Spec Survey</span>
          </h1>
          <div className="space-y-4 max-w-2xl mx-auto">
            <p className="text-lg md:text-xl text-white font-bold tracking-tight">
              What spec are you currently playing the MOST?
            </p>
            <p className="text-base text-white/40 leading-relaxed font-medium tracking-tight">
              We're trying to get a better picture of what the FAFO community is actually playing
              so we can make better decisions about where we put our development time.
            </p>
            <p className="text-base text-white/40 leading-relaxed font-medium tracking-tight">
              Select the ONE spec you currently consider your main.
            </p>
          </div>
        </div>

        {/* No border/card around the iframe itself - it should blend straight into the
            page background. min-height is a permanent floor (not removed once loaded)
            so the page never jumps: Tally's dynamicHeight script only ever grows the
            iframe taller than this once it reports real content height. */}
        <div className="relative w-full" style={{ minHeight: 480 }}>
          {!loaded && (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="w-6 h-6 rounded-full border-2 border-white/10 border-t-primary animate-spin" />
            </div>
          )}
          {/* data-tally-src only, deliberately no src: embed.js's dynamicHeight/resize
              wiring (iframe-resizer under the hood) only attaches to an iframe matching
              EXACTLY ONE of its two selectors - `[data-tally-src]:not([src])` (lazy-load,
              sets src itself via IntersectionObserver) or `:not([data-tally-src])` (src
              set directly, resized immediately). Setting both attributes, as the embed
              URL alone might suggest, matches neither selector and the iframe silently
              never resizes. */}
          <iframe
            data-tally-src={TALLY_SRC}
            title="FAFO Community Spec Survey"
            width="100%"
            style={{ border: 'none', background: 'transparent', display: 'block' }}
            onLoad={() => setLoaded(true)}
          />
        </div>
      </div>
    </section>
  );
}
