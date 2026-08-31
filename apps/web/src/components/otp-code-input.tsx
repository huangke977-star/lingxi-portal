"use client";

import { ClipboardEvent, KeyboardEvent, useEffect, useRef } from "react";

const OTP_LENGTH = 6;

interface OtpCodeInputProps {
  ariaLabel: string;
  autoFocus?: boolean;
  className?: string;
  disabled?: boolean;
  onChange: (value: string) => void;
  onComplete?: (value: string) => void;
  value: string;
}

function normalizeCode(value: string): string {
  return value.replace(/\D/g, "").slice(0, OTP_LENGTH);
}

export function OtpCodeInput({
  ariaLabel,
  autoFocus = false,
  className,
  disabled = false,
  onChange,
  onComplete,
  value,
}: OtpCodeInputProps) {
  const inputRefs = useRef<Array<HTMLInputElement | null>>([]);
  const previousValue = useRef(value);
  const code = normalizeCode(value);
  const digits = Array.from({ length: OTP_LENGTH }, (_, index) => code[index] ?? "");

  useEffect(() => {
    if (autoFocus) inputRefs.current[0]?.focus();
  }, [autoFocus]);

  useEffect(() => {
    if (previousValue.current && !code) inputRefs.current[0]?.focus();
    previousValue.current = code;
  }, [code]);

  function commit(nextValue: string) {
    const nextCode = normalizeCode(nextValue);
    onChange(nextCode);
    if (nextCode.length === OTP_LENGTH) onComplete?.(nextCode);
  }

  function fillFrom(index: number, rawValue: string) {
    const incoming = normalizeCode(rawValue);
    if (!incoming) {
      const next = code.split("");
      next[index] = "";
      onChange(next.join(""));
      return;
    }

    const next = code.padEnd(OTP_LENGTH, " ").split("");
    incoming.split("").forEach((digit, offset) => {
      if (index + offset < OTP_LENGTH) next[index + offset] = digit;
    });
    const nextCode = next.join("").replace(/\s/g, "");
    commit(nextCode);
    const targetIndex = Math.min(OTP_LENGTH - 1, index + incoming.length);
    inputRefs.current[targetIndex]?.focus();
  }

  function handleKeyDown(index: number, event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowLeft" && index > 0) {
      event.preventDefault();
      inputRefs.current[index - 1]?.focus();
      return;
    }
    if (event.key === "ArrowRight" && index < OTP_LENGTH - 1) {
      event.preventDefault();
      inputRefs.current[index + 1]?.focus();
      return;
    }
    if (event.key !== "Backspace" || digits[index] || index === 0) return;

    event.preventDefault();
    const next = code.split("");
    next[index - 1] = "";
    onChange(next.join(""));
    inputRefs.current[index - 1]?.focus();
  }

  function handlePaste(index: number, event: ClipboardEvent<HTMLInputElement>) {
    const pasted = normalizeCode(event.clipboardData.getData("text"));
    if (!pasted) return;
    event.preventDefault();
    fillFrom(index, pasted);
  }

  return (
    <div aria-label={ariaLabel} className={`otp-code-input${className ? ` ${className}` : ""}`} role="group">
      {digits.map((digit, index) => (
        <input
          aria-label={`${ariaLabel} ${index + 1}`}
          autoComplete={index === 0 ? "one-time-code" : "off"}
          disabled={disabled}
          inputMode="numeric"
          key={index}
          maxLength={1}
          onChange={(event) => fillFrom(index, event.target.value)}
          onFocus={(event) => event.currentTarget.select()}
          onKeyDown={(event) => handleKeyDown(index, event)}
          onPaste={(event) => handlePaste(index, event)}
          pattern="[0-9]*"
          ref={(element) => {
            inputRefs.current[index] = element;
          }}
          type="text"
          value={digit}
        />
      ))}
    </div>
  );
}
