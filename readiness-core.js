// Mastery score per subject:  M = Wc*C + Wp*P + Wt*T   (all 0-100)
//  C coverage, P PYQ, T test score shrunk toward a neutral prior.
// Weights are integers; when a subject has no subject-wise test yet, the test weight is dropped and the rest rescale.
export const K = 2;                       // confidence constant: two phantom tests at the prior
export const DEFAULT_PRIOR = 50;
export const shrink = (n, avg, prior = DEFAULT_PRIOR, k = K) => (n ? (n * avg + k * prior) / (n + k) : null);
export function weightsFor(w, hasTest) {
  const wc = +w.cov || 0, wp = +w.pyq || 0, wt = hasTest ? +w.rev || 0 : 0, sum = wc + wp + wt || 1;
  return { cov: wc / sum, pyq: wp / sum, test: wt / sum };
}
export const label = (M) => (M >= 85 ? 'Strong' : M >= 50 ? 'Medium' : 'Weak');

// C, P in 0-100; tests = array of 0-100 results (net marks / max, clamped); days = days since last activity (null = never)
export function mastery({ C, P, tests = [], w, prior = DEFAULT_PRIOR }) {
  const n = tests.length, avg = n ? tests.reduce((a, b) => a + b, 0) / n : 0, T = shrink(n, avg, prior);
  const W = weightsFor(w, n > 0);
  const raw = W.cov * C + W.pyq * P + W.test * (T ?? 0);
  return { M: raw, raw, C, P, T, n, W, label: label(raw) };
}
