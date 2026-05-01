import './globals.css';
import type { Metadata } from 'next';
import BusinessTree from '@/components/BusinessTree';

export const metadata: Metadata = { title: 'Panorama', description: 'Lista DAO 业务全景图' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body className="font-sans">
        <div className="flex h-screen">
          <aside className="w-80 bg-bg-1 border-r border-bg-3 overflow-y-auto" id="sidebar">
            <div className="px-4 py-3 border-b border-bg-3 text-sm font-semibold">Lista DAO</div>
            <BusinessTree />
          </aside>
          <main className="flex-1 overflow-y-auto p-6">{children}</main>
        </div>
      </body>
    </html>
  );
}
