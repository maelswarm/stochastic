module.exports = function errorHandler(err, req, res, next) { // eslint-disable-line no-unused-vars
  console.error(err);
  if (req.path.startsWith('/api/')) {
    return res.status(500).json({ error: 'Internal server error.' });
  }
  res.status(500).render('errors/500');
};
