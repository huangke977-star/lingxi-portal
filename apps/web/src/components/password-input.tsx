"use client";

import { Eye, EyeOff } from "lucide-react";
import type { InputHTMLAttributes, KeyboardEvent, PointerEvent } from "react";
import { useState } from "react";
import { useLanguage } from "@/components/language-provider";

type PasswordInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type">;

export function PasswordInput({ className, ...inputProps }: PasswordInputProps) {
  const { phrase } = useLanguage();
  const [isRevealed, setIsRevealed] = useState(false);

  function showOnPointer(event: PointerEvent<HTMLButtonElement>) {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    event.preventDefault();
    setIsRevealed(true);
  }

  function showOnKeyboard(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key !== " " && event.key !== "Enter") return;
    event.preventDefault();
    setIsRevealed(true);
  }

  function hideOnKeyboard(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key !== " " && event.key !== "Enter") return;
    event.preventDefault();
    setIsRevealed(false);
  }

  return (
    <span className="password-input">
      <input
        {...inputProps}
        className={className}
        type={isRevealed ? "text" : "password"}
      />
      <button
        aria-label={phrase("按住显示密码", "Hold to reveal password")}
        className="password-reveal-control"
        onBlur={() => setIsRevealed(false)}
        onContextMenu={(event) => event.preventDefault()}
        onKeyDown={showOnKeyboard}
        onKeyUp={hideOnKeyboard}
        onPointerCancel={() => setIsRevealed(false)}
        onPointerDown={showOnPointer}
        onPointerLeave={() => setIsRevealed(false)}
        onPointerUp={() => setIsRevealed(false)}
        title={phrase("按住显示密码", "Hold to reveal password")}
        type="button"
      >
        {isRevealed ? (
          <EyeOff aria-hidden="true" size={17} />
        ) : (
          <Eye aria-hidden="true" size={17} />
        )}
      </button>
    </span>
  );
}
