"use client";

/**
 * Display preferences that belong to the device, not the account.
 *
 * Text size is stored in localStorage rather than on the user: someone reading
 * on a phone in bright sunlight wants larger type there and not on the desktop
 * they use at work, and the preference should survive being signed out.
 */

const TEXT_SIZE_KEY = "niramoy:text-size";
export const TEXT_SIZES = [
  { id: "default", label: "Default", hint: "Standard size" },
  { id: "large", label: "Large", hint: "About 15% larger" },
  { id: "larger", label: "Larger", hint: "About a third larger" },
];

export function readTextSize() {
  if (typeof window === "undefined") return "default";
  const stored = window.localStorage.getItem(TEXT_SIZE_KEY);
  return TEXT_SIZES.some((s) => s.id === stored) ? stored : "default";
}

export function applyTextSize(size) {
  if (typeof document === "undefined") return;
  if (size === "default") document.documentElement.removeAttribute("data-text-size");
  else document.documentElement.setAttribute("data-text-size", size);
}

export function setTextSize(size) {
  window.localStorage.setItem(TEXT_SIZE_KEY, size);
  applyTextSize(size);
}
