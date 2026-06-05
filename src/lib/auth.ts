export const AUTH_COOKIE = "ftp_auth";

export function getSitePassword(): string {
  return process.env.SITE_PASSWORD ?? "fucktaxpro2026";
}

export function isAuthenticated(cookieValue: string | undefined): boolean {
  return cookieValue === "1";
}
