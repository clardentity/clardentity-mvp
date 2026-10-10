/* @visual: screenshot comparison of key mobile screens, per project.
 *
 * Baselines are made ONLY in the CI Docker image (fonts and anti-aliasing
 * differ between machines; a baseline from a laptop fails everywhere else):
 * run the "E2E visual baselines" workflow, which commits them under
 * e2e/visual.spec.ts-snapshots/ with a -linux suffix. A test whose baseline
 * doesn't exist yet skips rather than failing, so a fresh clone and Windows/
 * macOS runs are quiet. Runs only with E2E_VISUAL=1 (see playwright.config).
 *
 * Hidden (visual.css): timestamps, the companion, the account initials and
 * Next's dev indicator; the arrival greeting is suppressed (beforeEach). The mock's chat stream lands in one piece, so there is no partial text to mask.
 * Threshold: maxDiffPixelRatio 0.01 in the config - see the note there. */
import fs from "node:fs";
import path from "node:path";
import type { Page } from "@playwright/test";
import { test, expect, sel, signIn, press, thread } from "./fixtures";

test.describe.configure({ timeout: 60_000 });

function needsBaseline(name: string) {
  const info = test.info();
  const updating = info.config.updateSnapshots === "all" || info.config.updateSnapshots === "changed";
  const file = info.snapshotPath(name, { kind: "screenshot" });
  test.skip(!updating && !fs.existsSync(file), `no baseline for ${name} yet - run the visual baselines workflow`);
}

// What changes between runs - timestamps, the companion, the account
// initials - is hidden by visual.css, in place. Playwright's own `mask` option
// was tried first: it paints its boxes from rects that ignore the app's 85%
// root zoom, so in the first baselines every box sat up and left of its target
// and covered the wrong things.
test.beforeEach(async ({ page }) => {
  // The one-off "Welcome back" greeting fades on a timer: say it has already
  // been shown this session, so no screenshot catches it mid-fade.
  await page.addInitScript(() => {
    try {
      sessionStorage.setItem("clardentity.greetedThisSession", "1");
    } catch {
      // storage blocked: the greeting may show, and the diff will say so
    }
  });
});

async function snap(page: Page, name: string) {
  needsBaseline(name);
  await page.evaluate(() => document.fonts.ready);
  await expect(page).toHaveScreenshot(name, {
    animations: "disabled",
    caret: "hide",
    stylePath: path.join(__dirname, "visual.css"),
  });
}

test("V1 login @visual", async ({ app: page }) => {
  await page.goto("/login");
  await page.locator(sel.email).waitFor({ timeout: 30_000 });
  await snap(page, "login.png");
});

test("V2 workspaces @visual", async ({ signedIn: page }) => {
  await page.goto("/workspace");
  await expect(page.locator('a[href^="/workspace/w"]').first()).toBeVisible({ timeout: 30_000 });
  await snap(page, "workspaces.png");
});

test("V3 menu open @visual", async ({ signedIn: page }) => {
  await page.goto("/workspace");
  await press(page, sel.openNav);
  await expect(page.locator(sel.drawer)).toBeVisible();
  await snap(page, "menu-open.png");
});

test("V4 chat @visual", async ({ page }) => {
  await signIn(page, { messages: thread(2) });
  await page.goto("/chat/c1");
  await expect(page.locator(sel.composer)).toBeEditable({ timeout: 30_000 });
  await snap(page, "chat.png");
});

test("V5 settings @visual", async ({ signedIn: page }) => {
  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "Settings", exact: true })).toBeVisible({ timeout: 30_000 });
  await snap(page, "settings.png");
});
