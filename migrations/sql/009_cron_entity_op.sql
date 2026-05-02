-- Phase 2.5 hotfix: cron → entity junction was missing from Phase 2 schema.
-- PRD §5.3 listed "Cron WRITES Entity" as a first-class relationship but the
-- original schema only modelled api→entity. Without this table, the flow chart
-- can't draw lines between crons and the DB tables they write — which the user
-- correctly flagged as making the chart "decorative only".
CREATE TABLE IF NOT EXISTS panorama_cron_entity_op (
  cron_id         BIGINT NOT NULL,
  entity_id       BIGINT NOT NULL,
  op_type         ENUM('READ','WRITE','BOTH') NOT NULL DEFAULT 'BOTH',
  PRIMARY KEY (cron_id, entity_id),
  KEY idx_entity (entity_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
