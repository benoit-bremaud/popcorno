import { CatalogPage } from './catalog/CatalogPage.js';

/** The web player shell: brand header and the catalog. */
export function App(): React.JSX.Element {
  return (
    <>
      <header className="header">
        <h1 className="brand">Popcorno</h1>
      </header>
      <main className="shell">
        <CatalogPage />
      </main>
    </>
  );
}
