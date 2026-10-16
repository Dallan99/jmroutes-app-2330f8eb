import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

export function mobileOrigin(value: string): string {
  const url = new URL(value);
  if (url.username || url.password || url.pathname !== "/" || url.search || url.hash
    || (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname)))) {
    throw new Error("MOBILE_PUBLIC_ORIGIN exige origem HTTPS, sem caminho ou credenciais.");
  }
  return url.origin;
}
export class MobileAccess {
  private salt = randomBytes(32);
  private digest: Buffer;
  private token = "";
  private csrf = "";
  private expiresAt = 0;
  private attempts: number[] = [];
  constructor(secret: string) {
    if (secret.length < 32) throw new Error("MOBILE_ACCESS_KEY exige pelo menos 32 caracteres aleatórios.");
    this.digest = scryptSync(secret, this.salt, 32);
  }
  login(secret: string, now = Date.now()): { token: string; csrf: string } | null {
    this.attempts = this.attempts.filter(at => now - at < 60_000);
    if (this.attempts.length >= 5) return null;
    this.attempts.push(now);
    if (!timingSafeEqual(scryptSync(secret, this.salt, 32), this.digest)) return null;
    this.token = randomBytes(32).toString("hex");
    this.csrf = randomBytes(32).toString("hex");
    this.expiresAt = now + 30 * 60_000;
    return { token: this.token, csrf: this.csrf };
  }
  authorize(cookie: string | undefined, now = Date.now()): boolean {
    const token = cookie?.split(";").map(part => part.trim()).find(part => part.startsWith("jmr_mobile="))?.slice(11);
    return !!this.token && now < this.expiresAt && token === this.token;
  }
  verifyCsrf(value: string | undefined): boolean { return !!this.csrf && value === this.csrf; }
  revoke(): void { this.token = ""; this.csrf = ""; this.expiresAt = 0; }
}
