// QA double of TMDB for the #5 catalog pass (no real key): a handful of films, a series and a
// documentary with distinct coloured artwork, so the catalog rows, hero and dialog show real data.
// The server reaches it through redirect-fetch.mjs. Artwork PNGs come from $ART_DIR (made by run-qa.sh).
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';

const g = (id, name) => ({ id, name });
const ACTION = g(28, 'Action');
const DRAMA = g(18, 'Drama');
const SCIFI = g(878, 'Science Fiction');
const CRIME = g(80, 'Crime');
const DOC = g(99, 'Documentary');
const MYSTERY = g(9648, 'Mystery');
const cast = (...names) => ({
  cast: names.map((name, order) => ({ name, character: '', profile_path: null, order })),
});
const MOVIES = {
  603: [
    'The Matrix',
    '1999-03-30',
    [ACTION, SCIFI],
    8.2,
    136,
    cast('Keanu Reeves', 'Carrie-Anne Moss'),
  ],
  949: [
    'Heat',
    '1995-12-15',
    [ACTION, CRIME, DRAMA],
    7.9,
    170,
    cast('Al Pacino', 'Robert De Niro'),
  ],
  348: ['Alien', '1979-05-25', [SCIFI], 8.1, 117, cast('Sigourney Weaver')],
  680: ['Pulp Fiction', '1994-09-10', [CRIME], 8.5, 154, cast('John Travolta', 'Uma Thurman')],
  13: ['Forrest Gump', '1994-06-23', [DRAMA], 8.5, 142, cast('Tom Hanks')],
  329: ['Planet Earth Live', '2012-05-01', [DOC], 7.4, 90, cast('David Attenborough')],
};
const TV = {
  70523: ['Dark', '2017-12-01', [DRAMA, MYSTERY, SCIFI], 8.4, 60, cast('Louis Hofmann')],
};

const art = (name) => readFileSync(`${process.env.ART_DIR}/${name}.png`);
const details = ([title, date, genres, vote, runtime, credits], id, tv) => ({
  id,
  ...(tv
    ? { name: title, first_air_date: date, episode_run_time: [runtime] }
    : { title, release_date: date, runtime }),
  overview: `${title}: a synopsis served by the QA double of TMDB.`,
  genres,
  vote_average: vote,
  vote_count: 1000 + id,
  poster_path: `/p${id}.png`,
  backdrop_path: `/b${id}.png`,
  credits,
});
const search = (table, q) =>
  Object.entries(table)
    .filter(([, [title]]) => title.toLowerCase() === q.toLowerCase())
    .map(([id, [, date]]) => ({ id: Number(id), release_date: date, first_air_date: date }));

createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://x');
  console.log(`${req.method} ${url.pathname}${url.search}`);
  const json = (body, status = 200) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  const q = url.searchParams.get('query') ?? '';
  let m;
  if (url.pathname === '/3/search/movie') return json({ results: search(MOVIES, q) });
  if (url.pathname === '/3/search/tv') return json({ results: search(TV, q) });
  if ((m = /^\/3\/movie\/(\d+)$/.exec(url.pathname)) && MOVIES[m[1]])
    return json(details(MOVIES[m[1]], Number(m[1]), false));
  if ((m = /^\/3\/tv\/(\d+)\/season\/(\d+)$/.exec(url.pathname)))
    return json({
      episodes: [1, 2, 3].map((n) => ({
        episode_number: n,
        name: `Episode ${n}`,
        overview: '',
        air_date: null,
        runtime: 60,
        vote_average: null,
        still_path: null,
      })),
    });
  if ((m = /^\/3\/tv\/(\d+)$/.exec(url.pathname)) && TV[m[1]])
    return json(details(TV[m[1]], Number(m[1]), true));
  if (url.pathname === '/3/configuration')
    return json({ images: { secure_base_url: 'https://image.tmdb.org/t/p/' } });
  if ((m = /^\/t\/p\/\w+\/([pb])(\d+)\.png$/.exec(url.pathname))) {
    const body = art(`${m[1]}${m[2]}`);
    res.writeHead(200, { 'content-type': 'image/png', 'content-length': body.length });
    return res.end(body);
  }
  json({ status_message: 'not found' }, 404);
}).listen(3199, '127.0.0.1', () => console.log('fake TMDB on 127.0.0.1:3199'));
