// Dink-pluginin (RuneLite) viestien tulkinta. Puhdas funktio, jotta sen voi testata.
// Muoto: https://github.com/pajlads/DinkPlugin/blob/master/docs/json-examples.md
//
// Loot-viestissä ovat kaikki tapon esineet GE-hintoineen, kun Dinkin
// "Min Loot Value" on 0. Petit tulevat erillisenä PET-viestinä.

import { BOSSIT, type ProjektiBossi } from "./projekti.ts";

export interface DinkViesti {
  type: string;
  playerName?: string;
  extra?: {
    items?: { id: number; quantity: number; priceEach: number; name: string }[];
    source?: string;
    category?: string;
    killCount?: number | null;
    petName?: string | null;
  };
}

export interface LoottiEsine {
  id: number;
  nimi: string;
  maara: number;
  hinta: number; // kappalehinta
}

export type Tulkinta =
  | { tyyppi: "lootti"; bossi: string; kc: number | null; esineet: LoottiEsine[]; arvo: number; uniikit: string[] }
  | { tyyppi: "pet"; bossi: string; esine: string }
  | { tyyppi: "ohita"; syy: string };

// RSN:ssä välilyönti, alaviiva ja väliviiva ovat hiscoreissa sama merkki.
export const normalisoiRsn = (s: string) => s.toLowerCase().replace(/[\s_-]+/g, " ").trim();
const pieni = (s: string) => s.toLowerCase().trim();

function bossiLahteesta(lahde: string): ProjektiBossi | undefined {
  return BOSSIT.find((b) => b.lahteet.some((l) => pieni(l) === pieni(lahde)));
}

// Pelin nimet eroavat wikistä isoissa kirjaimissa ("Blood moon helm"), joten
// uniikki palautetaan projektin kirjoitusasussa.
function uniikinNimi(b: ProjektiBossi, nimi: string): string | null {
  return b.uniikit.find((u) => pieni(u.nimi) === pieni(nimi))?.nimi ?? null;
}

export function tulkitse(v: DinkViesti, rsn: string): Tulkinta {
  if (!v.playerName || normalisoiRsn(v.playerName) !== normalisoiRsn(rsn)) {
    return { tyyppi: "ohita", syy: `pelaaja ${v.playerName ?? "puuttuu"}` };
  }
  if (v.type === "LOOT") {
    const lahde = v.extra?.source ?? "";
    const b = bossiLahteesta(lahde);
    if (!b) return { tyyppi: "ohita", syy: `ei projektin bossi: ${lahde}` };
    const esineet = (v.extra?.items ?? [])
      .filter((i) => i.quantity > 0)
      .map((i) => ({ id: i.id, nimi: i.name, maara: i.quantity, hinta: Math.max(0, Math.round(i.priceEach ?? 0)) }));
    const uniikit = esineet.flatMap((e) => {
      const n = uniikinNimi(b, e.nimi);
      return n ? Array(e.maara).fill(n) : [];
    });
    const kc = Number.isInteger(v.extra?.killCount) ? v.extra!.killCount! : null;
    return {
      tyyppi: "lootti",
      bossi: b.id,
      kc,
      esineet,
      arvo: esineet.reduce((s, e) => s + e.maara * e.hinta, 0),
      uniikit,
    };
  }
  if (v.type === "PET") {
    const nimi = v.extra?.petName;
    if (!nimi) return { tyyppi: "ohita", syy: "petin nimi puuttuu" };
    for (const b of BOSSIT) {
      const u = b.uniikit.find((u) => u.pet && pieni(u.nimi) === pieni(nimi));
      if (u) return { tyyppi: "pet", bossi: b.id, esine: u.nimi };
    }
    return { tyyppi: "ohita", syy: `ei projektin pet: ${nimi}` };
  }
  return { tyyppi: "ohita", syy: `tyyppi ${v.type}` };
}
