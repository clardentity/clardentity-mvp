import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Outfit } from "next/font/google";
import "./globals.css";
import { AuthProvider } from "@/lib/auth";
import { AccentScope, ThemeProvider, THEME_INIT_SCRIPT } from "@/lib/theme";
import { TourProvider } from "@/lib/tour";
import { TourOverlay } from "@/components/tour/TourOverlay";
import { Analytics } from "@/components/system/Analytics";
import { ConsentBanner } from "@/components/system/ConsentBanner";
import { ServerWakingNotice } from "@/components/system/ServerWakingNotice";

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

/* The landing page's typeface, from the Figma design. Loaded here rather
   than in the page so it is part of the font CSS the document already emits;
   scoped to that page by the variable, so the app itself is untouched. */
const outfit = Outfit({
  variable: "--font-outfit",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
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
    icon: [
      // First, and sizes="any", which is how a browser is told to prefer the
      // vector: the mark on nothing, in whichever of its two colours suits
      // the chrome it lands in. The PNG and the .ico behind it are the tile,
      // for anything that cannot render an SVG icon.
      { url: "/icon.svg", type: "image/svg+xml", sizes: "any" },
      { url: "/favicon-32.png", sizes: "32x32", type: "image/png" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180" }],
  },
  // What a pasted link shows. app/opengraph-image.png is picked up by file
  // name; this is the alt text that goes with it, and the absolute base a
  // crawler needs to resolve the image at all.
  metadataBase: new URL("https://clardentity.ai"),
  openGraph: {
    title: "Clardentity",
    description: "Validated, mode-aware, citation-backed conversations.",
    url: "https://clardentity.ai",
    siteName: "Clardentity",
    type: "website",
  },
  twitter: { card: "summary_large_image", title: "Clardentity" },
};

export const viewport: Viewport = {
  // Phone layout: the page reaches the screen's edges and pads itself by the
  // safe-area insets (globals.css, data-safe), and on Android the layout
  // shrinks with the on-screen keyboard so the composer sits right above it
  // instead of under it. Neither does anything on a desktop browser.
  viewportFit: "cover",
  interactiveWidget: "resizes-content",
  // The colour the browser paints its chrome - and, on a phone, the status
  // bar - before the page has rendered. It was #000000, which was the dark
  // canvas until the dark palette was rebuilt and stopped being black; it
  // now names the canvas of whichever theme is about to load, so the chrome
  // never has to correct itself a frame later.
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f5f3f4" },
    { media: "(prefers-color-scheme: dark)", color: "#121013" },
  ],
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
      className={`${geistSans.variable} ${geistMono.variable} ${outfit.variable} h-full antialiased`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
        <script dangerouslySetInnerHTML={{ __html: SW_REGISTER_SCRIPT }} />
      </head>
      {/* The app shell (sidebar + topbar) is applied per-route by RequireAuth,
          so signed-out pages - landing, login, register - stay full-bleed. */}
      <body className="min-h-full bg-canvas text-ink">
        <ThemeProvider>
          <AuthProvider>
            <TourProvider>
              <AccentScope />
              {children}
              <TourOverlay />
              <Analytics />
              <ConsentBanner />
              <ServerWakingNotice />
            </TourProvider>
          </AuthProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
