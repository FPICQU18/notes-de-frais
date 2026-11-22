import { useEffect, useRef } from "react";

interface EcranErreurProps {
  message: string;
  onReessayer: () => void;
}

export function EcranErreur({ message, onReessayer }: EcranErreurProps) {
  const refTitre = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    refTitre.current?.focus();
  }, []);

  return (
    <main className="ecran ecran--centre">
      <p className="marque">Notes de frais</p>
      <h1 className="titre" tabIndex={-1} ref={refTitre}>
        Service indisponible
      </h1>
      <p className="alerte" role="alert" aria-live="polite">
        {message}
      </p>
      <div className="actions">
        <button type="button" className="bouton bouton--primaire" onClick={onReessayer}>
          Réessayer
        </button>
      </div>
    </main>
  );
}
