"use client";

/**
 * The public application: patients and doctors.
 *
 * Administration is not reachable from here. It lives at /admin, on the same
 * server and behind the same authorization — see app/admin/page.js.
 */
import { LanguageProvider } from "./lib/i18n.js";
import { Workspace } from "./components/workspace.js";

export default function Home() {
  return (
    <LanguageProvider>
      <Workspace portal="public" />
    </LanguageProvider>
  );
}
