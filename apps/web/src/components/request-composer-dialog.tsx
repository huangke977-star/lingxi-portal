"use client";

import { Send, X } from "lucide-react";
import { type FormEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useLanguage } from "@/components/language-provider";

interface RequestComposerDialogProps {
  children?: ReactNode;
  icon: ReactNode;
  isSubmitting: boolean;
  label: string;
  maxLength: number;
  onChange: (value: string) => void;
  onClose: () => void;
  onSubmit: () => void;
  placeholder: string;
  requireContent?: boolean;
  submitLabel: string;
  title: string;
  value: string;
}

export function RequestComposerDialog({
  children,
  icon,
  isSubmitting,
  label,
  maxLength,
  onChange,
  onClose,
  onSubmit,
  placeholder,
  requireContent = false,
  submitLabel,
  title,
  value,
}: RequestComposerDialogProps) {
  const { phrase, t } = useLanguage();
  if (typeof document === "undefined") return null;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmitting || (requireContent && !value.trim())) return;
    onSubmit();
  }

  return createPortal(
    <div className="modal-backdrop modal-backdrop--light request-composer-backdrop" role="presentation">
      <section aria-modal="true" className="chat-add-friend-dialog request-composer-dialog" role="dialog">
        <header>
          <span>{icon}<strong>{title}</strong></span>
          <button aria-label={t("common.close")} disabled={isSubmitting} onClick={onClose} title={t("common.close")} type="button"><X aria-hidden="true" size={17} /></button>
        </header>
        <form onSubmit={submit}>
          {children ? <div className="request-composer-context">{children}</div> : null}
          <label>
            <span>{label}</span>
            <div className="request-composer-input">
              <textarea autoFocus maxLength={maxLength} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} rows={5} value={value} />
              <small>{value.length} / {maxLength}</small>
              <button aria-label={isSubmitting ? phrase(`正在${submitLabel}`, `Sending ${submitLabel}`) : submitLabel} disabled={isSubmitting || (requireContent && !value.trim())} title={submitLabel} type="submit"><Send aria-hidden="true" size={17} /></button>
            </div>
          </label>
        </form>
      </section>
    </div>,
    document.body,
  );
}
