import * as Sentry from '@sentry/nextjs';
import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import React from 'react';

import { ServiceWorkerRegister } from '@/components/pwa/ServiceWorkerRegister';
import { Providers } from '@/providers/Providers';

import './globals.css';
import { siteConfig } from './siteConfig';

const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-inter',
});

export const viewport: Viewport = {
  themeColor: '#111111',
  width: 'device-width',
  initialScale: 1,
};

export function generateMetadata(): Metadata {
  const sentryData = Sentry.getTraceData();
  const filteredSentryData = Object.fromEntries(
    Object.entries(sentryData).filter(([_, value]) => value !== undefined)
  );

  return {
    metadataBase: new URL(siteConfig.url),
    title: siteConfig.name,
    description: siteConfig.description,
    keywords: [],
    authors: [
      {
        name: siteConfig.name,
        url: siteConfig.url,
      },
    ],
    creator: siteConfig.name,
    openGraph: {
      type: 'website',
      locale: 'en_US',
      url: siteConfig.url,
      title: siteConfig.name,
      description: siteConfig.description,
      siteName: siteConfig.name,
    },
    applicationName: 'RMO',
    appleWebApp: {
      capable: true,
      title: 'RMO',
      statusBarStyle: 'black-translucent',
    },
    icons: {
      icon: [
        { url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
        { url: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
      ],
      apple: { url: '/icons/apple-touch-icon.png', sizes: '180x180' },
    },
    other: {
      ...filteredSentryData,
    },
  };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body
        className={`${inter.className} overflow-x-hidden bg-background text-text antialiased`}
        suppressHydrationWarning
      >
        <Providers>{children}</Providers>
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}
