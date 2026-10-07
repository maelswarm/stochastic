-- Required shape for connect-pg-simple's default table name "session".
CREATE TABLE session (
  sid VARCHAR NOT NULL COLLATE "default" PRIMARY KEY,
  sess JSON NOT NULL,
  expire TIMESTAMP(6) NOT NULL
);
CREATE INDEX session_expire_idx ON session(expire);
