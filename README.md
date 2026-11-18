# OSRS-apuri: bossiprojekti 3000

Oma web-sovellus, joka seuraa viiden bossin projektia: 3000 KC kullekin.

| Bossi | Lempinimi | WOM-mittari | Uniikit |
| --- | --- | --- | --- |
| Giant Mole | Myyrä | `giant_mole` | Baby mole, Long bone, Curved bone |
| Sarachnis | Sararis | `sarachnis` | Sarachnis cudgel, Jar of eyes, Sraracha |
| Moons of Peril | Moon | `lunar_chests` (avatut arkut) | Blood/Blue/Eclipse Moon -sarjat (12 osaa) |
| Mad Angel | Hullu enkeli | `mad_angel` | Hallowfell, Jar of Light, Aggy |
| Amoxliatl | Amox | `amoxliatl` | Pendant of Ates (inert), Glacial temotli, Moxi |

KC:t tulevat Wise Old Manista tunnin välein. Uniikit kirjataan sivulla käsin
("Sain"), ja sivu laskee niistä dry-tilaston: KC:t edellisestä, kerrat droprateen
nähden ja todennäköisyyden, jolla esine olisi jo pitänyt tulla. Bossi- ja uniikkilista
on tiedostossa `supabase/functions/_jaettu/projekti.ts`.

Tavoitteet: virstanpylväät 100, 250, 500, 1000, 1500, 2000, 2500 ja 3000 KC, tahti
(KC/vko 28 päivän ikkunasta) ja arvioitu valmistumispäivä. Projekti alkoi 18.11.2026.

Aiempi versio (max cape -haasteet ja endgame-opettelu) on tagissa `max-cape-versio`.

Taustapalvelu on Supabasessa: Postgres, pg_cron-ajastus ja Edge Functionit.

## Rakenne

| Polku | Sisältö |
| --- | --- |
| `supabase/migrations/` | Tietokanta: mittarilukemat, ajastus, droppitaulu |
| `supabase/functions/_jaettu/wom.ts` | WOM-datan muunto mittareiksi (puhdas funktio) |
| `supabase/functions/_jaettu/projekti.ts` | Bossit, uniikit, virstanpylväät, tahti ja dry-tilasto |
| `supabase/functions/_jaettu/palvelu.ts` | Tietokantaa käyttävä logiikka |
| `supabase/functions/hae-wom/` | Tunnin välein ajettava WOM-haku |
| `supabase/functions/api/` | Käyttöliittymän rajapinta (vaatii kirjautumisen) |
| `web/` | Käyttöliittymä, julkaistaan GitHub Pagesiin |
| `testit/` | Deno-testit; tietokantatestit ajetaan PGlitellä |

Testit: `deno task testit`

## Mittarit

Jokainen lukema on `(mittari, arvo, aika, lähde, varmuus)`. Uusi rivi kirjataan vain,
kun arvo tai varmuus muuttuu. WOM-haku kirjaa edelleen kaikki mittarit (`xp:*`, `kc:*`,
`akt:*`, `tili:*`), joten historia säilyy, vaikka sivu näyttää vain projektin bossit.
Hiscoren −1 tallennetaan arvolla 0 ja varmuudella `alle_rajan`.

## Käyttöönotto

```sh
npx supabase login
npx supabase link --project-ref <ref>
npx supabase db push
npx supabase secrets set CRON_AVAIN=<satunnainen> OSRS_RSN=zei_kill
npx supabase functions deploy hae-wom
npx supabase functions deploy api
```

Ajastus lukee osoitteen ja avaimen Vaultista. Aja kerran SQL-editorissa:

```sql
select vault.create_secret('https://<ref>.supabase.co', 'projekti_url');
select vault.create_secret('<sama CRON_AVAIN>', 'cron_avain');
```

Rekisteröityminen on suljettu (`enable_signup = false`). Ainoa tunnus
`zei@osrs-apuri.invalid` luotiin Auth-hallintarajapinnalla; salasana on `.env`-tiedostossa
(`SIVU_SALASANA`). Osoite ei ole oikea sähköposti, joten sivulla kysytään vain salasanaa.

Sivun voi ajaa paikallisesti: `cd web && python3 -m http.server 8000`.

Ilmaisen tason projekti pysähtyy noin viikon käyttämättömyyden jälkeen.
