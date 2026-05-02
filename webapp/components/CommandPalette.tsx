'use client';

import { Command } from 'cmdk';
import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';

interface SearchResult {
  type: string; id: number; name: string;
  subtitle: string | null; score: number; href: string;
}

const TYPE_LABEL: Record<string, string> = {
  domain: 'Domains', doc: 'Docs', cron: 'Cron Jobs', api: 'API Endpoints',
  contract: 'Contracts', entity: 'Entities', redis: 'Redis Keys', route: 'Routes'
};

const TYPE_COLOR: Record<string, string> = {
  domain: 'text-text', doc: 'text-text-2',
  cron: 'text-type-cron', api: 'text-type-api',
  contract: 'text-type-contract', entity: 'text-type-db',
  redis: 'text-type-redis', route: 'text-type-ui'
};

export function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);

  // Cmd+K toggle
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setOpen(o => !o);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  // Debounced search
  useEffect(() => {
    if (!open) return;
    if (!query.trim()) { setResults([]); return; }
    setLoading(true);
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`, { cache: 'no-store' });
        const json = await res.json();
        setResults(json.data ?? []);
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 200);
    return () => clearTimeout(timer);
  }, [query, open]);

  const navigate = useCallback((href: string) => {
    setOpen(false);
    setQuery('');
    router.push(href);
  }, [router]);

  // Group results by type
  const grouped = results.reduce((acc, r) => {
    (acc[r.type] = acc[r.type] ?? []).push(r);
    return acc;
  }, {} as Record<string, SearchResult[]>);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 backdrop-blur-sm pt-[12vh]"
      onClick={() => setOpen(false)}
    >
      <div onClick={(e) => e.stopPropagation()}>
        <Command
          className="w-[640px] max-w-[90vw] bg-bg-1 border border-bg-3 rounded-lg shadow-2xl overflow-hidden"
          shouldFilter={false}
          loop
        >
          <Command.Input
            value={query}
            onValueChange={setQuery}
            placeholder="搜索 domain / cron / api / contract / entity / redis ..."
            autoFocus
            className="w-full px-4 py-3 bg-transparent border-b border-bg-3 outline-none text-sm placeholder:text-text-3"
          />
          <Command.List className="max-h-[400px] overflow-y-auto p-2">
            {loading && <Command.Loading><div className="px-3 py-2 text-text-3 text-xs">Searching…</div></Command.Loading>}
            {!loading && query.trim() && results.length === 0 && (
              <Command.Empty className="px-3 py-6 text-center text-text-3 text-sm">
                No matches for &quot;{query}&quot;
              </Command.Empty>
            )}
            {Object.entries(grouped).map(([type, items]) => (
              <Command.Group key={type} heading={TYPE_LABEL[type] ?? type} className="text-xs text-text-3 px-2 py-1">
                {items.map(r => (
                  <Command.Item
                    key={`${r.type}:${r.id}`}
                    value={`${r.type}:${r.id}:${r.name}`}
                    onSelect={() => navigate(r.href)}
                    className="flex items-center gap-3 px-2 py-2 rounded text-sm cursor-pointer aria-selected:bg-bg-2"
                  >
                    <span className={`text-xs uppercase font-mono w-12 ${TYPE_COLOR[type] ?? 'text-text-3'}`}>{type}</span>
                    <span className="flex-1 truncate">{r.name}</span>
                    {r.subtitle && (
                      <span className="text-xs text-text-3 truncate max-w-xs font-mono">{r.subtitle}</span>
                    )}
                  </Command.Item>
                ))}
              </Command.Group>
            ))}
          </Command.List>
          <div className="border-t border-bg-3 px-4 py-2 text-xs text-text-3 flex justify-between">
            <span>↑↓ navigate · ↵ select · esc close</span>
            <span className="font-mono">cmd+K</span>
          </div>
        </Command>
      </div>
    </div>
  );
}
