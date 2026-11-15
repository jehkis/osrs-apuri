-- Vaihe 3: skillikaistat, arvonnat, haasteet ja pisteet.
-- Kaikki luku ja kirjoitus kulkee api-funktion kautta service role -avaimella,
-- joten tauluilla on RLS päällä ilman yhtään sääntöä.

create table ehp_tahti (
  skilli      text primary key,
  menetelmat  jsonb not null,           -- WOM: [{startExp, rate, description}]
  paivitetty  timestamptz not null default now()
);

create table kaista (
  id          text primary key,
  nimi        text not null,
  jarjestys   integer not null
);

insert into kaista (id, nimi, jarjestys) values
  ('skilli1', 'Pääskilli 1', 1),
  ('skilli2', 'Pääskilli 2', 2);

create table arvonta (
  id      bigint generated always as identity primary key,
  kaista  text not null references kaista(id),
  siemen  bigint not null,
  luotu   timestamptz not null default now(),
  valittu timestamptz
);

-- Kaistalla on korkeintaan yksi avoin arvonta.
create unique index arvonta_yksi_avoin on arvonta (kaista) where valittu is null;

create table haaste (
  id           bigint generated always as identity primary key,
  kaista       text not null references kaista(id),
  arvonta      bigint references arvonta(id),
  kohde        text not null,
  ulottuvuus   text not null,
  mittari      text not null,
  alkuarvo     numeric not null,
  tavoite      numeric not null check (tavoite > 0),   -- lisäys alkuarvoon
  tavoitetaso  integer,
  tunnit       numeric not null,
  pisteet      integer not null,
  kuvaus       text not null,
  tila         text not null default 'tarjolla'
               check (tila in ('tarjolla', 'aktiivinen', 'valmis', 'hylatty')),
  luotu        timestamptz not null default now(),
  aloitettu    timestamptz,
  valmistui    timestamptz
);

create unique index haaste_yksi_aktiivinen on haaste (kaista) where tila = 'aktiivinen';
create index haaste_tila on haaste (tila);

-- Ohitetut kohteet saavat lisää painoa seuraaviin arvontoihin.
create table arvontapaino (
  kaista  text not null references kaista(id),
  kohde   text not null,
  lisa    numeric not null default 0,
  primary key (kaista, kohde)
);

create table pistetapahtuma (
  id      bigint generated always as identity primary key,
  aika    timestamptz not null default now(),
  haaste  bigint references haaste(id),
  pisteet integer not null,
  syy     text not null
);

alter table ehp_tahti enable row level security;
alter table kaista enable row level security;
alter table arvonta enable row level security;
alter table haaste enable row level security;
alter table arvontapaino enable row level security;
alter table pistetapahtuma enable row level security;

-- Valinta yhtenä transaktiona: valittu aktiiviseksi, muut hylätyiksi ja niille lisäpaino.
-- Alkuarvo päivitetään valintahetken lukemaan, koska kolmikko voi olla vanha.
create function valitse_haaste(p_haaste bigint, p_nyt numeric)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  h haaste;
begin
  select * into h from haaste where id = p_haaste and tila = 'tarjolla' for update;
  if not found then
    raise exception 'haaste % ei ole tarjolla', p_haaste;
  end if;

  update haaste set
    tila = 'aktiivinen',
    aloitettu = now(),
    alkuarvo = p_nyt,
    -- Tasotavoite on absoluuttinen taso, joten lisäys lasketaan uudesta alkuarvosta.
    tavoite = case when tavoitetaso is null then tavoite else greatest(1, tavoite + alkuarvo - p_nyt) end
  where id = p_haaste;

  update haaste set tila = 'hylatty'
  where arvonta = h.arvonta and id <> p_haaste;

  insert into arvontapaino (kaista, kohde, lisa)
  select kaista, kohde, 0.25 from haaste where arvonta = h.arvonta and id <> p_haaste
  on conflict (kaista, kohde) do update set lisa = arvontapaino.lisa + 0.25;

  insert into arvontapaino (kaista, kohde, lisa) values (h.kaista, h.kohde, 0)
  on conflict (kaista, kohde) do update set lisa = 0;

  update arvonta set valittu = now() where id = h.arvonta;
end;
$$;

-- Valmistuminen ja pisteet samalla kertaa, ettei pisteitä kirjata kahdesti.
create function merkitse_valmiiksi(p_haaste bigint)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  h haaste;
begin
  update haaste set tila = 'valmis', valmistui = now()
  where id = p_haaste and tila = 'aktiivinen'
  returning * into h;
  if not found then
    return false;
  end if;
  insert into pistetapahtuma (haaste, pisteet, syy) values (h.id, h.pisteet, h.kuvaus);
  return true;
end;
$$;

revoke all on function valitse_haaste(bigint, numeric) from public, anon, authenticated;
revoke all on function merkitse_valmiiksi(bigint) from public, anon, authenticated;
