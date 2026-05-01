import type { DomainDetail } from '@/lib/domain';

export function HeroBlock({ detail }: { detail: DomainDetail }) {
  const lastVerified = detail.docs[0]?.lastVerified ?? null;
  const fmConcepts = detail.docs[0]?.frontmatter?.concepts;
  const concepts: string[] = Array.isArray(fmConcepts)
    ? fmConcepts.filter((c): c is string => typeof c === 'string')
    : [];
  return (
    <header className="border-b border-bg-3 pb-4 mb-6">
      <h1 className="text-2xl font-semibold">{detail.domain.displayName}</h1>
      {detail.domain.description && (
        <p className="text-text-2 mt-2 max-w-prose">{detail.domain.description}</p>
      )}
      <div className="flex items-center gap-3 mt-3 text-sm">
        {concepts.map((c) => (
          <span key={c} className="px-2 py-0.5 rounded bg-bg-2 text-text-2">#{c}</span>
        ))}
        {lastVerified && (
          <span className="ml-auto text-text-3 font-mono text-xs">verified {lastVerified}</span>
        )}
      </div>
    </header>
  );
}
