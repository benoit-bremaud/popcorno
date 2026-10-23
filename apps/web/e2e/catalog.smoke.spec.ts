import { expect, test } from '@playwright/test';

// The API is mocked at the network layer: the smoke checks the built page, not the server.
const LIBRARY = { id: 'lib-1', name: 'Films', rootPath: '/media/films', kind: 'films' };
const META = {
  tmdbId: 1,
  overview: 'A synopsis.',
  releaseDate: null,
  runtimeMin: 120,
  voteCount: 10,
  cast: [],
  posterPath: null,
  backdropPath: null,
  fetchedAt: '2026-10-23T00:00:00.000Z',
};
const TITLES: readonly { id: string; title: string; genre: string; voteAverage: number }[] = [
  { id: 'heat', title: 'Heat', genre: 'Action', voteAverage: 8.3 },
  { id: 'alien', title: 'Alien', genre: 'Science Fiction', voteAverage: 8.1 },
];
const MEDIA = TITLES.map(({ id, title, genre, voteAverage }, index) => ({
  id,
  libraryId: 'lib-1',
  kind: 'film',
  title,
  year: null,
  relativePath: `${title}.mkv`,
  durationSec: 100,
  season: null,
  episode: null,
  episodeEnd: null,
  seriesId: null,
  providerIds: {},
  edition: null,
  part: null,
  streams: [],
  metadata: { ...META, genres: [{ id: index + 1, name: genre }], voteAverage },
}));

test('the catalog grid renders from the API and opens a title', async ({ page }) => {
  await page.route('**/api/libraries', (route) => route.fulfill({ json: [LIBRARY] }));
  await page.route('**/api/libraries/lib-1/media', (route) => route.fulfill({ json: MEDIA }));

  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'Top rated' })).toBeVisible();
  await page.getByRole('group', { name: 'Type' }).getByRole('button', { name: 'Films' }).click();
  await page.getByRole('button', { name: 'A–Z' }).click();
  const grid = page.getByRole('region', { name: 'Films — A–Z' });
  await expect(grid.getByRole('button')).toHaveCount(2);

  const poster = grid.getByRole('button', { name: 'Heat' });
  await poster.click();
  const dialog = page.getByRole('dialog', { name: 'Heat' });
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(poster).toBeFocused();

  await poster.press('Enter');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Close' }).click();
  await expect(dialog).toBeHidden();
  await expect(poster).toBeFocused();
});
