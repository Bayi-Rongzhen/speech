import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'),
  title: '讲清楚｜限时学习与演说训练',
  description: '用约二十分钟完成限时学习、录音演说、针对性反馈和同题重讲，让表达进步听得见。',
  openGraph: {
    title: '讲清楚｜把陌生问题，讲成自己的答案',
    description: '限时学习、录音演说、针对性反馈、同题重讲。用一次完整闭环，让表达进步听得见。',
    type: 'website',
    locale: 'zh_CN',
    images: [{ url: '/og.png', width: 1200, height: 630, alt: '讲清楚演说训练' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: '讲清楚｜把陌生问题，讲成自己的答案',
    description: '限时学习、录音演说、针对性反馈、同题重讲。',
    images: ['/og.png'],
  },
  icons: {
    icon: '/icon.png',
    apple: '/icon-192.png',
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
