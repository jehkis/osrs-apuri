// Tietokantaa käyttävä logiikka: WOM-haku, tilanne ja droppien kirjaus.
// Laskenta itse on puhtaissa moduuleissa (wom, projekti).

import type { SupabaseClient } from "npm:@supabase/supabase-js@2.45.4";
import { type WomPelaaja, womAika, womMittareiksi } from "./wom.ts";
import {
  BOSSIT, bossinTila, type Droppi, type Lukema, loottiTila, type LoottiRivi, onUniikki, TAHTI_IKKUNA_PV, yhteenveto,
} from "./projekti.ts";
import { type DinkViesti, tulkitse } from "./dink.ts";

const WOM = "https://api.wiseoldman.net/v2";
const OTSAKKEET = { "User-Agent": "osrs-apuri", "Content-Type": "application/json" };
const PAIVA = 86_400_000;

function tarkista<T>(r: { data: T; error: { message: string } | null }, mita: string): NonNullable<T> {
  if (r.error) throw new Error(`${mita}: ${r.error.message}`);
  if (r.data === null || r.data === undefined) throw new Error(`${mita}: ei dataa`);
  return r.data as NonNullable<T>;
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

// Kirjaa kaikki WOM:n mittarit (historia säilyy, vaikka projekti seuraa vain viittä).
export async function paivitaWom(db: SupabaseClient, rsn: string): Promise<{ kirjattu: number }> {
  try {
    const pelaaja = await haePelaaja(rsn);
    const kirjattu = Number(tarkista(
      await db.rpc("kirjaa_lukemat", { p_lahde: "wom", p_aika: womAika(pelaaja), lukemat: womMittareiksi(pelaaja) }),
      "kirjaa_lukemat",
    ));
    return { kirjattu };
  } catch (e) {
    await db.rpc("kirjaa_virhe", { p_lahde: "wom", p_viesti: e instanceof Error ? e.message : String(e) });
    throw e;
  }
}

// ---------------------------------------------------------------- lukeminen

// Projektin bossien KC-historia: tahti-ikkunan lukemat sekä viimeisin sitä edeltävä,
// jotta ikkunan alun KC tiedetään.
async function kcHistoria(db: SupabaseClient, nyt: number): Promise<Map<string, Lukema[]>> {
  const raja = new Date(nyt - TAHTI_IKKUNA_PV * PAIVA).toISOString();
  const tulos = new Map<string, Lukema[]>();
  await Promise.all(BOSSIT.map(async (b) => {
    const mittari = `kc:${b.id}`;
    const [ikkuna, ennen] = await Promise.all([
      db.from("mittarilukema").select("arvo, aika").eq("mittari", mittari).gte("aika", raja).order("aika"),
      db.from("mittarilukema").select("arvo, aika").eq("mittari", mittari).lt("aika", raja)
        .order("aika", { ascending: false }).limit(1),
    ]);
    const rivit = [...tarkista(ennen, mittari), ...tarkista(ikkuna, mittari)] as { arvo: string; aika: string }[];
    tulos.set(b.id, rivit.map((r) => ({ arvo: Number(r.arvo), aika: r.aika })));
  }));
  return tulos;
}

async function dropit(db: SupabaseClient): Promise<Droppi[]> {
  const rivit = tarkista(await db.from("droppi").select("id, bossi, esine, kc, aika").order("aika"), "droppi");
  return rivit.map((r: Droppi) => ({ ...r, id: Number(r.id), kc: Number(r.kc) }));
}

async function lootit(db: SupabaseClient) {
  const [bossit, esineet] = await Promise.all([
    db.from("lootti_bossi").select("bossi, tappoja, arvo, alku"),
    db.from("lootti_esine").select("bossi, nimi, maara, arvo"),
  ]);
  const yhteiset = (tarkista(bossit, "lootti_bossi") as LoottiRivi[])
    .map((r) => ({ ...r, tappoja: Number(r.tappoja), arvo: Number(r.arvo) }));
  const kaikki = (tarkista(esineet, "lootti_esine") as { bossi: string; nimi: string; maara: string; arvo: string }[])
    .map((r) => ({ ...r, maara: Number(r.maara), arvo: Number(r.arvo) }));
  return { yhteiset, kaikki };
}

export async function tilanne(db: SupabaseClient) {
  const nyt = Date.now();
  const [historia, kaikki, lahde, l] = await Promise.all([
    kcHistoria(db, nyt),
    dropit(db),
    db.from("lahde").select("paivitetty, virhe").eq("id", "wom").single(),
    lootit(db),
  ]);
  const bossit = BOSSIT.map((b) => ({
    ...bossinTila(b, historia.get(b.id) ?? [], kaikki, nyt),
    lootti: loottiTila(l.yhteiset.find((r) => r.bossi === b.id) ?? null, l.kaikki.filter((e) => e.bossi === b.id)),
  }));
  const nimet = new Map(BOSSIT.map((b) => [b.id, b.nimi]));
  return {
    yhteenveto: yhteenveto(bossit, nyt),
    bossit,
    viimeisimmat: kaikki.slice(-10).reverse().map((d) => ({ ...d, bossiNimi: nimet.get(d.bossi) ?? d.bossi })),
    wom: tarkista(lahde, "lahde"),
  };
}

// ---------------------------------------------------------------- dropit

// KC jätetään oletuksena nykyiseksi: drop kirjataan yleensä heti tapon jälkeen.
export async function kirjaaDroppi(db: SupabaseClient, bossi: string, esine: string, kc?: number): Promise<void> {
  if (!onUniikki(bossi, esine)) throw new Error(`${esine} ei ole bossin ${bossi} uniikki`);
  let arvo = kc;
  if (arvo === undefined) {
    const r = await db.from("mittari_nyt").select("arvo").eq("mittari", `kc:${bossi}`).maybeSingle();
    if (r.error) throw new Error(`mittari_nyt: ${r.error.message}`);
    arvo = Number(r.data?.arvo ?? 0);
  }
  if (!Number.isInteger(arvo) || arvo < 0) throw new Error("KC:n pitää olla kokonaisluku ≥ 0");
  const { error } = await db.from("droppi").insert({ bossi, esine, kc: arvo });
  if (error) throw new Error(`droppi: ${error.message}`);
}

export async function poistaDroppi(db: SupabaseClient, id: number): Promise<void> {
  const { error } = await db.from("droppi").delete().eq("id", id);
  if (error) throw new Error(`droppi: ${error.message}`);
}

// ---------------------------------------------------------------- Dink

async function nykyKc(db: SupabaseClient, bossi: string): Promise<number> {
  const r = await db.from("mittari_nyt").select("arvo").eq("mittari", `kc:${bossi}`).maybeSingle();
  if (r.error) throw new Error(`mittari_nyt: ${r.error.message}`);
  return Number(r.data?.arvo ?? 0);
}

// Uniikki kirjataan automaattisesti, ellei sama esine samalla KC:lla ole jo kirjattu
// (esim. käsin ennen Dinkiä tai Dinkin uudelleenlähetys).
async function kirjaaUniikki(db: SupabaseClient, bossi: string, esine: string, kc: number): Promise<boolean> {
  const r = await db.from("droppi").select("id").eq("bossi", bossi).eq("esine", esine).eq("kc", kc).limit(1);
  if (r.error) throw new Error(`droppi: ${r.error.message}`);
  if (r.data.length > 0) return false;
  await kirjaaDroppi(db, bossi, esine, kc);
  return true;
}

export async function kirjaaDink(db: SupabaseClient, viesti: DinkViesti, rsn: string) {
  const t = tulkitse(viesti, rsn);
  if (t.tyyppi === "ohita") return { kirjattu: false, syy: t.syy };
  if (t.tyyppi === "pet") {
    const kc = await nykyKc(db, t.bossi);
    return { kirjattu: await kirjaaUniikki(db, t.bossi, t.esine, kc), pet: t.esine, kc };
  }
  const { error } = await db.from("lootti").insert({ bossi: t.bossi, kc: t.kc, arvo: t.arvo, esineet: t.esineet });
  if (error) throw new Error(`lootti: ${error.message}`);
  const kc = t.kc ?? await nykyKc(db, t.bossi);
  for (const u of t.uniikit) await kirjaaUniikki(db, t.bossi, u, kc);
  return { kirjattu: true, bossi: t.bossi, arvo: t.arvo, uniikit: t.uniikit };
}
