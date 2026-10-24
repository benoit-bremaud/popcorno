import type { Media } from '@popcorntv/shared';
import {
  TYPE_LABELS,
  availableGenres,
  byGenreRows,
  homeRows,
  ofGenre,
  ofType,
  sortByTitle,
  topRated,
} from './catalog.js';
import { PosterGrid } from './PosterGrid.js';
import { PosterRow } from './PosterRow.js';
import type { ViewState } from './view-state.js';

/** Opens a title; `trigger` gets the focus back on close. */
export type OpenHandler = (item: Media, trigger: HTMLElement) => void;

type Props = {
  readonly items: readonly Media[];
  readonly state: ViewState;
  readonly onOpen: OpenHandler;
};

/** Rows or grid for the current view state (state diagram 05). */
export function CatalogBody({ items, state, onOpen }: Props): React.JSX.Element {
  if (state.type === 'all') {
    return (
      <>
        {homeRows(items).map((row, index) => (
          <PosterRow key={row.key} row={row} index={index} onOpen={onOpen} />
        ))}
      </>
    );
  }
  const typed = ofType(items, state.type);
  const label = TYPE_LABELS[state.type];
  if (state.view === 'top-rated') {
    return <PosterGrid title={`${label} — top rated`} items={topRated(typed)} onOpen={onOpen} />;
  }
  if (state.view === 'a-z') {
    return <PosterGrid title={`${label} — A–Z`} items={sortByTitle(typed)} onOpen={onOpen} />;
  }
  if (state.genre !== null) {
    const genre = availableGenres(typed).find((candidate) => candidate.id === state.genre);
    return (
      <PosterGrid
        title={`${label} — ${genre?.name ?? 'genre'}`}
        items={ofGenre(typed, state.genre)}
        onOpen={onOpen}
      />
    );
  }
  return (
    <>
      {byGenreRows(typed).map((row, index) => (
        <PosterRow key={row.key} row={row} index={index} onOpen={onOpen} />
      ))}
    </>
  );
}
