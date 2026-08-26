"""P12 first-run onboarding and points-resource center desktop/mobile checks.

The script intercepts every API response used by this flow. It creates no
server-side records and can be run against a local production Web build:

    python scripts/p12-growth-playwright.py
"""

from __future__ import annotations

import json
import os
from urllib.parse import urlparse

from playwright.sync_api import Browser, Page, Route, sync_playwright


BASE_URL = os.environ.get("LINGXI_E2E_URL", "http://localhost:3000").rstrip("/")
ACCESS_TOKEN = "eyJhbGciOiJub25lIn0.eyJzdWIiOiIxIn0.signature"
NOW = "2026-08-26T09:00:00.000Z"

USER = {
    "id": 1,
    "username": "growth-user",
    "nickname": "增长测试用户",
    "email": "growth@example.test",
    "status": "active",
    "isSuperAdmin": False,
    "isAdministrator": False,
    "avatarUrl": None,
    "profileBio": "",
    "locale": "zh-CN",
    "createdAt": NOW,
    "appearance": {
        "themeId": "cloud-blue",
        "customAccent": "#5f8fb5",
        "customSurface": "#ffffff",
        "customForeground": "#203142",
        "customMuted": "#6c7b88",
        "cardAlpha": 50,
        "glassBlur": 18,
        "glassTint": "#ffffff",
        "glassTintAlpha": 0,
    },
    "role": {"code": "user", "name": "用户", "level": 1},
}


def respond(route: Route, payload: object, status: int = 200) -> None:
    route.fulfill(status=status, content_type="application/json", body=json.dumps(payload, ensure_ascii=False))


def mock_api(route: Route) -> None:
    parsed = urlparse(route.request.url)
    if parsed.port != 3001:
        route.continue_()
        return
    path = parsed.path
    if path.startswith("/socket.io/"):
        route.abort()
    elif path == "/auth/me":
        respond(route, USER)
    elif path == "/site-settings/public":
        respond(route, {"siteName": "P12 Test"})
    elif path == "/discovery/onboarding" and route.request.method == "GET":
        respond(route, {"completed": False, "topics": [{
            "id": 18,
            "title": "部署与运维",
            "slug": "operations",
            "description": "服务器与部署实践",
            "coverPath": None,
            "articleCount": 6,
            "subscriberCount": 3,
            "subscribed": False,
        }]})
    elif path == "/discovery/onboarding" and route.request.method == "POST":
        payload = route.request.post_data_json
        assert payload == {"topicIds": [18]}, f"unexpected onboarding payload: {payload}"
        respond(route, {"completed": True, "topicIds": [18]})
    elif path == "/discovery/resources/visible":
        respond(route, {"items": [{
            "article": {
                "id": 76,
                "title": "可兑换的部署清单",
                "slug": "deploy-checklist",
                "category": "资源",
                "tags": ["部署"],
                "titleColor": "",
                "coverPath": None,
                "viewCount": 7,
                "likeCount": 3,
                "favoriteCount": 1,
                "commentCount": 2,
                "publishedAt": NOW,
                "author": {**USER, "id": 2, "nickname": "资源作者", "username": "resource-author"},
                "collections": [],
                "topics": [],
            },
            "minimumPointCost": 8,
            "blockCount": 2,
            "exchangeCount": 5,
        }], "total": 1, "page": 1, "pageSize": 24, "totalPages": 1})
    elif path == "/discovery/resources/summary":
        respond(route, {"purchasedBlocks": 2, "soldBlocks": 4, "pendingPoints": 13})
    elif path in ("/articles/visible/center/summary", "/articles/center/summary"):
        respond(route, {"discover": 1, "subscriptions": 0, "mine": 0, "favorites": 0, "liked": 0, "readLater": 0, "history": 0, "manage": 0})
    elif path == "/social/conversations":
        respond(route, {"items": []})
    elif path == "/social/friends":
        respond(route, {"friends": [], "incoming": [], "outgoing": [], "blocked": []})
    elif path == "/social/notifications":
        respond(route, {"items": [], "hasMore": False, "hiddenChannels": [], "channelStates": []})
    elif path == "/social/summary":
        respond(route, {"unreadMessages": 0, "pendingFriendRequests": 0, "pendingStrangerRequests": 0, "unreadNotifications": 0})
    else:
        respond(route, {})


def prepare_page(page: Page) -> None:
    page.add_init_script(
        "localStorage.setItem('lingxi_access_token', %s); localStorage.setItem('lingxi_refresh_token', 'test-refresh-token');"
        % json.dumps(ACCESS_TOKEN)
    )
    page.route("http://127.0.0.1:3001/**", mock_api)
    page.route("http://localhost:3001/**", mock_api)


def verify(page: Page, label: str, path: str) -> None:
    page.goto(f"{BASE_URL}{path}", wait_until="domcontentloaded")
    dialog = page.locator(".onboarding-dialog")
    dialog.wait_for()
    dialog.get_by_role("button", name="部署与运维").click()
    dialog.get_by_role("button", name="完成" if path.startswith("/articles") else "Continue").click()
    dialog.wait_for(state="hidden")
    page.locator(".resource-catalog-list > a").wait_for()
    metrics = page.evaluate("() => ({ width: document.documentElement.scrollWidth, viewport: window.innerWidth })")
    assert metrics["width"] <= metrics["viewport"], f"{label}: horizontal overflow"
    assert page.locator(".resource-catalog-list").inner_text().find("可兑换的部署清单") >= 0
    print(f"PASS {label}: onboarding POST, resource catalog, and no horizontal overflow")


def run() -> None:
    with sync_playwright() as playwright:
        browser: Browser = playwright.chromium.launch(headless=True)
        try:
            desktop = browser.new_page(viewport={"width": 1440, "height": 900})
            prepare_page(desktop)
            verify(desktop, "desktop", "/articles/resources")
            desktop.close()
            mobile = browser.new_page(viewport={"width": 390, "height": 844})
            prepare_page(mobile)
            verify(mobile, "mobile", "/articles/resources")
            mobile.close()
        finally:
            browser.close()


if __name__ == "__main__":
    run()
