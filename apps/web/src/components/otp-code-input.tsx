"use client";

import { ClipboardEvent, KeyboardEvent, useEffect, useRef } from "react";

const OTP_LENGTH = 6;

interface OtpCodeInputProps {
  ariaLabel: string;
  autoFocus?: boolean;
  className?: string;
  codeLength?: number;
  disabled?: boolean;
  allowLetters?: boolean;
  onChange: (value: string) => void;
  onComplete?: (value: string) => void;
  value: string;
}

function normalizeCode(value: string, allowLetters: boolean, maxLength: number): string {
  const normalized = allowLetters
    ? value.replace(/[^a-zA-Z0-9]/g, "").toUpperCase()
    : value.replace(/\D/g, "");
  return normalized.slice(0, maxLength);
}

function getCellLengths(codeLength: number): number[] {
  const safeLength = Math.max(OTP_LENGTH, codeLength);
  const baseLength = Math.floor(safeLength / OTP_LENGTH);
  const remainder = safeLength % OTP_LENGTH;
  return Array.from({ length: OTP_LENGTH }, (_, index) => baseLength + (index < remainder ? 1 : 0));
}

export function OtpCodeInput({
  ariaLabel,
  autoFocus = false,
  className,
  codeLength = OTP_LENGTH,
  disabled = false,
  allowLetters = false,
  onChange,
  onComplete,
  value,
}: OtpCodeInputProps) {
  const inputRefs = useRef<Array<HTMLInputElement | null>>([]);
  const previousValue = useRef(value);
  const cellLengths = getCellLengths(codeLength);
  const code = normalizeCode(value, allowLetters, codeLength);
  const cells: string[] = [];
  let cellStart = 0;
  cellLengths.forEach((cellLength) => {
    cells.push(code.slice(cellStart, cellStart + cellLength));
    cellStart += cellLength;
  });

  useEffect(() => {
    if (autoFocus) inputRefs.current[0]?.focus();
  }, [autoFocus]);

  useEffect(() => {
    if (previousValue.current && !code) inputRefs.current[0]?.focus();
    previousValue.current = code;
  }, [code]);

  function commit(nextValue: string) {
    const nextCode = normalizeCode(nextValue, allowLetters, codeLength);
    onChange(nextCode);
    if (nextCode.length === codeLength) onComplete?.(nextCode);
  }

  function fillFrom(index: number, rawValue: string) {
    const start = cellLengths.slice(0, index).reduce((total, length) => total + length, 0);
    const incoming = normalizeCode(rawValue, allowLetters, codeLength - start);
    const nextCode = normalizeCode(`${code.slice(0, start)}${incoming}${code.slice(start + cellLengths[index])}`, allowLetters, codeLength);
    commit(nextCode);
    const targetIndex = Math.min(OTP_LENGTH - 1, index + (incoming.length >= cellLengths[index] ? 1 : 0));
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
    if (event.key !== "Backspace" || cells[index] || index === 0) return;

    event.preventDefault();
    const previousStart = cellLengths.slice(0, index - 1).reduce((total, length) => total + length, 0);
    onChange(normalizeCode(`${code.slice(0, previousStart)}${code.slice(previousStart + cellLengths[index - 1])}`, allowLetters, codeLength));
    inputRefs.current[index - 1]?.focus();
  }

  function handlePaste(index: number, event: ClipboardEvent<HTMLInputElement>) {
    const pasted = normalizeCode(event.clipboardData.getData("text"), allowLetters, codeLength);
    if (!pasted) return;
    event.preventDefault();
    fillFrom(index, pasted);
  }

  return (
    <div aria-label={ariaLabel} className={`otp-code-input${className ? ` ${className}` : ""}`} role="group">
      {cells.map((_, index) => (
        <input
          aria-label={`${ariaLabel} ${index + 1}`}
          autoComplete={index === 0 ? "one-time-code" : "off"}
          disabled={disabled}
          inputMode={allowLetters ? "text" : "numeric"}
          key={index}
          maxLength={cellLengths[index]}
          onChange={(event) => fillFrom(index, event.target.value)}
          onFocus={(event) => event.currentTarget.select()}
          onKeyDown={(event) => handleKeyDown(index, event)}
          onPaste={(event) => handlePaste(index, event)}
          pattern={allowLetters ? "[A-Za-z0-9]*" : "[0-9]*"}
          ref={(element) => {
            inputRefs.current[index] = element;
          }}
          type="text"
          value={cells[index]}
        />
      ))}
    </div>
  );
}
