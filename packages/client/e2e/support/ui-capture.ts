import { appendFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import {
  emitCapturePreview,
  writeCapturePreview,
} from "../../scripts/artifact-capture.js";

/**
 * Screenshots from a Playwright case, delivered the way an ordinary capture is.
 *
 * A spec that writes PNGs and stops there has verified nothing the maintainer
 * can see. Cases record each shot here; global teardown then hands the whole
 * run to the same presentation helper the capture command uses, so the images
 * appear beside the tool call. See topics/ui-testing.md.
 *
 * Recording is opt-in through `YEP_E2E_UI_CAPTURE_DIR`, so an ordinary test run
 * writes nothing and presents nothing.
 */
const MANIFEST = "captures.jsonl";

interface RecordedCapture {
  name: string;
  width: number;
  height: number;
  path: string;
}

function captureDirectory(): string | undefined {
  return process.env.YEP_E2E_UI_CAPTURE_DIR || undefined;
}

/**
 * Write one screenshot and record it for presentation. Falls back to the page's
 * own viewport when the caller does not state one.
 */
export async function recordUiCapture(
  page: Page,
  name: string,
  viewport?: { width: number; height: number },
): Promise<void> {
  const directory = captureDirectory();
  if (!directory) return;
  const size = viewport ?? page.viewportSize();
  if (!size) throw new Error(`Capture ${name} has no viewport size to record`);
  mkdirSync(directory, { recursive: true });
  const path = join(directory, `${name}.png`);
  await page.screenshot({ animations: "disabled", path });
  const entry: RecordedCapture = { name, ...size, path };
  appendFileSync(join(directory, MANIFEST), `${JSON.stringify(entry)}\n`);
}

/**
 * Present every capture this run recorded. Safe to call unconditionally: with
 * no capture directory or no recorded shots it does nothing.
 */
export async function presentUiCaptures(): Promise<void> {
  const directory = captureDirectory();
  if (!directory) return;
  const manifest = join(directory, MANIFEST);
  if (!existsSync(manifest)) return;
  // Last write wins per name, so a re-recorded state replaces its earlier shot
  // instead of failing the unique-name check.
  const byName = new Map<string, RecordedCapture>();
  for (const line of readFileSync(manifest, "utf-8").split("\n")) {
    if (!line.trim()) continue;
    const entry = JSON.parse(line) as RecordedCapture;
    byName.set(entry.name, entry);
  }
  if (byName.size === 0) return;
  // A fresh output directory per run: the preview helper refuses to overwrite
  // an existing manifest, and a repeated run into the same capture directory
  // would otherwise fail after the screenshots already succeeded.
  const stamp = new Date().toISOString().replace(/[-:.]/g, "").slice(0, 15);
  emitCapturePreview(
    await writeCapturePreview({
      input: `Playwright UI captures (${directory})`,
      out: join(directory, `preview-${stamp}`),
      screenshots: [...byName.values()],
    }),
  );
}
