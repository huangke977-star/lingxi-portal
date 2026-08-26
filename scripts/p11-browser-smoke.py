"""P11 public-page desktop/mobile smoke checks.

The script is read-only: it opens public pages in Chromium and does not sign in
or submit data. Run it against a local production build or the deployed site:

    python scripts/p11-browser-smoke.py
    $env:LINGXI_SMOKE_URL = "https://5200918.xyz"; python scripts/p11-browser-smoke.py
"""

from __future__ import annotations

import os
import time
from urllib.parse import urljoin

from playwright.sync_api import Browser, ConsoleMessage, Page, sync_playwright


BASE_URL = os.environ.get("LINGXI_SMOKE_URL", "http://localhost:3000").rstrip("/") + "/"
MAX_PAGE_LOAD_MS = int(os.environ.get("LINGXI_MAX_PAGE_LOAD_MS", "12000"))
PATHS = ("/", "/en", "/articles", "/en/articles", "/topics", "/en/topics", "/articles/collections", "/en/articles/collections")


def collect_console_error(message: ConsoleMessage, errors: list[str]) -> None:
    if message.type == "error":
        errors.append(message.text)


def verify_page(page: Page, path: str, label: str) -> None:
    console_errors: list[str] = []
    page_errors: list[str] = []
    server_errors: list[str] = []
    page.on("console", lambda message: collect_console_error(message, console_errors))
    page.on("pageerror", lambda error: page_errors.append(str(error)))
    page.on(
        "response",
        lambda response: server_errors.append(f"{response.status} {response.url}") if response.status >= 500 else None,
    )

    started_at = time.perf_counter()
    response = page.goto(urljoin(BASE_URL, path.lstrip("/")), wait_until="domcontentloaded", timeout=30_000)
    elapsed_ms = round((time.perf_counter() - started_at) * 1000)
    assert response and response.status == 200, f"{label} {path}: page status was {response.status if response else 'no response'}"
    page.wait_for_timeout(900)

    metrics = page.evaluate(
        """
        () => {
          const failedImages = [...document.images]
            .filter((image) => image.currentSrc && image.complete && image.naturalWidth === 0)
            .map((image) => image.currentSrc);
          return {
            scrollWidth: document.documentElement.scrollWidth,
            viewportWidth: window.innerWidth,
            failedImages,
            readyState: document.readyState,
          };
        }
        """
    )
    assert elapsed_ms <= MAX_PAGE_LOAD_MS, f"{label} {path}: initial load took {elapsed_ms}ms (limit {MAX_PAGE_LOAD_MS}ms)"
    assert metrics["readyState"] in ("interactive", "complete"), f"{label} {path}: document did not become interactive"
    assert not server_errors, f"{label} {path}: server errors: {'; '.join(server_errors[:3])}"
    assert not page_errors, f"{label} {path}: page errors: {'; '.join(page_errors[:3])}"
    assert not console_errors, f"{label} {path}: console errors: {'; '.join(console_errors[:3])}"
    assert not metrics["failedImages"], f"{label} {path}: failed images: {'; '.join(metrics['failedImages'][:3])}"
    if label == "mobile":
        assert metrics["scrollWidth"] <= metrics["viewportWidth"], f"{label} {path}: page has horizontal overflow"
    print(f"PASS {label} {path}: {elapsed_ms}ms")


def run() -> None:
    with sync_playwright() as playwright:
        browser: Browser = playwright.chromium.launch(headless=True)
        try:
            for label, viewport in (("desktop", {"width": 1440, "height": 900}), ("mobile", {"width": 390, "height": 844})):
                for path in PATHS:
                    page = browser.new_page(viewport=viewport)
                    try:
                        verify_page(page, path, label)
                    finally:
                        page.close()
        finally:
            browser.close()


if __name__ == "__main__":
    run()
