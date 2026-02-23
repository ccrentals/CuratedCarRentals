"use client";

import { useEffect, type RefObject } from "react";

const FOCUSABLE_SELECTOR =
  'a[href], area[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

type UseDialogA11yOptions = {
  open: boolean;
  onClose: () => void;
  dialogRef: RefObject<HTMLElement | null>;
  restoreFocusRef?: RefObject<HTMLElement | null>;
};

export function useDialogA11y({ open, onClose, dialogRef, restoreFocusRef }: UseDialogA11yOptions) {
  useEffect(() => {
    if (!open) return;
    const dialog = dialogRef.current;
    if (!dialog) return;

    const getFocusableElements = () =>
      Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
        (element) =>
          !element.hasAttribute("disabled") &&
          element.getAttribute("aria-hidden") !== "true" &&
          (element.getClientRects().length > 0 || element === document.activeElement),
      );

    const previousFocusedElement =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }

      if (event.key !== "Tab") return;
      const focusable = getFocusableElements();
      if (focusable.length < 1) {
        event.preventDefault();
        dialog.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const activeElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;

      if (event.shiftKey) {
        if (!activeElement || activeElement === first || !dialog.contains(activeElement)) {
          event.preventDefault();
          last.focus();
        }
        return;
      }

      if (!activeElement || activeElement === last || !dialog.contains(activeElement)) {
        event.preventDefault();
        first.focus();
      }
    };

    const handleFocusIn = (event: FocusEvent) => {
      const target = event.target as Node | null;
      if (target && dialog.contains(target)) return;
      const focusable = getFocusableElements();
      const nextTarget = focusable[0] ?? dialog;
      nextTarget.focus();
    };

    window.addEventListener("keydown", handleKeyDown);
    document.addEventListener("focusin", handleFocusIn);

    const focusTimer = window.requestAnimationFrame(() => {
      const focusable = getFocusableElements();
      const nextTarget = focusable[0] ?? dialog;
      nextTarget.focus();
    });

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      window.cancelAnimationFrame(focusTimer);
      window.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("focusin", handleFocusIn);
      document.body.style.overflow = previousOverflow;

      const restoreTarget = restoreFocusRef?.current ?? previousFocusedElement;
      if (restoreTarget) {
        window.requestAnimationFrame(() => restoreTarget.focus());
      }
    };
  }, [dialogRef, onClose, open, restoreFocusRef]);
}
