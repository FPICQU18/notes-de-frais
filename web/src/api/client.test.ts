import { afterEach, describe, expect, test, vi } from "vitest";

import {
  MESSAGE_GENERIQUE,
  MESSAGE_RESEAU,
  apiDelete,
  apiGet,
  apiPatch,
  apiPost,
  apiTelechargerCsv,
  nomFichierDepuisContentDisposition,
} from "./client";

afterEach(() => {
  vi.restoreAllMocks();
});

test("apiGet extrait le message d'un détail chaîne (401)", async () => {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(JSON.stringify({ detail: "E-mail ou mot de passe incorrect." }), {
      status: 401,
    }),
  );

  await expect(apiGet("/v1/auth/me")).rejects.toMatchObject({
    status: 401,
    message: "E-mail ou mot de passe incorrect.",
  });
});

test("apiPost extrait le premier msg d'un détail tableau (422)", async () => {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(
      JSON.stringify({
        detail: [{ msg: "Le mot de passe est requis." }, { msg: "Autre" }],
      }),
      { status: 422 },
    ),
  );

  await expect(apiPost("/v1/auth/login", {})).rejects.toMatchObject({
    status: 422,
    message: "Le mot de passe est requis.",
  });
});

test("erreur réseau : message dédié", async () => {
  vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("réseau"));

  await expect(apiGet("/v1/auth/me")).rejects.toMatchObject({
    status: 0,
    message: MESSAGE_RESEAU,
  });
});

test("corps d'erreur non JSON : message générique", async () => {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response("<html>Erreur serveur</html>", { status: 500 }),
  );

  await expect(apiGet("/v1/auth/me")).rejects.toMatchObject({
    status: 500,
    message: MESSAGE_GENERIQUE,
  });
});

test("apiPost 204 (logout) ne tente pas de lire le corps", async () => {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 204 }));

  await expect(apiPost("/v1/auth/logout")).resolves.toBeUndefined();
});

test("apiPost envoie du JSON avec Content-Type et credentials same-origin", async () => {
  const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(JSON.stringify({ id: 1 }), { status: 200 }),
  );

  await apiPost("/v1/auth/login", { email: "a@b.c", password: "x" });

  const [url, init] = fetchMock.mock.calls[0];
  expect(String(url)).toBe("/api/v1/auth/login");
  expect(init?.method).toBe("POST");
  expect(init?.credentials).toBe("same-origin");
  expect(init?.headers).toMatchObject({
    Accept: "application/json",
    "Content-Type": "application/json",
  });
  expect(JSON.parse(String(init?.body))).toEqual({ email: "a@b.c", password: "x" });
});

test("apiGet envoie credentials same-origin", async () => {
  const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(JSON.stringify({ id: 1 }), { status: 200 }),
  );

  await apiGet("/v1/auth/me");

  const [, init] = fetchMock.mock.calls[0];
  expect(init?.credentials).toBe("same-origin");
});

test("apiPatch envoie la méthode PATCH avec le corps JSON", async () => {
  const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(JSON.stringify({ id: 1 }), { status: 200 }),
  );

  await apiPatch("/v1/depenses/1", { libelle: "Nouveau" });

  const [url, init] = fetchMock.mock.calls[0];
  expect(String(url)).toBe("/api/v1/depenses/1");
  expect(init?.method).toBe("PATCH");
  expect(init?.headers).toMatchObject({ "Content-Type": "application/json" });
  expect(JSON.parse(String(init?.body))).toEqual({ libelle: "Nouveau" });
});

test("apiDelete envoie la méthode DELETE et traite un 204 sans lire le corps", async () => {
  const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(null, { status: 204 }),
  );

  await expect(apiDelete("/v1/depenses/1")).resolves.toBeUndefined();

  const [url, init] = fetchMock.mock.calls[0];
  expect(String(url)).toBe("/api/v1/depenses/1");
  expect(init?.method).toBe("DELETE");
  expect(init?.credentials).toBe("same-origin");
});

describe("apiTelechargerCsv", () => {
  test("appelle GET /api/v1/notes/{id}/export.csv avec credentials same-origin et renvoie blob + nom de l'en-tête", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("date;libellé\n", {
        status: 200,
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": 'attachment; filename="note-42.csv"',
        },
      }),
    );

    const resultat = await apiTelechargerCsv(42);

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("/api/v1/notes/42/export.csv");
    expect(init?.method).toBe("GET");
    expect(init?.credentials).toBe("same-origin");
    expect(resultat.nomFichier).toBe("note-42.csv");
    expect(resultat.blob).toBeInstanceOf(Blob);
    expect(await resultat.blob.text()).toBe("date;libellé\n");
  });

  test("repli note-<id>.csv quand l'en-tête Content-Disposition est absent", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("a;b\n", { status: 200, headers: { "Content-Type": "text/csv" } }),
    );

    const resultat = await apiTelechargerCsv(7);

    expect(resultat.nomFichier).toBe("note-7.csv");
  });

  test("repli note-<id>.csv quand l'en-tête Content-Disposition est illisible", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("a;b\n", {
        status: 200,
        headers: { "Content-Disposition": "attachment" },
      }),
    );

    const resultat = await apiTelechargerCsv(7);

    expect(resultat.nomFichier).toBe("note-7.csv");
  });

  test("erreur 404 : ApiError avec le message issu de detail", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ detail: "Note introuvable." }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await expect(apiTelechargerCsv(1)).rejects.toMatchObject({
      status: 404,
      message: "Note introuvable.",
    });
  });

  test("erreur 500 : message issu de detail", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ detail: "Erreur interne." }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await expect(apiTelechargerCsv(1)).rejects.toMatchObject({
      status: 500,
      message: "Erreur interne.",
    });
  });

  test("panne réseau : ApiError(0, MESSAGE_RESEAU)", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("réseau"));

    await expect(apiTelechargerCsv(1)).rejects.toMatchObject({
      status: 0,
      message: MESSAGE_RESEAU,
    });
  });
});

describe("nomFichierDepuisContentDisposition", () => {
  test("en-tête classique avec guillemets", () => {
    expect(
      nomFichierDepuisContentDisposition('attachment; filename="note-3.csv"'),
    ).toBe("note-3.csv");
  });

  test("en-tête sans guillemets", () => {
    expect(nomFichierDepuisContentDisposition("attachment; filename=note-3.csv")).toBe(
      "note-3.csv",
    );
  });

  test("filename* UTF-8 prioritaire et décodé", () => {
    expect(
      nomFichierDepuisContentDisposition(
        "attachment; filename*=UTF-8''note%20special.csv",
      ),
    ).toBe("note special.csv");
  });

  test("null quand l'en-tête est absent", () => {
    expect(nomFichierDepuisContentDisposition(null)).toBeNull();
  });

  test("null quand aucun filename n'est présent", () => {
    expect(nomFichierDepuisContentDisposition("attachment")).toBeNull();
  });

  test("null quand le nom est vide", () => {
    expect(nomFichierDepuisContentDisposition('attachment; filename=""')).toBeNull();
  });

  test("null quand filename* est mal percent-encodé", () => {
    expect(
      nomFichierDepuisContentDisposition("attachment; filename*=UTF-8''%E0%A4%A"),
    ).toBeNull();
  });
});
