CREATE TABLE IF NOT EXISTS panorama_api_endpoint (
  id              BIGINT AUTO_INCREMENT PRIMARY KEY,
  domain_id       BIGINT NULL,
  http_method     VARCHAR(10) NOT NULL,
  path            VARCHAR(500) NOT NULL,
  controller      VARCHAR(200) NULL,
  repo            VARCHAR(50) NOT NULL,
  file_path       VARCHAR(500) NOT NULL,
  line_no         INT NULL,
  auth_required   TINYINT(1) NOT NULL DEFAULT 0,
  description     TEXT NULL,
  confidence      DECIMAL(3,2) NOT NULL DEFAULT 1.00,
  db_create_time  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  db_modify_time  TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_domain (domain_id),
  KEY idx_path (path),
  KEY idx_repo_file (repo, file_path),
  FULLTEXT KEY ft_search (path, description) WITH PARSER ngram
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS panorama_entity (
  id              BIGINT AUTO_INCREMENT PRIMARY KEY,
  domain_id       BIGINT NULL,
  table_name      VARCHAR(100) NOT NULL,
  repo            VARCHAR(50) NOT NULL,
  file_path       VARCHAR(500) NOT NULL,
  columns_json    JSON NULL,
  description     TEXT NULL,
  db_create_time  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  db_modify_time  TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_repo_table (repo, table_name),
  KEY idx_domain (domain_id),
  KEY idx_repo_file (repo, file_path),
  FULLTEXT KEY ft_search (table_name) WITH PARSER ngram
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS panorama_api_entity_op (
  api_id          BIGINT NOT NULL,
  entity_id       BIGINT NOT NULL,
  op_type         ENUM('READ','WRITE','BOTH') NOT NULL,
  PRIMARY KEY (api_id, entity_id),
  KEY idx_entity (entity_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
