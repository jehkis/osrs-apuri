# OSRS-apuri

Oma web-sovellus, joka vie tilin max capeen haasteilla ja opettaa endgame-bosseja.
Suunnitelma: https://claude.ai/artifact/JFhBRE8PU8pkDa1JhaQziR

Taustapalvelu on Supabasessa: Postgres, pg_cron-ajastus ja Edge Functionit.

## Rakenne

| Polku | Sisältö |
| --- | --- |
| `supabase/migrations/` | Tietokanta: lähteet, mittarilukemat, ajastus |
| `supabase/functions/_jaettu/wom.ts` | WOM-datan muunto mittareiksi (puhdas funktio) |
| `supabase/functions/hae-wom/` | Tunnin välein ajettava WOM-haku |
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

Ilmaisen tason projekti pysähtyy noin viikon käyttämättömyyden jälkeen.
