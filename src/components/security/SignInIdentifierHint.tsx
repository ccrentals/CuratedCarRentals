"use client";

import { useEffect, useState } from "react";

const IDENTIFIER_INPUT_SELECTOR =
  'input[name="identifier"], input[autocomplete="username"], input[id*="identifier"]';

function findIdentifierInput() {
  if (typeof document === "undefined") return null;
  return document.querySelector<HTMLInputElement>(IDENTIFIER_INPUT_SELECTOR);
}

export function SignInIdentifierHint() {
  const [identifierValue, setIdentifierValue] = useState("");

  useEffect(() => {
    if (typeof document === "undefined") return;

    let activeInput: HTMLInputElement | null = null;

    const bindInput = () => {
      const nextInput = findIdentifierInput();
      if (nextInput === activeInput) {
        return;
      }

      if (activeInput) {
        activeInput.removeEventListener("input", handleInput);
      }

      activeInput = nextInput;
      if (activeInput) {
        setIdentifierValue(activeInput.value ?? "");
        activeInput.addEventListener("input", handleInput);
      }
    };

    const handleInput = (event: Event) => {
      const target = event.target as HTMLInputElement | null;
      setIdentifierValue(target?.value ?? "");
    };

    bindInput();
    const observer = new MutationObserver(() => bindInput());
    observer.observe(document.body, { childList: true, subtree: true });
    const poll = window.setInterval(bindInput, 400);

    return () => {
      window.clearInterval(poll);
      observer.disconnect();
      if (activeInput) {
        activeInput.removeEventListener("input", handleInput);
      }
    };
  }, []);

  const normalized = identifierValue.trim().toLowerCase();
  const showUsernameFormatHint = normalized.includes(".") && !normalized.includes("@");

  return (
    <div
      className="mt-3 rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] p-3 text-xs text-[var(--ccr-muted)]"
      data-testid="sign-in-identifier-helper"
    >
      <p className="font-semibold text-[var(--ccr-text)]">Email address or username</p>
      <p className="mt-1">Username format: first initial + last name (e.g., mmalcolm).</p>
      {showUsernameFormatHint ? (
        <p
          className="mt-2 rounded-lg border border-amber-300/40 bg-amber-500/10 px-2 py-1 text-[11px] text-amber-300"
          data-testid="sign-in-username-dot-hint"
        >
          Usernames don&apos;t use dots. Try mmalcolm format, or use your email.
        </p>
      ) : null}
    </div>
  );
}
