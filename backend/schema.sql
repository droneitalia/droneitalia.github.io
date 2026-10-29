PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS journal_flights(
 id TEXT PRIMARY KEY,owner TEXT NOT NULL,request_id TEXT NOT NULL,
 title TEXT NOT NULL,nickname TEXT NOT NULL,body TEXT NOT NULL,flight_date TEXT NOT NULL,place TEXT NOT NULL DEFAULT '',drone TEXT NOT NULL DEFAULT '',duration REAL,distance REAL,height REAL,youtube_id TEXT,
 status TEXT NOT NULL CHECK(status IN('published','pending','rejected','hidden')),review_reason TEXT NOT NULL DEFAULT '',rights_version TEXT NOT NULL,rights_at TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,published_at TEXT,revision INTEGER NOT NULL DEFAULT 1,mutation TEXT NOT NULL DEFAULT '',
 UNIQUE(owner,request_id));
CREATE INDEX IF NOT EXISTS journal_public ON journal_flights(status,published_at DESC,id);
CREATE INDEX IF NOT EXISTS journal_owner ON journal_flights(owner,created_at DESC);
CREATE TABLE IF NOT EXISTS journal_media(id TEXT PRIMARY KEY,owner TEXT NOT NULL,flight_id TEXT REFERENCES journal_flights(id),kind TEXT NOT NULL CHECK(kind IN('photo','avatar')),sort_order INTEGER NOT NULL DEFAULT 0,mime TEXT NOT NULL,bytes BLOB NOT NULL,size INTEGER NOT NULL CHECK(size>0 AND size<=153600),moderation TEXT NOT NULL CHECK(moderation IN('pass','review')),created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS journal_media_flight ON journal_media(flight_id,kind,sort_order);
CREATE INDEX IF NOT EXISTS journal_media_owner ON journal_media(owner,created_at);
CREATE TABLE IF NOT EXISTS journal_mail(id TEXT PRIMARY KEY,flight_id TEXT NOT NULL UNIQUE REFERENCES journal_flights(id),state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN('pending','sending','sent','failed')),attempts INTEGER NOT NULL DEFAULT 0,last_attempt TEXT,sent_at TEXT,error_code TEXT);
CREATE TABLE IF NOT EXISTS journal_rate(bucket TEXT PRIMARY KEY,count INTEGER NOT NULL,expires_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS journal_audit(id TEXT PRIMARY KEY,flight_id TEXT NOT NULL,action TEXT NOT NULL,reason TEXT NOT NULL,created_at TEXT NOT NULL);
