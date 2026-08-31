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
    <html lang="en">
      <head>
        <script dangerouslySetInnerHTML={{ __html: TEXT_SIZE_BOOTSTRAP }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
