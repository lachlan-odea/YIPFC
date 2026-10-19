-- Pod Pool schema. Paste into the Supabase SQL editor of a fresh project.
--
-- This is a trusted friend group, so access is intentionally simple: anyone
-- holding the app's anon key can read and write. Keep the deployed URL to
-- your pod. If you want a lock, enable Supabase Auth and tighten the policies.

create extension if not exists pgcrypto;

create table if not exists players (
  id uuid primary key,
  name text not null,
  created_at timestamptz not null default now()
);

create table if not exists cards (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references players(id) on delete cascade,
  scryfall_id text not null,
  name text not null,
  set_code text not null,
  set_name text not null default '',
  collector_number text not null default '',
  type_line text not null default '',
  mana_cost text not null default '',
  cmc numeric not null default 0,
  color_identity text[] not null default '{}',
  rarity text not null default '',
  image_small text not null default '',
  image_normal text not null default '',
  oracle_text text not null default '',
  quantity int not null default 1 check (quantity >= 0),
  notes text not null default '',
  created_at timestamptz not null default now(),
  unique (owner_id, scryfall_id)
);

create table if not exists loans (
  id uuid primary key default gen_random_uuid(),
  card_id uuid not null references cards(id) on delete cascade,
  borrower_id uuid not null references players(id) on delete cascade,
  status text not null default 'requested'
    check (status in ('requested', 'lent', 'returned', 'declined')),
  requested_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists cards_name_idx on cards (lower(name));
create index if not exists cards_owner_idx on cards (owner_id);
create index if not exists loans_card_idx on loans (card_id);

-- Bulk insert that adds to quantity when the owner already has that printing.
create or replace function add_cards(rows jsonb)
returns setof cards
language plpgsql
as $$
begin
  return query
  insert into cards (
    owner_id, scryfall_id, name, set_code, set_name, collector_number, type_line,
    mana_cost, cmc, color_identity, rarity, image_small, image_normal, oracle_text, quantity, notes
  )
  select
    (r->>'owner_id')::uuid, r->>'scryfall_id', r->>'name', r->>'set_code',
    coalesce(r->>'set_name', ''), coalesce(r->>'collector_number', ''), coalesce(r->>'type_line', ''),
    coalesce(r->>'mana_cost', ''), coalesce((r->>'cmc')::numeric, 0),
    coalesce(array(select jsonb_array_elements_text(r->'color_identity')), '{}'),
    coalesce(r->>'rarity', ''), coalesce(r->>'image_small', ''), coalesce(r->>'image_normal', ''),
    coalesce(r->>'oracle_text', ''), coalesce((r->>'quantity')::int, 1), coalesce(r->>'notes', '')
  from jsonb_array_elements(rows) as r
  on conflict (owner_id, scryfall_id) do update
    set quantity = cards.quantity + excluded.quantity
  returning *;
end;
$$;

-- Open access for the pod (see note at top).
alter table players enable row level security;
alter table cards enable row level security;
alter table loans enable row level security;

drop policy if exists "pod can do anything" on players;
drop policy if exists "pod can do anything" on cards;
drop policy if exists "pod can do anything" on loans;
create policy "pod can do anything" on players for all using (true) with check (true);
create policy "pod can do anything" on cards for all using (true) with check (true);
create policy "pod can do anything" on loans for all using (true) with check (true);

-- Realtime so every phone updates when someone adds a card or asks to borrow.
alter publication supabase_realtime add table players, cards, loans;
