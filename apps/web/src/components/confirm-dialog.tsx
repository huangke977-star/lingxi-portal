"use client";

import { AlertTriangle, Check, X } from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useLanguage } from "@/components/language-provider";

interface ConfirmOptions {
  title?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}

interface ConfirmRequest {
  id: number;
  message: string;
  options: ConfirmOptions;
  resolve: (confirmed: boolean) => void;
}

interface ConfirmContextValue {
  confirm: (message: string, options?: ConfirmOptions) => Promise<boolean>;
}

const ConfirmContext = createContext<ConfirmContextValue | null>(null);

export function ConfirmDialogProvider({ children }: { children: ReactNode }) {
  const { phrase, t } = useLanguage();
  const [request, setRequest] = useState<ConfirmRequest | null>(null);
  const nextIdRef = useRef(0);
  const queueRef = useRef<ConfirmRequest[]>([]);

  const resolveRequest = useCallback((confirmed: boolean) => {
    setRequest((current) => {
      if (current) current.resolve(confirmed);
      return queueRef.current.shift() ?? null;
    });
  }, []);

  const confirm = useCallback((message: string, options: ConfirmOptions = {}) => (
    new Promise<boolean>((resolve) => {
      const nextRequest: ConfirmRequest = {
        id: ++nextIdRef.current,
        message,
        options,
        resolve,
      };
      setRequest((current) => {
        if (current) {
          queueRef.current.push(nextRequest);
          return current;
        }
        return nextRequest;
      });
    })
  ), []);

  useEffect(() => {
    if (!request) return;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") resolveRequest(false);
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [request, resolveRequest]);

  const value = { confirm };
  const activeOptions = request?.options;

  return (
    <ConfirmContext.Provider value={value}>
      {children}
      {request && typeof document !== "undefined" ? createPortal(
        <div
          aria-hidden="true"
          className="modal-backdrop modal-backdrop--light confirm-dialog-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) resolveRequest(false);
          }}
          role="presentation"
        >
          <section
            aria-describedby={`confirm-dialog-message-${request.id}`}
            aria-modal="true"
            aria-labelledby={`confirm-dialog-title-${request.id}`}
            className={`confirm-dialog${activeOptions?.danger ? " danger" : ""}`}
            onMouseDown={(event) => event.stopPropagation()}
            role="alertdialog"
          >
            <header>
              <span className="confirm-dialog-icon"><AlertTriangle aria-hidden="true" size={18} /></span>
              <strong id={`confirm-dialog-title-${request.id}`}>{activeOptions?.title ?? phrase("请确认", "Please confirm")}</strong>
            </header>
            <p id={`confirm-dialog-message-${request.id}`}>{request.message}</p>
            <footer>
              <button onClick={() => resolveRequest(false)} type="button">
                <X aria-hidden="true" size={15} />
                {activeOptions?.cancelLabel ?? t("common.cancel")}
              </button>
              <button className="confirm-dialog-submit" onClick={() => resolveRequest(true)} type="button">
                <Check aria-hidden="true" size={15} />
                {activeOptions?.confirmLabel ?? t("common.confirm")}
              </button>
            </footer>
          </section>
        </div>,
        document.body,
      ) : null}
    </ConfirmContext.Provider>
  );
}

export function useConfirm(): ConfirmContextValue {
  const context = useContext(ConfirmContext);
  if (!context) throw new Error("useConfirm must be used inside ConfirmDialogProvider");
  return context;
}
