"use client";

import { useEffect } from "react";

const SURFACE_SELECTOR = [
  "[role='dialog']",
  "[role='menu']",
  "[role='listbox']",
  ".chat-dock",
  ".header-popover",
  ".account-menu",
  ".public-profile-popover",
  ".chat-emoji-picker",
  ".chat-friend-action-menu",
  ".chat-message-action-menu",
  ".chat-notification-action-menu",
  ".chat-notification-channel-menu",
  ".chat-mobile-tools-panel",
  "[class*='backdrop']",
].join(",");

function getSurface(target: EventTarget | null): HTMLElement | null {
  return target instanceof Element ? target.closest<HTMLElement>(SURFACE_SELECTOR) : null;
}

function canScroll(element: HTMLElement, deltaY: number): boolean {
  if (element.scrollHeight <= element.clientHeight + 1) return false;
  const overflowY = window.getComputedStyle(element).overflowY;
  if (!/(auto|scroll|overlay)/.test(overflowY)) return false;

  const maximumTop = element.scrollHeight - element.clientHeight;
  return deltaY < 0 ? element.scrollTop > 0 : element.scrollTop < maximumTop - 1;
}

function surfaceCanScroll(surface: HTMLElement, target: EventTarget | null, deltaY: number): boolean {
  let current = target instanceof HTMLElement ? target : null;
  while (current) {
    if (canScroll(current, deltaY)) return true;
    if (current === surface) break;
    current = current.parentElement;
  }
  return false;
}

/**
 * Keeps wheel and touch gestures inside floating surfaces from chaining into
 * the document. This also covers Safari, where CSS overscroll containment is
 * not applied consistently to fixed dialogs and popovers.
 */
export function ScrollContainment() {
  useEffect(() => {
    let touchTarget: EventTarget | null = null;
    let touchY = 0;

    function preventBackgroundScroll(target: EventTarget | null, deltaY: number, event: Event) {
      const surface = getSurface(target);
      if (!surface || !surface.isConnected || surfaceCanScroll(surface, target, deltaY)) return;
      event.preventDefault();
    }

    function handleWheel(event: WheelEvent) {
      if (event.ctrlKey || Math.abs(event.deltaY) < 0.5) return;
      preventBackgroundScroll(event.target, event.deltaY, event);
    }

    function handleTouchStart(event: TouchEvent) {
      if (event.touches.length !== 1) {
        touchTarget = null;
        return;
      }
      touchTarget = event.target;
      touchY = event.touches[0].clientY;
    }

    function handleTouchMove(event: TouchEvent) {
      if (event.touches.length !== 1 || !touchTarget) return;
      const nextY = event.touches[0].clientY;
      const deltaY = touchY - nextY;
      touchY = nextY;
      if (Math.abs(deltaY) < 0.5) return;
      preventBackgroundScroll(touchTarget, deltaY, event);
    }

    function clearTouchTarget() {
      touchTarget = null;
    }

    document.addEventListener("wheel", handleWheel, { capture: true, passive: false });
    document.addEventListener("touchstart", handleTouchStart, { capture: true, passive: true });
    document.addEventListener("touchmove", handleTouchMove, { capture: true, passive: false });
    document.addEventListener("touchend", clearTouchTarget, { capture: true, passive: true });
    document.addEventListener("touchcancel", clearTouchTarget, { capture: true, passive: true });

    return () => {
      document.removeEventListener("wheel", handleWheel, true);
      document.removeEventListener("touchstart", handleTouchStart, true);
      document.removeEventListener("touchmove", handleTouchMove, true);
      document.removeEventListener("touchend", clearTouchTarget, true);
      document.removeEventListener("touchcancel", clearTouchTarget, true);
    };
  }, []);

  return null;
}
