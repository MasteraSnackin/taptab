export const TAPTAB_LOCAL_SITE_ORIGIN = "http://localhost:3000";

export function resolveTapTabMetadataOrigin(value?: string): string {
  const configured = value?.trim();
  if (!configured) return TAPTAB_LOCAL_SITE_ORIGIN;

  try {
    const url = new URL(configured);
    if (url.protocol !== "https:" || url.username || url.password) {
      return TAPTAB_LOCAL_SITE_ORIGIN;
    }
    return url.origin;
  } catch {
    return TAPTAB_LOCAL_SITE_ORIGIN;
  }
}
