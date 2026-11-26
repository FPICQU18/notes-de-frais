import { useSyncExternalStore } from "react";

/** `window.matchMedia` existe-t-il dans cet environnement (navigateur, ou jsdom mocké) ? */
function matchMediaDisponible(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function";
}

/**
 * Requête média (`matchMedia`) : vrai quand elle correspond, avec écoute de
 * l'événement `change` pour basculer dynamiquement au redimensionnement.
 *
 * Implémenté avec `useSyncExternalStore` : pas de `setState` dans un effet.
 * Quand `window.matchMedia` n'existe pas (jsdom sans mock), le hook renvoie
 * `false` (mode mobile).
 *
 * Testable en mockant `window.matchMedia`.
 */
export function useMediaQuery(requete: string): boolean {
  return useSyncExternalStore(
    (auChangement: () => void) => {
      if (!matchMediaDisponible()) return () => {};
      const mql = window.matchMedia(requete);
      mql.addEventListener("change", auChangement);
      return () => {
        mql.removeEventListener("change", auChangement);
      };
    },
    () => (matchMediaDisponible() ? window.matchMedia(requete).matches : false),
    () => false,
  );
}

/** Vrai quand la fenêtre fait au moins 1024 px de large (mise en page bureau, US-042). */
export function useBureau(): boolean {
  return useMediaQuery("(min-width: 1024px)");
}
