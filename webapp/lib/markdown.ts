import 'server-only';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { marked } from 'marked';

const REPOS_PATH = process.env.REPOS_PATH ?? '/var/repos';

/**
 * Read a markdown body from lista-knowledge by relative path
 * (e.g. "business/moolah/emission.md") and return both the rendered HTML
 * for prose and the raw fenced ```mermaid blocks for client-side render.
 */
export async function loadMarkdown(
  relPath: string
): Promise<{ html: string; mermaidBlocks: string[] }> {
  const abs = join(REPOS_PATH, 'lista-knowledge', relPath);
  const raw = await readFile(abs, 'utf8');
  const body = raw.replace(/^---\n[\s\S]*?\n---\n/, ''); // strip frontmatter

  const mermaidBlocks: string[] = [];
  const stripped = body.replace(/```mermaid\n([\s\S]*?)```/g, (_m, code: string) => {
    const idx = mermaidBlocks.length;
    mermaidBlocks.push(code);
    return `<div data-mermaid-placeholder="${idx}"></div>`;
  });

  marked.setOptions({ gfm: true, breaks: false });
  const html = await marked.parse(stripped);
  return { html, mermaidBlocks };
}
