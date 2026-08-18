import "./globals.css";

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
