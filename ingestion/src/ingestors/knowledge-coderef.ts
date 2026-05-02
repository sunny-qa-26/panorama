const REPOS = ['lista-mono', 'lista-admin', 'lista-bot', 'lista-cron', 'lista-knowledge'] as const;

// Match bare paths and markdown links. Examples that should match:
//   lista-cron/src/modules/moolah/emission.service.ts:42
//   `lista-cron/src/foo.ts:88`
//   [emission.service.ts:42](../../../lista-cron/src/modules/moolah/emission.service.ts)
//
// Brace expansion (e.g. `{a,b}.entity.ts`) is supported via expandBraces() below.
// Char class includes { , } so the regex captures the brace pattern; we then
// expand it into multiple paths.
const PATH_RE = new RegExp(
  '(?:^|[\\s`(\\[/])((?:' + REPOS.join('|') + ')/[A-Za-z0-9_./\\-{},]+\\.(?:ts|tsx|js|jsx|sol|py|sql|md))(?::(\\d+))?',
  'g'
);

const BRACE_RE = /\{([^{}]+)\}/;

/** Expand shell-style brace expansion in a single path. `a/{b,c}/d.ts` → ['a/b/d.ts', 'a/c/d.ts'].
 *  Supports a single brace group only (multi-group products are uncommon in our docs). */
function expandBraces(p: string): string[] {
  const m = p.match(BRACE_RE);
  if (!m || m[1] === undefined) return [p];
  const inner = m[1];
  const variants = inner.split(',').map(s => s.trim()).filter(Boolean);
  if (variants.length === 0) return [p];
  return variants.map(v => p.replace(BRACE_RE, v));
}

export interface CodeRefHit {
  repo: string;
  filePath: string;
  lineNo: number | null;
  /** 1-based line of the markdown source where the ref appeared. */
  docLineNo: number;
}

export function extractCodeRefs(markdown: string): CodeRefHit[] {
  const hits: CodeRefHit[] = [];
  const lines = markdown.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line === undefined) continue;
    PATH_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = PATH_RE.exec(line)) !== null) {
      const fullPath = m[1];
      const lineNoStr = m[2];
      if (!fullPath) continue;
      const repo = REPOS.find(r => fullPath.startsWith(r + '/'));
      if (!repo) continue;
      const tailRaw = fullPath.slice(repo.length + 1);
      // Skip paths that fail brace expansion gracefully (no braces → single variant).
      for (const tail of expandBraces(tailRaw)) {
        if (tail.includes('{') || tail.includes('}')) continue; // malformed brace, skip
        hits.push({
          repo,
          filePath: tail,
          lineNo: lineNoStr ? Number(lineNoStr) : null,
          docLineNo: i + 1
        });
      }
    }
  }
  return hits;
}
