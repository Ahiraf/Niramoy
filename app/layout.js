import "./globals.css";

/**
 * `viewport-fit=cover` so the page can paint under the notch and home
 * indicator; the safe-area insets in globals.css keep content out from under
 * them. `maximumScale` is deliberately left alone — capping zoom locks out
 * anyone who needs to enlarge text, and this is a health app.
 */
export const viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#0b867c",
};

export const metadata = {
  title: "Niramoy | Care that comes to you",
  description: "An AI-assisted telemedicine and appointment platform for Bangladesh.",
};

/**
 * Applied before first paint, so a patient who has chosen larger type does not
 * watch the page render at the default size and then jump. It is inlined
 * rather than run from a component for the same reason.
 */
const TEXT_SIZE_BOOTSTRAP = `try{
  var s = localStorage.getItem('niramoy:text-size');
  if (s === 'large' || s === 'larger') document.documentElement.setAttribute('data-text-size', s);
}catch(e){}`;

export default function RootLayout({ children }) {
  return (
    /*
     * `translate="no"` keeps machine translation off this application.
     *
     * Not a preference. The page declares a language and then renders whichever
     * strings the switch selects, so a browser that decides the two disagree
     * will offer to "fix" it — and Brave and Chrome did, turning "continue"
     * into "continuo" and "districts" into "distracts" on the live site. Two
     * things follow from that, and both are worse than ugly copy:
     *
     *   1. Machine translation REPLACES text nodes React owns. React then
     *      updates a node that is no longer there, so live text silently stops
     *      changing — which is why the sign-up countdown sat at 5:00 while the
     *      code behind it expired normally.
     *   2. This is a medical interface. A symptom, a dose or an emergency
     *      instruction re-worded by a general-purpose translator is a clinical
     *      risk, not a cosmetic one.
     *
     * Niramoy ships its own Bangla/English switch, which is the honest way to
     * offer another language: reviewed strings, not a guess layered over the DOM.
     */
    // Bangla is the default; LanguageProvider updates this when it is changed.
    <html lang="bn" translate="no">
      <head>
        <script dangerouslySetInnerHTML={{ __html: TEXT_SIZE_BOOTSTRAP }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
