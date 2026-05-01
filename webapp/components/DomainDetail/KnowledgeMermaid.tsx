'use client';

import { useEffect, useRef, useState } from 'react';

export function KnowledgeMermaid({
  html,
  mermaidBlocks
}: {
  html: string;
  mermaidBlocks: string[];
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open || !containerRef.current) return;
    let mounted = true;
    (async () => {
      const mermaid = (await import('mermaid')).default;
      mermaid.initialize({ startOnLoad: false, theme: 'dark', securityLevel: 'strict' });
      const placeholders = containerRef.current!.querySelectorAll('[data-mermaid-placeholder]');
      for (const ph of Array.from(placeholders)) {
        const idx = Number(ph.getAttribute('data-mermaid-placeholder'));
        const code = mermaidBlocks[idx];
        if (!code) continue;
        try {
          const { svg } = await mermaid.render(`mmd-${idx}-${Date.now()}`, code);
          if (mounted) ph.innerHTML = svg;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          ph.innerHTML = `<pre class="text-type-contract">mermaid render failed: ${msg}</pre>`;
        }
      }
    })();
    return () => {
      mounted = false;
    };
  }, [open, mermaidBlocks]);

  return (
    <details
      className="mt-6 border border-bg-3 rounded"
      open={open}
      onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}
    >
      <summary className="cursor-pointer px-4 py-2 select-none text-sm font-medium">
        完整业务文档（含手写 Mermaid 流程图）
      </summary>
      <div
        ref={containerRef}
        className="p-4 max-w-none"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </details>
  );
}
