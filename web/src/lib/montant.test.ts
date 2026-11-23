import { describe, expect, test } from "vitest";

import { formaterMontantSaisie, lireMontantCentimes } from "./montant";

describe("lireMontantCentimes", () => {
  test("« 24,50 » → 2450 centimes", () => {
    expect(lireMontantCentimes("24,50")).toEqual({ centimes: 2450, erreur: null });
  });

  test("« 24.50 » → 2450 centimes", () => {
    expect(lireMontantCentimes("24.50")).toEqual({ centimes: 2450, erreur: null });
  });

  test("« 24,5 » → 2450 centimes (décimale complétée à droite)", () => {
    expect(lireMontantCentimes("24,5")).toEqual({ centimes: 2450, erreur: null });
  });

  test("espaces (normaux et insécables) ignorés : « 1 234,50 » → 123450", () => {
    expect(lireMontantCentimes("1 234,50")).toEqual({ centimes: 123450, erreur: null });
    expect(lireMontantCentimes("1\u00A0234,50")).toEqual({ centimes: 123450, erreur: null });
    expect(lireMontantCentimes("1\u202F234,50")).toEqual({ centimes: 123450, erreur: null });
  });

  test("« 100 000 » et « 100000,00 » → 10000000 (accepté)", () => {
    expect(lireMontantCentimes("100 000")).toEqual({ centimes: 10000000, erreur: null });
    expect(lireMontantCentimes("100000,00")).toEqual({ centimes: 10000000, erreur: null });
  });

  test("« 100 000,01 » → tropGrand", () => {
    expect(lireMontantCentimes("100 000,01")).toEqual({ centimes: null, erreur: "tropGrand" });
  });

  test("vide ou uniquement des espaces → vide", () => {
    expect(lireMontantCentimes("")).toEqual({ centimes: null, erreur: "vide" });
    expect(lireMontantCentimes("   ")).toEqual({ centimes: null, erreur: "vide" });
  });

  test("zéro sous toutes ses formes → invalide", () => {
    expect(lireMontantCentimes("0")).toEqual({ centimes: null, erreur: "invalide" });
    expect(lireMontantCentimes("0,00")).toEqual({ centimes: null, erreur: "invalide" });
    expect(lireMontantCentimes("0.0")).toEqual({ centimes: null, erreur: "invalide" });
  });

  test("contenu non numérique → invalide", () => {
    for (const saisie of ["abc", "1e3", "5,", ",50", "5..0", "+5", "24.", ".50"]) {
      expect(lireMontantCentimes(saisie)).toEqual({ centimes: null, erreur: "invalide" });
    }
  });

  test("plus de deux décimales → decimales", () => {
    expect(lireMontantCentimes("12,345")).toEqual({ centimes: null, erreur: "decimales" });
  });
});

describe("formaterMontantSaisie", () => {
  test("2450 → « 24,50 »", () => {
    expect(formaterMontantSaisie(2450)).toBe("24,50");
  });

  test("50 → « 0,50 » (zéro initial conservé)", () => {
    expect(formaterMontantSaisie(50)).toBe("0,50");
  });

  test("10000000 → « 100000,00 »", () => {
    expect(formaterMontantSaisie(10000000)).toBe("100000,00");
  });
});
