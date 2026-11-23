import { useCallback, useEffect, useState } from "react";

import { ApiError, apiGet } from "../api/client";

/**
 * Charge une ressource de l'API au montage, avec états de chargement, d'erreur
 * et une fonction « Réessayer » qui relance l'appel sans recharger la page.
 * Un 401 est traité comme une session expirée et remonté via `onSessionExpiree`.
 */
export function useApiGet<T>(path: string, onSessionExpiree: () => void) {
  const [donnees, setDonnees] = useState<T | null>(null);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState<string | null>(null);
  const [erreurStatus, setErreurStatus] = useState<number | null>(null);
  const [tentative, setTentative] = useState(0);

  useEffect(() => {
    let actif = true;
    apiGet<T>(path)
      .then((resultat) => {
        if (!actif) return;
        setDonnees(resultat);
        setChargement(false);
      })
      .catch((attrape: unknown) => {
        if (!actif) return;
        if (attrape instanceof ApiError && attrape.status === 401) {
          onSessionExpiree();
          return;
        }
        setErreurStatus(attrape instanceof ApiError ? attrape.status : 0);
        setErreur(
          attrape instanceof ApiError ? attrape.message : "Une erreur est survenue.",
        );
        setChargement(false);
      });
    return () => {
      actif = false;
    };
  }, [path, tentative, onSessionExpiree]);

  const reessayer = useCallback(() => {
    setChargement(true);
    setErreur(null);
    setErreurStatus(null);
    setTentative((valeur) => valeur + 1);
  }, []);

  return { donnees, chargement, erreur, erreurStatus, reessayer };
}
