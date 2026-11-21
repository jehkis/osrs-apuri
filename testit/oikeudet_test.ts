import { assertEquals } from "jsr:@std/assert@1.0.8";
import { onOmistaja, sallittu } from "../supabase/functions/_jaettu/oikeudet.ts";

Deno.test("omistaja tunnistetaan sähköpostista kirjainkoosta riippumatta", () => {
  assertEquals(onOmistaja("zei@osrs-apuri.invalid"), true);
  assertEquals(onOmistaja("ZEI@osrs-apuri.invalid"), true);
  assertEquals(onOmistaja("opettaja@osrs-apuri.invalid"), false);
  assertEquals(onOmistaja(undefined), false);
  assertEquals(onOmistaja("a@b.fi", "a@b.fi"), true);
});

Deno.test("lukija saa vain lukea, omistaja kaiken", () => {
  assertEquals(sallittu("GET", "/tilanne", false), true);
  assertEquals(sallittu("POST", "/paivita", false), true);
  assertEquals(sallittu("POST", "/droppi", false), false);
  assertEquals(sallittu("DELETE", "/droppi/5", false), false);
  assertEquals(sallittu("GET", "/tuntematon", false), false);
  assertEquals(sallittu("POST", "/droppi", true), true);
  assertEquals(sallittu("DELETE", "/droppi/5", true), true);
});
