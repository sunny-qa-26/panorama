CREATE TABLE IF NOT EXISTS panorama_concept (
  id              BIGINT AUTO_INCREMENT PRIMARY KEY,
  name            VARCHAR(100) NOT NULL UNIQUE,
  aliases_json    JSON NULL,
  db_create_time  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS panorama_doc_concept_rel (
  doc_id          BIGINT NOT NULL,
  concept_id      BIGINT NOT NULL,
  PRIMARY KEY (doc_id, concept_id),
  KEY idx_concept (concept_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
