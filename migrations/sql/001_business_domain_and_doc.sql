-- panorama_business_domain: adjacency-list tree, root + 9 L1 + L2 sub-domains
CREATE TABLE IF NOT EXISTS panorama_business_domain (
  id              BIGINT AUTO_INCREMENT PRIMARY KEY,
  name            VARCHAR(100) NOT NULL,
  display_name    VARCHAR(200) NOT NULL,
  parent_id       BIGINT NULL,
  description     TEXT NULL,
  file_type       VARCHAR(50) NULL,
  knowledge_path  VARCHAR(500) NULL,
  sort_order      INT NOT NULL DEFAULT 0,
  db_create_time  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  db_modify_time  TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_parent (parent_id),
  KEY idx_name (name),
  CONSTRAINT fk_domain_parent FOREIGN KEY (parent_id)
    REFERENCES panorama_business_domain(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- panorama_knowledge_doc: per-md-file metadata; body kept on filesystem and read at request time
CREATE TABLE IF NOT EXISTS panorama_knowledge_doc (
  id                BIGINT AUTO_INCREMENT PRIMARY KEY,
  domain_id         BIGINT NOT NULL,
  path              VARCHAR(500) NOT NULL UNIQUE,
  title             VARCHAR(300) NULL,
  last_verified     DATE NULL,
  frontmatter_json  JSON NULL,
  body_md_path      VARCHAR(500) NULL,
  word_count        INT NOT NULL DEFAULT 0,
  db_create_time    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  db_modify_time    TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_domain (domain_id),
  FULLTEXT KEY ft_title (title)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
