-- Personal Chief of Staff — schema (MariaDB 10.4+ / MySQL 8)
SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS tasks (
  id INT AUTO_INCREMENT PRIMARY KEY,
  title VARCHAR(255) NOT NULL,
  notes TEXT NULL,
  category VARCHAR(50) NOT NULL DEFAULT 'general',      -- work / personal / health / finance / home / errand ...
  priority ENUM('high','medium','low') NOT NULL DEFAULT 'medium',
  status ENUM('todo','doing','done','cancelled') NOT NULL DEFAULT 'todo',
  due_date DATE NULL,
  duration_min INT NOT NULL DEFAULT 30,
  location VARCHAR(255) NULL,
  person_id INT NULL,
  source_text TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  last_touched_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  nudge_count INT NOT NULL DEFAULT 0,
  INDEX (status), INDEX (due_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS events (
  id INT AUTO_INCREMENT PRIMARY KEY,
  title VARCHAR(255) NOT NULL,
  start_at DATETIME NOT NULL,
  end_at DATETIME NOT NULL,
  location VARCHAR(255) NULL,
  is_offsite TINYINT(1) NOT NULL DEFAULT 0,             -- needs travel
  travel_min INT NULL,                                  -- one-way travel estimate
  person_id INT NULL,
  notes TEXT NULL,
  status ENUM('confirmed','tentative','cancelled') NOT NULL DEFAULT 'confirmed',
  source_text TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX (start_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS notes (
  id INT AUTO_INCREMENT PRIMARY KEY,
  title VARCHAR(255) NOT NULL,
  body TEXT NOT NULL,
  tags VARCHAR(500) NOT NULL DEFAULT '',                -- comma separated
  person_id INT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS people (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(150) NOT NULL,
  aliases VARCHAR(500) NOT NULL DEFAULT '',             -- comma separated nicknames
  relationship VARCHAR(100) NULL,
  company VARCHAR(150) NULL,
  phone VARCHAR(50) NULL,
  email VARCHAR(150) NULL,
  notes TEXT NULL,
  birthday DATE NULL,
  last_contact_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS interactions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  person_id INT NOT NULL,
  happened_at DATETIME NOT NULL,
  summary TEXT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX (person_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS shopping_items (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(150) NOT NULL,
  qty DECIMAL(10,2) NULL,
  unit VARCHAR(30) NULL,
  store VARCHAR(100) NULL,
  needed_for VARCHAR(255) NULL,                         -- e.g. "งานวันเกิดแม่ 30 พ.ย."
  status ENUM('needed','bought','cancelled') NOT NULL DEFAULT 'needed',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS inventory (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(150) NOT NULL,
  qty DECIMAL(10,2) NOT NULL DEFAULT 0,
  unit VARCHAR(30) NULL,
  location VARCHAR(100) NULL,
  low_threshold DECIMAL(10,2) NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS clarifications (
  id INT AUTO_INCREMENT PRIMARY KEY,
  fragment TEXT NOT NULL,                               -- the unclear piece of what the user said
  question TEXT NOT NULL,                               -- what to ask the user
  status ENUM('open','resolved','dismissed') NOT NULL DEFAULT 'open',
  answer TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resolved_at DATETIME NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS daily_plans (
  id INT AUTO_INCREMENT PRIMARY KEY,
  plan_date DATE NOT NULL,
  summary TEXT NOT NULL,
  blocks JSON NOT NULL,                                 -- [{start,end,kind,ref_type,ref_id,title,note}]
  context_links JSON NOT NULL,                          -- [{for_type,for_id,title,note_ids,person_ids,shopping_ids,task_ids,why}]
  nudges JSON NOT NULL,                                 -- [{task_id,title,days_stale,message}]
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX (plan_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS note_embeddings (
  note_id INT PRIMARY KEY,
  model VARCHAR(100) NOT NULL,
  note_updated_at DATETIME NOT NULL,
  vec LONGTEXT NOT NULL                                 -- JSON array
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS agent_runs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  mode ENUM('capture','brief') NOT NULL,
  input_text TEXT NULL,
  reply TEXT NULL,
  tool_calls JSON NULL,
  ok TINYINT(1) NOT NULL DEFAULT 1,
  error TEXT NULL,
  usage_json JSON NULL,
  duration_ms INT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
