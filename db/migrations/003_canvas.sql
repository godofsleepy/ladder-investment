-- What the design canvas adds: macro views, richer position theses, bonds,
-- when prices were last fetched, and who wrote a journal note.

alter table assets drop constraint assets_class_check;
alter table assets add constraint assets_class_check
  check (class in ('crypto','us_stock','idx_stock','gold','bond','other','fx'));

alter table prices add column updated_at timestamptz not null default now();

alter table theses drop constraint theses_title_check;
alter table theses add constraint theses_title_check check (char_length(title) <= 200);
alter table theses add column add_rule text;
alter table theses add column trim_rule text;
alter table theses add column max_weight_pct numeric check (max_weight_pct > 0 and max_weight_pct <= 100);
alter table theses add column review_every text not null default 'quarterly'
  check (review_every in ('monthly','quarterly','half-yearly'));
alter table theses add column last_reviewed_on date;

alter table journal add column author text not null default 'You';

-- A macro view is a belief about the world that several holdings ride on.
create table macro_views (
  id          integer generated always as identity primary key,
  user_id     integer default app_user() references users(id) on delete cascade,
  short_name  text not null check (char_length(short_name) <= 24),
  area        text not null check (char_length(area) <= 40),
  conviction  text not null check (conviction in ('High','Medium','Low')),
  status      text not null default 'holding' check (status in ('holding','weak','broken')),
  view        text not null,
  why         text not null default '',
  wrong_if    text not null,
  signals     jsonb not null default '[]',
  next_review date not null,
  created_at  timestamptz not null default now()
);
create index macro_views_user_idx on macro_views (user_id);

create table macro_holdings (
  view_id  integer not null references macro_views(id) on delete cascade,
  asset_id integer not null references assets(id) on delete cascade,
  user_id  integer default app_user() references users(id) on delete cascade,
  primary key (view_id, asset_id)
);

grant select, insert, update, delete on macro_views, macro_holdings to ladder_app;
grant usage on all sequences in schema public to ladder_app;

alter table macro_views    enable row level security;
alter table macro_holdings enable row level security;
create policy macro_views_own    on macro_views    for all using (user_id = app_user()) with check (user_id = app_user());
create policy macro_holdings_own on macro_holdings for all using (user_id = app_user()) with check (user_id = app_user());
