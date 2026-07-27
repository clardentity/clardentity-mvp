"use client";

export type AvatarState = "idle" | "listening" | "thinking" | "speaking" | "reacting";
export type AvatarGesture =
  | "presenting"
  | "chin_stroke"
  | "weighing_scales"
  | "open_hand_explaining"
  | "none";
export type AvatarExpression = "confident" | "thoughtful" | "cautious" | "concerned" | "neutral";

// Arm rotation in degrees, applied around each shoulder. 0 = hanging straight
// down at rest. Positive rotates the arm's tip toward +x (screen right).
const ARM_ANGLES: Record<AvatarGesture, { left: number; right: number }> = {
  none: { left: 0, right: 0 },
  presenting: { left: 0, right: -110 },
  chin_stroke: { left: 0, right: -165 },
  weighing_scales: { left: -95, right: 95 },
  open_hand_explaining: { left: 125, right: -125 },
};

const EXPRESSION_EYEBROW_ROTATION: Record<AvatarExpression, { left: number; right: number }> = {
  neutral: { left: 0, right: 0 },
  confident: { left: -8, right: 8 },
  thoughtful: { left: -4, right: 10 },
  cautious: { left: -18, right: 22 },
  concerned: { left: 20, right: -20 },
};

const MOUTH_PATHS: Record<AvatarExpression, string> = {
  neutral: "M84,90 Q100,92 116,90",
  confident: "M83,86 Q100,102 117,86",
  thoughtful: "M85,90 Q100,94 115,89",
  cautious: "M85,92 Q100,88 115,92",
  concerned: "M84,94 Q100,82 116,94",
};

function Arm({
  shoulderX,
  shoulderY,
  baseAngle,
  wobble,
}: {
  shoulderX: number;
  shoulderY: number;
  baseAngle: number;
  wobble: "left" | "right" | null;
}) {
  return (
    // Outer group: static base pose via the SVG transform attribute only.
    <g transform={`translate(${shoulderX},${shoulderY}) rotate(${baseAngle})`}>
      {/* Inner group: CSS-animated wobble only. Mixing an SVG transform
          attribute with a CSS transform (animation/class) on the *same*
          element makes the CSS one fully replace the attribute rather than
          compose with it - splitting into nested groups keeps both. */}
      <g
        className={wobble ? `avatar-wobble-${wobble}` : undefined}
        style={{ transformOrigin: "0px 0px" }}
      >
        <rect x="-8" y="0" width="16" height="52" rx="8" className="fill-brand" />
        <circle cx="0" cy="56" r="10" className="fill-brand-dark" />
      </g>
    </g>
  );
}

export function AvatarPanel({
  state,
  gesture,
  expression,
}: {
  state: AvatarState;
  gesture: AvatarGesture;
  expression: AvatarExpression;
}) {
  const angles = ARM_ANGLES[gesture] ?? ARM_ANGLES.none;
  const eyebrows = EXPRESSION_EYEBROW_ROTATION[expression] ?? EXPRESSION_EYEBROW_ROTATION.neutral;
  const mouthPath = MOUTH_PATHS[expression] ?? MOUTH_PATHS.neutral;

  const isListening = state === "listening";
  const isSpeaking = state === "speaking";
  const isReacting = state === "reacting";
  const isWeighing = gesture === "weighing_scales" && (state === "thinking" || state === "speaking");

  return (
    <div className="flex items-center justify-center" aria-hidden="true">
      <svg
        viewBox="0 0 200 220"
        className="h-28 w-28"
        role="img"
        aria-label={`Avatar companion: ${state}`}
      >
        <ellipse cx="100" cy="207" rx="42" ry="7" className="fill-slate-900/10 dark:fill-black/30" />

        <g
          style={{
            transform: isListening ? "rotate(-4deg)" : undefined,
            transformOrigin: "100px 150px",
            transition: "transform 0.4s ease",
          }}
        >
          {/* Nested separately from the listening-tilt group above: mixing a
              CSS animation (breathe/react) with a static inline transform on
              the same element hits the same override problem as the arms. */}
          <g className={`avatar-breathe ${isReacting ? "avatar-react" : ""}`}>
            <Arm shoulderX={58} shoulderY={118} baseAngle={angles.left} wobble={isWeighing ? "left" : null} />
            <Arm shoulderX={142} shoulderY={118} baseAngle={angles.right} wobble={isWeighing ? "right" : null} />

            {/* Torso */}
            <rect x="58" y="105" width="84" height="88" rx="38" className="fill-brand" />

            {/* Head */}
            <circle cx="100" cy="66" r="44" className="fill-indigo-100 dark:fill-indigo-200" />

            {/* Face */}
            <g>
              <path
                d="M74,48 Q82,42 90,46"
                className="stroke-slate-700"
                strokeWidth="3"
                strokeLinecap="round"
                fill="none"
                style={{ transform: `rotate(${eyebrows.left}deg)`, transformOrigin: "82px 46px" }}
              />
              <path
                d="M110,46 Q118,42 126,48"
                className="stroke-slate-700"
                strokeWidth="3"
                strokeLinecap="round"
                fill="none"
                style={{ transform: `rotate(${eyebrows.right}deg)`, transformOrigin: "118px 46px" }}
              />

              <ellipse cx="85" cy="62" rx="5" ry="7" className="fill-slate-800 avatar-blink" />
              <ellipse cx="115" cy="62" rx="5" ry="7" className="fill-slate-800 avatar-blink" />

              {isSpeaking ? (
                <ellipse cx="100" cy="88" rx="9" ry="7" className="fill-slate-700 avatar-talk" />
              ) : (
                <path
                  d={mouthPath}
                  className="stroke-slate-700"
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
