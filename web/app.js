import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm";
import { SUPABASE_AVAIN, SUPABASE_URL, TUNNUS } from "./asetukset.js";

const supabase = createClient(SUPABASE_URL, SUPABASE_AVAIN);
const API = `${SUPABASE_URL}/functions/v1/api`;
const $ = (id) => document.getElementById(id);

// ---------------------------------------------------------------- apurit

const luku = (n, desimaalit = 0) =>
  n.toLocaleString("fi-FI", { minimumFractionDigits: desimaalit, maximumFractionDigits: desimaalit });

const tunnit = (h) => (h >= 10 ? `${luku(h)} h` : h >= 1 ? `${luku(h, 1)} h` : `${luku(h * 60)} min`);

function sitten(iso) {
  if (!iso) return "ei vielä";
  const min = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (min < 1) return "juuri nyt";
  if (min < 60) return `${min} min sitten`;
  const h = Math.round(min / 60);
  return h < 24 ? `${h} h sitten` : `${Math.round(h / 24)} pv sitten`;
}

function paiva(iso) {
  return new Date(iso).toLocaleDateString("fi-FI", { day: "numeric", month: "long", year: "numeric" });
}

function el(tag, attrs = {}, ...lapset) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") e.className = v;
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) e.setAttribute(k, v === true ? "" : v);
  }
  for (const l of lapset.flat()) if (l != null && l !== false) e.append(l);
  return e;
}

const palkki = (osuus, luokka = "") =>
  el("div", { class: `palkki ${luokka}` }, el("span", { style: `width:${Math.min(100, Math.max(0, osuus * 100))}%` }));

let ilmoitusAjastin;
function ilmoita(teksti) {
  const i = $("ilmoitus");
  i.textContent = teksti;
  i.hidden = false;
  clearTimeout(ilmoitusAjastin);
  ilmoitusAjastin = setTimeout(() => (i.hidden = true), 4000);
}

// ---------------------------------------------------------------- rajapinta

async function kutsu(polku, valinnat = {}) {
  const { data } = await supabase.auth.getSession();
  if (!data.session) throw new Error("kirjaudu sisään");
  const v = await fetch(`${API}${polku}`, {
    ...valinnat,
    headers: { Authorization: `Bearer ${data.session.access_token}`, "Content-Type": "application/json" },
  });
  const json = await v.json().catch(() => ({}));
  if (v.status === 401) {
    await supabase.auth.signOut();
    nayta(null);
    throw new Error("istunto vanheni, kirjaudu uudelleen");
  }
  if (!v.ok) throw new Error(json.virhe ?? `palvelin vastasi ${v.status}`);
  return json;
}

// ---------------------------------------------------------------- piirto

function piirraLuvut(t) {
  const e = t.tili.ennuste;
  const p = t.pisteet;
  const ennusteArvo = e?.maxPaiva
    ? el("div", { class: "arvo" }, new Date(e.maxPaiva).toLocaleDateString("fi-FI", { month: "short", year: "numeric" }))
    : el("div", { class: "arvo" }, "–");
  const ennusteLisa = e?.maxPaiva
    ? `${luku(e.tahtiViikossa, 1)} h viikossa, ${paiva(e.maxPaiva)}`
    : `Tahti lasketaan, kun historiaa on 3 päivää${e?.tahdinPohja != null ? ` (nyt ${luku(e.tahdinPohja, 1)} pv)` : ""}`;

  $("luvut").replaceChildren(
    el("div", { class: "kortti luku korostus" },
      el("div", { class: "nimi" }, "Maxiin"),
      el("div", { class: "arvo" }, t.tili.ttm != null ? luku(t.tili.ttm) : "–", el("small", {}, "h")),
      el("div", { class: "lisa" }, `${luku(t.tili.ehp ?? 0)} h tehty`)),
    el("div", { class: "kortti luku" },
      el("div", { class: "nimi" }, "Max-ennuste"), ennusteArvo, el("div", { class: "lisa" }, ennusteLisa)),
    el("div", { class: "kortti luku" },
      el("div", { class: "nimi" }, "Tällä viikolla"),
      el("div", { class: "arvo" }, e?.viikonTunnit != null ? luku(e.viikonTunnit, 1) : "–", el("small", {}, "h")),
      el("div", { class: "lisa" }, "Maanantaista klo 05")),
    el("div", { class: "kortti luku" },
      el("div", { class: "nimi" }, `Pisteet · taso ${p.taso}`),
      el("div", { class: "arvo" }, luku(p.kertyneet), el("small", {}, `saldo ${luku(p.saldo)}`)),
      palkki((p.kertyneet - p.edellinenPalkinto) / (p.seuraavaPalkinto - p.edellinenPalkinto), "ohut"),
      el("div", { class: "lisa" }, `${luku(p.seuraavaPalkinto - p.kertyneet)} p seuraavaan palkintoon` +
        (p.seuraavaTaso ? ` · ${luku(p.seuraavaTaso - p.kertyneet)} tasoon ${p.taso + 1}` : ""))),
  );
}

const PALKINTO = {
  jokeri: { nimi: "Jokeri", selite: "Valitse mikä tahansa skilli kaistalle arvonnan ohi." },
  vapaapaiva: { nimi: "Vapaapäivä", selite: "Päivä ilman haasteita: tee mitä huvittaa." },
  bossi_ilta: { nimi: "Bossi-ilta", selite: "Illan bossaus antaa pisteitä kuin skillaus, 10 p EHB-tunnilta." },
  vaihto: { nimi: "Ilmainen vaihto", selite: "Uusi kolmikko yhdelle kaistalle ilman pistekulua." },
};

let tila = null; // viimeisin tilanne, kaistan toimintoja varten

function kaistanToiminnot(k) {
  const p = tila.pisteet;
  const ilmaisia = tila.palkinnot.varasto.vaihto;
  const vaihto = el("button", {
    class: "toissijainen",
    disabled: ilmaisia === 0 && p.saldo < 100,
    title: ilmaisia === 0 && p.saldo < 100 ? `Saldo ${p.saldo} / 100` : null,
    onclick: (ev) => toiminto("/vaihda", { kaista: k.id, ilmainen: ilmaisia > 0 }, ev.currentTarget,
      ilmaisia > 0 ? "Uusi kolmikko arvottu (ilmainen vaihto)." : "Uusi kolmikko arvottu, −100 p."),
  }, ilmaisia > 0 ? `Vaihda kolmikko · ilmainen (${ilmaisia})` : "Vaihda kolmikko · 100 p");

  const osat = [vaihto, el("span", { class: "vali" })];
  const jokereita = tila.palkinnot.varasto.jokeri;
  if (jokereita > 0) {
    const muut = new Set(tila.kaistat.filter((x) => x.id !== k.id && x.aktiivinen).map((x) => x.aktiivinen.kohde));
    const valinta = el("select", { "aria-label": "Jokerin skilli" },
      tila.skillit.filter((s) => s.tunnit99 > 0 && s.nimi !== "farming" && !muut.has(s.nimi))
        .map((s) => el("option", { value: s.nimi }, `${s.otsikko} (${s.taso})`)));
    osat.push(valinta, el("button", {
      class: "toissijainen",
      onclick: (ev) => toiminto("/jokeri", { kaista: k.id, skilli: valinta.value }, ev.currentTarget, "Jokeri käytetty."),
    }, `Käytä jokeri (${jokereita})`));
  }
  return el("div", { class: "kaistan-toiminnot" }, osat);
}

function piirraKaista(k) {
  const otsikko = el("div", { class: "kaista-otsikko" }, el("h3", {}, k.nimi));

  if (k.aktiivinen) {
    const a = k.aktiivinen;
    const tehty = Math.min(a.edistyminen, Number(a.tavoite));
    const osuus = tehty / Number(a.tavoite);
    otsikko.append(el("span", { class: "merkinta kulta" }, `+${a.pisteet} p`));
    return el("article", { class: "kortti kaista" }, otsikko,
      el("div", { class: "aktiivinen" },
        el("div", { class: "kuvaus" }, `${a.otsikko} ${a.tehtava}`),
        palkki(osuus, osuus >= 1 ? "valmis" : ""),
        el("div", { class: "rivi" },
          el("span", {}, `${luku(tehty)} / ${luku(Number(a.tavoite))} XP`),
          el("span", {}, `${luku(osuus * 100)} % · arvio ${tunnit(Number(a.tunnit))}`))));
  }

  if (k.tarjolla.length === 0) {
    return el("article", { class: "kortti kaista" }, otsikko,
      el("div", { class: "tyhja" }, "Ei vaihtoehtoja vielä. Ne arvotaan, kun tilin data on haettu."));
  }

  otsikko.append(el("span", { class: "merkinta" }, "Valitse yksi"));
  return el("article", { class: "kortti kaista" }, otsikko,
    el("div", { class: "valinta" }, k.tarjolla.map((h) => {
      return el("div", { class: "vaihtoehto" },
        el("div", {},
          el("div", { class: "kohde" }, h.otsikko),
          el("div", { class: "tehtava" }, h.ulottuvuus === "heikoin" ? `Heikoin lenkki: ${h.tehtava}` : h.tehtava)),
        el("div", { class: "tiedot" },
          el("span", { class: "merkinta" }, tunnit(Number(h.tunnit))),
          el("span", { class: "merkinta kulta" }, `+${h.pisteet} p`)),
        el("button", { onclick: (ev) => valitse(h.id, ev.currentTarget) }, "Valitse"));
    })),
    kaistanToiminnot(k));
}

function piirraPalkinnot(t) {
  const pk = t.palkinnot;

  const ilmoitukset = [];
  if (pk.vapaapaiva) ilmoitukset.push([el("strong", {}, "Vapaapäivä tänään."), " Tee mitä huvittaa, haasteet odottavat huomiseen."]);
  if (pk.bossiIlta) {
    const loppu = new Date(pk.bossiIlta.loppu).toLocaleTimeString("fi-FI", { hour: "2-digit", minute: "2-digit" });
    ilmoitukset.push([el("strong", {}, "Bossi-ilta käynnissä"), ` klo ${loppu} asti · +${pk.bossiIlta.pisteet} p tähän mennessä.`]);
  }
  $("tila-ilmoitus").hidden = ilmoitukset.length === 0;
  $("tila-ilmoitus").replaceChildren(...ilmoitukset.flatMap((i, n) => (n ? [el("br"), ...i] : i)));

  const odottava = pk.odottavat[0];
  $("palkinto-osio").hidden = !odottava;
  if (odottava) {
    $("palkinto-otsikko").textContent = pk.odottavat.length > 1
      ? `Palkinto odottaa (${pk.odottavat.length} jonossa)` : `Palkinto odottaa · ${odottava.kynnys} p`;
    $("palkintovalinta").replaceChildren(...odottava.vaihtoehdot.map((tyyppi) =>
      el("div", { class: "palkinto" },
        el("div", {}, el("div", { class: "nimi" }, PALKINTO[tyyppi].nimi), el("div", { class: "selite" }, PALKINTO[tyyppi].selite)),
        el("button", {
          onclick: (ev) => toiminto("/palkinto", { arvonta: odottava.id, tyyppi }, ev.currentTarget, `${PALKINTO[tyyppi].nimi} talteen.`),
        }, "Valitse"))));
  }

  const rivit = Object.entries(pk.varasto).filter(([, n]) => n > 0).map(([tyyppi, n]) => {
    let toimi = null;
    if (tyyppi === "vapaapaiva") {
      toimi = el("button", { class: "toissijainen", disabled: pk.vapaapaiva,
        onclick: (ev) => toiminto("/kayta", { tyyppi }, ev.currentTarget, "Vapaapäivä alkoi.") }, "Käytä tänään");
    } else if (tyyppi === "bossi_ilta") {
      toimi = el("button", { class: "toissijainen", disabled: !!pk.bossiIlta,
        onclick: (ev) => toiminto("/kayta", { tyyppi }, ev.currentTarget, "Bossi-ilta alkoi. Onnea dropeille!") }, "Aloita nyt");
    } else {
      toimi = el("span", { class: "ohje" }, "Käytä kaistan kortissa");
    }
    return el("div", { class: "kortti varasto-rivi" },
      el("div", {}, el("div", {}, PALKINTO[tyyppi].nimi, " ", el("span", { class: "maara" }, `×${n}`))),
      toimi);
  });
  $("varasto-osio").hidden = rivit.length === 0;
  $("varasto").replaceChildren(...rivit);
}

function piirraSkillit(t) {
  const aktiiviset = new Set(t.kaistat.flatMap((k) => (k.aktiivinen ? [k.aktiivinen.kohde] : [])));
  const suurin = Math.max(...t.skillit.map((s) => s.tunnit99), 1);
  $("skillit").replaceChildren(...t.skillit.map((s) => {
    const maxattu = s.taso >= 99;
    const alempi = maxattu ? "99 ✓" : s.bonus ? "Nousee bonuksena" : `${tunnit(s.tunnit99)} 99:ään`;
    return el("div", { class: `kortti skilli${maxattu ? " maxattu" : ""}${aktiiviset.has(s.nimi) ? " aktiivinen-skilli" : ""}` },
      el("div", { class: "ylin" }, el("span", { class: "nimi" }, s.otsikko), el("span", { class: "taso" }, s.taso)),
      palkki(maxattu ? 1 : s.tunnit99 / suurin, `ohut${maxattu ? " valmis" : ""}`),
      el("div", { class: "tunnit" }, alempi));
  }));
}

function piirra(t) {
  tila = t;
  piirraLuvut(t);
  piirraPalkinnot(t);
  $("kaistat").replaceChildren(...t.kaistat.map(piirraKaista));
  piirraSkillit(t);

  $("valmiit-osio").hidden = t.valmiit.length === 0;
  $("valmiit").replaceChildren(...t.valmiit.map((v) =>
    el("li", { class: "kortti" },
      el("span", {}, v.kuvaus.replace(/ \(noin .*\)$/, "")),
      el("span", { class: "pisteet" }, `+${v.pisteet} p`))));

  $("lahteet").replaceChildren(...t.lahteet.filter((l) => l.paivitetty || l.virhe).map((l) =>
    el("span", {}, `${l.id.toUpperCase()}: päivitetty ${sitten(l.paivitetty)}`,
      l.virhe ? el("span", { class: "virhe" }, ` · virhe: ${l.virhe}`) : null)));
}

// ---------------------------------------------------------------- toiminnot

async function lataa() {
  try {
    piirra(await kutsu("/tilanne"));
  } catch (e) {
    ilmoita(`Lataus epäonnistui: ${e.message}`);
  }
}

async function valitse(id, nappi) {
  nappi.disabled = true;
  try {
    piirra(await kutsu("/valitse", { method: "POST", body: JSON.stringify({ id }) }));
    ilmoita("Haaste valittu. Onnea grindiin!");
  } catch (e) {
    nappi.disabled = false;
    ilmoita(`Valinta epäonnistui: ${e.message}`);
  }
}

async function toiminto(polku, runko, nappi, viesti) {
  nappi.disabled = true;
  try {
    piirra(await kutsu(polku, { method: "POST", body: JSON.stringify(runko) }));
    ilmoita(viesti);
  } catch (e) {
    nappi.disabled = false;
    ilmoita(`Ei onnistunut: ${e.message}`);
  }
}

$("paivita").addEventListener("click", async (ev) => {
  const nappi = ev.currentTarget;
  nappi.disabled = true;
  nappi.textContent = "Päivitetään…";
  try {
    const r = await kutsu("/paivita", { method: "POST" });
    piirra(r.tilanne);
    ilmoita(r.valmistuneet > 0
      ? `${r.valmistuneet} haaste${r.valmistuneet > 1 ? "tta" : ""} valmistui!`
      : r.kirjattu > 0 ? `${r.kirjattu} mittaria päivittyi.` : "Ei uutta dataa.");
  } catch (e) {
    ilmoita(`Päivitys epäonnistui: ${e.message}`);
  } finally {
    nappi.disabled = false;
    nappi.textContent = "Päivitä nyt";
  }
});

$("kirjaudu").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const nappi = ev.submitter;
  nappi.disabled = true;
  $("kirjautumisvirhe").textContent = "";
  const { data, error } = await supabase.auth.signInWithPassword({ email: TUNNUS, password: $("salasana").value });
  nappi.disabled = false;
  if (error) {
    $("kirjautumisvirhe").textContent = "Väärä salasana.";
    return;
  }
  $("salasana").value = "";
  nayta(data.session);
});

$("ulos").addEventListener("click", async () => {
  await supabase.auth.signOut();
  nayta(null);
});

let ajastin;
function nayta(istunto) {
  $("kirjautuminen").hidden = !!istunto;
  $("sovellus").hidden = !istunto;
  clearInterval(ajastin);
  if (istunto) {
    lataa();
    // Pidä sivu ajan tasalla pelatessa: haku viiden minuutin välein, kun välilehti on näkyvissä.
    ajastin = setInterval(() => document.visibilityState === "visible" && lataa(), 5 * 60_000);
  }
}

document.querySelector('input[name="username"]').value = TUNNUS;
const { data } = await supabase.auth.getSession();
nayta(data.session);
