// Taukokaistan arvonta: endgame-opettelu ja tuttujen bossien haasteet.
// Puhdas ja siemenellä toistettava, kuten skillikaistojen arvonta.

import { type Ehdotus, painotettu, satunnainen, type Ulottuvuus } from "./arvonta.ts";
import { type BossiRivi, sallittuTier, type TaskiRivi, TIERIT } from "./bossit.ts";

export interface TaukoBossi extends BossiRivi {
  kc: number;
  vaatimusOk: boolean;
}

export interface TaukoTaski extends TaskiRivi {
  tehty: boolean;
}

export interface TaukoSyote {
  bossit: TaukoBossi[];
  taskit: TaukoTaski[];
  tapotTunnissa: Record<string, number>; // WOM:n EHB-tahdit
  taso: number;
  kesto: [number, number];
  lisapainot: Record<string, number>;
  siemen: number;
}

export const VARMUUS_KC = 10;
const CA_PISTEET = [5, 8, 12, 20, 30, 45];
// Tehokkaan tahdin sijaan arvioidaan realistisempi tahti oppimisvaiheessa olevalle.
const TAHDIN_OSUUS = 0.6;

const CA_ULOTTUVUUS: Record<string, Ulottuvuus> = {
  "Speed": "nopeus",
  "Restriction": "rajoitus",
  "Perfection": "putki",
  "Stamina": "putki",
  "Mechanical": "putki",
  "Kill Count": "maara",
};

function polunJarjestys(a: TaukoBossi, b: TaukoBossi): number {
  return a.porras - b.porras || a.vaikeus - b.vaikeus || a.nimi.localeCompare(b.nimi);
}

// Osaamistaso: korkein porras, jolla on opeteltava bossi vähintään 10 KC:lla.
export function osaamistaso(bossit: TaukoBossi[]): number {
  return Math.max(1, ...bossit.filter((b) => b.opeteltava && b.kc >= VARMUUS_KC).map((b) => b.porras));
}

// Opettelupolku: opeteltavat bossit, joilla on alle 10 KC, helpoimmasta vaikeimpaan.
// Polku alkaa portaan verran osaamistason alapuolelta, ettei se juutu helppoihin bosseihin.
export function opettelupolku(bossit: TaukoBossi[]): TaukoBossi[] {
  const alin = osaamistaso(bossit) - 1;
  return bossit.filter((b) => b.opeteltava && b.kc < VARMUUS_KC && b.porras >= alin).sort(polunJarjestys);
}

export function opetteluHaaste(b: TaukoBossi): Ehdotus {
  const ensimmainen = b.kc === 0;
  const tavoite = ensimmainen ? 1 : VARMUUS_KC - b.kc;
  return {
    kohde: b.id,
    ulottuvuus: "opettelu",
    mittari: `kc:${b.id}`,
    alkuarvo: b.kc,
    tavoite,
    tavoitetaso: null,
    tunnit: 0,
    // Opettelu antaa eniten pisteitä käytettyä aikaa kohden: uusi bossi houkuttaa enemmän kuin farmaus.
    pisteet: ensimmainen ? 30 : 10 + 3 * tavoite,
    kuvaus: ensimmainen ? "Ensimmäinen kill" : `Varmuus: ${b.kc} → ${VARMUUS_KC} KC`,
  };
}

function caHaaste(b: TaukoBossi, t: TaukoTaski): Ehdotus {
  return {
    kohde: b.id,
    ulottuvuus: CA_ULOTTUVUUS[t.tyyppi] ?? "putki",
    mittari: `ca:${t.id}`,
    alkuarvo: 0,
    tavoite: 1,
    tavoitetaso: null,
    tunnit: 0,
    pisteet: CA_PISTEET[t.tier],
    kuvaus: `${TIERIT[t.tier]} CA: ${t.nimi} – ${t.kuvaus}`,
  };
}

function maaraHaaste(b: TaukoBossi, tunnissa: number, kestoMin: number): Ehdotus {
  const tapot = Math.max(2, Math.round(tunnissa * TAHDIN_OSUUS * kestoMin / 60));
  const h = tapot / (tunnissa * TAHDIN_OSUUS);
  return {
    kohde: b.id,
    ulottuvuus: "maara",
    mittari: `kc:${b.id}`,
    alkuarvo: b.kc,
    tavoite: tapot,
    tavoitetaso: null,
    tunnit: h,
    // Tutun bossin farmaus antaa vähemmän kuin skillaus samassa ajassa.
    pisteet: Math.max(1, Math.round(h * 8)),
    kuvaus: `${tapot} killiä`,
  };
}

export function arvoTauko(s: TaukoSyote): Ehdotus[] {
  const r = satunnainen(s.siemen);
  const lisa = (id: string) => 1 + (s.lisapainot[id] ?? 0);
  const tulos: Ehdotus[] = [];
  const kaytetyt = new Set<string>();

  // 1. Opettelupolun kärjestä aina yksi vaihtoehto, kunnes polku on kuljettu.
  const karki = opettelupolku(s.bossit.filter((b) => b.vaatimusOk)).slice(0, 3);
  const uusi = painotettu(r, karki, (b) => lisa(b.id) / (karki.indexOf(b) + 1));
  if (uusi) {
    tulos.push(opetteluHaaste(uusi));
    kaytetyt.add(uusi.id);
  }

  // 2. Loput tutuista bosseista: CA-taskit tason rajoissa tai killimäärä.
  const ylin = sallittuTier(s.taso);
  const avoimet = new Map<string, TaukoTaski[]>();
  for (const t of s.taskit) {
    if (t.tehty || t.tier > ylin) continue;
    avoimet.set(t.bossi, [...(avoimet.get(t.bossi) ?? []), t]);
  }
  const tutut = s.bossit.filter((b) =>
    b.kc > 0 && b.vaatimusOk && (avoimet.has(b.id) || (b.kc >= VARMUUS_KC && s.tapotTunnissa[b.id] > 0))
  );

  const ulottuvuuksia: Record<string, number> = {};
  let yrityksia = 0;
  while (tulos.length < 3 && yrityksia++ < 50) {
    const b = painotettu(r, tutut.filter((x) => !kaytetyt.has(x.id)), (x) => lisa(x.id));
    if (!b) break;
    kaytetyt.add(b.id);

    const vaihtoehdot: { u: Ulottuvuus; paino: number; tee: () => Ehdotus }[] = [];
    if (b.kc >= VARMUUS_KC && s.tapotTunnissa[b.id] > 0) {
      const kesto = s.kesto[0] + Math.round((r() * (s.kesto[1] - s.kesto[0])) / 5) * 5;
      vaihtoehdot.push({ u: "maara", paino: 1.5, tee: () => maaraHaaste(b, s.tapotTunnissa[b.id], kesto) });
    }
    for (const t of avoimet.get(b.id) ?? []) {
      const u = CA_ULOTTUVUUS[t.tyyppi] ?? "putki";
      // Helpommat taskit ensin, mutta vaikeammatkin voivat tulla.
      vaihtoehdot.push({ u, paino: 1 / (t.tier + 1), tee: () => caHaaste(b, t) });
    }
    const valinta = painotettu(r, vaihtoehdot, (v) => v.paino * Math.pow(0.4, ulottuvuuksia[v.u] ?? 0));
    if (!valinta) continue;
    const e = valinta.tee();
    tulos.push(e);
    ulottuvuuksia[e.ulottuvuus] = (ulottuvuuksia[e.ulottuvuus] ?? 0) + 1;
  }
  return tulos;
}

export function vaatimusTaytetty(
  v: { slayer?: number; quest?: string } | null,
  slayerTaso: number,
  questit: Record<string, number>,
): boolean {
  if (!v) return true;
  if (v.slayer && slayerTaso < v.slayer) return false;
  if (v.quest && questit[v.quest] !== 2) return false;
  return true;
}
