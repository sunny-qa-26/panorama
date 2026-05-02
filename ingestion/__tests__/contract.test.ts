import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { ingestContract } from '../src/ingestors/contract.js';

const FIXTURE = join(__dirname, 'fixtures/contract');

describe('contract ingestor', () => {
  it('parses markdown tables into Contract nodes', async () => {
    const out = await ingestContract({ knowledgeRoot: join(FIXTURE, 'lista-knowledge') });
    const names = out.nodes.filter(n => n.type === 'contract').map(n => (n.data as { name: string }).name);
    expect(names).toEqual(expect.arrayContaining(['Moolah', 'InterestRateModel', 'Liquidator', 'OracleAdaptor']));
  });

  it('captures address + chain', async () => {
    const out = await ingestContract({ knowledgeRoot: join(FIXTURE, 'lista-knowledge') });
    const moolah = out.nodes.find(n => (n.data as { name: string }).name === 'Moolah');
    const d = moolah!.data as { address: string; chain: string };
    expect(d.address).toBe('0x8F73b65B4caAf64FBA2aF91cC5D4a2A1318E5D8C');
    expect(d.chain).toBe('bsc-mainnet');
  });

  it('matches ABI file when filename matches contract name', async () => {
    const out = await ingestContract({ knowledgeRoot: join(FIXTURE, 'lista-knowledge') });
    const moolah = out.nodes.find(n => (n.data as { name: string }).name === 'Moolah');
    expect((moolah!.data as { abiPath: string | null }).abiPath).toBe('onchain/abis/Moolah.json');
    const liq = out.nodes.find(n => (n.data as { name: string }).name === 'Liquidator');
    expect((liq!.data as { abiPath: string | null }).abiPath).toBeNull();
  });

  it('uses (chain, address) as the dedup key', async () => {
    const out = await ingestContract({ knowledgeRoot: join(FIXTURE, 'lista-knowledge') });
    const keys = out.nodes.filter(n => n.type === 'contract').map(n => n.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
