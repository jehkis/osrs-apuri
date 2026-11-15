-- Vaihe 2: mittarilukemat ja lähteet.
-- Jokainen lähde (WOM, WikiSync, EventsAPI, käsin) kirjoittaa samaan tauluun.
-- Haaste on myöhemmin mittari + alkuarvo + tavoite, joten todennus on yksi sääntö.

create table lahde (
  id          text primary key,          -- 'wom', 'wikisync', 'events', 'kasin'
  kuvaus      text not null,
  paivitetty  timestamptz,               -- viimeisin onnistunut haku
  virhe       text                       -- viimeisimmän epäonnistuneen haun viesti
);

insert into lahde (id, kuvaus) values
  ('wom',      'Wise Old Man: skillit, XP, EHP, aika maxiin, KC:t'),
  ('wikisync', 'WikiSync: questit, diaryt, Combat Achievementit'),
  ('events',   'RuneLite-tapahtumat: killit ja dropit aikaleimoineen'),
  ('kasin',    'Oma kuittaus');

create table mittarilukema (
  id       bigint generated always as identity primary key,
  mittari  text        not null,         -- esim. 'xp:mining', 'kc:zulrah', 'tili:ttm'
  arvo     numeric     not null,
  aika     timestamptz not null,
  lahde    text        not null references lahde(id),
  varmuus  text        not null default 'tarkka'
           check (varmuus in ('tarkka', 'alle_rajan', 'arvio')),
  unique (mittari, aika, lahde)
);

create index mittarilukema_mittari_aika on mittarilukema (mittari, aika desc);

-- Uusin lukema jokaiselle mittarille.
create view mittari_nyt with (security_invoker = true) as
select distinct on (mittari) mittari, arvo, aika, lahde, varmuus
from mittarilukema
order by mittari, aika desc, id desc;

-- Kirjaa lukemat, mutta vain ne, jotka poikkeavat mittarin uusimmasta arvosta.
-- Näin tunnin välein tehty haku ei kasvata taulua, kun mitään ei ole tapahtunut.
-- lukemat = [{"mittari": "...", "arvo": 123, "varmuus": "tarkka"}, ...]
create function kirjaa_lukemat(p_lahde text, p_aika timestamptz, lukemat jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  lisatty integer;
begin
  with uudet as (
    select l->>'mittari' as mittari,
           (l->>'arvo')::numeric as arvo,
           coalesce(l->>'varmuus', 'tarkka') as varmuus
    from jsonb_array_elements(lukemat) l
  ), muuttuneet as (
    select u.*
    from uudet u
    left join mittari_nyt n on n.mittari = u.mittari
    where n.mittari is null
       or n.arvo is distinct from u.arvo
       or n.varmuus is distinct from u.varmuus
  ), lisays as (
    insert into mittarilukema (mittari, arvo, aika, lahde, varmuus)
    select mittari, arvo, p_aika, p_lahde, varmuus from muuttuneet
    on conflict (mittari, aika, lahde) do nothing
    returning 1
  )
  select count(*) into lisatty from lisays;

  update lahde set paivitetty = now(), virhe = null where id = p_lahde;
  return lisatty;
end;
$$;

create function kirjaa_virhe(p_lahde text, p_viesti text)
returns void
language sql
security definer
set search_path = public
as $$
  update lahde set virhe = left(p_viesti, 1000) where id = p_lahde;
$$;

-- Yksi käyttäjä: anon-avaimella ei pääse mihinkään. Edge Function käyttää
-- service role -avainta. Käyttöliittymän oikeudet lisätään vaiheessa 3.
alter table lahde enable row level security;
alter table mittarilukema enable row level security;
revoke all on function kirjaa_lukemat(text, timestamptz, jsonb) from public, anon, authenticated;
revoke all on function kirjaa_virhe(text, text) from public, anon, authenticated;
