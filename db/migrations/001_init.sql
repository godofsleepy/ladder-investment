create extension if not exists vector;

create table assets (
  id           integer generated always as identity primary key,
  symbol       text not null unique,
  name         text not null,
  class        text not null check (class in ('crypto','us_stock','idx_stock','gold','other','fx')),
  currency     text not null check (currency in ('IDR','USD')),
  price_source text not null check (price_source in ('coingecko','yahoo','xau','manual')),
  source_id    text,
  created_at   timestamptz not null default now()
);

-- Source of truth: holdings are computed from trades, never stored.
-- fx_to_idr is the trade currency's IDR rate on the trade date, so IDR cost
-- basis does not move when USD/IDR moves later.
create table trades (
  id         integer generated always as identity primary key,
  asset_id   integer not null references assets(id),
  type       text not null check (type in ('buy','sell','dividend','fee','deposit')),
  qty        numeric not null default 0 check (qty >= 0),
  price      numeric not null default 0 check (price >= 0),
  fee        numeric not null default 0 check (fee >= 0),
  currency   text not null check (currency in ('IDR','USD')),
  fx_to_idr  numeric not null default 1 check (fx_to_idr > 0),
  platform   text,
  traded_at  date not null,
  note       text,
  created_at timestamptz not null default now()
);
create index trades_asset_idx on trades (asset_id, traded_at);

-- close is always in the asset's currency. Gold is IDR per gram.
create table prices (
  asset_id integer not null references assets(id),
  date     date not null,
  close    numeric not null check (close > 0),
  currency text not null,
  source   text not null,
  primary key (asset_id, date)
);

create table theses (
  id             integer generated always as identity primary key,
  asset_id       integer not null references assets(id),
  title          text not null check (char_length(title) <= 60),
  why            text not null,
  target_price   numeric,
  kill_criteria  text not null,
  kill_price     numeric,
  horizon        text not null check (horizon in ('3m','6m','1y','3y','5y+')),
  conviction     integer not null check (conviction between 1 and 5),
  status         text not null check (status in ('draft','active','achieved','invalidated','closed')),
  opened_at      date,
  closed_at      date,
  outcome        text check (outcome in ('right','wrong','mixed')),
  next_review_at date not null,
  embedding      vector(1536),
  created_at     timestamptz not null default now()
);
create unique index theses_one_active_per_asset on theses (asset_id) where status = 'active';
create unique index theses_one_draft_per_asset on theses (asset_id) where status = 'draft';

create table watchlist (
  id                 integer generated always as identity primary key,
  asset_id           integer not null references assets(id),
  zone_low           numeric not null check (zone_low > 0),
  zone_high          numeric not null,
  reason             text not null check (char_length(reason) <= 140),
  priority           text not null default 'medium' check (priority in ('high','medium','low')),
  planned_amount_idr numeric,
  alert              boolean not null default true,
  thesis_id          integer references theses(id),
  status             text not null default 'watching' check (status in ('watching','triggered','bought','dropped')),
  drop_reason        text,
  added_at           date not null,
  closed_at          date,
  check (zone_high >= zone_low)
);
create unique index watchlist_one_open_per_asset on watchlist (asset_id) where status in ('watching','triggered');

create table journal (
  id         integer generated always as identity primary key,
  asset_id   integer references assets(id),
  thesis_id  integer references theses(id),
  body       text not null,
  tags       text[] not null default '{}',
  created_at timestamptz not null default now(),
  embedding  vector(1536)
);

-- snapshot keeps the thesis as it stood before an update.
-- price_at_review lets a reviewed price trigger stay quiet until the next review.
create table thesis_reviews (
  id              integer generated always as identity primary key,
  thesis_id       integer not null references theses(id),
  reviewed_at     timestamptz not null default now(),
  action          text not null check (action in ('still_valid','update','close')),
  still_valid     boolean not null,
  note            text,
  price_at_review numeric,
  snapshot        jsonb
);
create index thesis_reviews_thesis_idx on thesis_reviews (thesis_id, reviewed_at desc);

insert into assets (symbol, name, class, currency, price_source, source_id)
values ('USDIDR', 'US dollar in rupiah', 'fx', 'IDR', 'yahoo', 'IDR=X');
