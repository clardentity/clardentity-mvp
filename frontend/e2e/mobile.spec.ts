/* Mobile M-nodes. Runs in the `mobile` project: Pixel 5, 375x812, touch.
 * Responsive app - same URLs as web; only the drawer controls differ (see sel).
 * Upstream T-deps are in the table at the end of e2e/README.md. */
import type { Page } from "@playwright/test";
import { test, expect, sel, login, mockApi, seedStorage, signIn, press, thread, tapArea, settleAnimations, KEYS, LIVE } from "./fixtures";

const W = 375;
const H = 812;

/** Side-scroll on the page or inside <main> (the shell's own scroll box, which
 *  scrolls sideways on its own when content is too wide). */
async function horizontalOverflow(page: Page) {
  return page.evaluate(() =>
    Math.max(
      ...[document.documentElement, document.querySelector("main")]
        .filter((e): e is HTMLElement => !!e)
        .map((e) => e.scrollWidth - e.clientWidth),
    ),
  );
}

/** Visible elements whose right edge passes the viewport - the usual cause of side-scroll. */
async function offenders(page: Page) {
  return page.evaluate((w) => {
    return [...document.querySelectorAll<HTMLElement>("body *")]
      .filter((el) => {
        const r = el.getBoundingClientRect();
        if (!r.width || !r.height) return false;
        // ignore content clipped by a scrolling/overflow-hidden ancestor
        for (let p = el.parentElement; p; p = p.parentElement) {
          const o = getComputedStyle(p).overflowX;
          if (o === "hidden" || o === "auto" || o === "scroll" || o === "clip") return false;
        }
        return r.right > w + 1;
      })
      .slice(0, 5)
      .map((el) => `${el.tagName.toLowerCase()}.${[...el.classList].slice(0, 3).join(".")}`);
  }, W);
}

/** A real finger drag (touchStart/Move/End), not a wheel event. */
async function touchSwipe(page: Page, x1: number, y1: number, x2: number, y2: number, steps = 12) {
  const cdp = await page.context().newCDPSession(page);
  const at = (x: number, y: number) => [{ x, y, id: 1 }];
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: at(x1, y1) });
  for (let i = 1; i <= steps; i++)
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove", touchPoints: at(x1 + ((x2 - x1) * i) / steps, y1 + ((y2 - y1) * i) / steps),
    });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await page.waitForTimeout(300);
}

async function openDrawer(page: Page) {
  await press(page, sel.openNav);
  const drawer = page.locator("div.fixed.inset-0.z-40 aside");
  await expect(drawer).toBeVisible();
  return drawer;
}

test.describe("render & layout", () => {
  test("M01 viewport render @M01", async ({ signedIn: page }) => {
    for (const path of ["/workspace", "/login"]) {
      // signed out for /login, or RedirectIfSignedIn sends it on to /start
      if (path === "/login") await page.evaluate((k) => { localStorage.removeItem(k.access); localStorage.removeItem(k.refresh); }, KEYS);
      await page.goto(path);
      // a rendered landmark, not "networkidle": the dev server's HMR socket
      // and polling keep the network busy indefinitely
      await page.locator(path === "/login" ? sel.email : sel.openNav).waitFor();
      expect(page.viewportSize()).toEqual({ width: W, height: H });
      expect(await horizontalOverflow(page), `side-scroll on ${path}: ${await offenders(page)}`).toBeLessThanOrEqual(0);
      const ox = await page.evaluate(() => [getComputedStyle(document.documentElement).overflowX, getComputedStyle(document.body).overflowX]);
      test.info().annotations.push({ type: "overflow-x", description: `${path} html/body: ${ox.join("/")}` });
      const minFont = await page.evaluate(() =>
        Math.min(...[...document.querySelectorAll<HTMLElement>("p, label, input, button, a, h1")]
          .filter((e) => e.offsetParent && e.innerText?.trim())
          .map((e) => parseFloat(getComputedStyle(e).fontSize))),
      );
      expect.soft(minFont, `smallest text on ${path}`).toBeGreaterThanOrEqual(12);
      if (path === "/workspace") await expect(page.locator(sel.openNav)).toBeVisible(); // mobile header, not sidebar
    }
  });

  test("M02 touch targets >= 44px @M02", async ({ signedIn: page }) => {
    await page.goto("/workspace");
    const small: string[] = [];
    // the area a finger can hit (tap areas reach past the drawn box), not the box
    const check = async (scope: string) => {
      for (const el of await page.locator(`${scope} :is(button, a[href]):visible`).all()) {
        const b = await tapArea(el);
        if (b.w < 44 || b.h < 44) {
          const name = (await el.getAttribute("aria-label")) ?? (await el.innerText()).trim().slice(0, 24);
          small.push(`${scope} "${name}" ${b.w}x${b.h}`);
        }
      }
    };
    await check("header");
    // enlarged hit areas must not overlap their neighbours
    const hdr = (await Promise.all((await page.locator("header button:visible").all()).map((el) => el.boundingBox())))
      .filter(Boolean)
      .sort((p, q) => p!.x - q!.x) as { x: number; width: number }[];
    for (let i = 1; i < hdr.length; i++) expect.soft(hdr[i].x).toBeGreaterThanOrEqual(hdr[i - 1].x + hdr[i - 1].width - 1);
    const drawer = await openDrawer(page);
    await check("div.fixed.inset-0.z-40 aside");
    // nav items must not overlap each other
    const boxes = (await Promise.all((await drawer.locator("nav a").all()).map((a) => a.boundingBox()))).filter(Boolean) as { y: number; height: number }[];
    for (let i = 1; i < boxes.length; i++) expect.soft(boxes[i].y).toBeGreaterThanOrEqual(boxes[i - 1].y + boxes[i - 1].height - 1);
    expect(small, small.join("\n")).toEqual([]);
  });
});

test.describe("navigation", () => {
  test("M03 drawer: open/close, focus trap, back @M03", async ({ signedIn: page }) => {
    test.slow(); // many navigations; a dev server under parallel load serves each slowly
    await page.goto("/workspace");
    const drawer = await openDrawer(page);
    await press(page, sel.closeNav);
    await expect(drawer).toBeHidden();

    await openDrawer(page);
    // the drawer covers the backdrop's centre; tap the strip to its right
    await page.locator(sel.navBackdrop).tap({ position: { x: W - 20, y: H / 2 } });
    await expect(drawer).toBeHidden();

    // a11y: modal semantics + focus stays inside while open
    await openDrawer(page);
    await expect.soft(page.locator('[role="dialog"][aria-modal="true"]'), "drawer has no dialog/aria-modal").toHaveCount(1);
    let escaped = 0;
    for (let i = 0; i < 25; i++) {
      await page.keyboard.press("Tab");
      if (!(await page.evaluate(() => !!document.activeElement?.closest("div.fixed.inset-0.z-40")))) escaped++;
    }
    expect.soft(escaped, "focus left the open drawer on Tab").toBe(0);
    await page.keyboard.press("Escape");
    await expect.soft(drawer, "Escape should close the drawer").toBeHidden();

    // Android/hardware Back while open should close the drawer, not leave the page
    await page.goto("/workspace");
    await openDrawer(page);
    await page.goBack();
    await expect.soft(page, "Back with drawer open navigated away").toHaveURL(/\/workspace$/);

    // Back after navigating through the drawer returns to where we were
    // (from a workspace, so Search goes somewhere other than this page)
    await page.goto("/workspace/w1");
    const d = await openDrawer(page);
    await d.getByRole("link", { name: "Search" }).tap();
    await expect(page).toHaveURL(/\/workspace\/w1\/search$/, { timeout: 15_000 }); // first hit compiles the route in dev
    await page.goBack();
    await expect(page).toHaveURL(/\/workspace\/w1$/, { timeout: 15_000 });
  });
});

test.describe("auth & core", () => {
  test("M04 login on mobile -> /chat @M04 @critical", async ({ app: page }) => {
    await page.goto("/login");
    await page.locator(sel.email).tap();
    await expect(page.locator(sel.email)).toBeFocused();
    await expect(page.locator(sel.email)).toHaveAttribute("inputmode", "email"); // email keyboard
    await page.locator(sel.email).fill(process.env.E2E_EMAIL ?? "e2e@clardentity.test");
    await page.locator(sel.password).tap();
    await page.locator(sel.password).fill(process.env.E2E_PASSWORD ?? "e2e-password");
    // keyboard open: shrink the viewport like the visual viewport does
    await page.setViewportSize({ width: W, height: 480 });
    await page.waitForTimeout(300);
    await page.locator(sel.loginSubmit).scrollIntoViewIfNeeded();
    await expect(page.locator(sel.loginSubmit)).toBeInViewport();
    await press(page, sel.loginSubmit);
    await page.waitForURL(/\/(start|chat\/)/);
    await page.setViewportSize({ width: W, height: H });
  });

  test("M05 workspace cards scale, no cut-off @M05 @critical", async ({ signedIn: page }) => {
    await page.goto("/workspace");
    const cards = page.locator('a[href^="/workspace/w"]');
    await expect(cards.first()).toBeVisible();
    for (const c of await cards.all()) {
      const b = (await c.boundingBox())!;
      expect(b.x).toBeGreaterThanOrEqual(0);
      expect(b.x + b.width).toBeLessThanOrEqual(W);
    }
    // long name truncates inside its card instead of pushing it wider
    const long = page.locator("span.truncate", { hasText: "deliberately long name" });
    expect(await long.evaluate((e) => e.scrollWidth > e.clientWidth && getComputedStyle(e).textOverflow === "ellipsis")).toBe(true);
    // state change visible: Create opens the inline composer
    await press(page, sel.wsCreate);
    await expect(page.locator(sel.wsName)).toBeVisible();
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
  });

  test("M06 form + keyboard: submit stays reachable @M06 @critical", async ({ signedIn: page }) => {
    await page.goto("/workspace");
    await press(page, sel.wsCreate);
    const input = page.locator(sel.wsName);
    await expect(input).toBeFocused();
    await page.setViewportSize({ width: W, height: 480 }); // keyboard up
    await page.waitForTimeout(300);
    await expect(page.locator(sel.wsSubmit)).toBeInViewport();
    await expect(page.locator(sel.wsSubmit)).toBeDisabled(); // validation: empty name
    await input.fill("Mobile workspace");
    await expect(page.locator(sel.wsSubmit)).toBeEnabled();
    await press(page, sel.wsSubmit);
    await expect(page.getByText("Mobile workspace")).toBeVisible();
    await page.setViewportSize({ width: W, height: H });
  });

  test("M07 network error in mobile layout @M07", async ({ page }) => {
    test.skip(LIVE, "uses the network mock");
    await mockApi(page, { failWorkspaces: true });
    await seedStorage(page, { signedIn: true });
    await page.goto("/workspace");
    const banner = page.locator(sel.errorBanner).first();
    await expect(banner).toBeVisible();
    await expect(banner).not.toBeEmpty();
    const b = (await banner.boundingBox())!;
    expect(b.x + b.width).toBeLessThanOrEqual(W);
    await expect(page.locator(sel.openNav)).toBeVisible(); // shell intact, not a white screen
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
  });
});

test.describe("scroll & gestures", () => {
  test("M08 scroll + sticky header doesn't cover inputs @M08", async ({ page }) => {
    if (!LIVE) await mockApi(page, { extraWorkspaces: 12 });
    await seedStorage(page, { signedIn: !LIVE });
    if (LIVE) await login(page);
    await page.goto("/workspace");
    await expect(page.locator('a[href^="/workspace/x11"]')).toBeAttached();
    const main = page.locator("main");
    const top = await main.evaluate((m) => m.scrollHeight > m.clientHeight);
    expect(top, "content should overflow and scroll at 812h").toBe(true);
    await main.evaluate((m) => m.scrollTo(0, m.scrollHeight));
    await expect(page.locator('a[href^="/workspace/x11"]')).toBeInViewport();
    const header = (await page.locator(sel.header).boundingBox())!;
    expect(header.y).toBe(0); // stays put while main scrolls
    await main.evaluate((m) => m.scrollTo(0, 0));
    await press(page, sel.wsCreate);
    const input = (await page.locator(sel.wsName).boundingBox())!;
    expect(input.y).toBeGreaterThanOrEqual(header.y + header.height);
  });

  test("M09 orientation portrait <-> landscape @M09", async ({ signedIn: page }) => {
    await page.goto("/workspace");
    for (const vp of [{ width: H, height: W }, { width: W, height: H }]) {
      await page.setViewportSize(vp);
      await page.waitForTimeout(300);
      expect(await horizontalOverflow(page), `${vp.width}x${vp.height}`).toBeLessThanOrEqual(0);
      await expect(page.locator(sel.openNav)).toBeVisible(); // < lg (1024): still the drawer
      const drawer = await openDrawer(page);
      const b = (await drawer.boundingBox())!;
      expect(b.height).toBeLessThanOrEqual(vp.height + 1);
      expect(b.width).toBeLessThan(vp.width);
      await press(page, sel.closeNav);
    }
  });

  test("M10 vertical swipe still scrolls @M10", async ({ page, browserName }) => {
    // The finger drag is driven through CDP (Input.dispatchTouchEvent), which
    // only Chromium has; synthetic TouchEvents in WebKit don't move native scroll.
    test.skip(browserName === "webkit", "WebKit: no CDP touch input - real-device check (see Mv.md)");
    if (!LIVE) await mockApi(page, { extraWorkspaces: 12 });
    await seedStorage(page, { signedIn: !LIVE });
    if (LIVE) await login(page);
    await page.goto("/workspace");
    await expect(page.locator('a[href^="/workspace/x11"]')).toBeAttached();
    await touchSwipe(page, 180, 650, 180, 250);
    expect(await page.locator("main").evaluate((m) => m.scrollTop)).toBeGreaterThan(0);
  });

});

test("M11 logout from drawer clears session @M11 @critical", async ({ signedIn: page }) => {
  await page.goto("/workspace");
  await openDrawer(page);
  await press(page, `div.fixed.inset-0.z-40 ${sel.accountMenu}`);
  await press(page, sel.logout);
  // the redirect is a client navigation; in dev, under parallel load, the
  // /login payload alone has taken up to ~10s to arrive
  await expect(page).toHaveURL(/\/login/, { timeout: 15_000 });
  await expect(page.locator(sel.email)).toBeVisible();
  const tokens = await page.evaluate((k) => [localStorage.getItem(k.access), localStorage.getItem(k.refresh)], KEYS);
  expect(tokens).toEqual([null, null]);
});

test("M02b recent chats: 36px rows and options button on touch, no overlap @M02", async ({ page }) => {
  const recents = ["Budget planning for Q4", "Should I take the offer?", "Learning Spanish verbs", "Logo ideas"]
    .map((title, i) => ({ id: `r${i}`, title, created_at: "2026-10-01T10:00:00Z", pinned: false }));
  await signIn(page, { handlers: { "GET /chat/conversations": () => ({ body: recents }) } });
  await page.goto("/workspace/w1");
  await press(page, sel.openNav);
  const drawer = page.locator(sel.drawer);
  const rows = drawer.locator('a[href^="/chat/r"]');
  await expect(rows).toHaveCount(4, { timeout: 30_000 });
  await settleAnimations(page); // the rows rise in, staggered; measure them at rest
  const boxes = [];
  for (const row of await rows.all()) {
    const b = (await row.boundingBox())!;
    expect(Math.round(b.height), "recents row height").toBeGreaterThanOrEqual(36);
    boxes.push(b);
  }
  for (let i = 1; i < boxes.length; i++) expect(boxes[i].y).toBeGreaterThanOrEqual(boxes[i - 1].y + boxes[i - 1].height - 1);
  for (const kebab of await drawer.getByRole("button", { name: /^Options for/ }).all()) {
    const b = (await kebab.boundingBox())!;
    expect(Math.min(Math.round(b.width), Math.round(b.height)), "options button").toBeGreaterThanOrEqual(36);
  }
});

/** A finger drag on the open drawer, as the pointer events it listens for.
 *  Dispatched in the page so it runs in WebKit too. `from` picks where it starts. */
async function swipeDrawer(page: Page, dx: number, dy = 0, from = "") {
  await page.locator(from || sel.drawer).first().evaluate(async (el, [dx, dy]) => {
    const r = el.getBoundingClientRect();
    const x0 = r.left + Math.min(r.width - 10, 150);
    const y0 = r.top + Math.min(r.height / 2, 300);
    const fire = (type: string, i: number) =>
      el.dispatchEvent(new PointerEvent(type, {
        bubbles: true, cancelable: true, pointerType: "touch", pointerId: 9, isPrimary: true,
        clientX: x0 + (dx * i) / 10, clientY: y0 + (dy * i) / 10,
      }));
    fire("pointerdown", 0);
    for (let i = 1; i <= 10; i++) {
      fire("pointermove", i);
      await new Promise((res) => setTimeout(res, 16));
    }
    fire("pointerup", 10);
  }, [dx, dy]);
  await page.waitForTimeout(400); // slide + the 180ms close
}

test("M03b swipe left closes the menu; short or vertical drags don't; no swipe-to-open @M03", async ({ page, browserName }) => {
  const recents = ["Budget planning for Q4", "Logo ideas"].map((title, i) => ({ id: `r${i}`, title, created_at: "2026-10-01T10:00:00Z" }));
  await signIn(page, { handlers: { "GET /chat/conversations": () => ({ body: recents }) } });
  await page.goto("/workspace/w1");
  const drawer = page.locator(sel.drawer);

  await press(page, sel.openNav);
  await expect(drawer).toBeVisible();
  await swipeDrawer(page, -40); // short: springs back
  await expect(drawer).toBeVisible();
  await expect.poll(() => drawer.evaluate((el) => el.getBoundingClientRect().left)).toBeGreaterThanOrEqual(-1);
  await swipeDrawer(page, -20, 160); // mostly vertical: a scroll, not a swipe
  await expect(drawer).toBeVisible();

  // started on a link: closes, and the link does not open
  await swipeDrawer(page, -200, 0, `${sel.drawer} a[href^="/chat/r"]`);
  await expect(drawer).toBeHidden();
  await expect(page).toHaveURL(/\/workspace\/w1$/);
  // the drawer's history entry was spent: Back now leaves normally, not into a ghost
  expect(await page.evaluate(() => history.state?.clardentityDrawer ?? null)).toBeNull();

  // reopens fully (no leftover offset), and a quick flick also closes
  await press(page, sel.openNav);
  await expect.poll(() => drawer.evaluate((el) => el.getBoundingClientRect().left)).toBeGreaterThanOrEqual(-1);
  await swipeDrawer(page, -200);
  await expect(drawer).toBeHidden();

  // no edge-swipe to open (iOS Back gesture lives there)
  await page.locator("main").evaluate((el) => {
    const fire = (type: string, x: number) =>
      el.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerType: "touch", pointerId: 3, clientX: x, clientY: 400 }));
    fire("pointerdown", 2); fire("pointermove", 120); fire("pointerup", 200);
  });
  await page.waitForTimeout(300);
  await expect(drawer).toBeHidden();

  // Chromium: a real finger drag through CDP, end to end, starting over the
  // recents list - a scroll box, where touch-action once let the browser
  // cancel the swipe (synthetic events can't see that; real touch can)
  if (browserName === "chromium") {
    await press(page, sel.openNav);
    await expect(drawer).toBeVisible();
    const cdp = await page.context().newCDPSession(page);
    const y = await drawer.locator('a[href^="/chat/r"]').first().evaluate((el) => el.getBoundingClientRect().top + 10);
    const at = (x: number) => [{ x, y, id: 1 }];
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: at(200) });
    for (let i = 1; i <= 10; i++) await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: at(200 - i * 18) });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await expect(drawer).toBeHidden();
  }
});

test("M28 tour on a phone: ring on its target, card on screen, phone wording @M28", async ({ page }) => {
  test.setTimeout(60_000); // first visit compiles the chat route, then three steps
  await signIn(page, { messages: thread(2) });
  await page.goto("/chat/c1");
  await expect(page.locator(sel.composer)).toBeEditable({ timeout: 30_000 });
  await page.getByRole("button", { name: "Show me around this page" }).tap();
  const targets: Record<string, string> = { "Choose how it thinks": "mode-picker", "Smart switching": "switching-toggle", "Ask here": "composer-input" };
  for (let step = 0; step < 3; step++) {
    const card = page.getByRole("dialog").filter({ has: page.getByRole("button", { name: "Next", exact: true }) });
    await expect(card).toBeVisible();
    await page.waitForTimeout(400); // scrollIntoView + the ring's RAF settle
    const m = await page.evaluate((targets) => {
      const ring = [...document.querySelectorAll<HTMLElement>('div[aria-hidden="true"]')].find((d) => d.style.boxShadow.includes("9999px"));
      const title = document.querySelector('[role="dialog"] h2')?.textContent ?? "";
      const target = [...document.querySelectorAll(`[data-tour="${targets[title]}"]`)].find((e) => e.getBoundingClientRect().width > 0);
      const dlg = document.querySelector('[role="dialog"] h2')!.closest('[role="dialog"]')!.getBoundingClientRect();
      const r = ring!.getBoundingClientRect();
      const t = target!.getBoundingClientRect();
      return { title, dx: r.left - t.left, dy: r.top - t.top, dw: r.width - t.width, dh: r.height - t.height, dlgL: dlg.left, dlgR: dlg.right, vw: innerWidth };
    }, targets);
    // the ring wraps its target with a few px of halo - never 15% away from it
    for (const k of ["dx", "dy"] as const) expect(Math.abs(m[k]), `${m.title}: ring ${k}`).toBeLessThanOrEqual(8);
    for (const k of ["dw", "dh"] as const) expect(Math.abs(m[k]), `${m.title}: ring ${k}`).toBeLessThanOrEqual(12);
    expect(m.dlgL, `${m.title}: card off the left edge`).toBeGreaterThanOrEqual(0);
    expect(m.dlgR, `${m.title}: card off the right edge`).toBeLessThanOrEqual(m.vw);
    if (m.title === "Ask here") await expect(card).toContainText("tap the arrow to send"); // not "Enter sends it"
    await card.getByRole("button", { name: "Next", exact: true }).click();
  }
});

test("M29 companion floats over the thread on a phone - no band across the chat @M29", async ({ page }) => {
  await signIn(page, { messages: thread(3) });
  await page.goto("/chat/c1");
  await expect(page.locator(sel.composer)).toBeEditable({ timeout: 30_000 });
  const avatar = page.locator('[data-tour="companion"]');
  await expect(avatar).toBeVisible();
  // the composer is ready before the thread arrives; measure against the thread
  await expect(page.locator(sel.message).last()).toBeVisible();
  const r = await page.evaluate(() => {
    const a = document.querySelector('[data-tour="companion"]')!;
    const row = a.parentElement!;
    const list = document.querySelector('[data-testid="message-list"]')!.getBoundingClientRect();
    const b = a.getBoundingClientRect();
    return { rowPos: getComputedStyle(row).position, rowBg: getComputedStyle(row).backgroundColor, overList: b.top < list.bottom, rowWidth: row.getBoundingClientRect().width };
  });
  expect(r.rowPos).toBe("absolute"); // takes no row of its own
  expect(r.rowBg).toMatch(/rgba\(0, 0, 0, 0\)|transparent/); // nothing behind the figure
  expect(r.overList).toBe(true); // sits over the end of the thread
});

test("M30 tapping Clardentity at the top of the menu goes home @M30", async ({ signedIn: page }) => {
  await page.goto("/workspace");
  await press(page, sel.openNav);
  const home = page.locator(sel.drawer).getByRole("link", { name: "Clardentity" });
  await expect(home).toHaveAttribute("href", "/");
  // the five-dot mark sits before the name, as in the desktop sidebar
  const mark = (await home.locator('[aria-hidden="true"]').first().boundingBox())!;
  const link = (await home.boundingBox())!;
  expect(mark.width).toBeGreaterThan(10);
  expect(mark.x).toBeLessThan(link.x + 12);
  await home.tap();
  await expect(page).toHaveURL(/\/$/, { timeout: 15_000 });
  await expect(page.locator(sel.drawer)).toHaveCount(0);
});

/** Index of the brightest curtain pleat (the light's position), or -1 if dark. */
const lightAt = (page: Page) =>
  page.evaluate(() => {
    const pleats = [...document.querySelectorAll<HTMLElement>(".landing-shimmer > span")];
    let best = -1;
    let max = 0.02;
    pleats.forEach((p, i) => {
      const o = Number(p.style.opacity || 0);
      if (o > max) [max, best] = [o, i];
    });
    return best;
  });

test("M31 home curtain on a phone: lit without hover, moves as a wave, no tilt, rests off-screen @M31", async ({ app: page }) => {
  test.setTimeout(60_000);
  await page.goto("/");
  await expect(page.locator(".landing-shimmer")).toBeAttached({ timeout: 30_000 });

  // lit by itself - no pointer, no sensor
  await expect.poll(() => lightAt(page), { timeout: 5_000 }).toBeGreaterThanOrEqual(0);
  // a travelling wave: the brightest fold moves along, and the folds sway
  const a = await lightAt(page);
  await expect.poll(() => lightAt(page), { message: "the light travels with the wave", timeout: 8_000 }).not.toBe(a);
  const sway = () => page.locator(".landing-shimmer > span").nth(10).evaluate((el) => (el as HTMLElement).style.transform);
  const t0 = await sway();
  await expect.poll(sway, { message: "the folds sway", timeout: 3_000 }).not.toBe(t0);

  // tilt does nothing any more: the wave keeps its own course
  await page.evaluate(() => window.dispatchEvent(new Event("deviceorientation")));
  await expect(page.locator(".landing-shimmer")).toBeAttached();

  // scrolled away: the loop stops and the light goes out
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await expect.poll(() => lightAt(page), { timeout: 4_000 }).toBe(-1);
});
