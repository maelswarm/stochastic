// Minimal in-memory sliding-window rate limiter -- no new dependency for
// something this simple. Per-process only (fine for a single-instance
// deploy); resets on restart.
function rateLimit({ windowMs, max, message }) {
  const hits = new Map(); // ip -> { count, resetAt }

  // Sweep expired entries periodically so the map doesn't grow unbounded
  // under sustained traffic from many distinct IPs.
  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [ip, entry] of hits) {
      if (entry.resetAt <= now) hits.delete(ip);
    }
  }, windowMs);
  sweep.unref();

  return (req, res, next) => {
    const ip = req.ip;
    const now = Date.now();
    let entry = hits.get(ip);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + windowMs };
      hits.set(ip, entry);
    }
    entry.count += 1;
    if (entry.count > max) {
      res.setHeader('Retry-After', Math.ceil((entry.resetAt - now) / 1000));
      if (req.path.startsWith('/api/')) {
        return res.status(429).json({ error: message || 'Too many requests -- try again shortly.' });
      }
      return res.status(429).send(message || 'Too many requests -- try again shortly.');
    }
    next();
  };
}

module.exports = { rateLimit };
