"use client";

import Image, { type StaticImageData } from "next/image";
import { useEffect, useState, useSyncExternalStore } from "react";
import heroTeam from "@/assets/landing/hero-team.webp";
import heroMember from "@/assets/landing/hero-member-sharp.webp";
import heroGroup from "@/assets/landing/hero-group.webp";

type Slide = { src: StaticImageData; alt: string; position: string };

/** Hero photos, in order. `position` keeps faces clear of the headline on phones and computers. */
const SLIDES: Slide[] = [
  { src: heroTeam, alt: "Members of Winners Team together at an event", position: "object-[50%_25%]" },
  { src: heroMember, alt: "A Winners Team member walking through the hall at an event", position: "object-[49%_30%] sm:object-[50%_35%]" },
  { src: heroGroup, alt: "Winners Team members standing together outdoors", position: "object-[50%_40%] sm:object-[50%_45%]" },
];

const INTERVAL_MS = 6500;
const FADE_MS = 1400;

function subscribeReducedMotion(cb: () => void) {
  const m = window.matchMedia("(prefers-reduced-motion: reduce)");
  m.addEventListener("change", cb);
  return () => m.removeEventListener("change", cb);
}
const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * Cross-fading hero slideshow with a slow zoom ("Ken Burns").
 * Pauses itself for people who ask for reduced motion, and always offers a pause button.
 */
export function HeroSlider({ quality = 90 }: { quality?: number }) {
  const reduce = useSyncExternalStore(subscribeReducedMotion, reducedMotion, () => false);
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const playing = !paused && !reduce;

  useEffect(() => {
    if (!playing) return;
    const t = window.setInterval(() => {
      if (document.visibilityState === "visible") setIndex((i) => (i + 1) % SLIDES.length);
    }, INTERVAL_MS);
    return () => window.clearInterval(t);
  }, [playing, index]);

  return (
    <>
      {/* Phones: photo fills the top part so faces stay clear of the text. Larger screens: full bleed. */}
      <div className="absolute inset-x-0 top-0 h-[62%] overflow-hidden sm:h-full" aria-roledescription="carousel" aria-label="Winners Team photos">
        {SLIDES.map((s, i) => {
          const active = i === index;
          return (
            <div
              key={i}
              className="absolute inset-0"
              style={{ opacity: active ? 1 : 0, transition: `opacity ${FADE_MS}ms ease-in-out` }}
              aria-hidden={!active}
              role="group"
              aria-roledescription="slide"
              aria-label={`${i + 1} of ${SLIDES.length}`}
            >
              <Image
                src={s.src}
                alt={s.alt}
                fill
                preload={i === 0}
                quality={quality}
                sizes="100vw"
                placeholder="blur"
                className={`object-cover ${s.position}`}
                style={{
                  transform: active && !reduce ? "scale(1.08)" : "scale(1)",
                  transition: active && !reduce ? `transform ${INTERVAL_MS + FADE_MS}ms linear` : `transform ${FADE_MS}ms ease-out`,
                }}
              />
            </div>
          );
        })}
        {/* Overlays keep faces visible at the top and the text readable at the bottom. */}
        <div className="absolute inset-0 bg-gradient-to-t from-night via-night/40 to-night/10 sm:via-night/70" aria-hidden />
        <div className="absolute inset-0 hidden bg-gradient-to-r from-night/70 via-transparent to-transparent sm:block" aria-hidden />
      </div>

      {/* Controls */}
      <div className="absolute bottom-5 left-1/2 z-10 flex -translate-x-1/2 items-center gap-2 rounded-full bg-night/50 px-2.5 py-1.5 backdrop-blur sm:bottom-8 sm:left-auto sm:right-8 sm:translate-x-0">
        {SLIDES.map((_, i) => (
          <button
            key={i}
            type="button"
            onClick={() => setIndex(i)}
            aria-label={`Show photo ${i + 1} of ${SLIDES.length}`}
            aria-current={i === index}
            className="group flex h-6 items-center justify-center px-0.5"
          >
            <span className={`block h-1.5 rounded-full transition-all duration-500 ${i === index ? "w-6 bg-white" : "w-1.5 bg-white/45 group-hover:bg-white/80"}`} />
          </button>
        ))}
        <button
          type="button"
          onClick={() => setPaused((p) => !p)}
          aria-label={playing ? "Pause slideshow" : "Play slideshow"}
          className="ml-0.5 flex h-6 w-6 items-center justify-center rounded-full text-white/80 hover:bg-white/15 hover:text-white"
        >
          <span className="material-symbols-outlined text-[18px]" aria-hidden>{playing ? "pause" : "play_arrow"}</span>
        </button>
      </div>
    </>
  );
}
