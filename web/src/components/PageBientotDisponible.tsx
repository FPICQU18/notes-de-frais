import { useEffect, useRef } from "react";

type Props = {
  titre: string;
};

export function PageBientotDisponible({ titre }: Props) {
  const refTitre = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    refTitre.current?.focus();
  }, []);

  return (
    <main className="ecran">
      <h1 className="titre" tabIndex={-1} ref={refTitre}>
        {titre}
      </h1>
      <p className="intro">Bientôt disponible.</p>
    </main>
  );
}
