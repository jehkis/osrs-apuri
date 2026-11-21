// Käyttöoikeudet: omistaja saa kaiken, muut kirjautuneet (esim. opettajan tunnus) vain lukea.
// Oletuksena kielletty: vain tunnetut lukureitit sallitaan lukijalle.

// Omistajan tunnus. Sama kuin web/asetukset.js:n TUNNUS; voi ohittaa OMISTAJA-salaisuudella.
export const OMISTAJA = "zei@osrs-apuri.invalid";

// Reitit, jotka lukija saa kutsua. "Päivitä nyt" vain hakee WOM-datan, eikä muuta kirjauksia.
const LUKUREITIT = new Set(["GET /tilanne", "POST /paivita"]);

export function onOmistaja(email: string | undefined, omistaja = OMISTAJA): boolean {
  return !!email && email.toLowerCase() === omistaja.toLowerCase();
}

export function sallittu(metodi: string, reitti: string, omistaja: boolean): boolean {
  if (omistaja) return true;
  return LUKUREITIT.has(`${metodi} ${reitti}`);
}
