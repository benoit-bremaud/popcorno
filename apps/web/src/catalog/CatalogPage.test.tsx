import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { Media } from '@popcorno/shared';
import { ACTION, DOCUMENTARY, DRAMA, media, metadata } from '../test-fixtures.js';
import { CatalogPage } from './CatalogPage.js';

const heat = media({
  id: 'heat',
  title: 'Heat',
  year: 1995,
  metadata: metadata({
    genres: [ACTION, DRAMA],
    voteAverage: 8.3,
    voteCount: 7000,
    runtimeMin: 170,
    posterPath: 'heat-poster.jpg',
    backdropPath: 'heat-backdrop.jpg',
    overview: 'A cop chases a thief.',
    cast: [{ name: 'Al Pacino', character: 'Hanna', profilePath: null }],
  }),
});
const alien = media({ id: 'alien', title: 'Alien', metadata: metadata({ genres: [ACTION] }) });
const dark = media({ id: 'dark', title: 'Dark', kind: 'series' });
const pilot = media({
  id: 'pilot',
  title: 'Secrets',
  kind: 'episode',
  seriesId: 'dark',
  season: 1,
  episode: 1,
});
const planet = media({
  id: 'planet',
  title: 'Planet',
  metadata: metadata({ genres: [DOCUMENTARY] }),
});

const CATALOG: Media[] = [heat, alien, dark, pilot, planet];

function renderPage(load: () => Promise<Media[]> = async () => CATALOG) {
  return { user: userEvent.setup(), ...render(<CatalogPage load={load} />) };
}

function group(name: string): HTMLElement {
  return screen.getByRole('group', { name });
}

describe('CatalogPage', () => {
  it('shows the home view: hero, top rated, type rows and genre rows', async () => {
    renderPage();

    expect(await screen.findByRole('button', { name: 'More info' })).toBeInTheDocument();
    expect(screen.getByText('A cop chases a thief.')).toBeInTheDocument();
    const rowTitles = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
    expect(rowTitles).toEqual(['Top rated', 'Films', 'Series', 'Documentaries', 'Action', 'Drama']);
    expect(screen.queryByRole('group', { name: 'View' })).not.toBeInTheDocument();
    expect(
      within(group('Type'))
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual(['All', 'Films', 'Series', 'Documentaries']);
  });

  it('reveals views, then genres, as choices are made (progressive disclosure)', async () => {
    const { user } = renderPage();

    await user.click(
      await within(await screen.findByRole('group', { name: 'Type' })).findByRole('button', {
        name: 'Films',
      }),
    );
    expect(
      within(group('View'))
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual(['By genre', 'Top rated', 'A–Z']);
    expect(
      within(group('Genre'))
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual(['Action', 'Drama']);

    await user.click(within(group('Genre')).getByRole('button', { name: 'Drama' }));
    expect(screen.getByRole('region', { name: 'Films — Drama' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /^Heat/ })).toHaveLength(1);

    await user.click(within(group('View')).getByRole('button', { name: 'A–Z' }));
    expect(screen.queryByRole('group', { name: 'Genre' })).not.toBeInTheDocument();
    const grid = screen.getByRole('region', { name: 'Films — A–Z' });
    expect(
      within(grid)
        .getAllByRole('button')
        .map((b) => b.getAttribute('aria-label')),
    ).toEqual(['Alien', 'Heat (1995)']);

    await user.click(within(group('View')).getByRole('button', { name: 'Top rated' }));
    expect(screen.getByRole('region', { name: 'Films — top rated' })).toBeInTheDocument();

    await user.click(within(group('Type')).getByRole('button', { name: 'All' }));
    expect(screen.queryByRole('group', { name: 'View' })).not.toBeInTheDocument();
  });

  it('hides Top rated for a type without ratings and keeps titles without genre reachable', async () => {
    const { user } = renderPage();

    await user.click(await screen.findByRole('button', { name: 'Series' }));
    expect(
      within(group('View'))
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual(['By genre', 'A–Z']);
    expect(screen.queryByRole('group', { name: 'Genre' })).not.toBeInTheDocument();
    const others = screen.getByRole('region', { name: 'Other titles' });
    expect(within(others).getByRole('button', { name: 'Dark' })).toBeInTheDocument();
  });

  it('opens a title in a dialog and returns focus to its poster on close', async () => {
    const { user } = renderPage();

    const poster = (await screen.findAllByRole('button', { name: 'Heat (1995)' }))[0];
    if (poster === undefined) throw new Error('poster missing');
    await user.click(poster);
    const dialog = screen.getByRole('dialog', { name: 'Heat' });
    expect(within(dialog).getByText('1995 · 170 min · ★ 8.3')).toBeInTheDocument();
    expect(within(dialog).getByText('A cop chases a thief.')).toBeInTheDocument();
    expect(within(dialog).getByText('Al Pacino')).toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(poster).toHaveFocus();
  });

  it('lists the episodes of a series and closes on the native close event', async () => {
    const { user } = renderPage();

    await user.click((await screen.findAllByRole('button', { name: 'Dark' }))[0] as HTMLElement);
    const dialog = screen.getByRole('dialog', { name: 'Dark' });
    expect(within(dialog).getByRole('heading', { name: 'Season 1' })).toBeInTheDocument();
    expect(within(dialog).getByText('Secrets')).toBeInTheDocument();
    expect(within(dialog).getByText('No synopsis yet.')).toBeInTheDocument();

    (dialog as HTMLDialogElement).close();
    expect(await screen.findByRole('heading', { name: 'Top rated' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('opens the hero title and gives the focus back to its button', async () => {
    const { user } = renderPage();

    const moreInfo = await screen.findByRole('button', { name: 'More info' });
    await user.click(moreInfo);
    const dialog = screen.getByRole('dialog', { name: 'Heat' });
    await user.click(within(dialog).getByRole('button', { name: 'Close' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(moreInfo).toHaveFocus();
  });

  it('ignores a stale load that settles after a newer one', async () => {
    let settleOld: (media: Media[]) => void = () => undefined;
    const oldLoad = () =>
      new Promise<Media[]>((resolve) => {
        settleOld = resolve;
      });
    const { rerender } = render(<CatalogPage load={oldLoad} />);

    rerender(<CatalogPage load={async () => CATALOG} />);
    expect(await screen.findByRole('heading', { name: 'Top rated' })).toBeInTheDocument();
    settleOld([]);

    expect(await screen.findByRole('heading', { name: 'Top rated' })).toBeInTheDocument();
    expect(screen.queryByText(/Nothing to show yet/)).not.toBeInTheDocument();
  });

  it('shows an error with a working Retry', async () => {
    const load = vi
      .fn<() => Promise<Media[]>>()
      .mockRejectedValueOnce(new Error('down'))
      .mockResolvedValueOnce(CATALOG);
    const { user } = renderPage(load);

    expect(await screen.findByRole('alert')).toHaveTextContent('could not be loaded');
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('heading', { name: 'Top rated' })).toBeInTheDocument();
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('shows the empty state when no library has items', async () => {
    renderPage(async () => [pilot]);

    expect(await screen.findByText(/Nothing to show yet/)).toBeInTheDocument();
  });

  it('shows the poster placeholder without artwork and the image with it', async () => {
    renderPage();

    const alienPoster = (await screen.findAllByRole('button', { name: 'Alien' }))[0] as HTMLElement;
    expect(alienPoster).toHaveTextContent('Alien');
    const heatPoster = screen.getAllByRole('button', { name: 'Heat (1995)' })[0] as HTMLElement;
    expect(heatPoster.querySelector('img')).toHaveAttribute('src', '/api/artwork/heat-poster.jpg');
  });
});
