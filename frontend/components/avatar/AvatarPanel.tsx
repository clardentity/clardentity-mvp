"use client";

import { useEffect, useId, useState } from "react";
import { cx } from "@/components/ui/primitives";

export type AvatarState = "idle" | "listening" | "thinking" | "speaking" | "reacting";
export type AvatarGesture =
  | "presenting"
  | "chin_stroke"
  | "weighing_scales"
  | "open_hand_explaining"
  | "wave"
  | "none";
export type AvatarExpression = "confident" | "thoughtful" | "cautious" | "concerned" | "neutral";

/* Rendered as gradient-shaded SVG rather than a real 3D scene. A WebGL
 * companion would mean shipping a renderer, a GPU context and an animation
 * loop for something that sits at 40px in the corner of a chat - so the depth
 * here comes from three-stop radial gradients, a specular highlight and a
 * contact shadow instead. It costs one inline <svg>, no JS frame loop, and no
 * dependency; the CSS animations are the only moving parts and they all stop
 * under prefers-reduced-motion.
 */

// Arm rotation in degrees, applied around each shoulder. 0 = hanging straight
// down at rest. SVG rotate() is clockwise, so a *positive* angle swings the
// arm's tip toward screen LEFT - the opposite of what the sign reads like.
// Outward means positive on the left arm and negative on the right.
const ARM_ANGLES: Record<AvatarGesture, { left: number; right: number }> = {
  none: { left: 14, right: -14 },
  presenting: { left: 14, right: -105 },
  // Reaches up and across to the chin rather than out to the side.
  chin_stroke: { left: 14, right: 131 },
  weighing_scales: { left: 100, right: -100 },
  open_hand_explaining: { left: 128, right: -128 },
  wave: { left: 14, right: -145 },
};

/* An idle companion that holds one pose is indistinguishable from a broken
 * one, so when there is nothing specific to show it works through these
 * instead - opening on a wave, the way a chat app greets you, then settling
 * into small shifts of attention. Each pose transitions rather than snapping. */
const IDLE_CYCLE: Array<{ gesture: AvatarGesture; expression: AvatarExpression }> = [
  { gesture: "wave", expression: "confident" },
  { gesture: "none", expression: "neutral" },
  { gesture: "chin_stroke", expression: "thoughtful" },
  { gesture: "none", expression: "confident" },
  { gesture: "presenting", expression: "neutral" },
  { gesture: "none", expression: "neutral" },
  { gesture: "open_hand_explaining", expression: "confident" },
  { gesture: "none", expression: "thoughtful" },
];

const IDLE_POSE_MS = 3800;

const EXPRESSION_EYEBROW_ROTATION: Record<AvatarExpression, { left: number; right: number }> = {
  neutral: { left: 0, right: 0 },
  confident: { left: -8, right: 8 },
  thoughtful: { left: -4, right: 10 },
  cautious: { left: -16, right: 20 },
  concerned: { left: 18, right: -18 },
};

const MOUTH_PATHS: Record<AvatarExpression, string> = {
  neutral: "M89,92 Q100,99 111,92",
  confident: "M87,89 Q100,104 113,89",
  thoughtful: "M90,93 Q100,97 110,91",
  cautious: "M90,95 Q100,90 110,95",
  concerned: "M89,97 Q100,86 111,97",
};

function Arm({
  shoulderX,
  shoulderY,
  baseAngle,
  wobble,
  fill,
  handFill,
}: {
  shoulderX: number;
  shoulderY: number;
  baseAngle: number;
  wobble: "left" | "right" | "wave" | null;
  fill: string;
  handFill: string;
}) {
  return (
    // Outer group: static base pose via the SVG transform attribute only.
    // The transition is what turns the idle cycle into movement rather than a
    // slideshow - `transform` is a real CSS property on SVG elements, so an
    // attribute change animates.
    <g
      transform={`translate(${shoulderX},${shoulderY}) rotate(${baseAngle})`}
      style={{ transition: "transform 0.7s cubic-bezier(0.34, 1.2, 0.64, 1)" }}
    >
      {/* Inner group: CSS-animated wobble only. Mixing an SVG transform
          attribute with a CSS transform (animation/class) on the *same*
          element makes the CSS one fully replace the attribute rather than
          compose with it - splitting into nested groups keeps both. */}
      <g
        className={wobble ? `avatar-wobble-${wobble}` : undefined}
        style={{ transformOrigin: "0px 0px" }}
      >
        <rect x="-7" y="-7" width="14" height="46" rx="7" fill={fill} />
        <circle cx="0" cy="43" r="9" fill={handFill} />
        {/* Rim light down the arm, the cheapest possible cue that it's round. */}
        <rect x="-4" y="-2" width="2.5" height="34" rx="1.25" fill="var(--avatar-body-lit)" opacity="0.5" />
      </g>
    </g>
  );
}

export function AvatarPanel({
  state,
  gesture,
  expression,
  className,
}: {
  state: AvatarState;
  gesture: AvatarGesture;
  expression: AvatarExpression;
  className?: string;
}) {
  // Gradient ids must be unique per instance or a second avatar on the page
  // silently repaints the first one's fills.
  const uid = useId().replace(/:/g, "");
  const id = (name: string) => `${name}-${uid}`;

  // Only take over when the caller has nothing of its own to show. A cue
  // carried over from the last answer is real information; overwriting it with
  // decoration would throw that away.
  const idling = state === "idle" && gesture === "none";
  const [idleStep, setIdleStep] = useState(0);

  useEffect(() => {
    if (!idling) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const timer = setInterval(() => setIdleStep((step) => step + 1), IDLE_POSE_MS);
    return () => clearInterval(timer);
  }, [idling]);

  const idlePose = idling ? IDLE_CYCLE[idleStep % IDLE_CYCLE.length] : null;
  const activeGesture = idlePose ? idlePose.gesture : gesture;
  const activeExpression = idlePose ? idlePose.expression : expression;

  const angles = ARM_ANGLES[activeGesture] ?? ARM_ANGLES.none;
  const eyebrows =
    EXPRESSION_EYEBROW_ROTATION[activeExpression] ?? EXPRESSION_EYEBROW_ROTATION.neutral;
  const mouthPath = MOUTH_PATHS[activeExpression] ?? MOUTH_PATHS.neutral;

  const isListening = state === "listening";
  const isThinking = state === "thinking";
  const isSpeaking = state === "speaking";
  const isReacting = state === "reacting";
  const isWeighing =
    activeGesture === "weighing_scales" && (isThinking || isSpeaking);
  const isWaving = activeGesture === "wave";

  return (
    <div className="flex items-center justify-center" aria-hidden="true">
      <svg
        viewBox="0 0 200 230"
        className={cx("h-10 w-10", className)}
        role="img"
        aria-label={`Avatar companion: ${state}`}
      >
        <defs>
          {/* Light source sits up and to the left, consistently on every part. */}
          <radialGradient id={id("head")} cx="34%" cy="26%" r="78%">
            <stop offset="0%" stopColor="var(--avatar-skin-lit)" />
            <stop offset="52%" stopColor="var(--avatar-skin)" />
            <stop offset="100%" stopColor="var(--avatar-skin-shade)" />
          </radialGradient>
          <radialGradient id={id("body")} cx="32%" cy="18%" r="92%">
            <stop offset="0%" stopColor="var(--avatar-body-lit)" />
            <stop offset="55%" stopColor="var(--brand)" />
            <stop offset="100%" stopColor="var(--brand-dark)" />
          </radialGradient>
          <linearGradient id={id("arm")} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="var(--avatar-body-lit)" />
            <stop offset="65%" stopColor="var(--brand)" />
            <stop offset="100%" stopColor="var(--brand-dark)" />
          </linearGradient>
          <radialGradient id={id("shadow")} cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="var(--avatar-shadow)" />
            <stop offset="100%" stopColor="var(--avatar-shadow)" stopOpacity="0" />
          </radialGradient>
        </defs>

        {/* Contact shadow: soft and elliptical, so the figure sits on a surface
            instead of floating on the panel. */}
        <ellipse cx="100" cy="214" rx="52" ry="11" fill={`url(#${id("shadow")})`} />

        <g
          style={{
            transform: isListening ? "rotate(-5deg)" : undefined,
            transformOrigin: "100px 150px",
            transition: "transform 0.4s ease",
          }}
        >
          {/* Nested separately from the listening-tilt group above: mixing a
              CSS animation (breathe/react) with a static inline transform on
              the same element hits the same override problem as the arms. */}
          <g className={cx("avatar-breathe", isReacting && "avatar-react")}>
            {/* Body: a wide, short capsule reads as chubby and friendly, where
                the previous tall rectangle read as a torso in a suit. */}
            <path
              d="M100,112 C132,112 148,132 148,158 C148,184 128,199 100,199 C72,199 52,184 52,158 C52,132 68,112 100,112 Z"
              fill={`url(#${id("body")})`}
            />
            {/* Specular streak on the body's upper left. */}
            <ellipse cx="76" cy="136" rx="13" ry="19" fill="var(--avatar-skin-lit)" opacity="0.22"
              transform="rotate(-22 76 136)" />

            {/* Arms sit in front of the body and hang from outside its
                silhouette. Drawn behind it, every raised gesture - the whole
                point of them - disappeared into the torso. */}
            <Arm
              shoulderX={54}
              shoulderY={132}
              baseAngle={angles.left}
              wobble={isWeighing ? "left" : null}
              fill={`url(#${id("arm")})`}
              handFill="var(--avatar-skin)"
            />
            <Arm
              shoulderX={146}
              shoulderY={132}
              baseAngle={angles.right}
              wobble={isWaving ? "wave" : isWeighing ? "right" : null}
              fill={`url(#${id("arm")})`}
              handFill="var(--avatar-skin)"
            />

            {/* Head: oversized relative to the body - the single biggest lever
                on whether a character reads as cute. */}
            <circle cx="100" cy="74" r="52" fill={`url(#${id("head")})`} />
            {/* Glossy highlight, the "3D" tell. */}
            <ellipse cx="78" cy="48" rx="17" ry="12" fill="#ffffff" opacity="0.55"
              transform="rotate(-28 78 48)" />

            {/* Antenna - a small idle-life detail so the figure never looks
                switched off, and it doubles as the thinking indicator. */}
            <path d="M100,26 L100,16" stroke="var(--brand-dark)" strokeWidth="4" strokeLinecap="round" />
            <circle
              cx="100"
              cy="11"
              r="6.5"
              fill="var(--brand)"
              className={isThinking ? "avatar-antenna-pulse" : undefined}
            />

            <g>
              <path
                d="M72,58 Q81,52 90,56"
                stroke="var(--avatar-face)"
                strokeWidth="3.5"
                strokeLinecap="round"
                fill="none"
                style={{ transform: `rotate(${eyebrows.left}deg)`, transformOrigin: "81px 55px" }}
              />
              <path
                d="M110,56 Q119,52 128,58"
                stroke="var(--avatar-face)"
                strokeWidth="3.5"
                strokeLinecap="round"
                fill="none"
                style={{ transform: `rotate(${eyebrows.right}deg)`, transformOrigin: "119px 55px" }}
              />

              {/* Big glossy eyes. The two specular dots per eye are what make
                  them look wet and alive rather than like drilled holes. */}
              <g className="avatar-blink" style={{ transformOrigin: "100px 74px" }}>
                <ellipse cx="82" cy="74" rx="8.5" ry="10.5" fill="var(--avatar-face)" />
                <ellipse cx="118" cy="74" rx="8.5" ry="10.5" fill="var(--avatar-face)" />
                <circle cx="79" cy="70" r="3.2" fill="#ffffff" opacity="0.95" />
                <circle cx="115" cy="70" r="3.2" fill="#ffffff" opacity="0.95" />
                <circle cx="85" cy="79" r="1.6" fill="#ffffff" opacity="0.6" />
                <circle cx="121" cy="79" r="1.6" fill="#ffffff" opacity="0.6" />
              </g>

              <ellipse cx="68" cy="88" rx="7" ry="4.5" fill="var(--avatar-blush)" opacity="0.5" />
              <ellipse cx="132" cy="88" rx="7" ry="4.5" fill="var(--avatar-blush)" opacity="0.5" />

              {isSpeaking ? (
                <ellipse
                  cx="100"
                  cy="94"
                  rx="8"
                  ry="6.5"
                  fill="var(--avatar-face)"
                  className="avatar-talk"
                  style={{ transformOrigin: "100px 94px" }}
                />
              ) : (
                <path
                  d={mouthPath}
                  stroke="var(--avatar-face)"
                  strokeWidth="3.5"
                  strokeLinecap="round"
                  fill="none"
                />
              )}
            </g>
          </g>
        </g>
      </svg>
    </div>
  );
}
