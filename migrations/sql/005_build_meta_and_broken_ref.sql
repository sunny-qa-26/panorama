CREATE TABLE IF NOT EXISTS panorama_build_meta (
  id              BIGINT AUTO_INCREMENT PRIMARY KEY,
  build_id        VARCHAR(40) NOT NULL UNIQUE,
  status          ENUM('running', 'success', 'failed') NOT NULL,
  started_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  finished_at     TIMESTAMP NULL,
  duration_ms     INT NULL,
  trigger_type    VARCHAR(20) NOT NULL,
  triggered_by    VARCHAR(100) NULL,
  commit_shas     JSON NULL,
  stats_json      JSON NULL,
  error_log       TEXT NULL,
  KEY idx_status (status),
  KEY idx_started (started_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS panorama_broken_ref (
  id              BIGINT AUTO_INCREMENT PRIMARY KEY,
  build_id        VARCHAR(40) NOT NULL,
  doc_path        VARCHAR(500) NOT NULL,
  doc_line_no     INT NULL,
  ref_repo        VARCHAR(50) NOT NULL,
  ref_file_path   VARCHAR(500) NOT NULL,
  ref_line_no     INT NULL,
  reason          VARCHAR(200) NULL,
  db_create_time  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  KEY idx_build (build_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
