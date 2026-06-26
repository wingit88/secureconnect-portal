/** Next.js 14 passes params synchronously; Next.js 15+ passes a Promise. */
export async function routeId(
  params: { id: string } | Promise<{ id: string }>,
): Promise<string | null> {
  const resolved = await Promise.resolve(params);
  const id = resolved?.id?.trim();
  if (!id || id === "undefined" || id === "null") return null;
  return id;
}
