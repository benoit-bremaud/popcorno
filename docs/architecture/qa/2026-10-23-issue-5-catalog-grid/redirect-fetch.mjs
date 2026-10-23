// Preloaded with `node --import`: routes the server's fetch to the fake TMDB double so the
// production client code (URLs, headers, retry, host pin) runs unchanged without a real key.
const real = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const url = new URL(input instanceof URL ? input.toString() : String(input));
  if (url.hostname === 'api.themoviedb.org' || url.hostname === 'image.tmdb.org') {
    url.protocol = 'http:';
    url.host = '127.0.0.1:3199';
  }
  return real(url, init);
};
