import { useCallback, useEffect, useRef, useState } from "react";

import { PauseIcon, PlayIcon } from "@/components/icons";

interface AutoplayVideoProps {
  src: string;
  poster: string;
  /** Description of what the clip shows, read by screen readers. */
  label: string;
  /** Short name used in the button label ("Browser" gives "Pause Browser video"). */
  name: string;
  /**
   * Returns the element that scrolls over this clip (the next sticky card). While that element
   * hides more than about half of the clip, the clip pauses.
   */
  coveredBy?: () => Element | null;
}

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";
/** Share of the clip that must be visible to start it. */
const IN_VIEW_THRESHOLD = 1 / 3;
/** Share of the clip height a cover may hide before the clip counts as covered. */
const COVERED_SHARE = 0.5;

/**
 * A short looping promo clip. It plays by itself while at least a third of it is on screen and
 * not covered by a later sticky card, and pauses otherwise (also when the user started it by
 * hand under reduced motion). A visible pause/play button (WCAG 2.2.2) lets the user stop it:
 * after a manual pause, scrolling back does not restart it. Reduced motion never autoplays; the
 * preference is read when a decision is made and watched live. The poster and source load only
 * once the clip is near the viewport.
 */
export function AutoplayVideo({ src, poster, label, name, coveredBy }: AutoplayVideoProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const coveredByRef = useRef(coveredBy);
  // Set once the user pauses by hand; the observer then stops starting playback.
  const userPausedRef = useRef(false);
  // Set while the user started playback by hand (matters under reduced motion).
  const manualRef = useRef(false);
  const [playing, setPlaying] = useState(false);
  const [near, setNear] = useState(() => typeof IntersectionObserver === "undefined");

  useEffect(() => {
    coveredByRef.current = coveredBy;
  }, [coveredBy]);

  const start = useCallback(() => {
    const el = videoRef.current;
    if (!el) return;
    try {
      const result = el.play() as Promise<void> | undefined;
      result?.catch(() => {});
    } catch {
      /* play() can throw synchronously in odd environments */
    }
  }, []);

  useEffect(() => {
    if (near || typeof IntersectionObserver === "undefined") return;
    const wrapper = wrapperRef.current;
    if (!wrapper) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        setNear(true);
        observer.disconnect();
      },
      { rootMargin: "400px 0px" },
    );
    observer.observe(wrapper);
    return () => observer.disconnect();
  }, [near]);

  useEffect(() => {
    const wrapper = wrapperRef.current;
    const el = videoRef.current;
    if (!wrapper || !el) return;
    el.muted = true;
    el.defaultMuted = true;
    const motion = typeof window.matchMedia === "function" ? window.matchMedia(REDUCED_MOTION_QUERY) : null;
    const reduced = () => motion?.matches === true;

    let inView = false;
    let covered = false;
    let raf = 0;

    const evaluate = () => {
      if (!inView || covered) {
        el.pause();
        return;
      }
      if (!userPausedRef.current && !reduced()) start();
    };

    // Returns true when the covered state changed.
    const measure = () => {
      const cover = coveredByRef.current?.() ?? null;
      const rect = wrapper.getBoundingClientRect();
      const next = cover !== null && cover.getBoundingClientRect().top < rect.bottom - rect.height * COVERED_SHARE;
      const changed = next !== covered;
      covered = next;
      return changed;
    };

    const onFrame = () => {
      raf = 0;
      if (measure()) evaluate();
    };
    const onScroll = () => {
      if (raf === 0) raf = requestAnimationFrame(onFrame);
    };
    const listen = (on: boolean) => {
      const toggle = on ? window.addEventListener : window.removeEventListener;
      toggle.call(window, "scroll", onScroll, { passive: true });
      toggle.call(window, "resize", onScroll);
    };

    let observer: IntersectionObserver | null = null;
    if (typeof IntersectionObserver !== "undefined") {
      observer = new IntersectionObserver(
        (entries) => {
          const entry = entries[entries.length - 1];
          if (!entry) return;
          const next = entry.isIntersecting;
          inView = next;
          listen(next);
          if (next) measure();
          evaluate();
        },
        { threshold: IN_VIEW_THRESHOLD },
      );
      observer.observe(el);
    }

    const onMotionChange = () => {
      if (reduced()) {
        if (!manualRef.current) el.pause();
      } else {
        evaluate();
      }
    };
    motion?.addEventListener?.("change", onMotionChange);

    return () => {
      observer?.disconnect();
      listen(false);
      if (raf) cancelAnimationFrame(raf);
      motion?.removeEventListener?.("change", onMotionChange);
    };
  }, [start]);

  const toggle = () => {
    const el = videoRef.current;
    if (!el) return;
    if (playing) {
      userPausedRef.current = true;
      manualRef.current = false;
      el.pause();
    } else {
      userPausedRef.current = false;
      manualRef.current = true;
      start();
    }
  };

  return (
    <div ref={wrapperRef} className="sf-card-shot sf-video">
      <video
        ref={videoRef}
        className="sf-video-el"
        muted
        playsInline
        loop
        preload="none"
        poster={near ? poster : undefined}
        width={1280}
        height={720}
        aria-hidden="true"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
      >
        {near ? <source src={src} type="video/mp4" /> : null}
      </video>
      <span className="sr-only">{label}</span>
      <button
        type="button"
        className="sf-video-toggle"
        aria-label={`${playing ? "Pause" : "Play"} ${name} video`}
        onClick={toggle}
      >
        {playing ? <PauseIcon size={14} aria-hidden /> : <PlayIcon size={14} aria-hidden />}
      </button>
    </div>
  );
}
