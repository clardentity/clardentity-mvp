/* The interface is drawn at 85% on every screen, phones included - see the
 * --ui-zoom block in globals.css for why.
 *
 * That is a CSS zoom on the root, which leaves one seam for scripts to fall
 * into: a measured rect and an inline `top`/`left` may not be in the same
 * pixels. Measure something, put a panel where it is, and the panel can land
 * 15% further down and right than the thing it points at.
 *
 * Which way round it is depends on the engine. Chromium (and current WebKit
 * on desktop) answers getBoundingClientRect() in screen pixels, already
 * zoomed, so a rect has to be divided by the zoom before it's used as a
 * style. iOS WebKit still has the older zoom, which answers in the zoomed
 * layout's own pixels - divide there and every tour ring and popover lands
 * 15% off, which is exactly what iPhones showed. So the factor isn't assumed
 * from the zoom value: it's measured, once, from a box of known size.
 *
 * Anything that measures and then positions converts here.
 */

/** What the root is zoomed to: 0.85 (0.92 on touch phones), or 1 where the
 *  property is missing. */
export function uiZoom(): number {
  if (typeof document === "undefined") return 1;
  const raw = getComputedStyle(document.documentElement).zoom;
  const value = Number.parseFloat(raw);
  return Number.isFinite(value) && value > 0 ? value : 1;
}

type Measured = { scale: number; width: number; height: number };
let measured: Measured | null = null;

if (typeof window !== "undefined") {
  // Rotation and resizing change the viewport; the scale itself is fixed per
  // engine, but re-measuring both together keeps this one code path.
  window.addEventListener("resize", () => (measured = null));
}

/** How measured rects relate to inline-style pixels, and the viewport in
 *  inline-style pixels - both read off real boxes rather than assumed. */
function measure(): Measured {
  if (measured) return measured;
  if (typeof document === "undefined" || !document.body) {
    const z = uiZoom();
    return { scale: z, width: 0, height: 0 };
  }
  const probe = (css: string) => {
    const el = document.createElement("div");
    el.style.cssText = `position:fixed;visibility:hidden;pointer-events:none;${css}`;
    document.body.appendChild(el);
    const rect = el.getBoundingClientRect();
    el.remove();
    return rect;
  };
  const unit = probe("left:0;top:0;width:100px;height:100px");
  const view = probe("inset:0");
  // 85 on engines that report screen pixels, 100 on those that don't
  const scale = unit.width > 0 ? unit.width / 100 : uiZoom();
  measured = { scale, width: view.width / scale, height: view.height / scale };
  return measured;
}

/** Divide a measured length (a rect, or a pointer's clientX travel) by this
 *  to get inline-style pixels. 0.85 or 1 depending on the engine - see above. */
export function rectScale(): number {
  return measure().scale;
}

/** A measured rectangle, in the pixels an inline style is written in. */
export function toLayoutRect(rect: DOMRect): {
  top: number;
  left: number;
  width: number;
  height: number;
  bottom: number;
  right: number;
} {
  const s = measure().scale;
  return {
    top: rect.top / s,
    left: rect.left / s,
    width: rect.width / s,
    height: rect.height / s,
    bottom: rect.bottom / s,
    right: rect.right / s,
  };
}

/** The window, in the same pixels - what to clamp a panel against. */
export function layoutViewport(): { width: number; height: number } {
  const m = measure();
  if (m.width > 0) return { width: m.width, height: m.height };
  const z = uiZoom();
  return { width: window.innerWidth / z, height: window.innerHeight / z };
}
