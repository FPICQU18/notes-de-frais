import { useEffect, useState } from "react";

import { apiGet } from "./api/client";

type Etat = "chargement" | "ok" | "erreur";

const LIBELLES: Record<Etat, string> = {
  chargement: "vérification…",
  ok: "disponible",
  erreur: "injoignable",
};

export default function App() {
  const [etat, setEtat] = useState<Etat>("chargement");

  useEffect(() => {
    apiGet<{ status: string }>("/health")
      .then((data) => setEtat(data.status === "ok" ? "ok" : "erreur"))
      .catch(() => setEtat("erreur"));
  }, []);

  return (
    <main>
      <h1>Notes de frais</h1>
      <p>API : {LIBELLES[etat]}</p>
    </main>
  );
}
