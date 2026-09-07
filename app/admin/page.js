"use client";

/**
 * The administration portal, on its own URL.
 *
 * Keeping it off the public entry point means a patient never sees an "Admin"
 * tab they cannot use. It is worth being exact about what this is and is not:
 * a separate path is not a security boundary — anyone who guesses this URL
 * reaches this page. What actually protects administration is unchanged and
 * lives on the server: the staff invite code at sign-up, and the role checks
 * every admin API performs on the session. This split is about not putting a
 * door in front of people who have no business walking through it, not about
 * the lock on that door.
 */
import { LanguageProvider } from "../lib/i18n.js";
import { Workspace } from "../components/workspace.js";

export default function AdminPortal() {
  return (
    <LanguageProvider>
      <Workspace portal="admin" />
    </LanguageProvider>
  );
}
