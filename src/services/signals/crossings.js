// Last-bar crossing helpers shared by every signal definition. Signals only
// ever fire on the most recently closed bar (index len-1 vs len-2) -- the
// engine re-evaluates the whole series each time but a signal is only
// "new" if the transition happened on the last step.
function valid(...vals) {
  return vals.every((v) => v !== null && v !== undefined && !Number.isNaN(v));
}

// "Before" state uses <=/>= and "after" uses strict >/< so a prior exact
// tie (e.g. two SMAs identically flat, then diverging) still counts as a
// cross -- requiring strict inequality on both sides misses that case
// entirely, since the tie bar satisfies neither "was below" nor "was above".
function crossesAboveLevel(series, level) {
  const n = series.length;
  if (n < 2 || !valid(series[n - 2], series[n - 1])) return false;
  return series[n - 2] <= level && series[n - 1] > level;
}

function crossesBelowLevel(series, level) {
  const n = series.length;
  if (n < 2 || !valid(series[n - 2], series[n - 1])) return false;
  return series[n - 2] >= level && series[n - 1] < level;
}

function seriesCrossesAbove(a, b) {
  const n = a.length;
  if (n < 2 || !valid(a[n - 2], a[n - 1], b[n - 2], b[n - 1])) return false;
  return a[n - 2] <= b[n - 2] && a[n - 1] > b[n - 1];
}

function seriesCrossesBelow(a, b) {
  const n = a.length;
  if (n < 2 || !valid(a[n - 2], a[n - 1], b[n - 2], b[n - 1])) return false;
  return a[n - 2] >= b[n - 2] && a[n - 1] < b[n - 1];
}

function enteredAbove(series, level) {
  return crossesAboveLevel(series, level);
}
function enteredBelow(series, level) {
  return crossesBelowLevel(series, level);
}

function flippedTo(series, target) {
  const n = series.length;
  if (n < 2 || !valid(series[n - 2], series[n - 1])) return false;
  return series[n - 2] !== target && series[n - 1] === target;
}

function last(series, offset = 0) {
  return series[series.length - 1 - offset];
}

module.exports = {
  valid, crossesAboveLevel, crossesBelowLevel, seriesCrossesAbove, seriesCrossesBelow,
  enteredAbove, enteredBelow, flippedTo, last,
};
