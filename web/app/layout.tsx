import { ClerkProvider } from "@clerk/nextjs";
import type { Metadata, Viewport } from "next";
import { Bebas_Neue, JetBrains_Mono, Space_Grotesk } from "next/font/google";
import "./globals.css";

// Ecurious's own type system: the three families ecurious.com uses, all SIL OFL, self-hosted by next/font.
// latin-ext because GoingElectric names cover the rest of Europe; it only loads when those letters appear.
const display = Bebas_Neue({ subsets: ["latin", "latin-ext"], weight: "400", variable: "--font-bebas-neue" });
const sans = Space_Grotesk({ subsets: ["latin", "latin-ext"], variable: "--font-space-grotesk" });
const mono = JetBrains_Mono({ subsets: ["latin", "latin-ext"], variable: "--font-jetbrains-mono" });

export const metadata: Metadata = {
  title: { default: "Baywatch: your charging spot, kept free", template: "%s · Baywatch" },
  description: "Book a public EV charger before you set off. A guard keeps the bay free and the camera checks you in on arrival.",
};

export const viewport: Viewport = {
  themeColor: "#f5f4f1", // paper, so the browser bar runs into the page
  viewportFit: "cover",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" data-scroll-behavior="smooth" className={`${display.variable} ${sans.variable} ${mono.variable}`}>
      <body>
        <ClerkProvider
          afterSignOutUrl="/"
          // our own copy, so the screens don't depend on the app name set in the Clerk dashboard
          localization={{
            signIn: { start: { title: "Sign in", subtitle: "Welcome back to Baywatch" } },
            signUp: { start: { title: "Create your account", subtitle: "Book your first bay in a minute" } },
          }}
          appearance={{
            cssLayerName: "clerk",
            // theme tokens, so a retheme in globals.css reaches Clerk's forms too
            variables: {
              colorPrimary: "var(--color-brand)",
              colorPrimaryForeground: "var(--color-on-brand)",
              colorForeground: "var(--color-ink)",
              colorMutedForeground: "var(--color-muted)",
              colorBackground: "var(--color-surface)",
              colorInput: "var(--color-surface)",
              colorInputForeground: "var(--color-ink)",
              colorDanger: "var(--color-danger)",
              colorWarning: "var(--color-warn)",
              colorBorder: "var(--color-line-strong)", // inputs need 3:1 against the page
              colorRing: "var(--color-accent)", // drawn at 15%: the visible focus ring is the global outline
              colorShadow: "var(--color-ink)",
              colorModalBackdrop: "var(--color-ink)",
              fontFamily: "var(--font-sans)",
              fontFamilyButtons: "var(--font-mono)",
              fontFamilyMono: "var(--font-mono)",
              fontSize: "1rem",
              borderRadius: "0.75rem", // pills are set per element in clerk-card.ts; a 999px base would round the OTP boxes
            },
          }}
        >
          {children}
        </ClerkProvider>
      </body>
    </html>
  );
}
