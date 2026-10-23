import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import type { Media } from '@popcorno/shared';
import { artworkUrl, loadCatalog } from '../api.js';
import {
  availableGenres,
  availableTypes,
  catalogItems,
  heroItem,
  ofType,
  seasonsOf,
  topRated,
} from './catalog.js';
import { CatalogBody } from './CatalogBody.js';
import type { OpenHandler } from './CatalogBody.js';
import { Controls } from './Controls.js';
import { DetailDialog } from './DetailDialog.js';
import { HOME, viewReducer } from './view-state.js';
import type { CatalogView } from './view-state.js';

type Load = { kind: 'loading' } | { kind: 'failed' } | { kind: 'ready'; media: Media[] };

type Props = {
  /** Injected in tests; defaults to the real API. */
  readonly load?: () => Promise<Media[]>;
};

/** UC3 / UC4: the catalog with its dynamic controls and the detail dialog. */
export function CatalogPage({ load = loadCatalog }: Props): React.JSX.Element {
  const [catalog, setCatalog] = useState<Load>({ kind: 'loading' });
  const [state, dispatch] = useReducer(viewReducer, HOME);
  // `seq` numbers each opening: the native `close` event is queued as a task, so a late one
  // from a previous opening must not close a title reopened in the meantime.
  const [open, setOpen] = useState<{ item: Media; seq: number } | null>(null);
  const openings = useRef(0);
  const trigger = useRef<HTMLElement | null>(null);

  const latest = useRef(0);

  // Only the latest request may settle the state (a quick Retry must not be overwritten).
  const fetchCatalog = useCallback(async () => {
    const request = ++latest.current;
    setCatalog({ kind: 'loading' });
    let next: Load;
    try {
      next = { kind: 'ready', media: await load() };
    } catch {
      next = { kind: 'failed' };
    }
    if (request === latest.current) setCatalog(next);
  }, [load]);

  useEffect(() => {
    void fetchCatalog();
  }, [fetchCatalog]);

  const onOpen = useCallback<OpenHandler>((item, element) => {
    trigger.current = element;
    openings.current += 1;
    setOpen({ item, seq: openings.current });
  }, []);

  const onClose = useCallback((seq: number) => {
    setOpen((current) => (current?.seq === seq ? null : current));
    trigger.current?.focus();
  }, []);

  if (catalog.kind === 'loading') {
    return <p className="status muted">Loading the catalog…</p>;
  }
  if (catalog.kind === 'failed') {
    return (
      <div className="status" role="alert">
        <p>The catalog could not be loaded.</p>
        <button type="button" className="button" onClick={() => void fetchCatalog()}>
          Retry
        </button>
      </div>
    );
  }

  const items = catalogItems(catalog.media);
  if (items.length === 0) {
    return (
      <p className="status muted">
        Nothing to show yet: add a library and scan it (POST /libraries, then /scan).
      </p>
    );
  }

  const types = availableTypes(items);
  const typed = state.type === 'all' ? items : ofType(items, state.type);
  const views: CatalogView[] =
    topRated(typed, 1).length > 0 ? ['genre', 'top-rated', 'a-z'] : ['genre', 'a-z'];
  const hero = state.type === 'all' ? heroItem(items) : null;
  const heroBackdrop = hero?.metadata?.backdropPath ?? null;

  return (
    <>
      {hero !== null && heroBackdrop !== null && (
        <section className="hero">
          <img className="hero__image" src={artworkUrl(heroBackdrop)} alt="" />
          <div className="hero__body">
            <p className="hero__title">{hero.title}</p>
            {hero.metadata?.overview && <p className="hero__overview">{hero.metadata.overview}</p>}
            <button
              type="button"
              className="button"
              onClick={(event) => onOpen(hero, event.currentTarget)}
            >
              More info
            </button>
          </div>
        </section>
      )}
      <Controls
        state={state}
        types={types}
        views={views}
        genres={availableGenres(typed)}
        dispatch={dispatch}
      />
      {/* Keyed by the view state: each new choice fades its content in. */}
      <div className="view" key={JSON.stringify(state)}>
        <CatalogBody items={items} state={state} onOpen={onOpen} />
      </div>
      {open !== null && (
        <DetailDialog
          key={open.seq}
          item={open.item}
          seasons={seasonsOf(open.item, catalog.media)}
          onClose={() => onClose(open.seq)}
        />
      )}
    </>
  );
}
