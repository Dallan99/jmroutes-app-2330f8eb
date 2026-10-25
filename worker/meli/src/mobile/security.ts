import { createHash, createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export const MOBILE_SESSION_SECONDS = 30 * 60;
export const MOBILE_REMEMBER_SECONDS = 30 * 24 * 60 * 60;
type AccessSession = { csrf: string; expiresAt: number; remembered: boolean };

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
  private sessions = new Map<string, AccessSession>();
  private signingKey: Buffer;
  private attempts: number[] = [];
  constructor(secret: string, private storagePath?: string) {
    if (secret.length < 32) throw new Error("MOBILE_ACCESS_KEY exige pelo menos 32 caracteres aleatórios.");
    this.digest = scryptSync(secret, this.salt, 32);
    this.signingKey = createHmac("sha256", secret).update("jmr-mobile-remember-v1").digest();
    if (storagePath) {
      let raw: string;
      try { raw = readFileSync(storagePath, "utf8"); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; return; }
      try {
        const { payload, signature } = JSON.parse(raw);
        const expected = this.sign(payload);
        if (typeof signature !== "string" || signature.length !== expected.length
          || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return;
        const records = JSON.parse(payload);
        if (!Array.isArray(records) || records.length > 20) return;
        for (const [hash, session] of records) {
          if (/^[a-f0-9]{64}$/.test(hash) && session.remembered === true
            && /^[a-f0-9]{64}$/.test(session.csrf) && Number.isSafeInteger(session.expiresAt)
            && session.expiresAt > Date.now()) this.sessions.set(hash, session);
        }
      } catch { this.sessions.clear(); }
    }
  }
  private sign(payload: string): string {
    return createHmac("sha256", this.signingKey).update(payload).digest("hex");
  }
  private persist(): void {
    if (!this.storagePath) return;
    const payload = JSON.stringify([...this.sessions].filter(([, session]) => session.remembered));
    mkdirSync(dirname(this.storagePath), { recursive: true, mode: 0o700 });
    const temporary = `${this.storagePath}.${randomBytes(8).toString("hex")}.tmp`;
    writeFileSync(temporary, JSON.stringify({ payload, signature: this.sign(payload) }), { mode: 0o600, flag: "wx" });
    renameSync(temporary, this.storagePath);
  }
  private cookieHash(cookie: string | undefined): string {
    const token = cookie?.split(";").map(part => part.trim()).find(part => part.startsWith("jmr_mobile="))?.slice(11);
    return token && /^[a-f0-9]{64}$/.test(token) ? createHash("sha256").update(token).digest("hex") : "";
  }
  login(secret: string, now = Date.now(), remember = false): { token: string; csrf: string; maxAge: number } | null {
    this.attempts = this.attempts.filter(at => now - at < 60_000);
    if (this.attempts.length >= 5) return null;
    this.attempts.push(now);
    if (!timingSafeEqual(scryptSync(secret, this.salt, 32), this.digest)) return null;
    for (const [hash, session] of this.sessions) if (now >= session.expiresAt) this.sessions.delete(hash);
    if (this.sessions.size >= 20) this.sessions.delete(this.sessions.keys().next().value!);
    const token = randomBytes(32).toString("hex");
    const csrf = randomBytes(32).toString("hex");
    const maxAge = remember ? MOBILE_REMEMBER_SECONDS : MOBILE_SESSION_SECONDS;
    this.sessions.set(createHash("sha256").update(token).digest("hex"), { csrf, expiresAt: now + maxAge * 1000, remembered: remember });
    try { this.persist(); }
    catch (error) { this.sessions.delete(createHash("sha256").update(token).digest("hex")); throw error; }
    return { token, csrf, maxAge };
  }
  authorize(cookie: string | undefined, now = Date.now()): boolean {
    const session = this.sessions.get(this.cookieHash(cookie));
    return !!session && now < session.expiresAt;
  }
  csrfFor(cookie: string | undefined, now = Date.now()): string | undefined {
    return this.authorize(cookie, now) ? this.sessions.get(this.cookieHash(cookie))?.csrf : undefined;
  }
  verifyCsrf(value: string | undefined, cookie?: string): boolean {
    if (!value) return false;
    return cookie !== undefined ? value === this.csrfFor(cookie)
      : [...this.sessions.values()].some(session => session.csrf === value);
  }
  revoke(cookie?: string): void {
    if (cookie === undefined) this.sessions.clear();
    else this.sessions.delete(this.cookieHash(cookie));
    this.persist();
  }
}

