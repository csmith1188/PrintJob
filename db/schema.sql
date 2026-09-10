CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS filaments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT UNIQUE NOT NULL,
  material TEXT NOT NULL,
  name TEXT NOT NULL,
  color TEXT NOT NULL,
  price_per_gram REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS printer_family (
  name TEXT PRIMARY KEY
);

CREATE TABLE IF NOT EXISTS allowed_materials (
  name TEXT PRIMARY KEY
);

CREATE TABLE IF NOT EXISTS jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  user_name TEXT NOT NULL,
  user_email TEXT,
  model_id INTEGER NOT NULL,
  instance_id INTEGER,
  title TEXT,
  cover_url TEXT,
  profile_title TEXT,
  makerworld_url TEXT,
  grams REAL,
  colors INTEGER,
  seconds INTEGER,
  filaments_json TEXT,
  amount INTEGER NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  finished_at TEXT
);

CREATE TABLE IF NOT EXISTS transfers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id INTEGER,
  direction TEXT NOT NULL,
  from_type TEXT NOT NULL,
  from_id INTEGER NOT NULL,
  to_type TEXT NOT NULL,
  to_id INTEGER NOT NULL,
  amount INTEGER NOT NULL,
  success INTEGER NOT NULL,
  message TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (job_id) REFERENCES jobs(id)
);

CREATE TABLE IF NOT EXISTS model_prints (
  model_id INTEGER PRIMARY KEY,
  title TEXT,
  cover_url TEXT,
  print_count INTEGER NOT NULL DEFAULT 0
);
