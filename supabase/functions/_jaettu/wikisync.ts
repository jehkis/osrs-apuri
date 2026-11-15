// WikiSyncin pelaajadatan muunto mittarilukemiksi.
// WikiSync päivittyy vain, kun RuneLiten WikiSync-plugin on päällä pelatessa.

import type { Lukema } from "./wom.ts";

export interface WikiSyncPelaaja {
  username: string;
  timestamp: string;
  quests: Record<string, number>; // 0 = aloittamatta, 1 = kesken, 2 = valmis
  achievement_diaries: Record<string, Record<string, { complete: boolean }>>;
  combat_achievements: number[]; // tehtyjen taskien id:t
}

export function wikiSyncMittareiksi(d: WikiSyncPelaaja): Lukema[] {
  const tulos: Lukema[] = [];
  // CA-taskeista kirjataan vain tehdyt: puuttuva mittari tarkoittaa tekemätöntä.
  for (const id of d.combat_achievements) {
    tulos.push({ mittari: `ca:${id}`, arvo: 1, varmuus: "tarkka" });
  }
  tulos.push({ mittari: "tili:ca_tehty", arvo: d.combat_achievements.length, varmuus: "tarkka" });
  for (const [nimi, tila] of Object.entries(d.quests)) {
    if (nimi.trim().length < 2) continue; // WikiSyncin datassa on tyhjiä rivejä, esim. "."
    tulos.push({ mittari: `quest:${nimi}`, arvo: tila, varmuus: "tarkka" });
  }
  for (const [alue, tasot] of Object.entries(d.achievement_diaries)) {
    for (const [taso, tila] of Object.entries(tasot)) {
      tulos.push({ mittari: `diary:${alue}:${taso}`, arvo: tila.complete ? 1 : 0, varmuus: "tarkka" });
    }
  }
  return tulos;
}
