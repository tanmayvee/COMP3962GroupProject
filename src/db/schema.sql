-- A owns users/groups/members/wishlist, B owns assignments, C owns hints + photos

DROP TABLE IF EXISTS gift_photos, hint_messages, assignments,
  wishlist_items, group_members, groups, users CASCADE;

-- Feature A: Groups & Wishlists
CREATE TABLE users (
  id            SERIAL PRIMARY KEY,
  name          TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,      -- "salt:hash" from auth.js, never the real password
  created_at    TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE groups (
  id             SERIAL PRIMARY KEY,
  name           TEXT NOT NULL,
  join_code      TEXT NOT NULL UNIQUE,
  organizer_id   INT NOT NULL REFERENCES users(id),
  budget         NUMERIC(8,2),
  exchange_date  DATE,
  drawn_at       TIMESTAMPTZ,      -- set by feature B when names get drawn
  revealed_at    TIMESTAMPTZ,      -- set by feature C when santas get revealed
  created_at     TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE group_members (
  group_id  INT REFERENCES groups(id) ON DELETE CASCADE,
  user_id   INT REFERENCES users(id) ON DELETE CASCADE,
  joined_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (group_id, user_id)
);

CREATE TABLE wishlist_items (
  id         SERIAL PRIMARY KEY,
  group_id   INT REFERENCES groups(id) ON DELETE CASCADE,
  user_id    INT REFERENCES users(id) ON DELETE CASCADE,
  title      TEXT NOT NULL,
  link       TEXT,
  image_key  TEXT,                 -- storage key if they upload a photo
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Feature B: The Draw
CREATE TABLE assignments (
  id           SERIAL PRIMARY KEY,
  group_id     INT REFERENCES groups(id) ON DELETE CASCADE,
  giver_id     INT REFERENCES users(id),
  receiver_id  INT REFERENCES users(id),
  UNIQUE (group_id, giver_id),
  UNIQUE (group_id, receiver_id),
  CHECK (giver_id <> receiver_id)
);

-- Feature C: Anonymous Hints & Gift Reveal 
-- messages hang off the assignment, not a user id.
-- that way the giftee's side never needs to know who the santa is
CREATE TABLE hint_messages (
  id             SERIAL PRIMARY KEY,
  assignment_id  INT REFERENCES assignments(id) ON DELETE CASCADE,
  from_role      TEXT NOT NULL CHECK (from_role IN ('santa', 'giftee')),
  body           TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 500),
  created_at     TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE gift_photos (
  id            SERIAL PRIMARY KEY,
  group_id    INT REFERENCES groups(id) ON DELETE CASCADE,
  uploader_id INT REFERENCES users(id),
  s3_key      TEXT NOT NULL,       -- local path for now, S3 key later
  caption     TEXT,
  created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX ON hint_messages (assignment_id, created_at);
CREATE INDEX ON gift_photos (group_id, created_at);
