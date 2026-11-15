// Tasot, kestot ja max-ennuste. Puhtaita funktioita.

export const TASOVALI = 1500;
const KESTOT: [number, number][] = [[30, 45], [45, 60], [60, 75], [75, 90], [90, 90]];

export function taso(kertyneet: number): number {
  return Math.min(5, Math.floor(Math.max(0, kertyneet) / TASOVALI) + 1);
}

export function kesto(t: number): [number, number] {
  return KESTOT[Math.min(5, Math.max(1, t)) - 1];
}

export interface Lukema {
  aika: string;
  arvo: number;
}

// Pelipäivä vaihtuu klo 05 Suomen aikaa, ja viikko alkaa maanantaina.
export function viikonAlku(nyt: Date): Date {
  const osat = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Helsinki", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23", weekday: "short",
  }).formatToParts(nyt);
  const o = Object.fromEntries(osat.map((p) => [p.type, p.value]));
  const paikallinen = Date.UTC(+o.year, +o.month - 1, +o.day, +o.hour, +o.minute, +o.second);
  const erotus = paikallinen - nyt.getTime(); // Helsingin poikkeama UTC:stä
  const viikonpaiva = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(o.weekday);
  let alku = Date.UTC(+o.year, +o.month - 1, +o.day - viikonpaiva, 5, 0, 0);
  if (alku > paikallinen) alku -= 7 * 86_400_000; // maanantai ennen klo 05
  return new Date(alku - erotus);
}

// Arvo hetkellä t: viimeisin lukema, joka on tehty viimeistään t:llä.
function arvoHetkella(historia: Lukema[], t: number): number | null {
  let tulos: number | null = null;
  for (const l of historia) {
    if (Date.parse(l.aika) <= t) tulos = l.arvo;
  }
  return tulos;
}

export interface Ennuste {
  viikonTunnit: number | null;
  tahtiViikossa: number | null;
  maxPaiva: string | null;
  tahdinPohja: number | null; // montako päivää historiaa tahti perustuu
}

// historia = tili:ehp-lukemat aikajärjestyksessä.
export function ennuste(historia: Lukema[], ttm: number, nyt: Date): Ennuste {
  const h = [...historia].sort((a, b) => Date.parse(a.aika) - Date.parse(b.aika));
  if (h.length === 0) return { viikonTunnit: null, tahtiViikossa: null, maxPaiva: null, tahdinPohja: null };

  const viimeisin = h[h.length - 1].arvo;
  const alussa = arvoHetkella(h, viikonAlku(nyt).getTime()) ?? h[0].arvo;
  const viikonTunnit = viimeisin - alussa;

  // Tahti viimeiseltä 28 päivältä, tai lyhyemmältä, jos historiaa on vähemmän.
  const ikkuna = 28 * 86_400_000;
  const alkuAika = Math.max(Date.parse(h[0].aika), nyt.getTime() - ikkuna);
  const paivia = (nyt.getTime() - alkuAika) / 86_400_000;
  const alkuArvo = arvoHetkella(h, alkuAika) ?? h[0].arvo;
  // Alle kolmen päivän historiasta ei vielä lasketa tahtia.
  if (paivia < 3) return { viikonTunnit, tahtiViikossa: null, maxPaiva: null, tahdinPohja: paivia };

  const tahti = ((viimeisin - alkuArvo) / paivia) * 7;
  const maxPaiva = tahti > 0
    ? new Date(nyt.getTime() + (ttm / tahti) * 7 * 86_400_000).toISOString().slice(0, 10)
    : null;
  return { viikonTunnit, tahtiViikossa: tahti, maxPaiva, tahdinPohja: paivia };
}

// ---------------------------------------------------------------- palkinnot

// Avausväli kasvaa tason mukana: 50, 75, 100, 125, 150 pistettä.
export function avausvali(t: number): number {
  return 25 + 25 * Math.min(5, Math.max(1, t));
}

// Kaikki avauskynnykset, jotka kertyneet pisteet ovat ylittäneet, sekä seuraava.
// Väli määräytyy edellisen kynnyksen kohdan tasosta, joten laskuri jatkuu
// tasorajan yli eikä mitään nollata.
export function avauskynnykset(kertyneet: number): { saavutetut: number[]; seuraava: number; edellinen: number } {
  const saavutetut: number[] = [];
  let raja = 0;
  while (true) {
    const seuraava = raja + avausvali(taso(raja));
    if (seuraava > kertyneet) return { saavutetut, seuraava, edellinen: raja };
    saavutetut.push(seuraava);
    raja = seuraava;
  }
}

export const PALKINNOT = ["jokeri", "vapaapaiva", "bossi_ilta", "vaihto"] as const;
export type Palkinto = typeof PALKINNOT[number];

// Kolme eri palkintoa neljästä, siemenellä toistettavasti.
export function arvoPalkinnot(siemen: number): Palkinto[] {
  let a = siemen >>> 0;
  const r = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const pakka = [...PALKINNOT];
  for (let i = pakka.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [pakka[i], pakka[j]] = [pakka[j], pakka[i]];
  }
  return pakka.slice(0, 3);
}

// Pelipäivä vaihtuu klo 05 Suomen aikaa: ma klo 03 kuuluu vielä sunnuntaihin.
export function pelipaiva(nyt: Date): string {
  const viiveella = new Date(nyt.getTime() - 5 * 3_600_000);
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Helsinki" }).format(viiveella);
}

// Seuraavan pelipäivän alku (klo 05 Suomen aikaa) UTC-hetkenä.
export function pelipaivanLoppu(nyt: Date): Date {
  for (let h = 1; h <= 30; h++) {
    const t = new Date(Math.floor(nyt.getTime() / 3_600_000) * 3_600_000 + h * 3_600_000);
    if (pelipaiva(t) !== pelipaiva(nyt)) return t;
  }
  throw new Error("pelipäivän loppua ei löytynyt");
}
