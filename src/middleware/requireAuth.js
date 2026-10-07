module.exports = function requireAuth(req, res, next) {
  if (req.session && req.session.userId) {
    return next();
  }
  if (req.path.startsWith('/api/')) {
    return res.status(401).json({ error: 'Authentication required.' });
  }
  const next_ = encodeURIComponent(req.originalUrl);
  return res.redirect(`/login?next=${next_}`);
};
