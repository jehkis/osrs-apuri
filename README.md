# OSRS-apuri

Oma web-sovellus, joka vie tilin max capeen haasteilla ja opettaa endgame-bosseja.
Suunnitelma: https://claude.ai/artifact/JFhBRE8PU8pkDa1JhaQziR

Taustapalvelu on Supabasessa: Postgres, pg_cron-ajastus ja Edge Functionit.

## Rakenne

| Polku | Sisältö |
| --- | --- |
| `supabase/migrations/` | Tietokanta: lähteet, mittarilukemat, ajastus |
| `supabase/functions/_jaettu/wom.ts` | WOM-datan muunto mittareiksi (puhdas funktio) |
| `supabase/functions/_jaettu/ehp.ts` | XP-taulukko ja tunnit EHP-tahdeista |
| `supabase/functions/_jaettu/arvonta.ts` | Skillikaistojen kolmen vaihtoehdon arvonta |
| `supabase/functions/_jaettu/eteneminen.ts` | Tasot, kestot ja max-ennuste |
| `supabase/functions/_jaettu/palvelu.ts` | Tietokantaa käyttävä logiikka |
| `supabase/functions/hae-wom/` | Tunnin välein ajettava WOM-haku |
| `supabase/functions/api/` | Käyttöliittymän rajapinta (vaatii kirjautumisen) |
| `web/` | Käyttöliittymä, julkaistaan GitHub Pagesiin |
| `testit/` | Deno-testit; tietokantatestit ajetaan PGlitellä |

Testit: `deno task testit`

## Mittarit

Jokainen lukema on `(mittari, arvo, aika, lähde, varmuus)`. Uusi rivi kirjataan vain,
kun arvo tai varmuus muuttuu. Haaste on myöhemmin mittari + alkuarvo + tavoite.

| Mittari | Esimerkki |
| --- | --- |
| `xp:<skilli>` | `xp:mining` |
| `kc:<bossi>` | `kc:zulrah` |
| `akt:<aktiviteetti>` | `akt:guardians_of_the_rift` |
| `tili:ehp`, `tili:ehb`, `tili:ttm`, `tili:combat` | WOM:n laskelmat (varmuus `arvio`) |

Hiscoren −1 tallennetaan arvolla 0 ja varmuudella `alle_rajan`.

## Käyttöönotto

```sh
npx supabase login
npx supabase link --project-ref <ref>
npx supabase db push
npx supabase secrets set CRON_AVAIN=<satunnainen> OSRS_RSN=zei_kill
npx supabase functions deploy hae-wom
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
