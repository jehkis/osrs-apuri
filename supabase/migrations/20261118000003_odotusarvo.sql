-- Lootin odotusarvo per bossi (GP/tappo) wikin droppitaulukosta ja GE-hinnoista.
-- WOM-haku päivittää sen kerran päivässä. Kassa-näkymän tavoite on 3000 × gp_tappo.

create table odotusarvo (
  bossi       text primary key,            -- WOM:n mittari, esim. 'giant_mole'
  gp_tappo    numeric     not null check (gp_tappo >= 0),
  erittely    jsonb       not null,        -- suurimmat osat: [{"nimi", "gp"}]
  paivitetty  timestamptz not null default now()
);

alter table odotusarvo enable row level security;
