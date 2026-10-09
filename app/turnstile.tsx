"use client";

import Script from "next/script";
import { useEffect, useEffectEvent, useRef, useState } from "react";

declare global {
  interface Window {
    turnstile?: { render: (el: HTMLElement, options: object) => string; remove: (id: string) => void };
  }
}

export const TURNSTILE_SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;

/**
 * Cloudflare Turnstile CAPTCHA. Calls onToken with a fresh token, or "" when it expires or fails.
 * A token works once: remount (change the key) after each attempt to get a new one. Renders nothing without a site key.
 */
export function Turnstile({ onToken }: { onToken: (token: string) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const [loaded, setLoaded] = useState(false);
  const report = useEffectEvent(onToken);
  useEffect(() => {
    if (!TURNSTILE_SITE_KEY || !loaded || !box.current || !window.turnstile) return;
    const id = window.turnstile.render(box.current, {
      sitekey: TURNSTILE_SITE_KEY,
      theme: "dark",
      callback: (token: string) => report(token),
      "expired-callback": () => report(""),
      "error-callback": () => report(""),
    });
    return () => window.turnstile?.remove(id);
  }, [loaded]);
  if (!TURNSTILE_SITE_KEY) return null;
  return (
    <>
      <Script src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit" onReady={() => setLoaded(true)} />
      <div ref={box} className="flex min-h-[65px] justify-center" />
    </>
  );
}
