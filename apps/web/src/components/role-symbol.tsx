import type { ReactNode } from "react";

const ROLE_PATHS: Record<string, ReactNode> = {
  qi_refining: (
    <path d="M12.2 2.6c.5 3.2-.7 5-2.3 6.7-1.5 1.6-2.8 3.2-2.8 5.6a5 5 0 0 0 10 0c0-1.5-.6-3-1.8-4.4-.1 2.2-1.1 3.4-2.3 4.2.3-2.8-.2-5.2-2.1-7.4.1-1.8.5-3.3 1.3-4.7Z" />
  ),
  foundation_building: (
    <path
      d="m12 2.8 9.2 8.4L12 21.2l-9.2-10L12 2.8Zm0 5.1-4.1 3.8 4.1 4.5 4.1-4.5L12 7.9Z"
      fillRule="evenodd"
    />
  ),
  golden_core: (
    <>
      <circle cx="12" cy="12" r="5.3" />
      <circle cx="12" cy="2.5" r="1.25" />
      <circle cx="18.7" cy="5.3" r="1.25" />
      <circle cx="21.5" cy="12" r="1.25" />
      <circle cx="18.7" cy="18.7" r="1.25" />
      <circle cx="12" cy="21.5" r="1.25" />
      <circle cx="5.3" cy="18.7" r="1.25" />
      <circle cx="2.5" cy="12" r="1.25" />
      <circle cx="5.3" cy="5.3" r="1.25" />
    </>
  ),
  nascent_soul: (
    <path d="M17.8 4.5A8.8 8.8 0 1 0 19.5 18 7.1 7.1 0 1 1 17.8 4.5Z" />
  ),
  spirit_transformation: (
    <path d="m12 2.2 2.9 5.9 6.5.9-4.7 4.6 1.1 6.5-5.8-3-5.8 3 1.1-6.5L2.6 9l6.5-.9L12 2.2Z" />
  ),
  void_refining: (
    <path
      d="m12 2.2 8.5 4.9v9.8L12 21.8l-8.5-4.9V7.1L12 2.2Zm0 5.3-3.9 2.2v4.6l3.9 2.2 3.9-2.2V9.7L12 7.5Z"
      fillRule="evenodd"
    />
  ),
  body_integration: (
    <path
      d="M9.2 4.5a7.5 7.5 0 0 1 5.4 2.3 7.5 7.5 0 1 1 0 10.4A7.5 7.5 0 1 1 9.2 4.5Zm2.8 4a4.8 4.8 0 0 0 0 7 4.8 4.8 0 0 0 0-7Z"
      fillRule="evenodd"
    />
  ),
  mahayana: <path d="m12 2.4 4.1 7.1 2-2.5 4.2 14.2H1.7L5.9 7l2 2.5L12 2.4Z" />,
  administrator: (
    <path
      d="M12 2.3 20 5v6.7c0 4.7-3.1 8.1-8 10-4.9-1.9-8-5.3-8-10V5l8-2.7Zm3.8 6.3-4.9 5-2.7-2.5-1.5 1.6 4.2 3.9 6.4-6.5-1.5-1.5Z"
      fillRule="evenodd"
    />
  ),
  super_administrator: (
    <path d="m3.1 6.2 4.6 3.6L12 3l4.3 6.8 4.6-3.6-1.5 11.2H4.6L3.1 6.2Zm2 13h13.8a1.3 1.3 0 0 1 0 2.6H5.1a1.3 1.3 0 0 1 0-2.6Z" />
  ),
};

export function RoleSymbol({
  code,
  className = "",
}: {
  code: string;
  className?: string;
}) {
  return (
    <svg
      aria-hidden="true"
      className={`role-symbol ${className}`.trim()}
      data-role={code}
      fill="currentColor"
      focusable="false"
      viewBox="0 0 24 24"
    >
      {ROLE_PATHS[code] ?? ROLE_PATHS.qi_refining}
    </svg>
  );
}
