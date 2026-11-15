-- Vaihe 5: taukokaista ja endgame-opettelupolku.
-- Bossit ja CA-taskit päivitetään wikistä, EHB-tahdit WOM:sta (kerran päivässä).

insert into kaista (id, nimi, jarjestys) values ('tauko', 'Tauko: bossit', 3);

create table bossi (
  id          text primary key,            -- WOM:n mittari, esim. 'vorkath'
  nimi        text not null,               -- wikin nimi
  porras      integer not null check (porras between 1 and 5),
  vaikeus     integer not null,            -- CA-tierien mediaani 0–5
  opeteltava  boolean not null,
  vaatimus    jsonb,                       -- {"slayer": 91} tai {"quest": "..."}
  paivitetty  timestamptz not null default now()
);

create table ca_taski (
  id      integer primary key,
  nimi    text not null,
  bossi   text not null references bossi(id),
  tier    integer not null check (tier between 0 and 5),
  tyyppi  text not null,
  kuvaus  text not null
);

create index ca_taski_bossi on ca_taski (bossi);

create table ehb_tahti (
  bossi           text primary key,
  tapot_tunnissa  numeric not null,
  paivitetty      timestamptz not null default now()
);

alter table bossi enable row level security;
alter table ca_taski enable row level security;
alter table ehb_tahti enable row level security;
