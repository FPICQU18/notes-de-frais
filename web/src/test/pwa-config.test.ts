import { describe, expect, test } from "vitest";

import config from "../../vite.config.ts?raw";

// Test de garde — AGENTS.md : « Le service worker ne met jamais en cache les
// réponses de l'API. » On inspecte la configuration Vite telle qu'écrite dans
// vite.config.ts (c'est elle qui est compilée dans dist/sw.js au build), plutôt
// que d'importer le module : vite-plugin-pwa n'expose pas ses options résolues.

// Les motifs de regex sont écrits avec des slashs échappés (ex. `/^\/api\//`) :
// on retire les antislashs pour comparer le motif sémantique, pas son écriture.
const sansEchappements = (texte: string): string => texte.replace(/\\/g, "");

describe("service worker : /api/ n'est jamais mis en cache", () => {
  test("navigateFallbackDenylist exclut les navigations vers /api/", () => {
    const denylist = config.match(/navigateFallbackDenylist\s*:\s*\[([^\]]*)\]/)?.[1];
    expect(denylist).toBeDefined();
    expect(sansEchappements(denylist!)).toContain("/api/");
  });

  test("aucune règle runtimeCaching ne capture /api/", () => {
    expect(sansEchappements(config)).not.toMatch(/runtimeCaching[\s\S]*?\/api\//);
  });
});
