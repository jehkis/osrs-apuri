// Bossit ja opettelupolku pelidatasta: CA-taskit wikistä, KC:t WOM:sta.
// Polun porras lasketaan bossin CA-taskien vaikeuden mediaanista, joten
// järjestystä ei tarvitse koota käsin.

export const TIERIT = ["Easy", "Medium", "Hard", "Elite", "Master", "Grandmaster"] as const;

// Wikin bucket('combat_achievement')-rivi.
export interface WikiTaski {
  id: number;
  name: string;
  monster: string;
  tier: string;
  type: string;
  task: string;
}

export interface BossiRivi {
  id: string; // WOM:n mittarin nimi, esim. "vorkath"
  nimi: string; // wikin nimi, esim. "Vorkath"
  porras: number; // 1–5
  vaikeus: number; // CA-tierien mediaani 0–5
  opeteltava: boolean;
  vaatimus: Vaatimus | null;
}

export interface TaskiRivi {
  id: number;
  nimi: string;
  bossi: string;
  tier: number; // 0 = Easy … 5 = Grandmaster
  tyyppi: string;
  kuvaus: string;
}

export interface Vaatimus {
  slayer?: number;
  quest?: string;
}

// Nimet, jotka eivät vastaa WOM:n mittaria suoraan.
const WIKI_WOM: Record<string, string> = {
  "Barrows": "barrows_chests",
  "Moons of Peril": "lunar_chests",
  "Fortis Colosseum": "sol_heredit",
  "Tombs of Amascut: Expert Mode": "tombs_of_amascut_expert",
  "Corrupted Hunllef": "the_corrupted_gauntlet",
  "Crystalline Hunllef": "the_gauntlet",
};

// Eivät kuulu endgame-opetteluun: skillaus- ja minipelibossit, F2P-avainbossit sekä
// wildyn bossit (PvP-riski). Niistä voi silti tulla CA- ja määrähaasteita, jos KC:ta on.
export const EI_OPETELTAVA = [
  "tempoross", "wintertodt", "zalcano", "hespori", "mimic",
  "bryophyta", "obor",
  "crazy_archaeologist", "chaos_fanatic", "chaos_elemental", "scorpia",
  "callisto", "venenatis", "vetion", "artio", "spindel", "calvarion",
];

// Vaatimukset, joiden puuttuessa bossia ei tarjota opeteltavaksi.
export const VAATIMUKSET: Record<string, Vaatimus> = {
  grotesque_guardians: { slayer: 75 },
  abyssal_sire: { slayer: 85 },
  kraken: { slayer: 87 },
  cerberus: { slayer: 91 },
  araxxor: { slayer: 92 },
  thermonuclear_smoke_devil: { slayer: 93 },
  alchemical_hydra: { slayer: 95 },
  vorkath: { quest: "Dragon Slayer II" },
  zulrah: { quest: "Regicide" },
  phantom_muspah: { quest: "Secrets of the North" },
  duke_sucellus: { quest: "Desert Treasure II - The Fallen Empire" },
  the_leviathan: { quest: "Desert Treasure II - The Fallen Empire" },
  the_whisperer: { quest: "Desert Treasure II - The Fallen Empire" },
  vardorvis: { quest: "Desert Treasure II - The Fallen Empire" },
};

const normalisoi = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

export function womAvain(monster: string, womAvaimet: string[]): string | null {
  if (WIKI_WOM[monster] && womAvaimet.includes(WIKI_WOM[monster])) return WIKI_WOM[monster];
  const n = new Map(womAvaimet.map((k) => [normalisoi(k), k]));
  return n.get(normalisoi(monster)) ?? n.get(normalisoi(`the ${monster}`)) ??
    n.get(normalisoi(monster.replace(/^The /, ""))) ?? null;
}

export function bossitTaskeista(wiki: WikiTaski[], womAvaimet: string[]): { bossit: BossiRivi[]; taskit: TaskiRivi[] } {
  const ryhmat = new Map<string, { nimi: string; tierit: number[] }>();
  const taskit: TaskiRivi[] = [];
  for (const t of wiki) {
    const tier = TIERIT.indexOf(t.tier as typeof TIERIT[number]);
    const id = womAvain(t.monster, womAvaimet);
    if (tier < 0 || !id) continue; // ei KC-mittaria: ei bossikaistalle
    taskit.push({ id: t.id, nimi: t.name, bossi: id, tier, tyyppi: t.type, kuvaus: t.task });
    const r = ryhmat.get(id) ?? { nimi: t.monster, tierit: [] };
    r.tierit.push(tier);
    ryhmat.set(id, r);
  }
  const bossit = [...ryhmat].map(([id, r]) => {
    const j = [...r.tierit].sort((a, b) => a - b);
    const vaikeus = j[Math.floor(j.length / 2)];
    return {
      id,
      nimi: r.nimi,
      porras: Math.max(1, Math.min(5, vaikeus)),
      vaikeus,
      opeteltava: !EI_OPETELTAVA.includes(id),
      vaatimus: VAATIMUKSET[id] ?? null,
    };
  });
  return { bossit, taskit };
}

// Tason sallima ylin CA-tier: taso 1 → Medium, 2 → Hard, … 5 → Grandmaster.
export function sallittuTier(taso: number): number {
  return Math.min(5, Math.max(1, taso));
}
