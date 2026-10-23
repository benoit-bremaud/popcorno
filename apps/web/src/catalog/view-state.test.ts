import { describe, expect, it } from 'vitest';
import { HOME, viewReducer } from './view-state.js';
import type { ViewState } from './view-state.js';

const films: ViewState = { type: 'films', view: 'genre', genre: null };

describe('viewReducer (state diagram 05)', () => {
  it('picking a type opens its genre view; picking All returns home', () => {
    expect(viewReducer(HOME, { kind: 'pick-type', type: 'films' })).toEqual(films);
    expect(viewReducer(films, { kind: 'pick-type', type: 'all' })).toBe(HOME);
  });

  it('picking another type resets the view and the genre', () => {
    const state: ViewState = { type: 'films', view: 'genre', genre: 28 };
    expect(viewReducer(state, { kind: 'pick-type', type: 'series' })).toEqual({
      type: 'series',
      view: 'genre',
      genre: null,
    });
  });

  it('picking a view clears the genre and is ignored at home', () => {
    const state: ViewState = { type: 'films', view: 'genre', genre: 28 };
    expect(viewReducer(state, { kind: 'pick-view', view: 'a-z' })).toEqual({
      type: 'films',
      view: 'a-z',
      genre: null,
    });
    expect(viewReducer(HOME, { kind: 'pick-view', view: 'a-z' })).toBe(HOME);
  });

  it('toggles a genre in the genre view only', () => {
    const picked = viewReducer(films, { kind: 'pick-genre', genre: 28 });
    expect(picked).toEqual({ ...films, genre: 28 });
    expect(viewReducer(picked, { kind: 'pick-genre', genre: 18 })).toEqual({ ...films, genre: 18 });
    expect(viewReducer(picked, { kind: 'pick-genre', genre: 28 })).toEqual(films);
    const az: ViewState = { type: 'films', view: 'a-z', genre: null };
    expect(viewReducer(az, { kind: 'pick-genre', genre: 28 })).toBe(az);
    expect(viewReducer(HOME, { kind: 'pick-genre', genre: 28 })).toBe(HOME);
  });
});
