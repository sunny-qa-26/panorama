CREATE TABLE IF NOT EXISTS panorama_cron_job (
  id              BIGINT AUTO_INCREMENT PRIMARY KEY,
  domain_id       BIGINT NULL,
  name            VARCHAR(200) NOT NULL,
  schedule        VARCHAR(100) NULL,
  job_id          VARCHAR(100) NULL,
  repo            VARCHAR(50) NOT NULL,
  file_path       VARCHAR(500) NOT NULL,
  line_no         INT NULL,
  handler_class   VARCHAR(200) NULL,
  description     TEXT NULL,
  confidence      DECIMAL(3,2) NOT NULL DEFAULT 1.00,
  db_create_time  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  db_modify_time  TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_domain (domain_id),
  KEY idx_name (name),
  KEY idx_repo_file (repo, file_path),
  FULLTEXT KEY ft_search (name, description)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
