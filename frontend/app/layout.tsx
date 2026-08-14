import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { AuthProvider } from "@/lib/auth";
import { ThemeProvider, THEME_INIT_SCRIPT } from "@/lib/theme";

/* Registered from the document rather than a client component, so it runs
   once per page load regardless of which route mounted. Failure is silent and
   harmless: the worker only makes the app installable and cold launches
   quick, so a browser that refuses it loses nothing that matters. */
const SW_REGISTER_SCRIPT = `
if ('serviceWorker' in navigator) {
  window.addEventListener('load', function () {
    navigator.serviceWorker.register('/sw.js').catch(function () {});
  });
}
`;

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Clardentity",
  description: "Validated, mode-aware, citation-backed conversations.",
  // Installable as a desktop/mobile app - see app/manifest.ts.
  manifest: "/manifest.webmanifest",
  applicationName: "Clardentity",
  appleWebApp: { capable: true, title: "Clardentity", statusBarStyle: "black-translucent" },
  icons: {
    icon: [{ url: "/favicon-32.png", sizes: "32x32", type: "image/png" }],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180" }],
  },
};

export const viewport: Viewport = {
  // Matches the manifest, so the installed window's chrome is the same black
  // as the canvas rather than flashing white on launch.
  themeColor: "#000000",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      // The theme attribute is written by the script below before paint, so
      // the server-rendered markup deliberately omits it - React would
      // otherwise flag the difference as a hydration mismatch.
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
        <script dangerouslySetInnerHTML={{ __html: SW_REGISTER_SCRIPT }} />
      </head>
      {/* The app shell (sidebar + topbar) is applied per-route by RequireAuth,
          so signed-out pages - landing, login, register - stay full-bleed. */}
      <body className="min-h-full bg-canvas text-ink">
        <ThemeProvider>
          <AuthProvider>{children}</AuthProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
