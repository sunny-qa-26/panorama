CREATE TABLE IF NOT EXISTS panorama_contract (
  id              BIGINT AUTO_INCREMENT PRIMARY KEY,
  name            VARCHAR(200) NOT NULL,
  address         VARCHAR(42) NOT NULL,
  chain           VARCHAR(50) NOT NULL,
  abi_path        VARCHAR(500) NULL,
  deployed_at     DATE NULL,
  notes           TEXT NULL,
  db_create_time  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  db_modify_time  TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_chain_addr (chain, address),
  KEY idx_name (name),
  FULLTEXT KEY ft_search (name, notes) WITH PARSER ngram
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS panorama_redis_key (
  id              BIGINT AUTO_INCREMENT PRIMARY KEY,
  domain_id       BIGINT NULL,
  key_pattern     VARCHAR(500) NOT NULL,
  redis_type      ENUM('string','hash','list','set','zset','stream','unknown') NOT NULL DEFAULT 'unknown',
  ttl_seconds     INT NULL,
  description     TEXT NULL,
  source_repo     VARCHAR(50) NOT NULL,
  source_file     VARCHAR(500) NOT NULL,
  source_line     INT NULL,
  confidence      DECIMAL(3,2) NOT NULL DEFAULT 0.70,
  db_create_time  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  db_modify_time  TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_pattern (key_pattern, source_repo),
  KEY idx_domain (domain_id),
  FULLTEXT KEY ft_search (key_pattern, description) WITH PARSER ngram
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS panorama_cron_redis_op (
  cron_id         BIGINT NOT NULL,
  redis_id        BIGINT NOT NULL,
  op_type         ENUM('READ','WRITE','BOTH','EXPIRE','DELETE') NOT NULL,
  PRIMARY KEY (cron_id, redis_id, op_type),
  KEY idx_redis (redis_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS panorama_api_redis_op (
  api_id          BIGINT NOT NULL,
  redis_id        BIGINT NOT NULL,
  op_type         ENUM('READ','WRITE','BOTH') NOT NULL,
  PRIMARY KEY (api_id, redis_id, op_type),
  KEY idx_redis (redis_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS panorama_cron_contract_call (
  cron_id         BIGINT NOT NULL,
  contract_id     BIGINT NOT NULL,
  method_name     VARCHAR(200) NOT NULL DEFAULT '',
  PRIMARY KEY (cron_id, contract_id, method_name),
  KEY idx_contract (contract_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS panorama_api_contract_call (
  api_id          BIGINT NOT NULL,
  contract_id     BIGINT NOT NULL,
  method_name     VARCHAR(200) NOT NULL DEFAULT '',
  PRIMARY KEY (api_id, contract_id, method_name),
  KEY idx_contract (contract_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
