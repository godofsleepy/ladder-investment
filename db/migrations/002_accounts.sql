-- Accounts. Portfolio tables carry user_id and row-level security decides what a
-- query can see, so a forgotten filter can't show one account another's data.
-- Sign-in tables stay out of reach of the role that runs tool queries.

create table users (
  id               integer generated always as identity primary key,
  email            text not null,
  name             text not null,
  password_hash    text,
  google_sub       text unique,
  base_currency    text not null default 'IDR' check (base_currency in ('IDR','USD')),
  start_page       text not null default 'portfolio' check (start_page in ('portfolio','watchlist')),
  notify_zone      boolean not null default true,
  notify_review    boolean not null default true,
  notify_weekly    boolean not null default false,
  mcp_access       text not null default 'rw' check (mcp_access in ('ro','rw')),
  weekly_sent_on   date,
  created_at       timestamptz not null default now()
);
create unique index users_email_unique on users (lower(email));

create table sessions (
  id           integer generated always as identity primary key,
  user_id      integer not null references users(id) on delete cascade,
  token_hash   text not null unique,
  expires_at   timestamptz not null,
  created_at   timestamptz not null default now()
);

create table password_resets (
  token_hash text primary key,
  user_id    integer not null references users(id) on delete cascade,
  expires_at timestamptz not null,
  used_at    timestamptz
);

create table oauth_clients (
  client_id     text primary key,
  client_name   text not null,
  redirect_uris text[] not null,
  created_at    timestamptz not null default now()
);

create table oauth_codes (
  code_hash      text primary key,
  client_id      text not null references oauth_clients(client_id) on delete cascade,
  user_id        integer not null references users(id) on delete cascade,
  redirect_uri   text not null,
  code_challenge text not null,
  expires_at     timestamptz not null,
  used_at        timestamptz
);

-- One row per connected assistant: a personal token, or an OAuth grant.
-- Only hashes are stored, so a copy of the database can't call the API.
create table api_tokens (
  id                 integer generated always as identity primary key,
  user_id            integer not null references users(id) on delete cascade,
  kind               text not null check (kind in ('token','oauth')),
  name               text not null,
  token_hash         text not null unique,
  suffix             text not null,
  client_id          text references oauth_clients(client_id) on delete cascade,
  refresh_hash       text unique,
  expires_at         timestamptz,
  refresh_expires_at timestamptz,
  created_at         timestamptz not null default now(),
  last_used_at       timestamptz
);

create function app_user() returns integer language sql stable as
$$ select nullif(current_setting('app.user_id', true), '')::integer $$;

alter table assets         add column user_id integer default app_user() references users(id) on delete cascade;
alter table trades         add column user_id integer default app_user() references users(id) on delete cascade;
alter table theses         add column user_id integer default app_user() references users(id) on delete cascade;
alter table watchlist      add column user_id integer default app_user() references users(id) on delete cascade;
alter table journal        add column user_id integer default app_user() references users(id) on delete cascade;
alter table thesis_reviews add column user_id integer default app_user() references users(id) on delete cascade;

alter table watchlist add column notified_at timestamptz;
alter table theses    add column review_notified_on date;

-- Assets belong to one account, so a manual price or feed choice never touches another's.
-- USD/IDR stays shared, with no owner.
alter table assets drop constraint assets_symbol_key;
create unique index assets_symbol_per_user on assets (coalesce(user_id, 0), symbol);
create index trades_user_idx on trades (user_id);
create index theses_user_idx on theses (user_id);
create index watchlist_user_idx on watchlist (user_id);
create index journal_user_idx on journal (user_id);

-- Deleting an account removes every record, whatever order the cascades run in.
alter table prices         drop constraint prices_asset_id_fkey,
  add foreign key (asset_id) references assets(id) on delete cascade;
alter table trades         drop constraint trades_asset_id_fkey,
  add foreign key (asset_id) references assets(id) on delete cascade;
alter table theses         drop constraint theses_asset_id_fkey,
  add foreign key (asset_id) references assets(id) on delete cascade;
alter table watchlist      drop constraint watchlist_asset_id_fkey,
  add foreign key (asset_id) references assets(id) on delete cascade;
alter table watchlist      drop constraint watchlist_thesis_id_fkey,
  add foreign key (thesis_id) references theses(id) on delete cascade;
alter table journal        drop constraint journal_asset_id_fkey,
  add foreign key (asset_id) references assets(id) on delete cascade;
alter table journal        drop constraint journal_thesis_id_fkey,
  add foreign key (thesis_id) references theses(id) on delete cascade;
alter table thesis_reviews drop constraint thesis_reviews_thesis_id_fkey,
  add foreign key (thesis_id) references theses(id) on delete cascade;

-- Tool queries run as this role. It can't log in, can't see sign-in tables,
-- and is bound by the policies below. Roles are per server, so it may already exist.
do $$
begin
  if not exists (select from pg_roles where rolname = 'ladder_app') then
    create role ladder_app nologin;
  end if;
end $$;
grant ladder_app to current_user;
grant usage on schema public to ladder_app;
grant select, insert, update, delete on assets, prices, trades, theses, watchlist, journal, thesis_reviews to ladder_app;
grant usage on all sequences in schema public to ladder_app;

alter table assets         enable row level security;
alter table prices         enable row level security;
alter table trades         enable row level security;
alter table theses         enable row level security;
alter table watchlist      enable row level security;
alter table journal        enable row level security;
alter table thesis_reviews enable row level security;

create policy assets_read  on assets for select using (user_id = app_user() or class = 'fx');
create policy assets_add   on assets for insert with check (user_id = app_user());
create policy assets_edit  on assets for update using (user_id = app_user()) with check (user_id = app_user());
create policy assets_drop  on assets for delete using (user_id = app_user());

-- Visibility comes from the assets policy, so this also covers the shared USD/IDR rate.
create policy prices_own on prices for all
  using (asset_id in (select id from assets))
  with check (asset_id in (select id from assets));

create policy trades_own         on trades         for all using (user_id = app_user()) with check (user_id = app_user());
create policy theses_own         on theses         for all using (user_id = app_user()) with check (user_id = app_user());
create policy watchlist_own      on watchlist      for all using (user_id = app_user()) with check (user_id = app_user());
create policy journal_own        on journal        for all using (user_id = app_user()) with check (user_id = app_user());
create policy thesis_reviews_own on thesis_reviews for all using (user_id = app_user()) with check (user_id = app_user());
