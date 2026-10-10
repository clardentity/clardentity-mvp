"use client";

import { useEffect, useRef } from "react";
import { usePrefersReducedMotion } from "@/lib/useReducedMotion";

/* The curtain catches the light - and the wind - where the cursor is.
 *
 * The effect is built out of the asset's own measurements. A column-
 * brightness profile of the stage image, autocorrelated, has its strongest
 * repeat at 1.9906% of its width: that is one fold to the next, about fifty
 * pleats across the stage. The colour is the mean of every lit-fabric pixel
 * in the same band, #a72341, with #d74564 for the edge of a fold turned
 * toward the light. So the bands land on the real folds and wear the
 * curtain's own burgundy.
 *
 * The spacing was 1.709% while the stage was a window onto the 4096px master
 * and this element was the whole photograph, overflowing the frame. The
 * design now supplies the band pre-cropped, so the element and the stage are
 * the same box: the folds did not move, but they are a larger share of a
 * narrower picture - the stage was always showing 85.66% of the master's
 * width, and 1.709 / 0.8566 is 1.995, which is what re-measuring the new
 * asset independently found.
 *
 * Each pleat is its own element rather than one repeating-gradient mask,
 * because a gradient can only be slid as a whole and wind has to move each
 * fold by a different amount. They are flat colour, not copies of the
 * photograph: fifty cheap divs instead of fifty textures, and every pleat the
 * same shade - brightening a copy of the picture gave each one a different
 * one, depending on what happened to be behind it.
 *
 * Nothing here runs under prefers-reduced-motion.
 *
 * A phone has no hover, so on the phone layout the curtain moves on its own:
 * a slow wave travels across the folds, and the light rides its crests. No
 * motion sensor - tilt steering was tried and dropped (iPhones only release
 * the sensor behind a permission prompt, so it was never the same on both).
 * A finger on the stage still lights it where it touches. The loop runs only
 * while the stage is on screen and the tab is visible.
 */

const PLEAT = 1.9906; // % of the stage's width, one fold to the next
const LIT = 0.62; // how much of a pleat catches the light
const COUNT = Math.ceil(100 / PLEAT) + 1;

const BURGUNDY = "#a72341";
const BURGUNDY_LIT = "#d74564";

/* The light pool. */
const REACH = 12; // % of the width it spans either side of the cursor

/* Where the curtain is lit at all, measured off the picture: a luminance
 * field of the slice the design shows puts the bright arch at 50% across and
 * 38% down, half-strength from 30% to 70% horizontally and fading to nothing
 * below two thirds of the height - the bottom of the frame is black fabric.
 * Re-measured on the pre-cropped asset: 49.8% across, 35.0% down, half
 * strength from 26% to 73%, gone by 63%. The same numbers, which is the
 * point - these were always in the coordinates of the slice, and the slice
 * is now the element they are applied to rather than a window onto it.
 *
 * Without this the light was flat top to bottom and flooded the corners the
 * photograph keeps dark, which read as a coloured overlay rather than as the
 * curtain catching anything. Shaping it this way is what the brightened copy
 * of the picture used to do for free. */
const LIGHT_FIELD =
  "radial-gradient(34% 54% at 50% 36%, #000 0%, rgba(0,0,0,0.78) 42%, rgba(0,0,0,0.3) 72%, transparent 100%)";

/* The wind. A gust is a travelling ripple: it starts where the cursor was
 * when it moved, spreads outward, and dies. Everything below is in percent
 * of the curtain's width, so it scales with the stage. */
const GUST_FROM_SPEED = 0.55; // how much pointer speed becomes gust strength
const GUST_MAX = 2.6; // ceiling, so a fast flick billows rather than tears
const GUST_DECAY = 0.91; // per frame - about a second to settle
const GUST_WIDTH = 26; // how far along the curtain a gust is felt
const WAVE_LENGTH = 11; // distance between crests
const WAVE_SPEED = 0.009; // how fast crests travel outward
const SWAY = 0.1; // the idle drift, present whether or not anything moved

/* The phone layout (touch, below lg). */
const PHONE_QUERY = "(max-width: 1023.98px) and (pointer: coarse)";
const PHONE_LIT = 0.75; // the light stays on - there is no hover to wait for
const PHONE_WAVE_LENGTH = 34; // % of the width from one crest to the next
const PHONE_WAVE_SPEED = 0.0007; // radians per ms - a crest crosses in ~6s
const PHONE_WAVE_SWAY = 0.9; // how far a fold moves with the wave, % of width

export function CurtainShimmer({ style }: { style: React.CSSProperties }) {
  const hostRef = useRef<HTMLSpanElement>(null);
  const reducedMotion = usePrefersReducedMotion();

  useEffect(() => {
    const host = hostRef.current;
    const stage = host?.parentElement;
    if (!host || !stage || reducedMotion) return;

    const pleats = Array.from(host.children) as HTMLElement[];

    // Everything the loop needs, kept out of React state: this updates every
    // frame, and a re-render per frame to move a gradient is a great deal of
    // work for no benefit.
    let pointerX = 50; // % across the curtain
    let lastPointerX = 50;
    let gust = 0; // current strength
    let gustX = 50; // where it started
    let lit = 0; // 0 at rest, 1 under the cursor - eased, so it fades
    let target = 0;
    let phase = 0;
    let frame = 0;
    let idle = 0;

    // The phone: the wave runs unless a finger is on the stage.
    const phone = window.matchMedia(PHONE_QUERY).matches;
    let touching = false;
    let wavePhase = 0;
    let onScreen = true;
    const ambient = () => phone && onScreen && document.visibilityState === "visible";

    const step = (now: number) => {
      const waving = phone && !touching;
      if (waving) {
        wavePhase = now * PHONE_WAVE_SPEED;
        target = ambient() ? PHONE_LIT : 0;
      }
      phase = now * WAVE_SPEED;
      lit += (target - lit) * 0.08;
      gust *= GUST_DECAY;
      // A curtain is never perfectly still, so a little sway continues after
      // the gust has gone - otherwise the fabric freezes the instant you stop
      // moving, which is the one thing real fabric never does.
      idle = Math.sin(now * 0.0012) * SWAY;

      for (let i = 0; i < pleats.length; i++) {
        const x = i * PLEAT; // this pleat's position across the curtain
        const toCursor = x - pointerX;
        const toGust = x - gustX;

        // How much of the gust reaches this fold, and the ripple it rides.
        const falloff = Math.exp(-(toGust * toGust) / (2 * GUST_WIDTH * GUST_WIDTH));
        const ripple = Math.sin((Math.abs(toGust) / WAVE_LENGTH) * Math.PI * 2 - phase);
        let shift = gust * falloff * ripple + idle * Math.sin(x * 0.4);

        // The light: a pool around the cursor, fading with distance.
        let glow = Math.exp(-(toCursor * toCursor) / (2 * REACH * REACH));

        if (waving) {
          // The phone's wave: every fold swings with it, and the light is
          // brightest on the crests, so bands of light travel across.
          const angle = (x / PHONE_WAVE_LENGTH) * Math.PI * 2 - wavePhase;
          shift += Math.sin(angle) * PHONE_WAVE_SWAY;
          glow = 0.25 + 0.75 * (0.5 + 0.5 * Math.cos(angle));
        }

        const node = pleats[i];
        // translate moves the fold; scaleX narrows it as it turns edge-on,
        // which is what sells the billow - a pleat swinging toward you gets
        // wider, one swinging away gets thinner.
        node.style.transform = `translate3d(${shift.toFixed(3)}%, 0, 0) scaleX(${(1 + shift * 0.09).toFixed(4)})`;
        node.style.opacity = (glow * lit * 0.8).toFixed(3);
      }

      // Keep going while there is anything to show: the light fading out, or
      // the fabric still settling.
      if (ambient() || lit > 0.002 || gust > 0.002) {
        frame = requestAnimationFrame(step);
      } else {
        frame = 0;
        for (const node of pleats) node.style.opacity = "0";
      }
    };

    const wake = () => {
      if (!frame) frame = requestAnimationFrame(step);
    };

    const onMove = (event: PointerEvent) => {
      const rect = stage.getBoundingClientRect();
      lastPointerX = pointerX;
      pointerX = ((event.clientX - rect.left) / rect.width) * 100;

      // Speed becomes wind. A slow drift barely stirs it; a quick sweep
      // sends a gust along the fabric from wherever the cursor was.
      const speed = Math.abs(pointerX - lastPointerX);
      const strength = Math.min(speed * GUST_FROM_SPEED, GUST_MAX);
      if (strength > gust) {
        gust = strength;
        gustX = pointerX;
      }
      target = 1;
      wake();
    };

    const onEnter = (event: PointerEvent) => {
      touching = event.pointerType !== "mouse";
      const rect = stage.getBoundingClientRect();
      pointerX = ((event.clientX - rect.left) / rect.width) * 100;
      lastPointerX = pointerX;
      target = 1;
      wake();
    };

    const onLeave = () => {
      touching = false;
      target = 0;
      // The gust that was in flight keeps travelling and dies on its own.
      wake();
    };

    // Pointer rather than mouse events: a finger on a touchscreen gets the
    // same light, and a drag across the stage the same wind.
    stage.addEventListener("pointerenter", onEnter);
    stage.addEventListener("pointermove", onMove);
    stage.addEventListener("pointerleave", onLeave);
    stage.addEventListener("pointercancel", onLeave);

    const onVisibility = () => {
      if (ambient()) wake();
    };
    const sight = new IntersectionObserver(([entry]) => {
      onScreen = entry.isIntersecting;
      if (ambient()) wake();
    });

    if (phone) {
      document.addEventListener("visibilitychange", onVisibility);
      sight.observe(stage);
      wake();
    }

    return () => {
      if (frame) cancelAnimationFrame(frame);
      document.removeEventListener("visibilitychange", onVisibility);
      sight.disconnect();
      stage.removeEventListener("pointerenter", onEnter);
      stage.removeEventListener("pointermove", onMove);
      stage.removeEventListener("pointerleave", onLeave);
      stage.removeEventListener("pointercancel", onLeave);
    };
  }, [reducedMotion]);

  if (reducedMotion) return null;

  return (
    <span
      ref={hostRef}
      aria-hidden="true"
      className="landing-shimmer pointer-events-none absolute overflow-hidden"
      style={{
        ...style,
        maskImage: LIGHT_FIELD,
        WebkitMaskImage: LIGHT_FIELD,
      }}
    >
      {Array.from({ length: COUNT }, (_, i) => (
        <span
          key={i}
          className="absolute top-0 block h-full"
          style={{
            left: `${i * PLEAT}%`,
            width: `${PLEAT * LIT}%`,
            // Lit edge to hollow, in the curtain's own two burgundies.
            backgroundImage: `linear-gradient(90deg, ${BURGUNDY_LIT}, ${BURGUNDY})`,
            // Light on fabric, not paint over it.
            mixBlendMode: "screen",
            opacity: 0,
            willChange: "transform, opacity",
          }}
        />
      ))}
    </span>
  );
}
