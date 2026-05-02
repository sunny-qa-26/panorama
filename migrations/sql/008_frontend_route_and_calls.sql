CREATE TABLE IF NOT EXISTS panorama_frontend_route (
  id              BIGINT AUTO_INCREMENT PRIMARY KEY,
  domain_id       BIGINT NULL,
  app_name        VARCHAR(100) NOT NULL,
  path            VARCHAR(500) NOT NULL,
  component       VARCHAR(200) NULL,
  repo            VARCHAR(50) NOT NULL DEFAULT 'lista-mono',
  file_path       VARCHAR(500) NOT NULL,
  is_lazy         TINYINT(1) NOT NULL DEFAULT 0,
  db_create_time  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  db_modify_time  TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_app_path (app_name, path),
  KEY idx_domain (domain_id),
  FULLTEXT KEY ft_search (path, component) WITH PARSER ngram
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS panorama_route_api_call (
  route_id        BIGINT NOT NULL,
  api_id          BIGINT NOT NULL,
  PRIMARY KEY (route_id, api_id),
  KEY idx_api (api_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS panorama_api_cron_call (
  api_id          BIGINT NOT NULL,
  cron_id         BIGINT NOT NULL,
  call_path       VARCHAR(500) NULL,
  PRIMARY KEY (api_id, cron_id),
  KEY idx_cron (cron_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
