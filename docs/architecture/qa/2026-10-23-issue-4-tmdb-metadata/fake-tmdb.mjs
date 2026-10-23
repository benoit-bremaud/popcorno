// QA double of TMDB (no real key available): answers the five operations the server uses.
// Started by run-qa.sh on 127.0.0.1:3199; the server reaches it through redirect-fetch.mjs.
import { createServer } from 'node:http';

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);
const matrix = {
  id: 603,
  title: 'The Matrix',
  overview: 'A computer hacker learns about the true nature of reality.',
  genres: [
    { id: 28, name: 'Action' },
    { id: 878, name: 'Science Fiction' },
  ],
  release_date: '1999-03-30',
  runtime: 136,
  vote_average: 8.2,
  vote_count: 25000,
  poster_path: '/matrixposter.png',
  backdrop_path: '/matrixbackdrop.png',
  credits: { cast: [{ name: 'Keanu Reeves', character: 'Neo', profile_path: null, order: 0 }] },
};
let hits = 0;
createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://x');
  hits += 1;
  console.log(
    `${hits} ${req.method} ${url.pathname}${url.search} auth=${req.headers.authorization ? 'bearer' : 'none'}`,
  );
  const json = (body, status = 200, headers = {}) => {
    res.writeHead(status, { 'content-type': 'application/json', ...headers });
    res.end(JSON.stringify(body));
  };
  if (url.pathname === '/3/search/movie') {
    // First call answers 429 once to exercise the retry; then matches "The Matrix" only.
    if (hits === 1) return json({}, 429, { 'retry-after': '1' });
    const q = url.searchParams.get('query') ?? '';
    return json({ results: q.includes('Matrix') ? [{ id: 603, release_date: '1999-03-30' }] : [] });
  }
  if (url.pathname === '/3/movie/603') return json(matrix);
  if (url.pathname === '/3/configuration')
    return json({ images: { secure_base_url: 'https://image.tmdb.org/t/p/' } });
  if (url.pathname.startsWith('/t/p/')) {
    res.writeHead(200, { 'content-type': 'image/png', 'content-length': png.length });
    return res.end(png);
  }
  json({ status_message: 'not found' }, 404);
}).listen(3199, '127.0.0.1', () => console.log('fake TMDB on 127.0.0.1:3199'));
