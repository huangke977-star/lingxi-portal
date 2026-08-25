"""P11-01 desktop and mobile regression checks for the recent chat/report layout fixes.

The script uses mocked API responses, so it never reads or changes application data.
Start the web app first, then run:

    python scripts/p11-01-playwright.py
"""

from __future__ import annotations

import json
import os
from urllib.parse import urlparse

from playwright.sync_api import Browser, Page, Route, sync_playwright


BASE_URL = os.environ.get("LINGXI_E2E_URL", "http://localhost:3000").rstrip("/")
ACCESS_TOKEN = "eyJhbGciOiJub25lIn0.eyJzdWIiOiIxIn0.signature"
NOW = "2026-08-25T08:00:00.000Z"


def user(user_id: int, nickname: str, username: str) -> dict:
    return {
        "id": user_id,
        "username": username,
        "nickname": nickname,
        "email": f"{username}@example.test",
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
            "cardAlpha": 0.78,
            "glassBlur": 18,
            "glassTint": "#ffffff",
            "glassTintAlpha": 0.32,
        },
        "role": {"code": "user", "name": "用户", "level": 1},
    }


CURRENT_USER = user(1, "测试用户", "test-user")
FRIEND = user(2, "聊天对象", "chat-user")


def report_fixture() -> dict:
    return {
        "key": "article-301",
        "id": 301,
        "source": "article",
        "sourceLabel": "文章举报",
        "status": "pending",
        "reason": "spam",
        "detail": (
            "这是一段足够长的举报补充说明，用于验证列表第二行会利用主列剩余空间，"
            "超出显示范围后仍然可以通过无边框磨砂悬浮提示查看完整内容。" * 4
        ),
        "resolution": None,
        "reporter": CURRENT_USER,
        "targetUser": FRIEND,
        "article": {
            "id": 401,
            "title": "用于回归测试的文章标题",
            "slug": "playwright-regression-article",
            "author": FRIEND,
        },
        "comment": None,
        "group": None,
        "message": None,
        "createdAt": NOW,
        "handledAt": None,
    }


def respond(route: Route, payload: object, status: int = 200) -> None:
    route.fulfill(
        status=status,
        content_type="application/json",
        body=json.dumps(payload, ensure_ascii=False),
    )


def mock_api(route: Route) -> None:
    request_url = route.request.url
    parsed = urlparse(request_url)
    if parsed.port != 3001:
        route.continue_()
        return

    if parsed.path.startswith("/socket.io/"):
        route.abort()
        return

    if parsed.path == "/auth/me":
        respond(route, CURRENT_USER)
    elif parsed.path == "/social/conversations":
        respond(
            route,
            {
                "items": [
                    {
                        "id": 91,
                        "kind": "direct",
                        "user": FRIEND,
                        "group": None,
                        "lastMessage": {
                            "id": 901,
                            "conversationId": 91,
                            "body": "回归测试消息",
                            "type": "text",
                            "attachments": [],
                            "call": None,
                            "sender": FRIEND,
                            "senderDisplayName": FRIEND["nickname"],
                            "readAt": None,
                            "createdAt": NOW,
                        },
                        "unreadCount": 0,
                        "muted": False,
                        "canCall": False,
                        "updatedAt": NOW,
                    }
                ]
            },
        )
    elif parsed.path == "/social/friends":
        respond(route, {"friends": [], "incoming": [], "outgoing": [], "blocked": []})
    elif parsed.path == "/social/notifications":
        respond(route, {"items": [], "hasMore": False, "hiddenChannels": [], "channelStates": []})
    elif parsed.path == "/social/summary":
        respond(route, {"unreadMessages": 0, "pendingFriendRequests": 0, "pendingStrangerRequests": 0, "unreadNotifications": 0})
    elif parsed.path == "/moderation/my-reports":
        respond(route, {"items": [report_fixture()]})
    elif parsed.path == "/auth/sessions":
        respond(
            route,
            {
                "sessions": [
                    {
                        "id": "session-1",
                        "issuedAt": NOW,
                        "expiresAt": "2026-09-24T08:00:00.000Z",
                        "ip": "192.0.2.1",
                        "userAgent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/149.0",
                        "current": True,
                    }
                ]
            },
        )
    elif parsed.path == "/discovery/profile/settings":
        respond(
            route,
            {
                "profileAccess": "public",
                "searchable": True,
                "friendRequestPolicy": "everyone",
                "directMessagePolicy": "request",
                "groupInvitationPolicy": "friends",
                "showBio": True,
                "showJoinedAt": True,
                "showStats": True,
                "showFollowingCount": True,
                "showPinnedContent": True,
                "pinnedArticleId": None,
                "pinnedCollectionId": None,
            },
        )
    elif parsed.path == "/articles/mine":
        respond(route, {"items": [], "total": 0, "page": 1, "pageSize": 50, "totalPages": 0})
    elif parsed.path == "/discovery/collections/mine":
        respond(route, {"items": []})
    elif parsed.path == "/reputation/me":
        respond(
            route,
            {
                "experience": 26,
                "points": 8,
                "pendingPoints": 0,
                "level": {"code": "user", "name": "用户", "level": 1, "minExperience": 0},
                "nextLevel": None,
                "experienceToNext": 0,
                "progressPercent": 100,
                "rules": [],
                "recent": [],
            },
        )
    elif parsed.path == "/site-settings/public":
        respond(route, {"siteName": "Test Portal"})
    elif "/messages" in parsed.path:
        respond(route, {"items": [], "hasMore": False})
    else:
        respond(route, {})


def prepare_page(page: Page) -> None:
    page.add_init_script(
        """
        (() => {
          localStorage.setItem('lingxi_access_token', %s);
          localStorage.setItem('lingxi_refresh_token', 'test-refresh-token');
        })();
        """
        % json.dumps(ACCESS_TOKEN)
    )
    page.route("http://127.0.0.1:3001/**", mock_api)
    page.route("http://localhost:3001/**", mock_api)


def open_chat(page: Page) -> None:
    page.evaluate(
        "window.dispatchEvent(new CustomEvent('hlovet-chat-dock-open', { detail: { tab: 'chats' } }))"
    )
    page.locator(".chat-dock").wait_for()
    page.locator('[data-testid="chat-conversation-action-trigger"]').first.wait_for()


def assert_chat_menu(page: Page, label: str) -> None:
    trigger = page.locator('[data-testid="chat-conversation-action-trigger"]').first
    trigger.locator("xpath=../..").hover()
    trigger.click()
    menu = page.locator('[data-testid="chat-conversation-action-menu"]')
    menu.wait_for(state="visible")
    result = menu.evaluate(
        """
        (element) => {
          const rect = element.getBoundingClientRect();
          const style = getComputedStyle(element);
          const point = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
          return {
            left: rect.left,
            top: rect.top,
            right: rect.right,
            bottom: rect.bottom,
            viewportWidth: window.innerWidth,
            viewportHeight: window.innerHeight,
            zIndex: style.zIndex,
            hit: Boolean(point && (point === element || element.contains(point))),
            scrollWidth: document.documentElement.scrollWidth,
          };
        }
        """
    )
    assert result["left"] >= 0, f"{label}: action menu overflows left"
    assert result["right"] <= result["viewportWidth"], f"{label}: action menu overflows right"
    assert result["top"] >= 0, f"{label}: action menu overflows top"
    assert result["bottom"] <= result["viewportHeight"], f"{label}: action menu overflows bottom"
    assert result["zIndex"] == "1300", f"{label}: action menu lost its portal stacking layer"
    assert result["hit"], f"{label}: action menu is covered at its center point"
    if label == "mobile":
        assert result["scrollWidth"] <= result["viewportWidth"], "mobile: page has horizontal overflow"


def assert_my_reports(page: Page, label: str) -> None:
    row = page.locator('[data-testid="my-report-row"]').first
    row.wait_for()
    detail = row.locator('[data-testid="my-report-detail"]')
    metrics = row.evaluate(
        """
        (row) => {
          const main = row.querySelector('.my-report-main').getBoundingClientRect();
          const title = row.querySelector('.my-report-title-line').getBoundingClientRect();
          const detail = row.querySelector('[data-testid="my-report-detail"]').getBoundingClientRect();
          return {
            rowHeight: row.getBoundingClientRect().height,
            mainWidth: main.width,
            titleTop: title.top,
            detailTop: detail.top,
            detailWidth: detail.width,
            detailScrollWidth: row.querySelector('[data-testid="my-report-detail"]').scrollWidth,
          };
        }
        """
    )
    assert metrics["detailTop"] > metrics["titleTop"], f"{label}: report detail did not move to its second row"
    assert metrics["detailWidth"] >= metrics["mainWidth"] - 1, f"{label}: report detail does not use the main column width"
    assert metrics["detailScrollWidth"] > metrics["detailWidth"], f"{label}: fixture did not exercise overflow handling"

    detail.hover()
    tooltip = page.locator('[data-testid="my-report-detail-tooltip"]')
    tooltip.wait_for(state="visible")
    tooltip_style = tooltip.evaluate(
        """
        (element) => {
          const rect = element.getBoundingClientRect();
          const style = getComputedStyle(element);
          return { text: element.textContent, top: rect.top, borderWidth: style.borderWidth, borderStyle: style.borderStyle, blur: style.backdropFilter };
        }
        """
    )
    assert tooltip_style["text"] == detail.get_attribute("aria-label")
    assert tooltip_style["borderWidth"] == "0px"
    assert tooltip_style["borderStyle"] == "none"
    assert "blur" in tooltip_style["blur"]


def assert_profile_section_order(page: Page, label: str) -> None:
    page.goto(f"{BASE_URL}/profile", wait_until="domcontentloaded")
    session_toggle = page.locator('button[aria-controls="account-sessions-panel"]')
    session_toggle.wait_for()
    session_toggle.click()
    page.locator("#account-sessions-panel").wait_for()
    order = page.evaluate(
        """
        () => {
          const grid = document.querySelector('.profile-settings-grid');
          const sessions = grid?.querySelector('.account-sessions-panel');
          const reputation = grid?.querySelector('.reputation-panel');
          if (!grid || !sessions || !reputation) return null;
          const relation = sessions.compareDocumentPosition(reputation);
          return { sessionsBeforeReputation: Boolean(relation & Node.DOCUMENT_POSITION_FOLLOWING) };
        }
        """
    )
    assert order and order["sessionsBeforeReputation"], f"{label}: login sessions are not before growth and points"


def run() -> None:
    with sync_playwright() as playwright:
        browser: Browser = playwright.chromium.launch(headless=True)
        try:
            for label, viewport in (("desktop", {"width": 1440, "height": 900}), ("mobile", {"width": 390, "height": 844})):
                page = browser.new_page(viewport=viewport)
                prepare_page(page)
                page.goto(f"{BASE_URL}/profile/reports", wait_until="domcontentloaded")
                assert_my_reports(page, label)
                profile_page = browser.new_page(viewport=viewport)
                prepare_page(profile_page)
                assert_profile_section_order(profile_page, label)
                profile_page.close()
                open_chat(page)
                assert_chat_menu(page, label)
                page.close()
                print(f"PASS {label}: report rows, overflow tooltip, chat menu bounds, and profile section order")
        finally:
            browser.close()


if __name__ == "__main__":
    run()
