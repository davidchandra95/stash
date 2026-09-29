CREATE TABLE IF NOT EXISTS schema_version(version integer PRIMARY KEY);
CREATE TABLE IF NOT EXISTS library(id integer PRIMARY KEY CHECK(id=1), revision bigint NOT NULL DEFAULT 0, identity text NOT NULL);
INSERT INTO library VALUES(1,0,gen_random_uuid()::text) ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS devices(id text PRIMARY KEY, name text NOT NULL, token_hash text UNIQUE NOT NULL, revoked boolean NOT NULL DEFAULT false);
CREATE TABLE IF NOT EXISTS entities(kind text NOT NULL, id text NOT NULL, revision bigint NOT NULL, deleted boolean NOT NULL, data jsonb NOT NULL, PRIMARY KEY(kind,id));
CREATE TABLE IF NOT EXISTS changes(revision bigint PRIMARY KEY, kind text NOT NULL, id text NOT NULL, deleted boolean NOT NULL, data jsonb NOT NULL);
CREATE TABLE IF NOT EXISTS receipts(device text NOT NULL REFERENCES devices(id), operation text NOT NULL, request_hash text NOT NULL, result jsonb NOT NULL, PRIMARY KEY(device,operation));
INSERT INTO schema_version VALUES(1) ON CONFLICT DO NOTHING;
