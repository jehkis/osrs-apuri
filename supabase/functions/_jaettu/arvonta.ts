// Kolmen vaihtoehdon arvonta skillikaistoille. Puhdas ja siemenellä toistettava.

import { type Menetelma, tasoXp, tunnit, xpTasolle, xpTunneista, XP_99 } from "./ehp.ts";

export type KaistaId = "skilli1" | "skilli2";
export type Ulottuvuus = "tunnit" | "tasotavoite" | "heikoin";

export interface Skilli {
  nimi: string;
  xp: number;
  menetelmat: Menetelma[];
}

export interface Ehdotus {
  kohde: string;
  ulottuvuus: Ulottuvuus;
  mittari: string;
  alkuarvo: number;
  tavoite: number; // XP-lisäys
  tavoitetaso: number | null;
  tunnit: number;
  pisteet: number;
  kuvaus: string;
}

export interface ArvontaSyote {
  kaista: KaistaId;
  skillit: Skilli[];
  kesto: [number, number]; // minuutteina, tason mukaan
  lisapainot: Record<string, number>; // aiemmin ohitetut kohteet saavat lisää painoa
  pois: string[]; // esim. toisen kaistan aktiivinen skilli
  siemen: number;
}

export const PISTEET_TUNNILTA = 10;

// Farmingin EHP perustuu puujuoksuihin, jotka etenevät kalenteriajassa eivätkä
// sessioissa. Siitä tehdään oma muistutus, ei tuntihaastetta.
export const EI_ARVONTAAN = ["farming"];

// mulberry32: pieni, nopea ja toistettava.
export function satunnainen(siemen: number): () => number {
  let a = siemen >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function painotettu<T>(r: () => number, kohteet: T[], paino: (x: T) => number): T | undefined {
  const painot = kohteet.map(paino);
  const summa = painot.reduce((s, p) => s + p, 0);
  if (summa <= 0) return undefined;
  let x = r() * summa;
  for (let i = 0; i < kohteet.length; i++) {
    x -= painot[i];
    if (x < 0) return kohteet[i];
  }
  return kohteet[kohteet.length - 1];
}

const NIMET: Record<string, string> = {
  runecrafting: "Runecrafting", firemaking: "Firemaking", woodcutting: "Woodcutting",
};
export const skillinNimi = (s: string) => NIMET[s] ?? s.charAt(0).toUpperCase() + s.slice(1);

// XP-tavoite pyöristetään siistiksi luvuksi, ettei kortissa lue 23 417 XP.
function siisti(xp: number): number {
  const askel = xp >= 100_000 ? 5_000 : xp >= 20_000 ? 1_000 : 500;
  return Math.max(askel, Math.round(xp / askel) * askel);
}

const muotoile = (n: number) => n.toLocaleString("fi-FI").replace(/ /g, " ");
const minuutit = (h: number) => `${Math.round(h * 60)} min`;

function pisteet(h: number): number {
  return Math.max(1, Math.round(h * PISTEET_TUNNILTA));
}

interface Tilanne extends Skilli {
  taso: number;
  tunnit99: number;
}

export function tilanne(s: Skilli): Tilanne | null {
  if (s.xp >= XP_99) return null;
  const h = tunnit(s.menetelmat, s.xp, XP_99);
  if (h === null || h <= 0) return null;
  return { ...s, taso: tasoXp(s.xp), tunnit99: h };
}

function tunnitHaaste(s: Tilanne, kestoMin: number): Ehdotus | null {
  const loppu = xpTunneista(s.menetelmat, s.xp, kestoMin / 60);
  if (loppu === null) return null;
  const lisa = siisti(Math.min(loppu, XP_99) - s.xp);
  const h = tunnit(s.menetelmat, s.xp, s.xp + lisa);
  if (h === null) return null;
  return {
    kohde: s.nimi, ulottuvuus: "tunnit", mittari: `xp:${s.nimi}`,
    alkuarvo: s.xp, tavoite: lisa, tavoitetaso: null, tunnit: h, pisteet: pisteet(h),
    kuvaus: `${skillinNimi(s.nimi)}: +${muotoile(lisa)} XP (noin ${minuutit(h)})`,
  };
}

function tasoHaaste(s: Tilanne, kesto: [number, number], ulottuvuus: Ulottuvuus): Ehdotus | null {
  // Pienin tasonnousu, joka vie vähintään kestoalarajan verran.
  for (let taso = s.taso + 1; taso <= 99; taso++) {
    const h = tunnit(s.menetelmat, s.xp, xpTasolle(taso));
    if (h === null) return null;
    if (h * 60 < kesto[0] && taso < 99) continue;
    // Tasotavoite saa venyä korkeintaan puolitoistakertaiseksi ylärajasta.
    if (ulottuvuus === "tasotavoite" && h * 60 > kesto[1] * 1.5) return null;
    const otsikko = ulottuvuus === "heikoin" ? "Heikoin lenkki: " : "";
    return {
      kohde: s.nimi, ulottuvuus, mittari: `xp:${s.nimi}`,
      alkuarvo: s.xp, tavoite: xpTasolle(taso) - s.xp, tavoitetaso: taso, tunnit: h,
      pisteet: pisteet(h),
      kuvaus: `${otsikko}${skillinNimi(s.nimi)} ${s.taso} → ${taso} (noin ${minuutit(h)})`,
    };
  }
  return null;
}

export function arvoKolmikko(syote: ArvontaSyote): Ehdotus[] {
  const r = satunnainen(syote.siemen);
  const ehdokkaat = syote.skillit
    .map(tilanne)
    .filter((s): s is Tilanne => s !== null && !syote.pois.includes(s.nimi) && !EI_ARVONTAAN.includes(s.nimi));
  const lisa = (s: Tilanne) => 1 + (syote.lisapainot[s.nimi] ?? 0);

  const tulos: Ehdotus[] = [];
  const kaytetyt = new Set<string>();
  const ulottuvuuksia: Record<string, number> = {};

  // Pääskilli 2: ensimmäinen vaihtoehto on aina alimman skillin +1 taso.
  if (syote.kaista === "skilli2" && ehdokkaat.length > 0) {
    const alin = [...ehdokkaat].sort((a, b) => a.xp - b.xp)[0];
    const e = tasoHaaste(alin, syote.kesto, "heikoin");
    if (e) {
      tulos.push(e);
      kaytetyt.add(alin.nimi);
      ulottuvuuksia.heikoin = 1;
    }
  }

  const skillinPaino = syote.kaista === "skilli1"
    ? (s: Tilanne) => s.tunnit99 * lisa(s)
    : (s: Tilanne) => Math.pow(100 - s.taso, 2) * lisa(s);

  let yrityksia = 0;
  while (tulos.length < 3 && yrityksia++ < 50) {
    const vapaat = ehdokkaat.filter((s) => !kaytetyt.has(s.nimi));
    const s = painotettu(r, vapaat, skillinPaino);
    if (!s) break;
    kaytetyt.add(s.nimi);

    // Jo arvottu ulottuvuus saa pienemmän painon, mutta toisto on sallittu.
    const vaihtoehdot: [Ulottuvuus, number][] = [["tunnit", 3], ["tasotavoite", 1.5]];
    const u = painotettu(r, vaihtoehdot, ([nimi, p]) => p * Math.pow(0.4, ulottuvuuksia[nimi] ?? 0))![0];
    const kesto = syote.kesto[0] + Math.round((r() * (syote.kesto[1] - syote.kesto[0])) / 5) * 5;

    const e = (u === "tasotavoite" ? tasoHaaste(s, syote.kesto, u) : null) ?? tunnitHaaste(s, kesto);
    if (!e) continue;
    tulos.push(e);
    ulottuvuuksia[e.ulottuvuus] = (ulottuvuuksia[e.ulottuvuus] ?? 0) + 1;
  }
  return tulos;
}
