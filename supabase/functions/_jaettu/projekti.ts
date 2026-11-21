// Bossiprojekti: viisi bossia, jokaiselle 3000 KC. Puhdas laskenta ilman verkkoa
// tai tietokantaa, jotta sen voi testata erikseen.
//
// Uniikkien todennäköisyydet ovat wikistä (marraskuu 2026). Moons of Perilin KC on
// WOM:n lunar_chests eli avatut arkut, ei yksittäisten kuiden tappoja.

export const TAVOITE = 3000;
export const VIRSTANPYLVAAT = [100, 250, 500, 1000, 1500, 2000, 2500, 3000];
// Projektin aloituspäivä: tätä ennen tehdyt KC:t näytetään lähtötasona.
export const ALOITUS = "2026-11-18T00:00:00+02:00";
// Tahti lasketaan näin monen päivän ikkunasta, ja ennuste odottaa vähintään minimin.
export const TAHTI_IKKUNA_PV = 28;
export const TAHTI_MINIMI_PV = 3;

const PAIVA = 86_400_000;

export interface Uniikki {
  nimi: string;
  // Keskimäärin 1/harvinaisuus per tappo (Moonsilla per arkku, kun kaikki kolme kuuta on tapettu).
  harvinaisuus: number;
  pet?: boolean;
  ryhma?: string; // Moonsin haarniskasarja
  huomio?: string;
  kuva?: string; // wikin kuvatiedosto, jos eri kuin "<nimi>.png"
}

export interface ProjektiBossi {
  id: string; // WOM:n mittari
  nimi: string;
  lempinimi: string;
  wiki: string;
  lahteet: string[]; // Dinkin loot-viestin source (RuneLiten Loot Tracker -nimi)
  kuva: string; // wikin kuvatiedosto bossikortin otsikkoon
  dropSivu: string; // wikin sivu, jonka droppitaulukosta odotusarvo lasketaan
  uniikit: Uniikki[];
}

// Moonsin sarjan rulla on 1/56 per kuu. Osuman jälkeen tulee jokin sarjan
// puuttuvista osista, joten yksittäinen osa on keskimäärin noin 1/224.
const MOON_HUOMIO = "Sarja 1/56 per kuu, ei tuplia ennen kuin sarja on täysi";
const moonSarja = (sarja: string, ase: string): Uniikki[] =>
  [ase, `${sarja} helm`, `${sarja} chestplate`, `${sarja} tassets`].map((nimi) => ({
    nimi, harvinaisuus: 224, ryhma: sarja, huomio: MOON_HUOMIO,
  }));

export const BOSSIT: ProjektiBossi[] = [
  {
    id: "giant_mole",
    nimi: "Giant Mole",
    lempinimi: "Myyrä",
    wiki: "Giant_Mole",
    dropSivu: "Giant Mole",
    kuva: "Giant Mole.png",
    lahteet: ["Giant Mole"],
    uniikit: [
      { nimi: "Baby mole", harvinaisuus: 3000, pet: true, kuva: "Baby Mole.png" },
      { nimi: "Long bone", harvinaisuus: 400 },
      { nimi: "Curved bone", harvinaisuus: 5012.5 },
    ],
  },
  {
    id: "sarachnis",
    nimi: "Sarachnis",
    lempinimi: "Sararis",
    wiki: "Sarachnis",
    dropSivu: "Sarachnis",
    kuva: "Sarachnis.png",
    lahteet: ["Sarachnis"],
    uniikit: [
      { nimi: "Sarachnis cudgel", harvinaisuus: 384 },
      { nimi: "Jar of eyes", harvinaisuus: 2000, kuva: "Jar of Eyes.png" },
      { nimi: "Sraracha", harvinaisuus: 3000, pet: true },
    ],
  },
  {
    id: "lunar_chests",
    nimi: "Moons of Peril",
    lempinimi: "Moon",
    wiki: "Moons_of_Peril",
    dropSivu: "Lunar Chest",
    kuva: "Eclipse Moon.png",
    lahteet: ["Lunar Chest", "Lunar Chests"],
    uniikit: [
      ...moonSarja("Blood Moon", "Dual macuahuitl"),
      ...moonSarja("Blue Moon", "Blue Moon spear"),
      ...moonSarja("Eclipse Moon", "Eclipse atlatl"),
    ],
  },
  {
    id: "mad_angel",
    nimi: "Mad Angel",
    lempinimi: "Hullu enkeli",
    wiki: "Mad_Angel",
    dropSivu: "Mad Angel",
    kuva: "Mad Angel.webp",
    lahteet: ["Mad Angel"],
    uniikit: [
      { nimi: "Hallowfell", harvinaisuus: 127 },
      { nimi: "Jar of Light", harvinaisuus: 1000 },
      { nimi: "Aggy", harvinaisuus: 2000, pet: true },
    ],
  },
  {
    id: "amoxliatl",
    nimi: "Amoxliatl",
    lempinimi: "Amox",
    wiki: "Amoxliatl",
    dropSivu: "Amoxliatl",
    kuva: "Amoxliatl.png",
    lahteet: ["Amoxliatl"],
    uniikit: [
      { nimi: "Pendant of Ates (inert)", harvinaisuus: 25 },
      { nimi: "Glacial temotli", harvinaisuus: 100 },
      { nimi: "Moxi", harvinaisuus: 3000, pet: true },
    ],
  },
];

export function haeBossi(id: string): ProjektiBossi | undefined {
  return BOSSIT.find((b) => b.id === id);
}

export function onUniikki(bossi: string, esine: string): boolean {
  return haeBossi(bossi)?.uniikit.some((u) => u.nimi === esine) ?? false;
}

// ---------------------------------------------------------------- virstanpylväät

export function virstanpylvaat(kc: number) {
  const saavutetut = VIRSTANPYLVAAT.filter((v) => kc >= v);
  const seuraava = VIRSTANPYLVAAT.find((v) => kc < v) ?? null;
  return { saavutetut, seuraava, puuttuu: seuraava === null ? 0 : seuraava - kc };
}

// ---------------------------------------------------------------- tahti ja ennuste

export interface Lukema {
  arvo: number;
  aika: string;
  lahde?: string; // 'wom' tai 'events' (Dink)
}

// Mistä nykyinen KC tuli: ensimmäinen lukema, joka nosti KC:n nykyiseen arvoonsa.
export function kcLahde(historia: Lukema[], nyt: number): { lahde: string; aika: string } | null {
  const kc = kcHetkella(historia, nyt);
  if (kc === null) return null;
  const osumat = historia.filter((l) => l.arvo === kc && Date.parse(l.aika) <= nyt)
    .sort((a, b) => Date.parse(a.aika) - Date.parse(b.aika));
  return osumat.length ? { lahde: osumat[0].lahde ?? "wom", aika: osumat[0].aika } : null;
}

// KC annettuna hetkenä: suurin siihen mennessä kirjattu lukema. KC ei voi
// pienentyä, joten hiscoren vanhentunut lukema ei kumoa Dinkin tuoreempaa.
export function kcHetkella(historia: Lukema[], hetki: number): number | null {
  let tulos: number | null = null;
  for (const l of historia) {
    if (Date.parse(l.aika) <= hetki && (tulos === null || l.arvo > tulos)) tulos = l.arvo;
  }
  return tulos;
}

// KC-käyrä kaaviota varten: piste aina, kun KC nousi (enintään yksi piste tunnissa, jotta
// Dinkin tappokohtaiset lukemat eivät paisuta vastausta), ja lopuksi nykyhetki. Ikkunaa
// vanhemmat lukemat siirretään ikkunan alkuun, jotta käyrä alkaa siitä.
export function kcKayra(historia: Lukema[], nyt: number, ikkunaPv = TAHTI_IKKUNA_PV): { aika: string; kc: number }[] {
  const alku = nyt - ikkunaPv * PAIVA;
  const jarjestetty = historia
    .map((l) => ({ hetki: Math.max(Date.parse(l.aika), alku), arvo: l.arvo }))
    .filter((l) => l.hetki <= nyt)
    .sort((a, b) => a.hetki - b.hetki);
  const pisteet: { tunti: number; hetki: number; kc: number }[] = [];
  let suurin = -Infinity;
  for (const l of jarjestetty) {
    if (l.arvo <= suurin) continue; // KC ei voi laskea: vanhentunut hiscore-lukema ohitetaan
    suurin = l.arvo;
    const tunti = Math.floor(l.hetki / 3_600_000);
    const viimeinen = pisteet.at(-1);
    if (viimeinen && viimeinen.tunti === tunti) viimeinen.kc = suurin;
    else pisteet.push({ tunti, hetki: l.hetki, kc: suurin });
  }
  if (pisteet.length === 0) return [];
  pisteet.push({ tunti: 0, hetki: nyt, kc: suurin });
  return pisteet.map((p) => ({ aika: new Date(p.hetki).toISOString(), kc: p.kc }));
}

export interface Tahti {
  viikossa: number | null; // KC viikossa, null kun historiaa ei ole tarpeeksi
  pohjaPv: number; // montako päivää historiaa tahti kattaa
}

// Tahti ikkunan alusta nykyhetkeen. Jos historia on ikkunaa lyhyempi, aloitetaan
// vanhimmasta lukemasta.
export function tahti(historia: Lukema[], nyt: number, ikkunaPv = TAHTI_IKKUNA_PV): Tahti {
  if (historia.length === 0) return { viikossa: null, pohjaPv: 0 };
  const vanhin = Math.min(...historia.map((l) => Date.parse(l.aika)));
  const alku = Math.max(vanhin, nyt - ikkunaPv * PAIVA);
  const pohjaPv = (nyt - alku) / PAIVA;
  if (pohjaPv < TAHTI_MINIMI_PV) return { viikossa: null, pohjaPv };
  const kcAlku = kcHetkella(historia, alku) ?? 0;
  const kcNyt = kcHetkella(historia, nyt) ?? kcAlku;
  return { viikossa: ((kcNyt - kcAlku) / pohjaPv) * 7, pohjaPv };
}

// Valmistumispäivä nykyisellä tahdilla; null, jos tahtia ei ole tai se on nolla.
export function valmistuu(kc: number, viikossa: number | null, nyt: number, tavoite = TAVOITE): string | null {
  if (kc >= tavoite) return new Date(nyt).toISOString();
  if (!viikossa || viikossa <= 0) return null;
  return new Date(nyt + ((tavoite - kc) / viikossa) * 7 * PAIVA).toISOString();
}

// ---------------------------------------------------------------- uniikit

export interface Droppi {
  id: number;
  bossi: string;
  esine: string;
  kc: number;
  aika: string;
}

export interface UniikinTila {
  nimi: string;
  harvinaisuus: number;
  pet: boolean;
  ryhma: string | null;
  huomio: string | null;
  kuva: string;
  saadut: { id: number; kc: number; aika: string }[];
  // Kuivuus: KC:t viimeisimmän saman esineen jälkeen (tai alusta).
  kuivana: number;
  kertaa: number; // kuivana / harvinaisuus
  todennakoisyys: number; // todennäköisyys saada vähintään yksi näillä KC:illa
  odotettu: number; // odotettu määrä nykyisellä KC:lla
}

export function uniikinTila(u: Uniikki, kc: number, dropit: Droppi[]): UniikinTila {
  const saadut = dropit
    .filter((d) => d.esine === u.nimi)
    .sort((a, b) => a.kc - b.kc)
    .map(({ id, kc, aika }) => ({ id, kc, aika }));
  const viimeisin = saadut.at(-1)?.kc ?? 0;
  const kuivana = Math.max(0, kc - viimeisin);
  const p = 1 / u.harvinaisuus;
  return {
    nimi: u.nimi,
    harvinaisuus: u.harvinaisuus,
    pet: u.pet ?? false,
    ryhma: u.ryhma ?? null,
    huomio: u.huomio ?? null,
    kuva: u.kuva ?? `${u.nimi}.png`,
    saadut,
    kuivana,
    kertaa: kuivana / u.harvinaisuus,
    todennakoisyys: 1 - Math.pow(1 - p, kuivana),
    odotettu: kc * p,
  };
}

// ---------------------------------------------------------------- koonti

export interface BossinTila {
  id: string;
  nimi: string;
  lempinimi: string;
  wiki: string;
  kuva: string;
  kc: number;
  alkuKc: number; // KC projektin alkaessa
  kcLahde: { lahde: string; aika: string } | null;
  osuus: number; // kc / TAVOITE, enintään 1
  virstanpylvaat: ReturnType<typeof virstanpylvaat>;
  kayra: { aika: string; kc: number }[];
  tahti: Tahti;
  valmistuu: string | null;
  uniikit: UniikinTila[];
}

export function bossinTila(
  b: ProjektiBossi,
  historia: Lukema[],
  dropit: Droppi[],
  nyt: number,
): BossinTila {
  const kc = Math.max(0, kcHetkella(historia, nyt) ?? 0);
  const t = tahti(historia, nyt);
  const omat = dropit.filter((d) => d.bossi === b.id);
  return {
    id: b.id,
    nimi: b.nimi,
    lempinimi: b.lempinimi,
    wiki: b.wiki,
    kuva: b.kuva,
    kc,
    alkuKc: kcHetkella(historia, Date.parse(ALOITUS)) ?? Math.min(kc, ...historia.map((l) => l.arvo)),
    kcLahde: kcLahde(historia, nyt),
    osuus: Math.min(1, kc / TAVOITE),
    virstanpylvaat: virstanpylvaat(kc),
    kayra: kcKayra(historia, nyt),
    tahti: t,
    valmistuu: valmistuu(kc, t.viikossa, nyt),
    uniikit: b.uniikit.map((u) => uniikinTila(u, kc, omat)),
  };
}

// ---------------------------------------------------------------- lootti

export interface LoottiRivi {
  bossi: string;
  tappoja: number; // Dinkin kirjaamat tapot (Moonsilla arkut)
  arvo: number;
  alku: string;
}

export interface LoottiEsineYht {
  nimi: string;
  maara: number;
  arvo: number;
}

// GP/tappo kirjatuista tapoista ja sen perusteella arvio koko 3000 tapon tuotosta.
// Lootti kertyy vasta Dinkin asennuksesta, joten aiemmat KC:t eivät ole mukana.
export function loottiTila(rivi: LoottiRivi | null, esineet: LoottiEsineYht[], parhaat = 5) {
  if (!rivi || rivi.tappoja === 0) return null;
  const perTappo = rivi.arvo / rivi.tappoja;
  return {
    tappoja: rivi.tappoja,
    arvo: rivi.arvo,
    perTappo,
    arvio3000: perTappo * TAVOITE,
    alku: rivi.alku,
    parhaat: [...esineet].sort((a, b) => b.arvo - a.arvo).slice(0, parhaat)
      .map(({ nimi, maara, arvo }) => ({ nimi, maara, arvo })),
  };
}

// ---------------------------------------------------------------- kassa

export interface Odotus {
  bossi: string;
  gpTappo: number;
  erittely: { nimi: string; gp: number }[];
}

// Kassa: Dinkin kertynyt GP koko projektin odotettua tuottoa (5 × 3000 tappoa) vasten.
// Tuuri verrataan odotukseen samoilla tapoilla, jotka Dink on kirjannut.
export function kassa(bossit: { id: string; nimi: string; lootti?: ReturnType<typeof loottiTila> }[], odotukset: Odotus[]) {
  const rivit = bossit.map((b) => {
    const o = odotukset.find((x) => x.bossi === b.id) ?? null;
    const gp = b.lootti?.arvo ?? 0;
    const tappoja = b.lootti?.tappoja ?? 0;
    return {
      id: b.id,
      nimi: b.nimi,
      gp,
      tappoja,
      gpTappo: o?.gpTappo ?? null,
      tavoite: o ? o.gpTappo * TAVOITE : null,
      odotettu: o ? o.gpTappo * tappoja : null,
      erittely: o?.erittely ?? [],
    };
  });
  const tavoite = rivit.every((r) => r.tavoite !== null) ? rivit.reduce((s, r) => s + r.tavoite!, 0) : null;
  const gp = rivit.reduce((s, r) => s + r.gp, 0);
  const odotettu = rivit.reduce((s, r) => s + (r.odotettu ?? 0), 0);
  return {
    gp,
    tavoite,
    osuus: tavoite ? Math.min(1, gp / tavoite) : 0,
    odotettu,
    // Tuuri: kertynyt / odotettu samoilla tapoilla (1 = keskimäärin), null ilman tappoja.
    tuuri: odotettu > 0 ? gp / odotettu : null,
    bossit: rivit,
  };
}

export function yhteenveto(bossit: (BossinTila & { lootti?: ReturnType<typeof loottiTila> })[], nyt: number) {
  const kc = bossit.reduce((s, b) => s + Math.min(b.kc, TAVOITE), 0);
  const tavoite = bossit.length * TAVOITE;
  const tahdit = bossit.map((b) => b.tahti.viikossa);
  const viikossa = tahdit.every((t) => t !== null) ? tahdit.reduce((s, t) => s! + t!, 0)! : null;
  // Koko projekti valmistuu, kun hitain bossi on valmis.
  const paivat = bossit.map((b) => b.valmistuu);
  const valmis = paivat.every((p) => p !== null) ? paivat.reduce((a, b) => (a! > b! ? a : b)) : null;
  const uniikit = bossit.flatMap((b) => b.uniikit);
  return {
    kc,
    tavoite,
    osuus: kc / tavoite,
    projektissa: bossit.reduce((s, b) => s + Math.max(0, b.kc - b.alkuKc), 0),
    viikossa,
    valmistuu: valmis,
    // Lootti: kertynyt GP ja arvio viiden bossin 3000 tapon tuotosta niistä, joilta on dataa.
    gp: bossit.reduce((s, b) => s + (b.lootti?.arvo ?? 0), 0),
    gpArvio: bossit.reduce((s, b) => s + (b.lootti?.arvio3000 ?? 0), 0),
    gpBosseja: bossit.filter((b) => b.lootti).length,
    uniikkejaSaatu: uniikit.filter((u) => u.saadut.length > 0).length,
    uniikkejaYhteensa: uniikit.length,
    paivitetty: new Date(nyt).toISOString(),
  };
}
