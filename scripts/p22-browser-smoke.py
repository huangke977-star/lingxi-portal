"""P22 browser smoke and optional visual regression checks.

The default run is read-only and covers public routes only. It checks both
desktop and 390px mobile viewports, captures screenshots, and can compare them
with a baseline when Pillow is installed.

Examples:
    python scripts/p22-browser-smoke.py
    $env:LINGXI_E2E_URL = "https://example.com"; python scripts/p22-browser-smoke.py
    python scripts/p22-browser-smoke.py --update-baseline
    python scripts/p22-browser-smoke.py --baseline-dir scripts/p22-baselines
"""

from __future__ import annotations

import argparse
import os
import shutil
import sys
from pathlib import Path
from urllib.parse import urljoin

from playwright.sync_api import Browser, Page, sync_playwright


PATHS = ("/", "/en", "/articles", "/en/articles", "/topics", "/en/topics", "/articles/collections", "/en/articles/collections")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--baseline-dir", type=Path, default=None)
    parser.add_argument("--screenshot-dir", type=Path, default=Path(os.environ.get("P22_SCREENSHOT_DIR", ".artifacts/p22/screenshots")))
    parser.add_argument("--update-baseline", action="store_true")
    parser.add_argument("--max-diff-ratio", type=float, default=0.01)
    return parser.parse_args()


def compare_images(actual: Path, baseline: Path, max_diff_ratio: float) -> None:
    try:
        from PIL import Image, ImageChops  # type: ignore
    except ImportError as error:
        raise AssertionError("visual comparison requires Pillow; install it with: python -m pip install pillow") from error
    current = Image.open(actual).convert("RGBA")
    expected = Image.open(baseline).convert("RGBA")
    if current.size != expected.size:
        raise AssertionError(f"visual size mismatch: {actual.name} {current.size} != {expected.size}")
    diff = ImageChops.difference(current, expected)
    changed = sum(1 for pixel in diff.getdata() if any(channel > 10 for channel in pixel))
    ratio = changed / max(1, current.width * current.height)
    if ratio > max_diff_ratio:
        raise AssertionError(f"visual diff {ratio:.2%} exceeds {max_diff_ratio:.2%}: {actual.name}")


def verify_page(page: Page, base_url: str, path: str, label: str, screenshot_dir: Path, baseline_dir: Path | None, update_baseline: bool, max_diff_ratio: float) -> None:
    console_errors: list[str] = []
    page_errors: list[str] = []
    server_errors: list[str] = []
    page.on("console", lambda message: console_errors.append(message.text) if message.type == "error" else None)
    page.on("pageerror", lambda error: page_errors.append(str(error)))
    page.on("response", lambda response: server_errors.append(f"{response.status} {response.url}") if response.status >= 500 else None)
    response = page.goto(urljoin(base_url, path.lstrip("/")), wait_until="domcontentloaded", timeout=30_000)
    assert response and response.status == 200, f"{label} {path}: page status {response.status if response else 'none'}"
    page.wait_for_timeout(900)
    metrics = page.evaluate("""() => ({
      scrollWidth: document.documentElement.scrollWidth,
      viewportWidth: window.innerWidth,
      readyState: document.readyState,
      title: document.title,
      failedImages: [...document.images].filter((image) => image.currentSrc && image.complete && image.naturalWidth === 0).map((image) => image.currentSrc),
    })""")
    assert metrics["readyState"] in ("interactive", "complete"), f"{label} {path}: document not interactive"
    assert not server_errors, f"{label} {path}: server errors: {'; '.join(server_errors[:3])}"
    assert not page_errors, f"{label} {path}: page errors: {'; '.join(page_errors[:3])}"
    assert not console_errors, f"{label} {path}: console errors: {'; '.join(console_errors[:3])}"
    assert not metrics["failedImages"], f"{label} {path}: failed images: {'; '.join(metrics['failedImages'][:3])}"
    if label == "mobile":
        assert metrics["scrollWidth"] <= metrics["viewportWidth"], f"{label} {path}: horizontal overflow {metrics['scrollWidth']} > {metrics['viewportWidth']}"
    file_name = f"{label}-{path.strip('/').replace('/', '-') or 'home'}.png"
    actual = screenshot_dir / file_name
    page.screenshot(path=str(actual), full_page=True)
    if baseline_dir:
        baseline = baseline_dir / file_name
        if update_baseline:
            baseline.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(actual, baseline)
        else:
            assert baseline.exists(), f"missing visual baseline: {baseline} (run with --update-baseline once)"
            compare_images(actual, baseline, max_diff_ratio)
    print(f"PASS {label} {path}")


def run() -> None:
    args = parse_args()
    base_url = os.environ.get("LINGXI_E2E_URL", "http://localhost:3000").rstrip("/") + "/"
    args.screenshot_dir.mkdir(parents=True, exist_ok=True)
    if args.baseline_dir and args.update_baseline:
        args.baseline_dir.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as playwright:
        browser: Browser = playwright.chromium.launch(headless=True)
        try:
            for label, viewport in (("desktop", {"width": 1440, "height": 900}), ("mobile", {"width": 390, "height": 844})):
                page = browser.new_page(viewport=viewport)
                try:
                    for path in PATHS:
                        verify_page(page, base_url, path, label, args.screenshot_dir, args.baseline_dir, args.update_baseline, args.max_diff_ratio)
                finally:
                    page.close()
        finally:
            browser.close()


if __name__ == "__main__":
    try:
        run()
    except AssertionError as error:
        print(f"FAIL {error}", file=sys.stderr)
        raise SystemExit(1)
