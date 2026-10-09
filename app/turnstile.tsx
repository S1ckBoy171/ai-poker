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
  const container = useRef<HTMLDivElement>(null);
  const [loaded, setLoaded] = useState(false);
  const reportToken = useEffectEvent(onToken);
  useEffect(() => {
    if (!TURNSTILE_SITE_KEY || !loaded || !container.current || !window.turnstile) {
      return;
    }
    const widgetId = window.turnstile.render(container.current, {
      sitekey: TURNSTILE_SITE_KEY,
      theme: "dark",
      callback: (token: string) => reportToken(token),
      "expired-callback": () => reportToken(""),
      "error-callback": () => reportToken(""),
    });
    return () => window.turnstile?.remove(widgetId);
  }, [loaded]);
  if (!TURNSTILE_SITE_KEY) {
    return null;
  }
  return (
    <>
      <Script src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit" onReady={() => setLoaded(true)} />
      <div ref={container} className="flex min-h-[65px] justify-center" />
    </>
  );
}
