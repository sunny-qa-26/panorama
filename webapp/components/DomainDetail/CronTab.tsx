import type { DomainCron } from '@/lib/domain';

export function CronTab({ crons }: { crons: DomainCron[] }) {
  if (crons.length === 0) return <p className="text-text-3">No cron jobs linked to this domain.</p>;
  return (
    <table className="w-full text-sm">
      <thead className="text-text-3 text-xs uppercase">
        <tr>
          <th className="text-left py-2">Name</th>
          <th className="text-left">Schedule / Job ID</th>
          <th className="text-left">Handler</th>
          <th className="text-left">File</th>
          <th>Confidence</th>
        </tr>
      </thead>
      <tbody>
        {crons.map((c) => (
          <tr key={c.id} className="border-t border-bg-3">
            <td className="py-2 font-mono">{c.name}</td>
            <td className="font-mono text-text-2">{c.jobId ?? c.schedule ?? '—'}</td>
            <td className="text-text-2">{c.handlerClass ?? '—'}</td>
            <td className="text-text-3 font-mono text-xs">
              {c.repo}/{c.filePath}
              {c.lineNo ? `:${c.lineNo}` : ''}
            </td>
            <td className="text-center font-mono text-xs">{c.confidence.toFixed(2)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
