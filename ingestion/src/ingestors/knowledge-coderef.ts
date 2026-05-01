const REPOS = ['lista-mono', 'lista-admin', 'lista-bot', 'lista-cron', 'lista-knowledge'] as const;

// Match bare paths and markdown links. Examples that should match:
//   lista-cron/src/modules/moolah/emission.service.ts:42
//   `lista-cron/src/foo.ts:88`
//   [emission.service.ts:42](../../../lista-cron/src/modules/moolah/emission.service.ts)
const PATH_RE = new RegExp(
  '(?:^|[\\s`(\\[/])((?:' + REPOS.join('|') + ')/[A-Za-z0-9_./\\-]+\\.(?:ts|tsx|js|jsx|sol|py|sql|md))(?::(\\d+))?',
  'g'
);

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
      const filePath = fullPath.slice(repo.length + 1);
      hits.push({
        repo,
        filePath,
        lineNo: lineNoStr ? Number(lineNoStr) : null,
        docLineNo: i + 1
      });
    }
  }
  return hits;
}
