import type { Genre } from '@popcorno/shared';
import { TYPE_LABELS } from './catalog.js';
import type { CatalogType } from './catalog.js';
import type { CatalogView, ViewAction, ViewState } from './view-state.js';

const VIEW_LABELS: Readonly<Record<CatalogView, string>> = {
  genre: 'By genre',
  'top-rated': 'Top rated',
  'a-z': 'A–Z',
};

type Props = {
  readonly state: ViewState;
  readonly types: readonly CatalogType[];
  /** Views offered for the chosen type (guards of state diagram 05). */
  readonly views: readonly CatalogView[];
  /** Genres of the chosen type. */
  readonly genres: readonly Genre[];
  readonly dispatch: (action: ViewAction) => void;
};

/** Type tabs, then the views of that type, then its genres: each level appears after the previous choice. */
export function Controls({ state, types, views, genres, dispatch }: Props): React.JSX.Element {
  return (
    <nav className="controls" aria-label="Catalog">
      <fieldset className="controls__level">
        <legend className="visually-hidden">Type</legend>
        {(['all', ...types] as const).map((type) => (
          <button
            key={type}
            type="button"
            className="tab"
            aria-pressed={state.type === type}
            onClick={() => dispatch({ kind: 'pick-type', type })}
          >
            {type === 'all' ? 'All' : TYPE_LABELS[type]}
          </button>
        ))}
      </fieldset>
      {state.type !== 'all' && (
        <fieldset className="controls__level">
          <legend className="visually-hidden">View</legend>
          {views.map((view) => (
            <button
              key={view}
              type="button"
              className="chip"
              aria-pressed={state.view === view}
              onClick={() => dispatch({ kind: 'pick-view', view })}
            >
              {VIEW_LABELS[view]}
            </button>
          ))}
        </fieldset>
      )}
      {state.type !== 'all' && state.view === 'genre' && genres.length > 0 && (
        <fieldset className="controls__level">
          <legend className="visually-hidden">Genre</legend>
          {genres.map((genre) => (
            <button
              key={genre.id}
              type="button"
              className="chip chip--small"
              aria-pressed={state.genre === genre.id}
              onClick={() => dispatch({ kind: 'pick-genre', genre: genre.id })}
            >
              {genre.name}
            </button>
          ))}
        </fieldset>
      )}
    </nav>
  );
}
