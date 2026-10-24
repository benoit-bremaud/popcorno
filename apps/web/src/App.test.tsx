import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from './App.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('App', () => {
  it('renders the brand and loads the catalog from the API', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('[]', { status: 200 })),
    );

    render(<App />);

    expect(screen.getByRole('heading', { name: 'PopCornTV', level: 1 })).toBeInTheDocument();
    expect(await screen.findByText(/Nothing to show yet/)).toBeInTheDocument();
  });
});
