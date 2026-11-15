-- Vaihe 4: palkinnot, saldo ja kolmikon vaihto.
-- Kertyneet pisteet (pistetapahtuma) eivät koskaan vähene; saldo = kertyneet − kulut.

create table pistekulu (
  id     bigint generated always as identity primary key,
  aika   timestamptz not null default now(),
  maara  integer not null check (maara > 0),
  syy    text not null
);

-- Yksi arvonta jokaista ylitettyä avauskynnystä kohden.
create table palkintoarvonta (
  id           bigint generated always as identity primary key,
  kynnys       integer not null unique,
  siemen       bigint not null,
  vaihtoehdot  text[] not null,
  luotu        timestamptz not null default now(),
  valittu      timestamptz,
  valinta      text
);

create table palkinto (
  id        bigint generated always as identity primary key,
  tyyppi    text not null check (tyyppi in ('jokeri', 'vapaapaiva', 'bossi_ilta', 'vaihto')),
  arvonta   bigint references palkintoarvonta(id),
  saatu     timestamptz not null default now(),
  kaytetty  timestamptz,
  kaytto    jsonb
);

create index palkinto_kayttamaton on palkinto (tyyppi) where kaytetty is null;

-- Miksi skillikaistan arvonta suljettiin: valinta, vaihto tai jokeri.
alter table arvonta add column suljettu_syy text;

alter table pistekulu enable row level security;
alter table palkintoarvonta enable row level security;
alter table palkinto enable row level security;

create function saldo()
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select (coalesce((select sum(pisteet) from pistetapahtuma), 0)
        - coalesce((select sum(maara) from pistekulu), 0))::integer;
$$;

create function valitse_palkinto(p_arvonta bigint, p_tyyppi text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  a palkintoarvonta;
begin
  select * into a from palkintoarvonta where id = p_arvonta and valittu is null for update;
  if not found then
    raise exception 'palkintoarvonta % ei ole avoinna', p_arvonta;
  end if;
  if not (p_tyyppi = any (a.vaihtoehdot)) then
    raise exception 'palkinto % ei ole vaihtoehtojen joukossa', p_tyyppi;
  end if;
  insert into palkinto (tyyppi, arvonta) values (p_tyyppi, p_arvonta);
  update palkintoarvonta set valittu = now(), valinta = p_tyyppi where id = p_arvonta;
end;
$$;

-- Ottaa vanhimman käyttämättömän palkinnon käyttöön. Palauttaa sen id:n.
create function kayta_palkinto(p_tyyppi text, p_kaytto jsonb)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  p_id bigint;
begin
  select id into p_id from palkinto
  where tyyppi = p_tyyppi and kaytetty is null
  order by saatu, id limit 1 for update skip locked;
  if p_id is null then
    raise exception 'ei käyttämätöntä palkintoa: %', p_tyyppi;
  end if;
  update palkinto set kaytetty = now(), kaytto = p_kaytto where id = p_id;
  return p_id;
end;
$$;

-- Sulkee kaistan avoimen kolmikon: tarjotut haasteet hylätään ilman lisäpainoa.
create function sulje_kolmikko(p_kaista text, p_syy text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (select 1 from haaste where kaista = p_kaista and tila = 'aktiivinen') then
    raise exception 'kaistalla % on jo aktiivinen haaste', p_kaista;
  end if;
  update haaste set tila = 'hylatty' where kaista = p_kaista and tila = 'tarjolla';
  update arvonta set valittu = now(), suljettu_syy = p_syy where kaista = p_kaista and valittu is null;
end;
$$;

-- Kolmikon vaihto: 100 pistettä saldosta tai ilmainen vaihto -palkinto.
create function vaihda_kolmikko(p_kaista text, p_ilmainen boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Yksi vaihto kerrallaan, ettei saldo mene kahdella samanaikaisella pyynnöllä miinukselle.
  perform pg_advisory_xact_lock(hashtext('vaihda_kolmikko'));
  if not exists (select 1 from haaste where kaista = p_kaista and tila = 'tarjolla') then
    raise exception 'kaistalla % ei ole vaihdettavaa kolmikkoa', p_kaista;
  end if;
  if p_ilmainen then
    perform kayta_palkinto('vaihto', jsonb_build_object('kaista', p_kaista));
  else
    if saldo() < 100 then
      raise exception 'saldo ei riitä: % / 100', saldo();
    end if;
    insert into pistekulu (maara, syy) values (100, 'Kolmikon vaihto: ' || p_kaista);
  end if;
  perform sulje_kolmikko(p_kaista, 'vaihto');
end;
$$;

-- Jokeri: avoin kolmikko suljetaan ja valittu skilli aktivoidaan suoraan.
create function kayta_jokeri(p_kaista text, p_haaste jsonb)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  h_id bigint;
begin
  perform sulje_kolmikko(p_kaista, 'jokeri');
  perform kayta_palkinto('jokeri', jsonb_build_object('kaista', p_kaista, 'kohde', p_haaste->>'kohde'));
  insert into haaste (kaista, kohde, ulottuvuus, mittari, alkuarvo, tavoite, tavoitetaso,
                      tunnit, pisteet, kuvaus, tila, aloitettu)
  values (p_kaista, p_haaste->>'kohde', p_haaste->>'ulottuvuus', p_haaste->>'mittari',
          (p_haaste->>'alkuarvo')::numeric, (p_haaste->>'tavoite')::numeric,
          (p_haaste->>'tavoitetaso')::integer, (p_haaste->>'tunnit')::numeric,
          (p_haaste->>'pisteet')::integer, p_haaste->>'kuvaus', 'aktiivinen', now())
  returning id into h_id;
  return h_id;
end;
$$;

-- Bossi-ilta: EHB:n kasvu illan aikana hyvitetään pisteinä (10 / tunti).
-- Kutsutaan joka tarkistuksessa; hyvittää vain uuden osuuden.
create function hyvita_bossi_ilta(p_palkinto bigint, p_ehb numeric, p_paattynyt boolean)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  p palkinto;
  ansaittu integer;
  uusi integer;
begin
  select * into p from palkinto
  where id = p_palkinto and tyyppi = 'bossi_ilta' and kaytetty is not null
    and not coalesce((kaytto->>'paattynyt')::boolean, false)
  for update;
  if not found then
    return 0;
  end if;
  ansaittu := greatest(0, floor((p_ehb - (p.kaytto->>'ehb_alku')::numeric) * 10))::integer;
  uusi := ansaittu - coalesce((p.kaytto->>'annettu')::integer, 0);
  if uusi > 0 then
    insert into pistetapahtuma (pisteet, syy) values (uusi, 'Bossi-ilta');
  end if;
  update palkinto set kaytto = kaytto
    || jsonb_build_object('annettu', greatest(ansaittu, coalesce((kaytto->>'annettu')::integer, 0)),
                          'paattynyt', p_paattynyt)
  where id = p_palkinto;
  return greatest(uusi, 0);
end;
$$;

revoke all on function saldo() from public, anon, authenticated;
revoke all on function valitse_palkinto(bigint, text) from public, anon, authenticated;
revoke all on function kayta_palkinto(text, jsonb) from public, anon, authenticated;
revoke all on function sulje_kolmikko(text, text) from public, anon, authenticated;
revoke all on function vaihda_kolmikko(text, boolean) from public, anon, authenticated;
revoke all on function kayta_jokeri(text, jsonb) from public, anon, authenticated;
revoke all on function hyvita_bossi_ilta(bigint, numeric, boolean) from public, anon, authenticated;
