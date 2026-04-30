import type { Request, Response, NextFunction } from "express";

export function ipAllowlist(req: Request, res: Response, next: NextFunction) {
  const allowed = (process.env.ADMIN_ALLOWED_IPS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  if (allowed.length === 0) return next();

  // req.ip may return IPv4-mapped IPv6 (e.g. "::ffff:1.2.3.4") — normalize to plain IPv4
  const rawIp = req.ip ?? "";
  const clientIp = rawIp.startsWith("::ffff:") ? rawIp.slice(7) : rawIp;

  if (!clientIp || !allowed.includes(clientIp)) {
    res.status(403).send("Forbidden");
    return;
  }
  next();
}

export function basicAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Basic ")) {
    res.set("WWW-Authenticate", 'Basic realm="Admin"');
    res.status(401).send("Authentication required");
    return;
  }

  const decoded = Buffer.from(header.slice(6), "base64").toString();
  const sep = decoded.indexOf(":");
  const user = sep === -1 ? decoded : decoded.slice(0, sep);
  const pass = sep === -1 ? "" : decoded.slice(sep + 1);

  if (user !== process.env.ADMIN_USER || pass !== process.env.ADMIN_PASS) {
    res.status(401).send("Invalid credentials");
    return;
  }
  next();
}
