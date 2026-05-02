export type NodeKind =
  | 'domain' | 'doc' | 'concept' | 'code_ref'
  | 'cron' | 'api' | 'entity' | 'contract' | 'route' | 'redis';

export interface IngestorNode {
  type: NodeKind;
  /** Stable natural key — used to deduplicate across ingestor runs. */
  key: string;
  data: Record<string, unknown>;
}

export interface IngestorEdge {
  sourceType: NodeKind;
  sourceKey: string;
  targetType: NodeKind;
  targetKey: string;
  linkType: 'DESCRIBES' | 'REFERENCES' | 'BELONGS_TO' | 'MENTIONS' | 'CALLS' | 'READS_WRITES';
  confidence: number;       // 0..1
  meta?: Record<string, unknown>;
}

export interface BrokenRef {
  docPath: string;
  docLineNo: number | null;
  refRepo: string;
  refFilePath: string;
  refLineNo: number | null;
  reason: 'file_not_found' | 'content_drift' | 'invalid_pattern';
}

export interface IngestorOutput {
  ingestor: string;          // 'knowledge' | 'cron' | ...
  nodes: IngestorNode[];
  edges: IngestorEdge[];
  brokenRefs: BrokenRef[];
}
