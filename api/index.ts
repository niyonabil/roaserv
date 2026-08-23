// Wrapper API Vercel : charge dynamiquement l'entrée SSR d'Angular.
// L'import dynamique évite que le bundling CJS de Vercel tente un
// `require()` statique d'un fichier ESM (.mjs) — ce qui plantait au
// démarrage de la fonction (FUNCTION_INVOCATION_FAILED / HTTP 500).
export default async function handler(req: unknown, res: unknown) {
  // @ts-ignore — bundle généré par @angular/build, sans déclarations
  const mod = await import('../dist/server/server.mjs');
  return (mod.default as (r: unknown, s: unknown) => Promise<unknown>)(req, res);
}

export const config = { maxDuration: 30 };
