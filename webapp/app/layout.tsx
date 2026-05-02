import './globals.css';
import type { Metadata } from 'next';
import BusinessTree from '@/components/BusinessTree';
import { SyncIndicator } from '@/components/SyncIndicator';
import { CommandPalette } from '@/components/CommandPalette';

export const metadata: Metadata = { title: 'Panorama', description: 'Lista DAO 业务全景图' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body className="font-sans">
        <div className="flex h-screen flex-col">
          <header className="h-12 border-b border-bg-3 px-4 flex items-center gap-4 bg-bg-1">
            <span className="font-semibold">Panorama</span>
            <SyncIndicator />
            <span className="ml-auto text-xs text-text-3 font-mono">⌘K to search</span>
          </header>
          <div className="flex flex-1 overflow-hidden">
            <aside className="w-80 bg-bg-1 border-r border-bg-3 overflow-y-auto">
              <div className="px-4 py-3 border-b border-bg-3 text-sm font-semibold">Lista DAO</div>
              <BusinessTree />
            </aside>
            <main className="flex-1 overflow-y-auto p-6">{children}</main>
          </div>
        </div>
        <CommandPalette />
      </body>
    </html>
  );
}
