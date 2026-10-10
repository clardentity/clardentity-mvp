/* Phone layout, second batch (M32-M47): the error screens, the rest of the
 * Mv.md checklist, and the routes/components the graphify coverage map found
 * untested (/welcome, /privacy, /terms, the consent banner, feedback). */
import http from "node:http";
import type { AddressInfo } from "node:net";
import type { Page } from "@playwright/test";
import { test, expect, sel, signIn, mockApi, seedStorage, hideDevOverlay, press, thread, sseBody, horizontalOverflow, tapArea, expectTappable, API, KEYS } from "./fixtures";

test.describe.configure({ timeout: 60_000 });

async function openChat(page: Page) {
  await page.goto("/chat/c1");
  await expect(page.locator(sel.composer)).toBeEditable({ timeout: 30_000 });
}

test.describe("error screens", () => {
  test("M32 one broken answer: inline box, rest of the chat works, report flow @M32", async ({ page, browserName }) => {
    const t = thread(2);
    (t[3] as Record<string, unknown>).claims = null; // bad data from the server: this answer throws
    const sent: string[] = [];
    // PostHog drops events from automated browsers (navigator.webdriver);
    // look like a person's phone so the report is actually sent here.
    await page.addInitScript(() => Object.defineProperty(navigator, "webdriver", { get: () => false }));
    await signIn(page, { messages: t, onAnalytics: (req) => sent.push(new URL(req.url()).pathname) });
    await openChat(page);

    const box = page.getByTestId("part-error");
    await expect(box).toHaveCount(1);
    await expect(box).toContainText("This answer couldn't be shown.");
    await expect(page.locator(`${sel.message}[data-role="assistant"]`).first()).toContainText("Answer 1"); // the rest renders
    await expect(page.locator(sel.composer)).toBeEditable(); // and the chat still works
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);

    // the report link is small; the sheet asks first, sends, and only then
    // shows a reference (the test server's analytics host is the mock)
    await box.getByRole("button", { name: "Report" }).tap();
    const sheet = page.getByRole("dialog", { name: "Report this error" });
    await expect(sheet).toContainText("Send a report?");
    await expect(sheet).toContainText("not your messages");
    await expect(page.getByTestId("error-ref")).toHaveCount(0); // no reference before sending
    await sheet.getByRole("button", { name: "Send report" }).tap();
    await expect(sheet).toContainText("Report sent");
    await expect(page.getByTestId("error-ref")).toHaveText(/^[0-9A-F]{4}-[0-9A-F]{4}$/);
    // Delivery is checked on WebKit: PostHog's bot filter also reads Chrome's
    // brand list, which says "HeadlessChrome" under test (never on a phone).
    if (browserName === "webkit")
      await expect.poll(() => sent.some((p) => /\/(e|i\/v0\/e|batch)\/?$/.test(p) || p.includes("/e/")), { timeout: 10_000 }).toBe(true);
    await sheet.getByRole("button", { name: "Done" }).tap();
    await expect(sheet).toHaveCount(0);

    // Try again remounts the part (same bad data, so the box comes back)
    await box.getByRole("button", { name: "Try again" }).tap();
    await expect(page.getByTestId("part-error")).toContainText("This answer couldn't be shown.");
  });

  test("M33 broken page: page-level box, menu still works @M33", async ({ page }) => {
    await signIn(page, {
      handlers: { "GET /profile": () => ({ body: { aspects: "not-a-list", roles: [], personality_md: null, user_edited: false, updated_at: null, companion_names: {} } }) },
    });
    await page.goto("/profile");
    const box = page.getByTestId("part-error");
    await expect(box).toContainText("This page didn't load.", { timeout: 30_000 });
    await expect(box).toContainText("Your chats are safe");
    await expectTapOk(box.getByRole("button", { name: "Try again" }));
    await press(page, sel.openNav); // the shell survived
    await expect(page.locator(sel.drawer)).toBeVisible();
  });

  test("M34 whole app broken: full-screen companion page @M34", async ({ page }) => {
    // the shell itself throws (its workspace list isn't a list)
    await signIn(page, { handlers: { "GET /workspaces": () => ({ body: { not: "a list" } }) } });
    await page.goto("/workspace");
    const screen = page.getByTestId("app-error");
    await expect(screen).toBeVisible({ timeout: 30_000 });
    await expect(screen).toContainText("Something tripped me up");
    await expect(screen).toContainText("Nothing you did");
    await expectTapOk(screen.getByRole("button", { name: "Reload" }));
    await expect(screen.getByRole("link", { name: "Back to start" })).toHaveAttribute("href", "/start");
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
  });

  test("M35 broken recent-chats list: just that list gives way @M35", async ({ page }) => {
    await signIn(page, {
      handlers: { "GET /chat/conversations": () => ({ body: [{ id: "r1", title: { bad: "title" }, created_at: "2026-10-01T10:00:00Z" }] }) },
    });
    await page.goto("/workspace/w1");
    await press(page, sel.openNav);
    const drawer = page.locator(sel.drawer);
    await expect(drawer.getByTestId("part-error")).toContainText("Recent chats couldn't be shown.", { timeout: 30_000 });
    await expect(drawer.getByRole("link", { name: "Search" })).toBeVisible(); // the rest of the menu works
  });

  test("M36 broken question card: just the card gives way @M36", async ({ page }) => {
    await signIn(page, {
      messages: thread(1),
      handlers: { "POST /chat/c1/messages": () => ({ sse: sseBody([["clarifying_options", { question: "Which one?", options: null }]]) }) },
    });
    await openChat(page);
    await page.locator(sel.composer).fill("help with my budget");
    await press(page, sel.send);
    await expect(page.getByTestId("part-error")).toContainText("This question couldn't be shown.");
    await expect(page.locator(sel.composer)).toBeVisible();
  });
});

async function expectTapOk(loc: ReturnType<Page["locator"]>) {
  const a = await tapArea(loc);
  expect(Math.min(a.w, a.h), `tap area ${a.w}x${a.h}`).toBeGreaterThanOrEqual(44);
}

test.describe("checklist items", () => {
  test("M37 menu open: the page behind it doesn't scroll @M37", async ({ page }) => {
    await signIn(page, { extraWorkspaces: 12 });
    await page.goto("/workspace");
    await expect(page.locator('a[href^="/workspace/x11"]')).toBeAttached({ timeout: 30_000 });
    const overflow = () => page.locator("main").evaluate((m) => getComputedStyle(m).overflowY);
    expect(await overflow()).toBe("auto");
    await press(page, sel.openNav);
    await expect.poll(overflow).toBe("hidden");
    await page.locator(sel.closeNav).tap();
    await expect.poll(overflow).toBe("auto");
  });

  test("M38 draft survives a refresh, cleared once sent @M38", async ({ page }) => {
    await signIn(page, { messages: thread(1) });
    await openChat(page);
    await page.locator(sel.composer).fill("half-written thought about the budget");
    await page.reload();
    await expect(page.locator(sel.composer)).toHaveValue("half-written thought about the budget", { timeout: 30_000 });
    await press(page, sel.send);
    await expect(page.locator(`${sel.message}[data-role="assistant"]`).last()).toContainText("half-written thought");
    await page.reload();
    await expect(page.locator(sel.composer)).toBeEditable({ timeout: 30_000 });
    await expect(page.locator(sel.composer)).toHaveValue("");
  });

  test("M39 named progress while an answer is on its way @M39", async ({ page }) => {
    // A real streaming server for this one: the mock answers in one piece,
    // and the point here is what shows *between* the frames.
    const server = http.createServer((req, res) => {
      res.writeHead(200, {
        "content-type": "text/event-stream",
        "access-control-allow-origin": req.headers.origin ?? "*",
        "access-control-allow-headers": "authorization, content-type",
      });
      if (req.method === "OPTIONS") return res.end();
      res.write(sseBody([["status", { phase: "searching", label: "Searching" }]]));
      setTimeout(() => res.write(sseBody([["status", { phase: "validating", label: "Validating" }]])), 1500);
      setTimeout(() => res.end(), 4000);
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const port = (server.address() as AddressInfo).port;
    try {
      await signIn(page, { messages: thread(1) });
      await page.route(`${API}/api/v1/chat/c1/messages`, (route) =>
        route.request().method() === "POST" ? route.continue({ url: `http://127.0.0.1:${port}/stream` }) : route.fallback(),
      );
      await openChat(page);
      await page.locator(sel.composer).fill("what changed this year?");
      await press(page, sel.send);
      await expect(page.getByText("Searching the web")).toBeVisible();
      await expect(page.getByText("Checking the claims")).toBeVisible({ timeout: 5_000 });
    } finally {
      server.close();
    }
  });

  test("M40 small fields render at 16px (no iOS zoom on focus); taps have no delay @M40", async ({ app: page }) => {
    await page.goto("/login");
    await page.locator(sel.email).waitFor({ timeout: 30_000 });
    const m = await page.evaluate(() => {
      const zoom = parseFloat(getComputedStyle(document.documentElement).zoom) || 1;
      const email = document.querySelector<HTMLInputElement>("#email")!;
      const btn = document.querySelector<HTMLButtonElement>('button[type="submit"]')!;
      return { rendered: parseFloat(getComputedStyle(email).fontSize) * zoom, touch: getComputedStyle(btn).touchAction };
    });
    expect(m.rendered).toBeGreaterThanOrEqual(15.9);
    expect(m.touch).toBe("manipulation");
  });

  test("M41 phone edges: viewport-fit, keyboard resize, safe-area hooks; drawer keeps its swipe @M41", async ({ signedIn: page }) => {
    await page.goto("/workspace");
    await expect(page.locator(sel.openNav)).toBeVisible({ timeout: 30_000 });
    const viewport = await page.locator('meta[name="viewport"]').getAttribute("content");
    expect(viewport).toContain("viewport-fit=cover");
    expect(viewport).toContain("interactive-widget=resizes-content");
    await expect(page.locator('header[data-safe="top"]')).toHaveCount(1);
    await press(page, sel.openNav);
    // the base-layer touch-action rule must not override the drawer's pan-y
    expect(await page.locator(sel.drawer).getByRole("link", { name: "Search" }).evaluate((a) => getComputedStyle(a).touchAction)).toBe("pan-y");
  });

  test("M42 chat icon buttons have a 44px tap area on touch @M42", async ({ page }) => {
    const messages = thread(1);
    // one sentence of the answer tagged as opinion: its marker sits inside the text
    messages[1].claims = [{
      claim_index: 0, claim_text: "Answer 1.", claim_score: null, entailment_label: "opinion",
      distortion_flag: null, distortion_explanation: null, bias_name: null, bias_definition: null,
      bias_category: null, bias_category_name: null, reconciliation_note: null, dynamic: false, evidence: [],
    }] as never;
    messages[1].content = "Answer 1. Some supporting detail follows here.";
    await signIn(page, { messages });
    await openChat(page);
    // the inline opinion marker keeps the text's line: not grown into a 44px box
    const marker = page.getByRole("button", { name: /Stated as an opinion/ });
    await expect(marker).toBeVisible();
    const mb = (await marker.boundingBox())!;
    expect(mb.height, "inline marker height").toBeLessThan(30);
    await expectTappable(marker, "opinion marker");
    const small: string[] = [];
    for (const name of ["Attach a file or image", "Record a voice message", "Regenerate this answer", "Mark this answer helpful", "Mark this answer not helpful"]) {
      const el = page.getByRole("button", { name }).first();
      if (!(await el.count())) continue;
      // what a finger can hit: the chat box's icons stay small and reach 44px
      // through an invisible hit area; the answer's icons are 44px boxes
      const a = await tapArea(el);
      if (a.w < 44 || a.h < 44) small.push(`${name} ${a.w}x${a.h}`);
    }
    expect(small, small.join("\n")).toEqual([]);
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
  });

  test("M43 daily preview limit (402) is explained in the chat, which stays usable @M43", async ({ page }) => {
    await signIn(page, {
      messages: thread(1),
      handlers: { "POST /chat/c1/messages": () => ({ status: 402, body: { detail: "You've used today's preview messages. They reset at midnight." } }) },
    });
    await openChat(page);
    await page.locator(sel.composer).fill("one more");
    await press(page, sel.send);
    await expect(page.getByText("You've used today's preview messages.")).toBeVisible();
    await expect(page.locator(sel.composer)).toBeEditable();
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
  });

  test("M44 feedback buttons work by tap @M44", async ({ page }) => {
    let rated = "";
    await signIn(page, {
      messages: thread(1),
      handlers: { "PUT /chat/c1/messages/ta0/feedback": (req) => { rated = String((req.postDataJSON() as { rating: string }).rating); return undefined; } },
    });
    await openChat(page);
    await page.getByRole("button", { name: "Mark this answer helpful" }).first().tap();
    await expect.poll(() => rated).toBe("up");
  });
});

test.describe("routes the graph found untested", () => {
  test("M45 /welcome on a phone: questions, progress, finish @M45", async ({ page }) => {
    await mockApi(page, { onboarded: false });
    await seedStorage(page, { signedIn: true });
    await page.goto("/welcome");
    const box = page.getByRole("textbox").first();
    await expect(box).toBeVisible({ timeout: 30_000 });
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
    await expect(page.getByRole("list", { name: "Progress" })).toBeVisible();
    await box.fill("Planning a career change");
    await expectTapOk(page.getByRole("button", { name: "Continue" }));
    await page.getByRole("button", { name: "Continue" }).tap();
    await page.getByRole("button", { name: "Continue" }).tap();
    await page.getByRole("button", { name: "Finish" }).tap();
    await page.waitForURL(/\/(start|chat\/)/, { timeout: 30_000 });
  });

  for (const path of ["/privacy", "/terms"]) {
    test(`M46 ${path} reads on a phone @M46`, async ({ app: page }) => {
      await page.goto(path);
      await expect(page.locator("h1")).toBeVisible({ timeout: 30_000 });
      expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
      const font = await page.locator("main p, article p, p").first().evaluate((p) => parseFloat(getComputedStyle(p).fontSize));
      expect(font).toBeGreaterThanOrEqual(12);
    });
  }

  test("M47 consent banner on a first visit: fits, tappable, remembers @M47", async ({ page }) => {
    await mockApi(page);
    await hideDevOverlay(page);
    // a first-time visitor - once, so the reload below sees what they chose
    await page.addInitScript((k) => {
      if (sessionStorage.getItem("e2e-fresh")) return;
      localStorage.removeItem(k.consent);
      sessionStorage.setItem("e2e-fresh", "1");
    }, KEYS);
    await page.goto("/login");
    const banner = page.getByRole("dialog", { name: "Analytics consent" });
    await expect(banner).toBeVisible({ timeout: 30_000 });
    const b = (await banner.boundingBox())!;
    expect(b.x).toBeGreaterThanOrEqual(0);
    expect(b.x + b.width).toBeLessThanOrEqual(376);
    const buttons = banner.getByRole("button");
    await expectTapOk(buttons.first());
    await expectTapOk(buttons.nth(1));
    await buttons.nth(1).tap();
    await expect(banner).toHaveCount(0);
    await page.reload();
    await expect(page.locator(sel.email)).toBeVisible({ timeout: 30_000 });
    await expect(banner).toHaveCount(0);
  });
});

test.describe("scrolling", () => {
  const fromBottom = (page: Page) =>
    page.locator(sel.messageList).first().evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight);
  // the thread opens with a smooth scroll of its own: let it land before
  // scrolling by script (WebKit doesn't cancel a smooth scroll for a jump)
  async function settled(page: Page) {
    const list = page.locator(sel.messageList).first();
    let last = -1;
    await expect.poll(async () => {
      const now = await list.evaluate((el) => el.scrollTop);
      const same = now === last;
      last = now;
      return same;
    }, { intervals: [250] }).toBe(true);
    return list;
  }

  test("M48 chat: a jump-to-latest button once you've scrolled up @M48", async ({ page }) => {
    await signIn(page, { messages: thread(8) });
    await openChat(page);
    const jump = page.getByRole("button", { name: "Jump to the latest message" });
    await expect.poll(() => fromBottom(page)).toBeLessThan(80);
    await expect(jump).toHaveCount(0);
    const list = await settled(page);
    await list.evaluate((el) => el.scrollTo({ top: 0, behavior: "instant" }));
    await expect(jump).toBeVisible();
    await expectTappable(jump, "jump to latest");
    await jump.tap();
    await expect.poll(() => fromBottom(page)).toBeLessThan(80);
    await expect(jump).toHaveCount(0);
  });

  test("M49 chat: your place is kept when you come back to it @M49", async ({ page }) => {
    await signIn(page, { messages: thread(8) });
    await openChat(page);
    const list = await settled(page);
    await list.evaluate((el) => el.scrollTo({ top: 120, behavior: "instant" }));
    await expect.poll(() => page.evaluate(() => Math.abs(Number(sessionStorage.getItem("clardentity-place:c1") ?? -99) - 120) <= 1)).toBe(true);
    await page.reload();
    await expect(page.locator(sel.composer)).toBeEditable({ timeout: 30_000 });
    // within a pixel: under the root zoom, scroll positions snap to device pixels
    await expect.poll(() => page.locator(sel.messageList).first().evaluate((el) => Math.abs(el.scrollTop - 120) <= 1)).toBe(true);
    await expect(page.getByRole("button", { name: "Jump to the latest message" })).toBeVisible();
    // back at the bottom, the saved place is dropped: the next visit opens at the latest
    await page.getByRole("button", { name: "Jump to the latest message" }).tap();
    await expect.poll(() => page.evaluate(() => sessionStorage.getItem("clardentity-place:c1"))).toBeNull();
  });

  test("M50 lists fade at an edge with more past it; no desktop scrollbars on a phone @M50", async ({ page, browserName }) => {
    const recents = Array.from({ length: 24 }, (_, i) => ({ id: `r${i}`, title: `Chat number ${i + 1}`, created_at: "2026-10-01T10:00:00Z", pinned: false }));
    await signIn(page, { messages: thread(2), handlers: { "GET /chat/conversations": () => ({ body: recents }) } });
    await page.goto("/workspace/w1");
    await press(page, sel.openNav);
    const list = page.locator(sel.drawer).locator("ul.scroll-fade-y");
    await expect(list.locator('a[href^="/chat/r"]')).toHaveCount(12, { timeout: 30_000 }) // the list shows 12 at a time;
    await expect(list).toHaveAttribute("data-more-end", "");
    await expect(list).not.toHaveAttribute("data-more-start", "");
    expect(await list.evaluate((el) => getComputedStyle(el).maskImage || getComputedStyle(el).webkitMaskImage)).toContain("gradient");
    await list.evaluate((el) => el.scrollTo({ top: el.scrollHeight, behavior: "instant" }));
    await expect(list).toHaveAttribute("data-more-start", "");
    await expect(list).not.toHaveAttribute("data-more-end", "");

    // the mode rail in a chat runs past the screen: its far edge fades
    await page.locator(sel.closeNav).first().tap();
    await openChat(page);
    await expect(page.locator(sel.modeRail)).toHaveAttribute("data-more-end", "");
    // the phone's own scrollbar (an overlay), not a styled 8px bar taking width
    if (browserName === "chromium")
      expect(await page.locator(sel.messageList).first().evaluate((el) => (el as HTMLElement).offsetWidth - el.clientWidth)).toBe(0);
  });
});

test.describe("server waking from a quiet spell", () => {
  const notice = (page: Page) => page.getByTestId("server-waking");
  const later = (ms: number) => new Promise((r) => setTimeout(r, ms));

  test("M51 a slow first answer says the server is waking, then gets out of the way @M51", async ({ page }) => {
    test.slow();
    await signIn(page, { handlers: { "GET /auth/me": async () => { await later(7000); return undefined; } } });
    await page.goto("/workspace");
    await expect(notice(page)).toContainText("Waking the server up", { timeout: 10_000 });
    const n = (await notice(page).boundingBox())!;
    expect(n.x).toBeGreaterThanOrEqual(0);
    expect(n.x + n.width).toBeLessThanOrEqual(376);
    await expect(page.locator('a[href^="/workspace/w"]').first()).toBeVisible({ timeout: 20_000 });
    await expect(notice(page)).toHaveCount(0);
  });

  test("M52 a server still booting doesn't sign you out: the first check is retried @M52", async ({ page }) => {
    test.slow();
    let calls = 0;
    await signIn(page, {
      handlers: { "GET /auth/me": () => (++calls <= 2 ? { status: 503, body: { detail: "starting" } } : undefined) },
    });
    await page.goto("/workspace");
    await expect(page.locator('a[href^="/workspace/w"]').first()).toBeVisible({ timeout: 30_000 });
    expect(page.url()).not.toContain("/login");
    expect(calls).toBeGreaterThanOrEqual(3);
  });

  test("M53 one slow request in an awake session isn't called a cold start @M53", async ({ page }) => {
    test.slow();
    await signIn(page, { handlers: { "GET /workspaces": async () => { await later(7000); return undefined; } } });
    await page.goto("/workspace");
    // /auth/me answered quickly, so the server is awake: no notice while /workspaces crawls
    await later(5500);
    await expect(notice(page)).toHaveCount(0);
    await expect(page.locator('a[href^="/workspace/w"]').first()).toBeVisible({ timeout: 20_000 });
  });
});

test("M54 home page cards: one embossed mark each, in the empty space only; none on desktop @M54", async ({ app: page }) => {
  await page.goto("/");
  const cards = page.locator("article.landing-card");
  await expect(cards).toHaveCount(11, { timeout: 30_000 });
  // the marks are placed once each card's text has laid out; read them then
  await cards.last().scrollIntoViewIfNeeded();
  await page.waitForTimeout(800);
  await cards.first().scrollIntoViewIfNeeded();
  await page.waitForTimeout(800);
  const report = await cards.evaluateAll((els) =>
    els.map((card) => {
      const marks = card.querySelectorAll('[data-testid="card-emboss"]');
      const mark = marks[0]?.getBoundingClientRect();
      const words = [...card.querySelectorAll("h3, p, span, img")].filter(
        (el) => el.closest('[data-testid="card-emboss"]') === null && (el.textContent?.trim() || el.tagName === "IMG"),
      );
      const hits = mark
        ? words.filter((el) => {
            const r = el.getBoundingClientRect();
            return r.width > 0 && r.left < mark.right && r.right > mark.left && r.top < mark.bottom && r.bottom > mark.top;
          }).map((el) => el.textContent?.trim().slice(0, 20) || el.tagName)
        : [];
      // centred in the gap the text leaves: as much room above as below
      let above = -Infinity, below = Infinity;
      const box = card.getBoundingClientRect();
      for (const el of words) {
        const r = el.getBoundingClientRect();
        if (r.height === 0) continue;
        if (r.top + r.height / 2 < box.top + box.height / 2) above = Math.max(above, r.bottom);
        else below = Math.min(below, r.top);
      }
      const skew = mark ? Math.abs((mark.top - above) - (below - mark.bottom)) : 0;
      return { marks: marks.length, hits, skew };
    }),
  );
  for (const [i, r] of report.entries()) {
    expect.soft(r.marks, `card ${i}: one mark`).toBe(1);
    expect.soft(r.hits, `card ${i}: mark overlaps text`).toEqual([]);
    expect.soft(r.skew, `card ${i}: mark off-centre in its gap`).toBeLessThanOrEqual(3);
  }
  // desktop width: the cards are exactly as designed, no marks
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(page.locator('[data-testid="card-emboss"]').first()).toBeHidden();
});

test("M55 phone text: drawn at 92%, smallest labels held at 12.5px on the glass @M55", async ({ page }) => {
  await signIn(page, { messages: thread(1) });
  await openChat(page);
  const zoom = await page.evaluate(() => Number.parseFloat(getComputedStyle(document.documentElement).zoom));
  expect(zoom).toBeCloseTo(0.92, 2);
  const label = page.getByText("Was this helpful?").first();
  await expect(label).toBeVisible();
  const px = await label.evaluate((el) => Number.parseFloat(getComputedStyle(el).fontSize));
  expect(px * zoom, "label size on the glass").toBeGreaterThanOrEqual(12.4);
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
});

test("M56 typing folds the mode row to a chip; the chip opens it without closing the keyboard @M56", async ({ page }) => {
  await signIn(page, { messages: thread(1) });
  await openChat(page);
  const rail = page.locator(sel.modeRail);
  const chip = page.getByTestId("mode-chip");
  const composer = page.locator(sel.composer);
  await expect(rail).toBeVisible();
  await composer.tap();
  await expect(chip).toBeVisible();
  await expect(chip).toContainText("Finder");
  await expect(rail).toHaveCount(0);
  await expectTappable(chip, "mode chip");
  await chip.tap();
  await expect(rail).toBeVisible();
  await expect(composer).toBeFocused(); // keyboard stays up
  await rail.getByRole("radio", { name: "Thought coach" }).tap();
  await expect(composer).toBeFocused();
  await expect(chip).toContainText("Thought coach");
  // keyboard away (focus leaves the box): the full row is back. Blurred
  // directly - WebKit's emulation doesn't move focus on a tap on plain text.
  await composer.evaluate((el) => (el as HTMLElement).blur());
  await expect(rail).toBeVisible();
  await expect(rail.getByRole("radio", { name: "Thought coach" })).toHaveAttribute("aria-checked", "true");
});
