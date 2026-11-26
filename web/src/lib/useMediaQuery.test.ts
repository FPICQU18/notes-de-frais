import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";

import { useBureau, useMediaQuery } from "./useMediaQuery";

type Ecouteur = (evenement: MediaQueryListEvent) => void;

/**
 * Mock de `window.matchMedia` piloté par la largeur : `definirLargeur(px)`
 * met à jour `matches` et notifie les écouteurs enregistrés, comme le
 * navigateur au redimensionnement.
 */
function mockMatchMedia(largeurInitiale: number) {
  let largeur = largeurInitiale;
  const ecouteurs = new Map<string, Set<Ecouteur>>();

  const mql = (requete: string): MediaQueryList => {
    const correspond = () =>
      requete === "(min-width: 1024px)" ? largeur >= 1024 : false;
    return {
      get matches() {
        return correspond();
      },
      media: requete,
      addEventListener: (_: string, ecouteur: Ecouteur) => {
        if (!ecouteurs.has(requete)) ecouteurs.set(requete, new Set());
        ecouteurs.get(requete)?.add(ecouteur);
      },
      removeEventListener: (_: string, ecouteur: Ecouteur) => {
        ecouteurs.get(requete)?.delete(ecouteur);
      },
    } as unknown as MediaQueryList;
  };

  vi.stubGlobal(
    "matchMedia",
    (requete: string) => mql(requete),
  );

  return {
    definirLargeur(px: number) {
      largeur = px;
      for (const [requete, liste] of ecouteurs) {
        const evenement = {
          matches: requete === "(min-width: 1024px)" ? px >= 1024 : false,
          media: requete,
        } as MediaQueryListEvent;
        for (const ecouteur of liste) ecouteur(evenement);
      }
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useMediaQuery / useBureau", () => {
  test("1023 px : false (mode mobile)", () => {
    mockMatchMedia(1023);
    const { result } = renderHook(() => useBureau());
    expect(result.current).toBe(false);
  });

  test("1024 px : true (mode bureau)", () => {
    mockMatchMedia(1024);
    const { result } = renderHook(() => useBureau());
    expect(result.current).toBe(true);
  });

  test("changement dynamique de largeur : 1024 → 900 → 1280", () => {
    const media = mockMatchMedia(1024);
    const { result } = renderHook(() => useBureau());
    expect(result.current).toBe(true);

    act(() => media.definirLargeur(900));
    expect(result.current).toBe(false);

    act(() => media.definirLargeur(1280));
    expect(result.current).toBe(true);
  });

  test("requête arbitraire passée au hook", () => {
    mockMatchMedia(500);
    const { result } = renderHook(() => useMediaQuery("(min-width: 1024px)"));
    expect(result.current).toBe(false);
  });
});
