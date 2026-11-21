# OSRS-apuri: bossiprojekti 3000

**Tekijä:** Joona Jehkonen

Oma web-sovellus, joka seuraa Old School RuneScape -pelin bossiprojektiani: viisi bossia ja
3000 tappoa (KC) kullekin. Sovellus näyttää edistymisen, tahdin, arvioidun valmistumispäivän,
saadut uniikit esineet ja kertyneen lootin arvon. Data päivittyy itsestään: KC:t tulevat Wise Old
Manista tunnin välein ja Dink-pluginista heti tapon jälkeen.

Sovellus on myös **Web Development 1 -kurssin Projekti 3** (JavaScript-sovellus ulkoisten
kirjastojen avulla). Projektia varten käyttöliittymä tehtiin uudelleen **jQuerylla**,
**Bootstrapilla** ja **Chart.js:llä**, ja siihen lisättiin bossikohtainen näkymä, KC-käyrä,
juhlinta ja lukutila opettajaa varten. Projektin osuus on kuvattu kohdassa
[Projekti 3: ulkoiset kirjastot](#projekti-3-ulkoiset-kirjastot).

## Linkit

- **Julkaistu sovellus:** https://jehkis.github.io/osrs-apuri/ (vaatii kirjautumisen; opettajan tunnukset ovat Canvas-palautuksessa)
- **GitHub-repositorio:** https://github.com/jehkis/osrs-apuri
- **Esittelyvideo:** TODO: lisää videon linkki

## Projekti 3: ulkoiset kirjastot

### Idea ja tausta

Aloitin OSRS-apurin omaksi käyttööni 15.11.2026 (ensimmäinen versio seurasi max cape -tavoitetta,
tagi `max-cape-versio`) ja muutin sen 18.11. bossiprojektin seurannaksi. Kurssin Projekti 3 antoi
mahdollisuuden rakentaa aiemman projektin pohjalta, joten valitsin oman, oikeasti käytössä olevan
sovellukseni. Ennen Projekti 3:a käyttöliittymä oli tehty tavallisella JavaScriptillä ilman kirjastoja.

Projektissa käyttöliittymä käännettiin jQueryyn ja Bootstrapiin, ja siihen lisättiin neljä uutta
ominaisuutta:

1. **Bossinäkymä:** etusivulla on tiiviit kortit, ja kortin klikkaus avaa bossin oman näkymän.
2. **KC-käyrä** Chart.js:llä: KC:n kehitys 28 päivän ajalta ja seuraava virstanpylväs.
3. **Juhlinta:** uusi uniikki tai virstanpylväs näyttää bannerin, kortti hehkuu ja KC laskee ylös.
4. **Opettajan tunnus:** muut kuin omistaja ovat lukutilassa, joten opettaja voi katsoa sovellusta muuttamatta dataa.
   Lukutilassa droppia voi kokeilla **demona**: juhlinta näkyy, mutta mitään ei tallenneta.

### Käytetyt kirjastot

| Kirjasto | Versio | Mihin sitä käytetään |
| --- | --- | --- |
| [jQuery](https://jquery.com/) | 3.7.1 | DOM-käsittely, tapahtumankuuntelijat, AJAX (`$.ajax`) ja animaatiot |
| [Bootstrap](https://getbootstrap.com/) | 5.3.3 | Toast-ilmoitukset, kirjausmodaali, välilehdet, napit, lomakkeet, badge, tumma teema |
| [Chart.js](https://www.chartjs.org/) | 4.4.1 | Bossinäkymän KC-käyrä |
| [Supabase JS](https://supabase.com/docs/reference/javascript) | 2.45.4 | Kirjautuminen (käytössä jo ennen Projekti 3:a) |

Kirjastot ladataan CDN:stä (`web/index.html`), joten sovellus ei tarvitse build-vaihetta.

### Miten kirjastoja käytetään

**jQuery**

- **DOM:** elementit haetaan CSS-valitsimilla (`$("#luvut")`) ja muokataan ketjutettavilla
  metodeilla: `.empty().append(...)`, `.text()`, `.val()`, `.prop("hidden", ...)`, `.attr()`.
- **Tapahtumat:** `.on("click", ...)` ja `.on("submit", ...)`. Kortit ja uniikkiruudut piirretään
  uudelleen viiden minuutin välein, joten niissä käytetään **delegoituja kuuntelijoita**:
  `$("#bossit").on("click", ".bossi", ...)`. Kuuntelija on vanhemmassa elementissä, ja tieto klikatusta
  kohteesta luetaan `data-`-attribuutista (`$(this).data("bossi")`).
- **AJAX:** kaikki palvelinkutsut kulkevat `kutsu()`-funktion kautta, joka käyttää `$.ajax`:ia.
  jQuery muuntaa JSON-vastauksen olioksi ja ohjaa virhestatukset (401, 403, 500) `catch`-lohkoon.
- **Näkymät:** osoitteen #-osa kertoo näkymän (`#bossi/sarachnis`). `$(window).on("hashchange", ...)`
  vaihtaa näkymän `fadeOut`/`fadeIn`-efekteillä, joten selaimen Takaisin-nappi toimii.
- **Animaatiot:** juhlabannerit näytetään jQueryn **animaatiojonolla** (`queue`, `slideDown`, `delay`,
  `slideUp`), joten useampi saavutus näkyy yksi kerrallaan. Kortin hehku ja KC-laskuri on tehty
  `animate()`-metodilla: animoidaan lukua 0 → 1, ja `step`-funktio muuttaa sen varjoksi tai luvuksi.

**Bootstrap**

- Ilmoitukset ovat **toasteja** (`bootstrap.Toast`) ja dropin kirjaus avautuu **modaaliin** (`bootstrap.Modal`).
- Bossinäkymässä on **välilehdet** (Uniikit, KC-käyrä, Lootti). Valittu välilehti muistetaan
  Bootstrapin `shown.bs.tab`-tapahtumalla, jota kuunnellaan jQuerylla.
- Napit (`btn`), lomakkeet (`form-control`, `form-label`) ja lukutilan merkki (`badge`).
- Värit muokattiin Bootstrapin CSS-muuttujilla (esim. `--bs-btn-bg`), joten komponentit ovat
  Bootstrapin mutta ilme sovelluksen oma. Tumma teema seuraa käyttöjärjestelmää (`data-bs-theme`).

**Chart.js**

- Portaittainen viivakaavio (`stepped: true`) KC:stä ja katkoviiva seuraavan virstanpylvään kohdalla.
- Värit luetaan CSS-muuttujista, joten kaavio on bossin värinen ja toimii tummassa teemassa.
- Vanha kaavio tuhotaan (`destroy()`) ennen uutta, kun näkymä piirretään uudelleen.

### Muut muutokset palvelimeen

- `kcKayra()` (`supabase/functions/_jaettu/projekti.ts`) laskee käyrän pisteet KC-historiasta:
  enintään yksi piste tunnissa, ja vanhentunut hiscore-lukema ohitetaan.
- `_jaettu/oikeudet.ts`: omistaja saa kaiken, muut tunnukset vain lukea. `api` palauttaa
  kirjoitusyrityksestä 403. Käyttöliittymässä lukijan "Sain" on demo: drop lisätään vain selaimessa
  olevaan kopioon datasta (`structuredClone`), ja sivu piirretään uudelleen, jolloin juhlinta
  käynnistyy. Palvelimelle ei lähetetä mitään, ja seuraava päivitys palauttaa oikean datan.
- Molemmille on testit (`testit/projekti_test.ts`, `testit/oikeudet_test.ts`).

### Käyttöohje

1. Avaa https://jehkis.github.io/osrs-apuri/ ja kirjaudu sähköpostilla ja salasanalla.
2. **Etusivu:** yläreunassa yhteenveto (KC yhteensä, tahti, valmistuminen, uniikit), viiden bossin
   osuuspalkki, kassa ja bossikortit. Kortin pienet kuvat ovat bossin uniikit: värillinen = saatu.
3. **Bossinäkymä:** klikkaa korttia tai osuuspalkin bossia. Palaa linkistä "← Kaikki bossit" tai
   selaimen Takaisin-napilla.
4. **Välilehdet:** *Uniikit* (klikkaa esinettä, niin näet dropraten ja dry-tilaston), *KC-käyrä* ja
   *Lootti* (Dinkin kirjaama lootti ja sen arvo).
5. **Päivitä nyt** hakee tuoreet tiedot Wise Old Manista.
6. **Dropin kirjaus ja juhlinta:** avaa uniikin tiedot ja paina **Sain** (tai **+1**), tarkista KC ja
   paina Tallenna. Ylös tulee juhlabanneri, bossin kortti hehkuu ja ilmoitus kertoo kirjauksesta.
   Omistaja voi poistaa väärän kirjauksen ×-napilla.
7. **Opettajan tunnuksella** otsikon vieressä lukee "Lukutila". Sain-napista voi kokeilla juhlintaa,
   mutta kirjaus on demo: sitä ei tallenneta, ja se katoaa seuraavassa päivityksessä (5 min tai
   "Päivitä nyt"). Juhlinta tulee automaattisesti myös oikeista uusista dropeista ja virstanpylväistä,
   kun sivu päivittyy.

### Kuvakaappaukset

TODO: kuvakaappaukset (etusivu, bossinäkymä ja KC-käyrä, puhelinnäkymä)

### Tunnetut ongelmat ja rajoitukset

- Sovellus on yhden pelaajan (zei_kill) oma seuranta, eikä siihen voi rekisteröityä.
- Wise Old Manin hiscoret päivittyvät vasta, kun pelistä kirjaudutaan ulos. Dink lähettää KC:n heti,
  mutta vain silloin, kun plugin on päällä.
- Lootti kertyy vasta Dinkin asennuksesta (18.11.2026) lähtien.
- KC-käyrä näyttää viimeiset 28 päivää.
- Juhlinnan "nähty"-tila on selaimen localStoragessa, joten se on laite- ja selainkohtainen.
- Supabasen ilmainen taso pysäyttää projektin noin viikon käyttämättömyyden jälkeen.

### Itsearviointi ja oppimispohdinta

TODO: kirjoitan omin sanoin

**Mikä onnistui?**

**Mikä oli haastavaa?**

**Mitä parantaisin?**

**Mitä opin?**

**Itsearvioitu arvosana: xx/10.**

### Lähteet ja tekoälyn käyttö

- [jQuery API -dokumentaatio](https://api.jquery.com/): `.on()`, `$.ajax()`, `.animate()`, `.queue()`
- [Bootstrap 5.3 -dokumentaatio](https://getbootstrap.com/docs/5.3/): Toasts, Modal, Navs & tabs, CSS-muuttujat, Color modes
- [Chart.js-dokumentaatio](https://www.chartjs.org/docs/latest/): Line chart, Linear axis, Tooltip
- [MDN: Window: hashchange event](https://developer.mozilla.org/en-US/docs/Web/API/Window/hashchange_event)
- [MDN: Window.localStorage](https://developer.mozilla.org/en-US/docs/Web/API/Window/localStorage)
- [Supabase-dokumentaatio](https://supabase.com/docs): Auth, Edge Functions
- [Wise Old Man API](https://docs.wiseoldman.net/): KC:t
- [Dink-plugin (RuneLite)](https://github.com/pajlads/DinkPlugin): KC ja lootti heti tapon jälkeen
- [OSRS Wiki](https://oldschool.runescape.wiki/): esineiden ja bossien kuvat, droprate-taulukot ja GE-hinnat
- **Tekoäly:** Claude Code (Anthropic)
  - **Minun päätökseni:** sovelluksen idea, bossit ja tavoitteet, tietolähteet (Wise Old Man ja
    Dink) ja Supabase taustapalveluksi, jotta sovellus on käytössä koko ajan. Projekti 3:ssa valitsin
    pohjaksi oman sovellukseni, kirjastoiksi Bootstrapin (jQueryn lisäksi), lisättävät ominaisuudet
    (bossinäkymä, KC-käyrä, juhlinta, opettajan tunnus) ja työtavan. Testasin uuden version omilla
    tunnuksillani ennen julkaisua ja päätin julkaisusta.
  - **Clauden osuus:** kirjoitti koodin ja kommentit, sekä sovelluksen alkuperäisen version että
    Projekti 3:n muutokset. Projekti 3 tehtiin seitsemässä osassa (yksi commit per osa), ja Claude
    selitti jokaisen osan ennen seuraavaa. Lisäksi Claude teki jQuery-oppimateriaalin esimerkeillä
    omasta koodistani, testasi muutokset selaimessa testidatalla ja kirjoitti tämän README:n rungon.
    Itsearvioinnin kirjoitan itse.

---

## Tekninen kuvaus

### Bossit

| Bossi | Lempinimi | WOM-mittari | Uniikit |
| --- | --- | --- | --- |
| Giant Mole | Myyrä | `giant_mole` | Baby mole, Long bone, Curved bone |
| Sarachnis | Sararis | `sarachnis` | Sarachnis cudgel, Jar of eyes, Sraracha |
| Moons of Peril | Moon | `lunar_chests` (avatut arkut) | Blood/Blue/Eclipse Moon -sarjat (12 osaa) |
| Mad Angel | Hullu enkeli | `mad_angel` | Hallowfell, Jar of Light, Aggy |
| Amoxliatl | Amox | `amoxliatl` | Pendant of Ates (inert), Glacial temotli, Moxi |

KC:t tulevat Wise Old Manista tunnin välein ja Dinkistä heti tapon jälkeen. Dink kirjaa myös lootin
ja uniikit automaattisesti; uniikin voi kirjata myös käsin ("Sain"). Sivu laskee uniikeista
dry-tilaston: KC:t edellisestä, kerrat droprateen nähden ja todennäköisyyden, jolla esine olisi jo
pitänyt tulla. Bossi- ja uniikkilista on tiedostossa `supabase/functions/_jaettu/projekti.ts`.

Tavoitteet: virstanpylväät 100, 250, 500, 1000, 1500, 2000, 2500 ja 3000 KC, tahti
(KC/vko 28 päivän ikkunasta) ja arvioitu valmistumispäivä. Projekti alkoi 18.11.2026.

Taustapalvelu on Supabasessa: Postgres, pg_cron-ajastus ja Edge Functionit.

### Rakenne

| Polku | Sisältö |
| --- | --- |
| `web/index.html` | Sivun rakenne, kirjastojen lataus, modaali, toast ja juhlabanneri |
| `web/app.js` | Käyttöliittymän logiikka (jQuery, Bootstrap, Chart.js) |
| `web/tyyli.css` | Ulkoasu ja Bootstrapin värit omasta paletista |
| `web/asetukset.js` | Supabasen julkinen osoite ja avain sekä omistajan tunnus |
| `supabase/migrations/` | Tietokanta: mittarilukemat, ajastus, droppitaulu, lootti |
| `supabase/functions/_jaettu/wom.ts` | WOM-datan muunto mittareiksi (puhdas funktio) |
| `supabase/functions/_jaettu/projekti.ts` | Bossit, uniikit, virstanpylväät, tahti, KC-käyrä ja dry-tilasto |
| `supabase/functions/_jaettu/oikeudet.ts` | Omistaja vs. lukija |
| `supabase/functions/_jaettu/palvelu.ts` | Tietokantaa käyttävä logiikka |
| `supabase/functions/hae-wom/` | Tunnin välein ajettava WOM-haku |
| `supabase/functions/dink/` | Dink-pluginin webhook (KC, lootti, uniikit) |
| `supabase/functions/api/` | Käyttöliittymän rajapinta (vaatii kirjautumisen) |
| `testit/` | Deno-testit; tietokantatestit ajetaan PGlitellä |

Testit: `deno task testit`

### Mittarit

Jokainen lukema on `(mittari, arvo, aika, lähde, varmuus)`. Uusi rivi kirjataan vain,
kun arvo tai varmuus muuttuu. WOM-haku kirjaa edelleen kaikki mittarit (`xp:*`, `kc:*`,
`akt:*`, `tili:*`), joten historia säilyy, vaikka sivu näyttää vain projektin bossit.
Hiscoren −1 tallennetaan arvolla 0 ja varmuudella `alle_rajan`.

### Käyttöönotto

```sh
npx supabase login
npx supabase link --project-ref <ref>
npx supabase db push
npx supabase secrets set CRON_AVAIN=<satunnainen> OSRS_RSN=zei_kill
npx supabase functions deploy hae-wom
npx supabase functions deploy dink
npx supabase functions deploy api
```

Ajastus lukee osoitteen ja avaimen Vaultista. Aja kerran SQL-editorissa:

```sql
select vault.create_secret('https://<ref>.supabase.co', 'projekti_url');
select vault.create_secret('<sama CRON_AVAIN>', 'cron_avain');
```

Rekisteröityminen on suljettu (`enable_signup = false`), joten tunnukset luodaan Supabasen
hallinnasta (Authentication → Users → Add user). Omistajan tunnus `zei@osrs-apuri.invalid` ei ole
oikea sähköposti, joten omistaja voi jättää kirjautumisen sähköpostikentän tyhjäksi. Kaikki muut
tunnukset ovat lukutilassa. Omistajan voi vaihtaa `OMISTAJA`-salaisuudella.

Sivun voi ajaa paikallisesti: `cd web && python3 -m http.server 8000`.
