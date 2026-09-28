import type { Metadata } from 'next';
import Link from 'next/link';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';

const geistSans = Geist({ variable: '--font-geist-sans', subsets: ['latin'] });
const geistMono = Geist_Mono({ variable: '--font-geist-mono', subsets: ['latin'] });

const description =
  'Before you drop a class, know what it costs you. See what dropping or switching to P/NP does to your UC San Diego degree, get a re-plan the code has checked, and send it to TritonPlan.';

// Vercel sets VERCEL_PROJECT_PRODUCTION_URL at build; locally OG images resolve against localhost.
const siteUrl = process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : 'http://localhost:3000';

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: { default: 'Quarterback', template: '%s · Quarterback' },
  description,
  applicationName: 'Quarterback',
  icons: { icon: '/icon.svg' },
  openGraph: { title: 'Quarterback', description, type: 'website', siteName: 'Quarterback', images: ['/wordmark.svg'] },
};

function Mark() {
  return (
    <svg viewBox="0 0 32 32" width="28" height="28" aria-hidden="true" className="shrink-0">
      <rect width="32" height="32" rx="8" fill="#0f5f4c" />
      <circle cx="15.5" cy="14.5" r="7" fill="none" stroke="#fff" strokeWidth="3" />
      <path d="M19.5 18.5 25 24" stroke="#fff" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full`}>
      <body className="flex min-h-full flex-col">
        <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-surface focus:px-3 focus:py-2 focus:text-sm focus:shadow">
          Skip to content
        </a>
        <header className="border-b border-line bg-surface/80 backdrop-blur">
          <div className="mx-auto flex h-14 w-full max-w-7xl items-center justify-between px-4 sm:px-6">
            <Link href="/" className="flex items-center gap-2.5 font-semibold tracking-tight text-ink">
              <Mark />
              <span>Quarterback</span>
            </Link>
            <nav aria-label="Primary" className="flex items-center gap-5 text-sm text-ink-2">
              <Link href="/plan?demo=a" className="hover:text-ink">Demo</Link>
              <Link href="/about" className="hover:text-ink">About</Link>
            </nav>
          </div>
        </header>
        <main id="main" className="flex-1">{children}</main>
        <footer className="border-t border-line">
          <div className="mx-auto flex w-full max-w-7xl flex-col gap-2 px-4 py-6 text-xs text-ink-3 sm:flex-row sm:items-center sm:justify-between sm:px-6">
            <p>
              MIT licensed ·{' '}
              <a href="https://github.com/SahirSSharma/quarterback" className="underline decoration-line-2 underline-offset-2 hover:text-ink-2" rel="noopener noreferrer" target="_blank">
                GitHub
              </a>{' '}
              · Not affiliated with UC San Diego. Confirm anything that matters with your college advisor.
            </p>
            <p>Runs on Nebius Token Factory with NVIDIA Nemotron.</p>
          </div>
        </footer>
      </body>
    </html>
  );
}
