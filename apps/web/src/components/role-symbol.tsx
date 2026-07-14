import type { ReactNode } from "react";

const ROLE_PATHS: Record<string, ReactNode> = {
  qi_refining: (
    <>
      <circle cx="12" cy="12" r="5.6" />
      <circle cx="18.2" cy="7.4" r="1.8" />
    </>
  ),
  foundation_building: (
    <>
      <path d="M12 3.8 20.2 12 12 20.2 3.8 12 12 3.8Z" />
      <path d="M8 12h8" />
    </>
  ),
  golden_core: (
    <>
      <circle cx="12" cy="12" r="7.4" />
      <circle cx="12" cy="12" r="3.1" fill="currentColor" />
    </>
  ),
  nascent_soul: (
    <>
      <path d="M16.9 4.8a7.4 7.4 0 1 0 0 14.4 5.9 5.9 0 1 1 0-14.4Z" />
      <circle cx="14.9" cy="9" r="1.4" fill="currentColor" />
    </>
  ),
  spirit_transformation: (
    <path d="m12 3.6 2.2 5 5.3.5-4 3.6 1.2 5.2L12 15.2l-4.7 2.7 1.2-5.2-4-3.6 5.3-.5L12 3.6Z" />
  ),
  void_refining: (
    <>
      <path d="m12 3.6 7.3 4.2v8.4L12 20.4l-7.3-4.2V7.8L12 3.6Z" />
      <path d="M8.4 9.9h7.2M8.4 14.1h7.2" />
    </>
  ),
  body_integration: (
    <>
      <circle cx="9.2" cy="12" r="5.1" />
      <circle cx="14.8" cy="12" r="5.1" />
    </>
  ),
  mahayana: (
    <>
      <path d="M12 3.8 20.4 18H3.6L12 3.8Z" />
      <path d="M8.2 15.2h7.6M12 8.6v6.6" />
    </>
  ),
  administrator: (
    <path d="M12 3.6 19 6.2v5.9c0 4.1-2.8 7-7 8.3-4.2-1.3-7-4.2-7-8.3V6.2l7-2.6Z" />
  ),
};

export function RoleSymbol({ code, className = "" }: { code: string; className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={`role-symbol ${className}`.trim()}
      fill="none"
      focusable="false"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.8"
      viewBox="0 0 24 24"
    >
      {ROLE_PATHS[code] ?? ROLE_PATHS.qi_refining}
    </svg>
  );
}
