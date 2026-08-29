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

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
