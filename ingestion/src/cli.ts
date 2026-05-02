import { randomUUID } from 'node:crypto';
import { ingestKnowledge } from './ingestors/knowledge.js';
import { ingestCron } from './ingestors/cron.js';
import { ingestApi } from './ingestors/api.js';
import { ingestEntity } from './ingestors/entity.js';
import { ingestContract } from './ingestors/contract.js';
import { ingestFrontend } from './ingestors/frontend.js';
import { ingestRedis } from './ingestors/redis.js';
import { runOrchestrator } from './orchestrator.js';
import { detectBrokenRefs } from './broken-refs.js';
import { loadGraph } from './loader.js';
import { closePool } from './db.js';
import { loadEnv } from './env.js';
import { log } from './log.js';

async function rebuild() {
  const env = loadEnv();
  const buildId = randomUUID();
  const triggerType = (process.env.TRIGGER_TYPE === 'cron' ? 'cron' : 'manual') as 'cron' | 'manual';
  const triggeredBy = process.env.TRIGGERED_BY ?? process.env.USER ?? 'unknown';

  log('info', 'rebuild start', { buildId, triggerType, triggeredBy });

  const knowledgeOut = await ingestKnowledge({
    knowledgeRoot: `${env.reposPath}/lista-knowledge`
  });
  log('info', 'knowledge done', { nodes: knowledgeOut.nodes.length, edges: knowledgeOut.edges.length });

  const cronOut = await ingestCron({
    reposPath: env.reposPath,
    repos: ['lista-cron', 'lista-bot']
  });
  log('info', 'cron done', { nodes: cronOut.nodes.length, edges: cronOut.edges.length });

  const apiOut = await ingestApi({
    reposPath: env.reposPath,
    repos: ['lista-admin']
  });
  log('info', 'api done', { nodes: apiOut.nodes.length, edges: apiOut.edges.length });

  const entityOut = await ingestEntity({
    reposPath: env.reposPath,
    repos: ['lista-admin', 'lista-cron', 'lista-bot']
  });
  log('info', 'entity done', { nodes: entityOut.nodes.length, edges: entityOut.edges.length });

  const contractOut = await ingestContract({
    knowledgeRoot: `${env.reposPath}/lista-knowledge`
  });
  log('info', 'contract done', { nodes: contractOut.nodes.length, edges: contractOut.edges.length });

  const frontendOut = await ingestFrontend({
    monoRoot: `${env.reposPath}/lista-mono`
  });
  log('info', 'frontend done', { nodes: frontendOut.nodes.length, edges: frontendOut.edges.length });

  const redisOut = await ingestRedis({
    reposPath: env.reposPath,
    repos: ['lista-cron', 'lista-bot', 'lista-admin']
  });
  log('info', 'redis done', { nodes: redisOut.nodes.length, edges: redisOut.edges.length });

  const merged = runOrchestrator([
    knowledgeOut, cronOut, apiOut, entityOut,
    contractOut, frontendOut, redisOut
  ]);
  merged.brokenRefs.push(...await detectBrokenRefs({
    nodes: merged.nodes, reposPath: env.reposPath
  }));
  log('info', 'orchestrate done', {
    nodes: merged.nodes.length, edges: merged.edges.length,
    brokenRefs: merged.brokenRefs.length
  });

  await loadGraph({ merged, buildId, triggerType, triggeredBy });
  log('info', 'rebuild ok', { buildId });
}

function usage(): never {
  console.error('Usage: tsx src/cli.ts rebuild');
  process.exit(1);
}

async function main() {
  const cmd = process.argv[2];
  if (cmd !== 'rebuild') usage();
  try {
    await rebuild();
  } finally {
    await closePool();
  }
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  const stack = err instanceof Error ? err.stack ?? msg : msg;
  log('error', 'rebuild failed', { error: msg, stack });
  process.exit(2);
});
