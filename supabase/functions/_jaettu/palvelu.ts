// Tietokantaa käyttävä logiikka: tilanne, arvonnat, valinta ja tarkistus.
// Laskenta itse on puhtaissa moduuleissa (ehp, arvonta, eteneminen).

import type { SupabaseClient } from "npm:@supabase/supabase-js@2.45.4";
import { type Menetelma, tasoXp } from "./ehp.ts";
import {
  arvoKolmikko, jokeriHaaste, type KaistaId, type Skilli, skillinNimi, tilanne as skillinTilanne,
} from "./arvonta.ts";
import {
  arvoPalkinnot, avauskynnykset, ennuste, kesto, type Palkinto, PALKINNOT, pelipaiva, pelipaivanLoppu, taso, TASOVALI,
} from "./eteneminen.ts";
import { type WomPelaaja, womAika, womMittareiksi } from "./wom.ts";

const WOM = "https://api.wiseoldman.net/v2";
const OTSAKKEET = { "User-Agent": "osrs-apuri", "Content-Type": "application/json" };
const KAISTAT: KaistaId[] = ["skilli1", "skilli2"];

function tarkista<T>(r: { data: T; error: { message: string } | null }, mita: string): NonNullable<T> {
  if (r.error) throw new Error(`${mita}: ${r.error.message}`);
  if (r.data === null || r.data === undefined) throw new Error(`${mita}: ei dataa`);
  return r.data as NonNullable<T>;
}

// Kirjoitukset ja void-funktiot palauttavat datana null: tarkistetaan vain virhe.
function onnistui(r: { error: { message: string } | null }, mita: string): void {
  if (r.error) throw new Error(`${mita}: ${r.error.message}`);
}

// ---------------------------------------------------------------- WOM

async function haePelaaja(rsn: string): Promise<WomPelaaja> {
  const nimi = encodeURIComponent(rsn);
  // POST päivittää datan hiscoreista. WOM torjuu päivityksen, jos edellisestä on
  // alle minuutti, joten silloin luetaan viimeisin tallennettu tila GET:llä.
  const paivitys = await fetch(`${WOM}/players/${nimi}`, { method: "POST", headers: OTSAKKEET });
  if (paivitys.ok) return await paivitys.json();
  const luku = await fetch(`${WOM}/players/${nimi}`, { headers: OTSAKKEET });
  if (!luku.ok) throw new Error(`WOM vastasi ${paivitys.status} (päivitys) ja ${luku.status} (luku)`);
  return await luku.json();
}

async function paivitaTahdit(db: SupabaseClient): Promise<void> {
  const v = await fetch(`${WOM}/efficiency/rates?metric=ehp&type=main`, { headers: OTSAKKEET });
  if (!v.ok) throw new Error(`WOM-tahdit: ${v.status}`);
  const tahdit: { skill: string; methods: Menetelma[] }[] = await v.json();
  const rivit = tahdit.map((t) => ({ skilli: t.skill, menetelmat: t.methods, paivitetty: new Date().toISOString() }));
  onnistui(await db.from("ehp_tahti").upsert(rivit), "ehp_tahti");
}

// Hakee WOM-datan, päivittää tahdit kerran päivässä ja tarkistaa haasteet.
export async function paivitaWom(db: SupabaseClient, rsn: string) {
  try {
    const pelaaja = await haePelaaja(rsn);
    const kirjattu = tarkista(
      await db.rpc("kirjaa_lukemat", { p_lahde: "wom", p_aika: womAika(pelaaja), lukemat: womMittareiksi(pelaaja) }),
      "kirjaa_lukemat",
    );
    const vanhin = tarkista(await db.from("ehp_tahti").select("paivitetty").order("paivitetty").limit(1), "ehp_tahti");
    if (vanhin.length === 0 || Date.now() - Date.parse(vanhin[0].paivitetty) > 86_400_000) {
      await paivitaTahdit(db);
    }
    const valmistuneet = await tarkistaHaasteet(db);
    return { kirjattu, valmistuneet };
  } catch (e) {
    const viesti = e instanceof Error ? e.message : String(e);
    await db.rpc("kirjaa_virhe", { p_lahde: "wom", p_viesti: viesti });
    throw e;
  }
}

// ---------------------------------------------------------------- lukeminen

async function nykyarvot(db: SupabaseClient): Promise<Map<string, number>> {
  const rivit = tarkista(await db.from("mittari_nyt").select("mittari, arvo"), "mittari_nyt");
  return new Map(rivit.map((r: { mittari: string; arvo: string }) => [r.mittari, Number(r.arvo)]));
}

async function skillit(db: SupabaseClient, arvot: Map<string, number>): Promise<Skilli[]> {
  const tahdit = tarkista(await db.from("ehp_tahti").select("skilli, menetelmat"), "ehp_tahti");
  const menetelmat = new Map(tahdit.map((t: { skilli: string; menetelmat: Menetelma[] }) => [t.skilli, t.menetelmat]));
  const tulos: Skilli[] = [];
  for (const [mittari, xp] of arvot) {
    if (!mittari.startsWith("xp:") || mittari === "xp:overall") continue;
    const nimi = mittari.slice(3);
    tulos.push({ nimi, xp, menetelmat: menetelmat.get(nimi) ?? [] });
  }
  return tulos;
}

async function kertyneetPisteet(db: SupabaseClient): Promise<number> {
  const rivit = tarkista(await db.from("pistetapahtuma").select("pisteet"), "pistetapahtuma");
  return rivit.reduce((s: number, r: { pisteet: number }) => s + r.pisteet, 0);
}

// ---------------------------------------------------------------- arvonta ja tarkistus

export async function varmistaKolmikot(db: SupabaseClient): Promise<void> {
  const arvot = await nykyarvot(db);
  const kaikki = await skillit(db, arvot);
  if (!kaikki.some((s) => s.menetelmat.length > 0)) return; // tahteja ei vielä haettu

  const haasteet = tarkista(
    await db.from("haaste").select("kaista, kohde, tila").in("tila", ["aktiivinen", "tarjolla"]),
    "haaste",
  );
  const t = taso(await kertyneetPisteet(db));

  for (const kaista of KAISTAT) {
    if (haasteet.some((h: { kaista: string }) => h.kaista === kaista)) continue;

    const painot = tarkista(await db.from("arvontapaino").select("kohde, lisa").eq("kaista", kaista), "arvontapaino");
    const siemen = Math.floor(Math.random() * 2 ** 31);
    const ehdotukset = arvoKolmikko({
      kaista,
      skillit: kaikki,
      kesto: kesto(t),
      lisapainot: Object.fromEntries(painot.map((p: { kohde: string; lisa: string }) => [p.kohde, Number(p.lisa)])),
      // Sama skilli ei ole kahdella kaistalla yhtä aikaa.
      pois: haasteet.filter((h: { kaista: string }) => h.kaista !== kaista).map((h: { kohde: string }) => h.kohde),
      siemen,
    });
    if (ehdotukset.length === 0) continue;

    const arvonta = tarkista(
      await db.from("arvonta").insert({ kaista, siemen }).select("id").single(),
      "arvonta",
    );
    const rivit = ehdotukset.map((e) => ({
      kaista, arvonta: arvonta.id, kohde: e.kohde, ulottuvuus: e.ulottuvuus, mittari: e.mittari,
      alkuarvo: e.alkuarvo, tavoite: e.tavoite, tavoitetaso: e.tavoitetaso,
      tunnit: Number(e.tunnit.toFixed(4)), pisteet: e.pisteet, kuvaus: e.kuvaus,
    }));
    onnistui(await db.from("haaste").insert(rivit), "haaste");
    haasteet.push(...rivit.map((r) => ({ kaista, kohde: r.kohde, tila: "tarjolla" })));
  }
}

// ---------------------------------------------------------------- palkinnot

async function saldo(db: SupabaseClient): Promise<number> {
  return Number(tarkista(await db.rpc("saldo"), "saldo"));
}

// Luo palkintoarvonnan jokaiselle ylitetylle avauskynnykselle, jolla sitä ei vielä ole.
export async function varmistaPalkinnot(db: SupabaseClient): Promise<void> {
  const { saavutetut } = avauskynnykset(await kertyneetPisteet(db));
  if (saavutetut.length === 0) return;
  const olemassa = tarkista(await db.from("palkintoarvonta").select("kynnys"), "palkintoarvonta");
  const on = new Set(olemassa.map((r: { kynnys: number }) => r.kynnys));
  const uudet = saavutetut.filter((k) => !on.has(k)).map((kynnys) => {
    const siemen = Math.floor(Math.random() * 2 ** 31);
    return { kynnys, siemen, vaihtoehdot: arvoPalkinnot(siemen) };
  });
  if (uudet.length === 0) return;
  onnistui(
    await db.from("palkintoarvonta").upsert(uudet, { onConflict: "kynnys", ignoreDuplicates: true }),
    "palkintoarvonta",
  );
}

// WOM-haku on tunnin välein, joten illan viimeinen bossaus näkyy vasta seuraavassa
// haussa. Bossi-ilta päättyy siksi vasta tunnin kuluttua pelipäivän vaihtumisesta.
const BOSSI_ILLAN_JALKIAIKA = 65 * 60_000;

async function hyvitaBossiIllat(db: SupabaseClient): Promise<void> {
  const illat = tarkista(
    await db.from("palkinto").select("id, kaytto").eq("tyyppi", "bossi_ilta").not("kaytetty", "is", null),
    "palkinto",
  ).filter((p: { kaytto: { paattynyt?: boolean } }) => !p.kaytto?.paattynyt);

  for (const ilta of illat) {
    const raja = Date.parse(ilta.kaytto.loppu) + BOSSI_ILLAN_JALKIAIKA;
    const lukema = tarkista(
      await db.from("mittarilukema").select("arvo").eq("mittari", "tili:ehb")
        .lte("aika", new Date(raja).toISOString()).order("aika", { ascending: false }).limit(1),
      "mittarilukema",
    );
    if (lukema.length === 0) continue;
    tarkista(
      await db.rpc("hyvita_bossi_ilta", {
        p_palkinto: ilta.id, p_ehb: Number(lukema[0].arvo), p_paattynyt: Date.now() > raja,
      }),
      "hyvita_bossi_ilta",
    );
  }
}

export async function valitsePalkinto(db: SupabaseClient, arvonta: number, tyyppi: string): Promise<void> {
  onnistui(await db.rpc("valitse_palkinto", { p_arvonta: arvonta, p_tyyppi: tyyppi }), "valitse_palkinto");
}

async function aktiivisetPalkinnot(db: SupabaseClient) {
  const kaytetyt = tarkista(
    await db.from("palkinto").select("tyyppi, kaytto").in("tyyppi", ["vapaapaiva", "bossi_ilta"])
      .not("kaytetty", "is", null).order("kaytetty", { ascending: false }).limit(20),
    "palkinto",
  );
  const tanaan = pelipaiva(new Date());
  const vapaapaiva = kaytetyt.some((p: { tyyppi: string; kaytto: { paiva?: string } }) =>
    p.tyyppi === "vapaapaiva" && p.kaytto?.paiva === tanaan
  );
  const ilta = kaytetyt.find((p: { tyyppi: string; kaytto: { paattynyt?: boolean } }) =>
    p.tyyppi === "bossi_ilta" && !p.kaytto?.paattynyt
  );
  return {
    vapaapaiva,
    bossiIlta: ilta ? { loppu: ilta.kaytto.loppu, pisteet: ilta.kaytto.annettu ?? 0 } : null,
  };
}

export async function kaytaPalkinto(db: SupabaseClient, tyyppi: string): Promise<void> {
  const aktiiviset = await aktiivisetPalkinnot(db);
  let kaytto: Record<string, unknown>;
  if (tyyppi === "vapaapaiva") {
    if (aktiiviset.vapaapaiva) throw new Error("tänään on jo vapaapäivä");
    kaytto = { paiva: pelipaiva(new Date()) };
  } else if (tyyppi === "bossi_ilta") {
    if (aktiiviset.bossiIlta) throw new Error("bossi-ilta on jo käynnissä");
    const ehb = (await nykyarvot(db)).get("tili:ehb");
    if (ehb === undefined) throw new Error("EHB-lukemaa ei vielä ole");
    kaytto = { alku: new Date().toISOString(), loppu: pelipaivanLoppu(new Date()).toISOString(), ehb_alku: ehb, annettu: 0 };
  } else {
    throw new Error(`palkintoa ${tyyppi} ei käytetä tällä tavalla`);
  }
  tarkista(await db.rpc("kayta_palkinto", { p_tyyppi: tyyppi, p_kaytto: kaytto }), "kayta_palkinto");
}

export async function vaihda(db: SupabaseClient, kaista: string, ilmainen: boolean): Promise<void> {
  onnistui(await db.rpc("vaihda_kolmikko", { p_kaista: kaista, p_ilmainen: ilmainen }), "vaihda_kolmikko");
  await varmistaKolmikot(db);
}

export async function jokeri(db: SupabaseClient, kaista: string, skilli: string): Promise<void> {
  const arvot = await nykyarvot(db);
  const s = (await skillit(db, arvot)).find((x) => x.nimi === skilli);
  if (!s) throw new Error(`tuntematon skilli ${skilli}`);
  const e = jokeriHaaste(s, kesto(taso(await kertyneetPisteet(db))));
  if (!e) throw new Error(`skillille ${skillinNimi(skilli)} ei voi tehdä haastetta`);
  tarkista(await db.rpc("kayta_jokeri", { p_kaista: kaista, p_haaste: e }), "kayta_jokeri");
}

export async function tarkistaHaasteet(db: SupabaseClient): Promise<number> {
  const arvot = await nykyarvot(db);
  const aktiiviset = tarkista(
    await db.from("haaste").select("id, mittari, alkuarvo, tavoite").eq("tila", "aktiivinen"),
    "haaste",
  );
  let valmiita = 0;
  for (const h of aktiiviset) {
    const nyt = arvot.get(h.mittari);
    if (nyt !== undefined && nyt - Number(h.alkuarvo) >= Number(h.tavoite)) {
      if (tarkista(await db.rpc("merkitse_valmiiksi", { p_haaste: h.id }), "merkitse_valmiiksi")) valmiita++;
    }
  }
  await hyvitaBossiIllat(db);
  await varmistaPalkinnot(db);
  await varmistaKolmikot(db);
  return valmiita;
}

export async function valitse(db: SupabaseClient, haasteId: number): Promise<void> {
  const h = tarkista(await db.from("haaste").select("mittari").eq("id", haasteId).single(), "haaste");
  const nyt = (await nykyarvot(db)).get(h.mittari);
  if (nyt === undefined) throw new Error(`mittarille ${h.mittari} ei ole lukemaa`);
  onnistui(await db.rpc("valitse_haaste", { p_haaste: haasteId, p_nyt: nyt }), "valitse_haaste");
}

// ---------------------------------------------------------------- etusivun tilanne

interface HaasteRivi {
  kohde: string;
  ulottuvuus: string;
  alkuarvo: string | number;
  tavoite: string | number;
  tavoitetaso: number | null;
}

// Kortin otsikko ja tehtävä valmiina, ettei käyttöliittymän tarvitse jäsentää kuvausta.
function korttiin<T extends HaasteRivi>(h: T) {
  const otsikko = skillinNimi(h.kohde);
  const tehtava = h.tavoitetaso
    ? `${tasoXp(Number(h.alkuarvo))} → ${h.tavoitetaso}`
    : `+${Number(h.tavoite).toLocaleString("fi-FI").replace(/\u00a0/g, " ")} XP`;
  return { ...h, otsikko, tehtava };
}

export async function tilanne(db: SupabaseClient) {
  const arvot = await nykyarvot(db);
  const kaikki = await skillit(db, arvot);
  const kertyneet = await kertyneetPisteet(db);

  const historia = tarkista(
    await db.from("mittarilukema").select("aika, arvo").eq("mittari", "tili:ehp")
      .gte("aika", new Date(Date.now() - 36 * 86_400_000).toISOString()).order("aika"),
    "mittarilukema",
  ).map((r: { aika: string; arvo: string }) => ({ aika: r.aika, arvo: Number(r.arvo) }));
  const ttm = arvot.get("tili:ttm") ?? null;

  const lahteet = tarkista(await db.from("lahde").select("id, kuvaus, paivitetty, virhe").order("id"), "lahde");
  const kaistat = tarkista(await db.from("kaista").select("id, nimi").order("jarjestys"), "kaista");
  const haasteet = tarkista(
    await db.from("haaste")
      .select("id, kaista, kohde, ulottuvuus, mittari, alkuarvo, tavoite, tavoitetaso, tunnit, pisteet, kuvaus, tila")
      .in("tila", ["aktiivinen", "tarjolla"]).order("id"),
    "haaste",
  ).map(korttiin);
  const valmiit = tarkista(
    await db.from("haaste").select("id, kaista, kuvaus, pisteet, valmistui").eq("tila", "valmis")
      .order("valmistui", { ascending: false }).limit(10),
    "haaste",
  );

  const t = taso(kertyneet);
  const kynnykset = avauskynnykset(kertyneet);
  const odottavat = tarkista(
    await db.from("palkintoarvonta").select("id, kynnys, vaihtoehdot").is("valittu", null).order("kynnys"),
    "palkintoarvonta",
  );
  const kayttamattomat = tarkista(
    await db.from("palkinto").select("tyyppi").is("kaytetty", null),
    "palkinto",
  );
  const varasto = Object.fromEntries(PALKINNOT.map((p: Palkinto) => [p, 0])) as Record<Palkinto, number>;
  for (const p of kayttamattomat) varasto[p.tyyppi as Palkinto]++;

  return {
    tili: {
      ttm,
      ehp: arvot.get("tili:ehp") ?? null,
      combat: arvot.get("tili:combat") ?? null,
      totalXp: arvot.get("xp:overall") ?? null,
      ennuste: ttm === null ? null : ennuste(historia, ttm, new Date()),
    },
    pisteet: {
      kertyneet,
      saldo: await saldo(db),
      taso: t,
      seuraavaTaso: t < 5 ? t * TASOVALI : null,
      kesto: kesto(t),
      seuraavaPalkinto: kynnykset.seuraava,
      edellinenPalkinto: kynnykset.edellinen,
    },
    palkinnot: { odottavat, varasto, ...(await aktiivisetPalkinnot(db)) },
    skillit: kaikki
      .map((s) => ({
        nimi: s.nimi,
        otsikko: skillinNimi(s.nimi),
        xp: s.xp,
        taso: tasoXp(s.xp),
        tunnit99: skillinTilanne(s)?.tunnit99 ?? 0,
        bonus: s.menetelmat.length === 0, // nousee vain muun treenin sivutuotteena
      }))
      .sort((a, b) => b.tunnit99 - a.tunnit99 || a.xp - b.xp),
    kaistat: kaistat.map((k: { id: string; nimi: string }) => {
      const omat = haasteet.filter((h: { kaista: string }) => h.kaista === k.id);
      const aktiivinen = omat.find((h: { tila: string }) => h.tila === "aktiivinen");
      const nykyinen = aktiivinen ? arvot.get(aktiivinen.mittari) ?? Number(aktiivinen.alkuarvo) : null;
      return {
        ...k,
        aktiivinen: aktiivinen
          ? { ...aktiivinen, edistyminen: Math.max(0, (nykyinen! - Number(aktiivinen.alkuarvo))) }
          : null,
        tarjolla: omat.filter((h: { tila: string }) => h.tila === "tarjolla"),
      };
    }),
    valmiit,
    lahteet,
  };
}
