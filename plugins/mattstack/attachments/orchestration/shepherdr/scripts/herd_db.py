"""Shared SQLite access for a shepherdr herd-run DB.

One DB per run at ~/.mattstack/shepherdr/runs/<run-id>/herd.db. This module owns the
schema and connection settings; the herd-* CLI scripts own all behavior.
"""
import sqlite3
import time

SCHEMA = """
CREATE TABLE IF NOT EXISTS questions(
  id INTEGER PRIMARY KEY,
  job TEXT NOT NULL,
  needs TEXT NOT NULL DEFAULT 'answer',
  context TEXT,
  question TEXT NOT NULL,
  options TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  answer TEXT,
  asked_at INTEGER,
  answered_at INTEGER
);
CREATE TABLE IF NOT EXISTS reports(
  id INTEGER PRIMARY KEY,
  job TEXT NOT NULL,
  body TEXT NOT NULL,
  reported_at INTEGER,
  handled_at INTEGER
);
CREATE TABLE IF NOT EXISTS jobs(
  job TEXT PRIMARY KEY,
  repo TEXT, pane TEXT, target TEXT, worktree TEXT, branch TEXT,
  model TEXT, strategy TEXT, account TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  spawned_at INTEGER
);
CREATE TABLE IF NOT EXISTS state(key TEXT PRIMARY KEY, value TEXT);
"""


def connect(db_path):
    conn = sqlite3.connect(db_path, timeout=30)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.row_factory = sqlite3.Row
    return conn


def init_db(db_path):
    conn = connect(db_path)
    conn.executescript(SCHEMA)
    conn.commit()
    return conn


def get_state(conn, key):
    row = conn.execute("SELECT value FROM state WHERE key=?", (key,)).fetchone()
    return row["value"] if row else None


def set_state(conn, key, value):
    conn.execute(
        "INSERT OR REPLACE INTO state(key, value) VALUES(?, ?)", (key, str(value))
    )
    conn.commit()


def now():
    return int(time.time())
