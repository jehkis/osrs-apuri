-- Bossiprojekti korvaa max cape -haasteet: viisi bossia, 3000 KC kullekin.
-- Vanha versio on tagissa max-cape-versio. Mittarilukemat ja WOM-ajastus jäävät.

drop function if exists valitse_haaste(bigint, numeric) cascade;
drop function if exists merkitse_valmiiksi(bigint) cascade;
drop function if exists saldo() cascade;
drop function if exists valitse_palkinto(bigint, text) cascade;
drop function if exists kayta_palkinto(text, jsonb) cascade;
drop function if exists sulje_kolmikko(text, text) cascade;
drop function if exists vaihda_kolmikko(text, boolean) cascade;
drop function if exists kayta_jokeri(text, jsonb) cascade;
drop function if exists hyvita_bossi_ilta(bigint, numeric, boolean) cascade;

drop table if exists
  pistetapahtuma, arvontapaino, haaste, arvonta, kaista, ehp_tahti,
  pistekulu, palkintoarvonta, palkinto,
  bossi, ca_taski, ehb_tahti
  cascade;

-- Käsin kirjatut uniikit. Sama esine voi tulla monta kertaa.
-- Bossin ja esineen kelpoisuus tarkistetaan api-funktiossa projektin listasta.
create table droppi (
  id     bigint generated always as identity primary key,
  bossi  text        not null,           -- WOM:n mittari, esim. 'giant_mole'
  esine  text        not null,           -- wikin nimi, esim. 'Baby mole'
  kc     integer     not null check (kc >= 0),
  aika   timestamptz not null default now()
);

create index droppi_bossi on droppi (bossi, esine, kc);

-- Kaikki kulkee api-funktion (service role) kautta.
alter table droppi enable row level security;
