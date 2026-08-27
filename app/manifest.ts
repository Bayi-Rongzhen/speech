import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: '讲清楚｜限时学习与演说训练',
    short_name: '讲清楚',
    description: '限时学习、录音演说、针对性反馈和同题重讲。',
    start_url: '/',
    display: 'standalone',
    background_color: '#f4f1e8',
    theme_color: '#16271f',
    lang: 'zh-CN',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
  };
}
