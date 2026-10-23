import type { CatalogType } from './catalog.js';

/** How a chosen type is presented (state diagram 05). */
export type CatalogView = 'genre' | 'top-rated' | 'a-z';

/**
 * The catalog's dynamic controls. `type: 'all'` is the home view; `genre` is only
 * meaningful in the `genre` view and is cleared whenever an earlier choice changes.
 */
export type ViewState =
  | { readonly type: 'all' }
  | { readonly type: CatalogType; readonly view: CatalogView; readonly genre: number | null };

/** User choices, one per control. */
export type ViewAction =
  | { readonly kind: 'pick-type'; readonly type: CatalogType | 'all' }
  | { readonly kind: 'pick-view'; readonly view: CatalogView }
  | { readonly kind: 'pick-genre'; readonly genre: number };

/** Initial state: the home view. */
export const HOME: ViewState = { type: 'all' };

/** Transitions of state diagram 05; later choices reset when an earlier one changes. */
export function viewReducer(state: ViewState, action: ViewAction): ViewState {
  switch (action.kind) {
    case 'pick-type':
      return action.type === 'all' ? HOME : { type: action.type, view: 'genre', genre: null };
    case 'pick-view':
      if (state.type === 'all') return state;
      return { type: state.type, view: action.view, genre: null };
    case 'pick-genre':
      if (state.type === 'all' || state.view !== 'genre') return state;
      return { ...state, genre: state.genre === action.genre ? null : action.genre };
  }
}
