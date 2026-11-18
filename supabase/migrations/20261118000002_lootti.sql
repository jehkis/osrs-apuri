-- Dink-pluginin lähettämät lootit: yksi rivi per tappo (Moonsilla per arkku).
-- Hinnat ovat Dinkin GE-hintoja dropin hetkellä, joten arvo ei muutu jälkikäteen.

create table lootti (
  id       bigint generated always as identity primary key,
  bossi    text        not null,          -- WOM:n mittari, esim. 'giant_mole'
  kc       integer,                       -- Dinkin killCount, jos RuneLite tiesi sen
  arvo     bigint      not null check (arvo >= 0),
  esineet  jsonb       not null,          -- [{"id", "nimi", "maara", "hinta"}]
  aika     timestamptz not null default now()
);

create index lootti_bossi_aika on lootti (bossi, aika);

create view lootti_bossi with (security_invoker = true) as
select bossi, count(*)::int as tappoja, sum(arvo)::bigint as arvo, min(aika) as alku
from lootti
group by bossi;

create view lootti_esine with (security_invoker = true) as
select l.bossi,
       e->>'nimi' as nimi,
       sum((e->>'maara')::bigint)::bigint as maara,
       sum((e->>'maara')::bigint * (e->>'hinta')::bigint)::bigint as arvo
from lootti l, jsonb_array_elements(l.esineet) e
group by l.bossi, e->>'nimi';

alter table lootti enable row level security;
