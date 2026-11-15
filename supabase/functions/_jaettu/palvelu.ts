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
import { bossitTaskeista, type WikiTaski } from "./bossit.ts";
import { arvoTauko, opettelupolku, osaamistaso, type TaukoBossi, type TaukoTaski, vaatimusTaytetty } from "./tauko.ts";
import { type WikiSyncPelaaja, wikiSyncMittareiksi } from "./wikisync.ts";

const WOM = "https://api.wiseoldman.net/v2";
const OTSAKKEET = { "User-Agent": "osrs-apuri", "Content-Type": "application/json" };
const KAISTAT: KaistaId[] = ["skilli1", "skilli2", "tauko"];
const WIKI = "https://oldschool.runescape.wiki/api.php";
const WIKISYNC = "https://sync.runescape.wiki/runelite/player";
const PAIVA = 86_400_000;

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

async function vanhentunut(db: SupabaseClient, taulu: string, ika: number): Promise<boolean> {
  const r = tarkista(await db.from(taulu).select("paivitetty").order("paivitetty").limit(1), taulu);
  return r.length === 0 || Date.now() - Date.parse(r[0].paivitetty) > ika;
}

// EHB-tahdit: montako killiä tunnissa tehokkaalla tahdilla.
async function paivitaEhbTahdit(db: SupabaseClient): Promise<void> {
  const v = await fetch(`${WOM}/efficiency/rates?metric=ehb&type=main`, { headers: OTSAKKEET });
  if (!v.ok) throw new Error(`WOM-EHB-tahdit: ${v.status}`);
  const tahdit: { boss: string; rate: number }[] = await v.json();
  const nyt = new Date().toISOString();
  onnistui(
    await db.from("ehb_tahti").upsert(tahdit.map((t) => ({ bossi: t.boss, tapot_tunnissa: t.rate, paivitetty: nyt }))),
    "ehb_tahti",
  );
}

// Bossit ja CA-taskit wikistä. Bossin tunniste on WOM:n KC-mittari, joten
// mukaan tulevat vain bossit, joiden KC on hiscoreissa.
async function paivitaBossit(db: SupabaseClient, arvot: Map<string, number>): Promise<void> {
  const kysely = "bucket('combat_achievement').select('id','name','monster','tier','type','task').limit(5000).run()";
  const v = await fetch(`${WIKI}?action=bucket&format=json&query=${encodeURIComponent(kysely)}`, { headers: OTSAKKEET });
  if (!v.ok) throw new Error(`wiki: ${v.status}`);
  const wiki: WikiTaski[] = (await v.json()).bucket ?? [];
  if (wiki.length < 100) throw new Error(`wiki palautti vain ${wiki.length} CA-taskia`);
  const womAvaimet = [...arvot.keys()].filter((m) => m.startsWith("kc:")).map((m) => m.slice(3));
  const { bossit, taskit } = bossitTaskeista(wiki, womAvaimet);
  const nyt = new Date().toISOString();
  onnistui(await db.from("bossi").upsert(bossit.map((b) => ({ ...b, paivitetty: nyt }))), "bossi");
  onnistui(await db.from("ca_taski").upsert(taskit), "ca_taski");
}

async function paivitaWikiSync(db: SupabaseClient, rsn: string): Promise<number> {
  try {
    const v = await fetch(`${WIKISYNC}/${encodeURIComponent(rsn)}/STANDARD`, { headers: OTSAKKEET });
    if (!v.ok) throw new Error(`WikiSync vastasi ${v.status}`);
    const d: WikiSyncPelaaja = await v.json();
    return Number(tarkista(
      await db.rpc("kirjaa_lukemat", { p_lahde: "wikisync", p_aika: d.timestamp, lukemat: wikiSyncMittareiksi(d) }),
      "kirjaa_lukemat",
    ));
  } catch (e) {
    await db.rpc("kirjaa_virhe", { p_lahde: "wikisync", p_viesti: e instanceof Error ? e.message : String(e) });
    return 0;
  }
}

// Hakee WOM- ja WikiSync-datan, päivittää tahdit ja bossit kerran päivässä ja tarkistaa haasteet.
// WOM on pakollinen; WikiSyncin tai wikin virhe kirjataan, mutta haku jatkuu.
export async function paivitaWom(db: SupabaseClient, rsn: string) {
  let kirjattu: number;
  try {
    const pelaaja = await haePelaaja(rsn);
    kirjattu = Number(tarkista(
      await db.rpc("kirjaa_lukemat", { p_lahde: "wom", p_aika: womAika(pelaaja), lukemat: womMittareiksi(pelaaja) }),
      "kirjaa_lukemat",
    ));
    if (await vanhentunut(db, "ehp_tahti", PAIVA)) await paivitaTahdit(db);
  } catch (e) {
    await db.rpc("kirjaa_virhe", { p_lahde: "wom", p_viesti: e instanceof Error ? e.message : String(e) });
    throw e;
  }
  kirjattu += await paivitaWikiSync(db, rsn);
  try {
    if (await vanhentunut(db, "ehb_tahti", PAIVA)) await paivitaEhbTahdit(db);
    if (await vanhentunut(db, "bossi", PAIVA)) await paivitaBossit(db, await nykyarvot(db));
  } catch (e) {
    console.error("bossidata:", e);
  }
  const valmistuneet = await tarkistaHaasteet(db);
  return { kirjattu, valmistuneet };
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

// Taukokaistan lähtötiedot: bossit KC:ineen ja vaatimuksineen sekä CA-taskit.
async function taukoData(db: SupabaseClient, arvot: Map<string, number>) {
  const rivit = tarkista(
    await db.from("bossi").select("id, nimi, porras, vaikeus, opeteltava, vaatimus"),
    "bossi",
  );
  const slayer = tasoXp(arvot.get("xp:slayer") ?? 0);
  const questit: Record<string, number> = {};
  for (const [m, v] of arvot) if (m.startsWith("quest:")) questit[m.slice(6)] = v;

  const bossit: TaukoBossi[] = rivit.map((b: Omit<TaukoBossi, "kc" | "vaatimusOk">) => ({
    ...b,
    kc: Math.max(0, arvot.get(`kc:${b.id}`) ?? 0),
    vaatimusOk: vaatimusTaytetty(b.vaatimus, slayer, questit),
  }));
  const taskit: TaukoTaski[] = rivit.length === 0 ? [] : tarkista(
    await db.from("ca_taski").select("id, nimi, bossi, tier, tyyppi, kuvaus"),
    "ca_taski",
  ).map((t: Omit<TaukoTaski, "tehty">) => ({ ...t, tehty: arvot.get(`ca:${t.id}`) === 1 }));
  return { bossit, taskit, slayer };
}

// Puuttuva Slayer-taso opettelupolun kärjessä painottaa Slayeria pääskilli 2 -kaistalla.
function slayerEste(bossit: TaukoBossi[], slayer: number): boolean {
  return opettelupolku(bossit).slice(0, 6).some((b) => !b.vaatimusOk && (b.vaatimus?.slayer ?? 0) > slayer);
}

function vaatimusTeksti(b: TaukoBossi): string | null {
  if (b.vaatimusOk || !b.vaatimus) return null;
  return b.vaatimus.slayer ? `Vaatii Slayer ${b.vaatimus.slayer}` : `Vaatii questin ${b.vaatimus.quest}`;
}

async function kertyneetPisteet(db: SupabaseClient): Promise<number> {
  const rivit = tarkista(await db.from("pistetapahtuma").select("pisteet"), "pistetapahtuma");
  return rivit.reduce((s: number, r: { pisteet: number }) => s + r.pisteet, 0);
}

// ---------------------------------------------------------------- arvonta ja tarkistus

async function ehbTahdit(db: SupabaseClient): Promise<Record<string, number>> {
  const r = tarkista(await db.from("ehb_tahti").select("bossi, tapot_tunnissa"), "ehb_tahti");
  return Object.fromEntries(r.map((x: { bossi: string; tapot_tunnissa: string }) => [x.bossi, Number(x.tapot_tunnissa)]));
}

export async function varmistaKolmikot(db: SupabaseClient): Promise<void> {
  const arvot = await nykyarvot(db);
  const kaikki = await skillit(db, arvot);
  if (!kaikki.some((s) => s.menetelmat.length > 0)) return; // tahteja ei vielä haettu

  const haasteet = tarkista(
    await db.from("haaste").select("kaista, kohde, tila").in("tila", ["aktiivinen", "tarjolla"]),
    "haaste",
  );
  const t = taso(await kertyneetPisteet(db));
  const tauko = await taukoData(db, arvot);

  for (const kaista of KAISTAT) {
    if (haasteet.some((h: { kaista: string }) => h.kaista === kaista)) continue;
    if (kaista === "tauko" && tauko.bossit.length === 0) continue; // bossidataa ei vielä haettu

    const painot = tarkista(await db.from("arvontapaino").select("kohde, lisa").eq("kaista", kaista), "arvontapaino");
    const lisapainot: Record<string, number> = Object.fromEntries(
      painot.map((p: { kohde: string; lisa: string }) => [p.kohde, Number(p.lisa)]),
    );
    if (kaista === "skilli2" && slayerEste(tauko.bossit, tauko.slayer)) {
      lisapainot.slayer = (lisapainot.slayer ?? 0) + 1.5;
    }
    const siemen = Math.floor(Math.random() * 2 ** 31);
    const ehdotukset = kaista === "tauko"
      ? arvoTauko({
        bossit: tauko.bossit,
        taskit: tauko.taskit,
        tapotTunnissa: await ehbTahdit(db),
        taso: t,
        kesto: kesto(t),
        lisapainot,
        siemen,
      })
      : arvoKolmikko({
        kaista,
        skillit: kaikki,
        kesto: kesto(t),
        lisapainot,
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
  // Tekemättömällä CA-taskilla tai tappamattomalla bossilla ei ole lukemaa: arvo on 0.
  const nyt = (await nykyarvot(db)).get(h.mittari) ?? (/^(ca|kc):/.test(h.mittari) ? 0 : undefined);
  if (nyt === undefined) throw new Error(`mittarille ${h.mittari} ei ole lukemaa`);
  onnistui(await db.rpc("valitse_haaste", { p_haaste: haasteId, p_nyt: nyt }), "valitse_haaste");
}

// ---------------------------------------------------------------- etusivun tilanne

interface HaasteRivi {
  kohde: string;
  mittari: string;
  kuvaus: string;
  ulottuvuus: string;
  alkuarvo: string | number;
  tavoite: string | number;
  tavoitetaso: number | null;
}

const wikiSivu = (nimi: string, alasivu = "") =>
  `https://oldschool.runescape.wiki/w/${encodeURIComponent(nimi.replace(/ /g, "_"))}${alasivu}`;

// Kortin otsikko, tehtävä ja yksikkö valmiina, ettei käyttöliittymän tarvitse jäsentää kuvausta.
function korttiin<T extends HaasteRivi>(h: T, bossinimet: Map<string, string>) {
  if (h.mittari.startsWith("xp:")) {
    const tehtava = h.tavoitetaso
      ? `${tasoXp(Number(h.alkuarvo))} → ${h.tavoitetaso}`
      : `+${Number(h.tavoite).toLocaleString("fi-FI").replace(/\u00a0/g, " ")} XP`;
    return { ...h, otsikko: skillinNimi(h.kohde), tehtava, yksikko: "XP", linkki: null };
  }
  const nimi = bossinimet.get(h.kohde) ?? h.kohde;
  return {
    ...h,
    otsikko: nimi,
    tehtava: h.kuvaus,
    yksikko: h.mittari.startsWith("ca:") ? "taski" : "killiä",
    linkki: h.ulottuvuus === "opettelu" ? wikiSivu(nimi, "/Strategies") : wikiSivu(nimi),
  };
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
  const tauko = await taukoData(db, arvot);
  const bossinimet = new Map(tauko.bossit.map((b) => [b.id, b.nimi]));
  const kaistat = tarkista(await db.from("kaista").select("id, nimi").order("jarjestys"), "kaista");
  const haasteet = tarkista(
    await db.from("haaste")
      .select("id, kaista, kohde, ulottuvuus, mittari, alkuarvo, tavoite, tavoitetaso, tunnit, pisteet, kuvaus, tila")
      .in("tila", ["aktiivinen", "tarjolla"]).order("id"),
    "haaste",
  ).map((h: HaasteRivi & { kaista: string; tila: string; [k: string]: unknown }) => korttiin(h, bossinimet));
  const valmiit = tarkista(
    await db.from("haaste").select("id, kaista, kohde, mittari, kuvaus, pisteet, valmistui").eq("tila", "valmis")
      .order("valmistui", { ascending: false }).limit(10),
    "haaste",
  ).map((v: { kohde: string; mittari: string; kuvaus: string }) => ({
    ...v,
    // Taukohaasteen kuvauksessa ei ole bossin nimeä.
    kuvaus: v.mittari.startsWith("xp:") ? v.kuvaus : `${bossinimet.get(v.kohde) ?? v.kohde}: ${v.kuvaus}`,
  }));

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
    opettelu: {
      osaamistaso: osaamistaso(tauko.bossit),
      polku: opettelupolku(tauko.bossit).slice(0, 10).map((b) => ({
        id: b.id, nimi: b.nimi, porras: b.porras, kc: b.kc, este: vaatimusTeksti(b), linkki: wikiSivu(b.nimi, "/Strategies"),
      })),
      caTehty: arvot.get("tili:ca_tehty") ?? null,
    },
    valmiit,
    lahteet,
  };
}
