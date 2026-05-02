-- Phase 2.5 hotfix step 2: route → contract junction.
-- User flagged that the launchpool frontend uses contracts but Panorama doesn't
-- detect it. The lista-mono apps reference contracts via `ContractNames.X` enum
-- from @lista/onchain. The frontend ingestor scans component sources for these
-- enum members and the orchestrator resolves them against panorama_contract.name.
CREATE TABLE IF NOT EXISTS panorama_route_contract_call (
  route_id        BIGINT NOT NULL,
  contract_id     BIGINT NOT NULL,
  PRIMARY KEY (route_id, contract_id),
  KEY idx_contract (contract_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
