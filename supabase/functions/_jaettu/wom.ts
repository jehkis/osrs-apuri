// Wise Old Manin pelaajadatan muunto mittarilukemiksi.
// Puhdas funktio ilman verkkoa tai tietokantaa, jotta sen voi testata erikseen.

export type Varmuus = "tarkka" | "alle_rajan" | "arvio";

export interface Lukema {
  mittari: string;
  arvo: number;
  varmuus: Varmuus;
}

interface WomSkilli { metric: string; experience: number; level: number }
interface WomBossi { metric: string; kills: number }
interface WomAktiviteetti { metric: string; score: number }

export interface WomPelaaja {
  username: string;
  ehp: number;
  ehb: number;
  ttm: number;
  combatLevel: number;
  updatedAt: string | null;
  latestSnapshot: {
    createdAt: string;
    data: {
      skills: Record<string, WomSkilli>;
      bosses: Record<string, WomBossi>;
      activities: Record<string, WomAktiviteetti>;
    };
  } | null;
}

// Hiscoret ilmoittavat näkymättömän arvon −1:nä. Se tallennetaan tietona
// "alle rajan" arvolla 0, ei nollana, jotta myöhempi kasvu ei näytä väärältä.
function lukema(mittari: string, arvo: number): Lukema {
  return arvo < 0
    ? { mittari, arvo: 0, varmuus: "alle_rajan" }
    : { mittari, arvo, varmuus: "tarkka" };
}

const pyorista = (x: number, desimaalit = 3) => Number(x.toFixed(desimaalit));

export function womMittareiksi(p: WomPelaaja): Lukema[] {
  const s = p.latestSnapshot?.data;
  if (!s) throw new Error(`WOM ei palauttanut tilannekuvaa pelaajalle ${p.username}`);

  const tulos: Lukema[] = [];
  for (const [nimi, sk] of Object.entries(s.skills)) {
    tulos.push(lukema(`xp:${nimi}`, sk.experience));
  }
  for (const [nimi, b] of Object.entries(s.bosses)) {
    tulos.push(lukema(`kc:${nimi}`, b.kills));
  }
  for (const [nimi, a] of Object.entries(s.activities)) {
    tulos.push(lukema(`akt:${nimi}`, a.score));
  }
  // WOM:n omat laskelmat ovat arvioita, eivät pelin lukuja.
  tulos.push({ mittari: "tili:ehp", arvo: pyorista(p.ehp), varmuus: "arvio" });
  tulos.push({ mittari: "tili:ehb", arvo: pyorista(p.ehb), varmuus: "arvio" });
  tulos.push({ mittari: "tili:ttm", arvo: pyorista(p.ttm), varmuus: "arvio" });
  tulos.push(lukema("tili:combat", p.combatLevel));
  return tulos;
}

// Lukemien aikaleima on WOM:n tilannekuvan hetki, ei hakuhetki.
export function womAika(p: WomPelaaja): string {
  return p.latestSnapshot?.createdAt ?? p.updatedAt ?? new Date().toISOString();
}
