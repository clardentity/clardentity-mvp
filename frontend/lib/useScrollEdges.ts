import { useCallback } from "react";

/* Marks a scroll box with whether there is more to see past each edge:
 * `data-more-start` (above / to the left) and `data-more-end` (below / to the
 * right). globals.css turns those into soft fades on phones (`scroll-fade-y`,
 * `scroll-fade-x`), so a list that runs on past the screen says so.
 *
 * A callback ref, so it follows the element in and out of the tree - the
 * recents list, for one, only renders once it has items. Attributes rather
 * than state: they change on every scroll and nothing renders from them. */
export function useScrollEdges(axis: "x" | "y") {
  return useCallback(
    (el: HTMLElement | null) => {
      if (!el) return;
      let frame = 0;
      const update = () => {
        frame = 0;
        const at = axis === "y" ? el.scrollTop : Math.abs(el.scrollLeft);
        const max = axis === "y" ? el.scrollHeight - el.clientHeight : el.scrollWidth - el.clientWidth;
        el.toggleAttribute("data-more-start", at > 2);
        el.toggleAttribute("data-more-end", max - at > 2);
      };
      const schedule = () => {
        if (!frame) frame = requestAnimationFrame(update);
      };
      update();
      el.addEventListener("scroll", schedule, { passive: true });
      // the box resizing, or its items arriving / leaving, moves the edges too
      const resize = new ResizeObserver(schedule);
      resize.observe(el);
      const items = new MutationObserver(schedule);
      items.observe(el, { childList: true });
      return () => {
        cancelAnimationFrame(frame);
        el.removeEventListener("scroll", schedule);
        resize.disconnect();
        items.disconnect();
      };
    },
    [axis],
  );
}
