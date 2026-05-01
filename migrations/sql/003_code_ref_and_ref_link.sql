-- Generic code anchor — shared by ingestors. Unique on (repo, file_path, line_no).
CREATE TABLE IF NOT EXISTS panorama_code_ref (
  id              BIGINT AUTO_INCREMENT PRIMARY KEY,
  repo            VARCHAR(50) NOT NULL,
  file_path       VARCHAR(500) NOT NULL,
  line_no         INT NULL,
  snippet         TEXT NULL,
  db_create_time  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_loc (repo, file_path, line_no)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Polymorphic edge table. Phase 1 only writes DESCRIBES (doc -> domain) and REFERENCES (doc -> code_ref).
CREATE TABLE IF NOT EXISTS panorama_ref_link (
  id              BIGINT AUTO_INCREMENT PRIMARY KEY,
  source_type     VARCHAR(30) NOT NULL,
  source_id       BIGINT NOT NULL,
  target_type     VARCHAR(30) NOT NULL,
  target_id       BIGINT NOT NULL,
  link_type       VARCHAR(50) NOT NULL,
  confidence      DECIMAL(3,2) NOT NULL DEFAULT 1.00,
  meta_json       JSON NULL,
  db_create_time  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  KEY idx_source (source_type, source_id),
  KEY idx_target (target_type, target_id),
  KEY idx_type (link_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
