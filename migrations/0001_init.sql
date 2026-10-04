-- teamlancaster-family: initial schema (spec v3 §4 + Chris's additions + reviewer fixes)
-- NOTE: no columns for full birthdates, addresses, schools or phones, by design.
-- birth_year is kept ONLY for the request-time minor check; it is never rendered for minors.

CREATE TABLE person (
  id              TEXT PRIMARY KEY,               -- random id (p_xxx)
  first_name      TEXT NOT NULL,
  middle          TEXT,
  last_name       TEXT,
  birth_surname   TEXT,
  nickname        TEXT,
  birth_year      INTEGER,
  death_year      INTEGER,
  is_deceased     INTEGER NOT NULL DEFAULT 0,
  adult_confirmed INTEGER NOT NULL DEFAULT 0,     -- default false: no birth year => minor/private
  public_ok       INTEGER NOT NULL DEFAULT 0,     -- default false; requires adult_confirmed=1 (enforced in code + trigger)
  is_founder      INTEGER NOT NULL DEFAULT 0,     -- founders appear at the centre of the public constellation
  memorial        INTEGER NOT NULL DEFAULT 0,
  bio_md          TEXT,
  memorial_md     TEXT,
  avatar_photo_id TEXT,
  hidden          INTEGER NOT NULL DEFAULT 0,     -- "Hide now" sets this
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK (public_ok = 0 OR adult_confirmed = 1),   -- reviewer fix 7, enforced at the DB layer too
  CHECK (birth_year IS NULL OR birth_year BETWEEN 1500 AND 2200),
  CHECK (death_year IS NULL OR death_year BETWEEN 1500 AND 2200)
);
CREATE INDEX person_name ON person(last_name, first_name);

-- "union" is an SQL keyword, so the table is "unions".
CREATE TABLE unions (
  id          TEXT PRIMARY KEY,
  partner_a   TEXT NOT NULL REFERENCES person(id) ON DELETE CASCADE,
  partner_b   TEXT NOT NULL REFERENCES person(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL DEFAULT 'married' CHECK (kind IN ('married','partner','engaged')),
  start_year  INTEGER,
  end_year    INTEGER,
  end_reason  TEXT CHECK (end_reason IS NULL OR end_reason IN ('divorced','separated','widowed','other')),
  CHECK (partner_a <> partner_b)
);

CREATE TABLE parent_child (
  parent_id TEXT NOT NULL REFERENCES person(id) ON DELETE CASCADE,
  child_id  TEXT NOT NULL REFERENCES person(id) ON DELETE CASCADE,
  kind      TEXT NOT NULL DEFAULT 'bio' CHECK (kind IN ('bio','adopted','step','foster','guardian')),
  union_id  TEXT REFERENCES unions(id) ON DELETE SET NULL,
  PRIMARY KEY (parent_id, child_id),
  CHECK (parent_id <> child_id)
);
CREATE INDEX pc_child ON parent_child(child_id);

CREATE TABLE branch (
  id            TEXT PRIMARY KEY,
  slug          TEXT NOT NULL UNIQUE CHECK (slug GLOB '[a-z0-9]*' AND slug NOT GLOB '*[^a-z0-9-]*'),
  display_name  TEXT NOT NULL,
  root_union_id TEXT REFERENCES unions(id) ON DELETE SET NULL,
  color         TEXT,
  public_blurb  TEXT,
  pw_hash       TEXT,          -- base64 PBKDF2-SHA256; the passphrase itself is never stored
  pw_salt       TEXT,
  pw_iters      INTEGER,
  pw_version    INTEGER NOT NULL DEFAULT 0,  -- bump => every branch cookie is invalid
  pw_rotated_at TEXT,
  sort          INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE person_branch (
  person_id TEXT NOT NULL REFERENCES person(id) ON DELETE CASCADE,
  branch_id TEXT NOT NULL REFERENCES branch(id) ON DELETE CASCADE,
  PRIMARY KEY (person_id, branch_id)
);
CREATE INDEX pb_branch ON person_branch(branch_id);

-- Photos live in the PRIVATE R2 bucket (see docs/R2-LAYOUT.md). Rows hold keys, never URLs.
CREATE TABLE photo (
  id          TEXT PRIMARY KEY,
  r2_key      TEXT NOT NULL,
  thumb_key   TEXT,
  w           INTEGER,
  h           INTEGER,
  bytes       INTEGER,
  sha256      TEXT,
  year        INTEGER,
  caption     TEXT,
  branch_id   TEXT REFERENCES branch(id) ON DELETE SET NULL,
  has_minor   INTEGER NOT NULL DEFAULT 0,
  visibility  TEXT NOT NULL DEFAULT 'admin' CHECK (visibility IN ('public','branch','admin')),
  source      TEXT NOT NULL DEFAULT 'admin' CHECK (source IN ('admin','branch_request')),
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  deleted_at  TEXT,            -- soft delete; R2 objects purged after 30 days by the cron
  CHECK (NOT (has_minor = 1 AND visibility = 'public'))
);
CREATE UNIQUE INDEX photo_sha ON photo(sha256) WHERE deleted_at IS NULL;

CREATE TABLE photo_tag (
  photo_id  TEXT NOT NULL REFERENCES photo(id) ON DELETE CASCADE,
  person_id TEXT NOT NULL REFERENCES person(id) ON DELETE CASCADE,
  box       TEXT,              -- optional JSON {x,y,w,h}; manual only, never face recognition
  source    TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','suggested')),
  confirmed INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (photo_id, person_id)
);

CREATE TABLE story (
  id            TEXT PRIMARY KEY,
  person_id     TEXT REFERENCES person(id) ON DELETE CASCADE,
  union_id      TEXT REFERENCES unions(id) ON DELETE CASCADE,
  year          INTEGER,
  place_general TEXT,          -- city/state at most
  text_md       TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK (person_id IS NOT NULL OR union_id IS NOT NULL)
);

CREATE TABLE audit_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  actor_email TEXT NOT NULL,
  action      TEXT NOT NULL,    -- create/update/delete/link/unlink/hide/rotate_passphrase/...
  entity      TEXT NOT NULL,
  entity_id   TEXT NOT NULL,
  summary     TEXT,
  before_json TEXT,
  after_json  TEXT,
  undoable    INTEGER NOT NULL DEFAULT 1,  -- 0 for passphrase rotations (reviewer fix 5)
  undone_at   TEXT
);
CREATE INDEX audit_at ON audit_log(at DESC);

CREATE TABLE login_fail (
  branch_id TEXT NOT NULL,
  ip_hash   TEXT NOT NULL,     -- HMAC-SHA256(IP, IP_HASH_PEPPER); raw IPs are never stored
  at        INTEGER NOT NULL   -- unix seconds
);
CREATE INDEX login_fail_idx ON login_fail(branch_id, ip_hash, at);

-- "Request a change" queue (Chris's addition + reviewer fixes 2-4).
-- All text here is UNTRUSTED user input: escaped on render, passed to AI only as quoted data.
CREATE TABLE change_request (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,  -- numeric so the pointer email can say "#123"
  source        TEXT NOT NULL CHECK (source IN ('public','branch')),
  branch_id     TEXT REFERENCES branch(id) ON DELETE SET NULL, -- set ONLY from a verified branch cookie
  requester_name TEXT NOT NULL,       -- public: "name not verified"
  person_text   TEXT NOT NULL,        -- free text "which person"; no people picker on the public form
  change_text   TEXT NOT NULL,
  kind          TEXT NOT NULL DEFAULT 'edit' CHECK (kind IN ('edit','add','photo_removal','privacy','other')),
  status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','applied','dismissed','hidden')),
  ip_hash       TEXT,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  resolved_at   TEXT,
  resolved_by   TEXT,
  resolution_note TEXT,
  notified_at   TEXT,
  CHECK (length(requester_name) <= 80 AND length(person_text) <= 200 AND length(change_text) <= 2000)
);
CREATE INDEX cr_status ON change_request(status, created_at);
CREATE INDEX cr_ip ON change_request(ip_hash, created_at);

-- Photos attached to IN-BRANCH requests only (reviewer fix 2). Upload lands in R2 quarantine/,
-- is magic-byte checked + size capped, then re-encoded server-side before it can ever be shown.
-- The in-branch form itself ships with branch pages (Phase 3); the pipeline + table are ready now.
CREATE TABLE upload_quarantine (
  id            TEXT PRIMARY KEY,
  request_id    INTEGER REFERENCES change_request(id) ON DELETE CASCADE,
  branch_id     TEXT NOT NULL REFERENCES branch(id) ON DELETE CASCADE,
  r2_key        TEXT NOT NULL,        -- quarantine/<id>
  detected_type TEXT NOT NULL CHECK (detected_type IN ('image/jpeg','image/png','image/webp','image/heic')),
  bytes         INTEGER NOT NULL CHECK (bytes > 0 AND bytes <= 10485760),
  sha256        TEXT NOT NULL,
  state         TEXT NOT NULL DEFAULT 'quarantined' CHECK (state IN ('quarantined','reencoded','rejected','promoted','purged')),
  clean_key     TEXT,                 -- clean/<id>.webp after server-side re-encode
  promoted_photo_id TEXT REFERENCES photo(id) ON DELETE SET NULL,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  error         TEXT
);

-- Per-ip_hash request-form throttle (3/hour), kept separate so it can be pruned aggressively.
CREATE TABLE form_hit (
  ip_hash TEXT NOT NULL,
  at      INTEGER NOT NULL
);
CREATE INDEX form_hit_idx ON form_hit(ip_hash, at);

-- Admin full-text search over names (FTS5). Public search never touches this table.
CREATE VIRTUAL TABLE person_fts USING fts5(
  person_id UNINDEXED, first_name, last_name, birth_surname, nickname, middle,
  tokenize = 'unicode61 remove_diacritics 2'
);
CREATE TRIGGER person_ai AFTER INSERT ON person BEGIN
  INSERT INTO person_fts(person_id, first_name, last_name, birth_surname, nickname, middle)
  VALUES (new.id, new.first_name, new.last_name, new.birth_surname, new.nickname, new.middle);
END;
CREATE TRIGGER person_au AFTER UPDATE ON person BEGIN
  DELETE FROM person_fts WHERE person_id = old.id;
  INSERT INTO person_fts(person_id, first_name, last_name, birth_surname, nickname, middle)
  VALUES (new.id, new.first_name, new.last_name, new.birth_surname, new.nickname, new.middle);
END;
CREATE TRIGGER person_ad AFTER DELETE ON person BEGIN
  DELETE FROM person_fts WHERE person_id = old.id;
END;
