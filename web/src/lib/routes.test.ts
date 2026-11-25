import { describe, expect, test } from "vitest";

import { estRouteFormulaireDepense } from "./routes";

describe("estRouteFormulaireDepense", () => {
  test("vrai pour la saisie et la modification d'une dépense", () => {
    expect(estRouteFormulaireDepense("/depenses/nouvelle")).toBe(true);
    expect(estRouteFormulaireDepense("/depenses/1")).toBe(true);
    expect(estRouteFormulaireDepense("/depenses/42")).toBe(true);
  });

  test("faux pour les autres écrans", () => {
    expect(estRouteFormulaireDepense("/")).toBe(false);
    expect(estRouteFormulaireDepense("/depenses")).toBe(false);
    expect(estRouteFormulaireDepense("/depenses/nouvelle/extra")).toBe(false);
    expect(estRouteFormulaireDepense("/depenses/abc")).toBe(false);
    expect(estRouteFormulaireDepense("/dossiers")).toBe(false);
    expect(estRouteFormulaireDepense("/dossiers/1")).toBe(false);
  });
});
