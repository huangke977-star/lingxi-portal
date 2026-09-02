"use client";

import { ChevronDown } from "lucide-react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { useEffect, useRef, useState } from "react";

export interface GlassSelectOption<T extends string> {
  label: string;
  value: T;
}

export function GlassSelect<T extends string>({
  ariaLabel,
  disabled = false,
  leadingIcon,
  menuClassName,
  menuPortal = false,
  onChange,
  options,
  value,
}: {
  ariaLabel: string;
  disabled?: boolean;
  leadingIcon?: ReactNode;
  menuClassName?: string;
  menuPortal?: boolean;
  onChange: (value: T) => void;
  options: ReadonlyArray<GlassSelectOption<T>>;
  value: T;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState({ left: 0, top: 0, width: 0 });
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const selected = options.find((option) => option.value === value) ?? options[0];

  useEffect(() => {
    function close(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node) && !menuRef.current?.contains(event.target as Node)) setIsOpen(false);
    }
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, []);

  useEffect(() => {
    if (!isOpen || !menuPortal) return;
    function updateMenuPosition() {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const width = Math.max(rect.width, 132);
      const menuHeight = menuRef.current?.getBoundingClientRect().height ?? Math.min(options.length * 32 + 10, 320);
      const opensUp = rect.bottom + 4 + menuHeight > window.innerHeight - 8 && rect.top - menuHeight - 4 >= 8;
      setMenuPosition({
        left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)),
        top: opensUp ? rect.top - menuHeight - 4 : rect.bottom + 4,
        width,
      });
    }
    updateMenuPosition();
    window.addEventListener("resize", updateMenuPosition);
    window.addEventListener("scroll", updateMenuPosition, true);
    return () => {
      window.removeEventListener("resize", updateMenuPosition);
      window.removeEventListener("scroll", updateMenuPosition, true);
    };
  }, [isOpen, menuPortal, options.length]);

  const menu = isOpen ? (
    <div
      aria-label={ariaLabel}
      className={`announcement-editor-select-menu${menuClassName ? ` ${menuClassName}` : ""}${menuPortal ? " announcement-editor-select-menu-portal" : ""}`}
      ref={menuRef}
      role="listbox"
      style={menuPortal ? { left: menuPosition.left, top: menuPosition.top, width: menuPosition.width } : undefined}
    >
      {options.map((option) => (
        <button
          aria-selected={option.value === value}
          key={option.value}
          onClick={() => {
            onChange(option.value);
            setIsOpen(false);
          }}
          role="option"
          type="button"
        >
          {option.label}
        </button>
      ))}
    </div>
  ) : null;

  return (
    <div className="announcement-editor-select" ref={rootRef}>
      <button
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        aria-label={ariaLabel}
        className="announcement-editor-select-trigger"
        disabled={disabled}
        onClick={() => setIsOpen((current) => !current)}
        ref={triggerRef}
        type="button"
      >
        {leadingIcon ? <span className="announcement-editor-select-leading-icon" aria-hidden="true">{leadingIcon}</span> : null}
        <span className="announcement-editor-select-value">{selected?.label ?? value}</span>
        <ChevronDown aria-hidden="true" size={15} />
      </button>
      {menuPortal && typeof document !== "undefined" ? (menu ? createPortal(menu, document.body) : null) : menu}
    </div>
  );
}
