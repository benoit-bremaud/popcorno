# Component diagram — catalog (apps/web)

> **Feature**: UC3 / UC4 ([spec](../../specs/catalog-grid.md))
> **Related ADRs**: ADR-0001, ADR-0004

## Diagram

```mermaid
flowchart TB
  subgraph web[apps/web]
    app[App] --> page[catalog/CatalogPage]
    page --> controls[catalog/Controls]
    page --> row[catalog/PosterRow]
    page --> grid[catalog/PosterGrid]
    page --> detail[catalog/DetailDialog]
    row --> card[catalog/PosterCard]
    grid --> card
    page --> state[catalog/view-state.ts<br/>reducer, pure]
    page --> cat[catalog/catalog.ts<br/>rows, pure]
    page --> api[api.ts<br/>fetch, only HTTP egress]
    tokens[(styles/tokens.css)]
  end
  shared[packages/shared<br/>Media, isDocumentary]
  cat --> shared
  api --> shared
  api -->|/api/libraries, /api/libraries/:id/media| server[apps/server]
  card -->|/api/artwork/:file| server
```

## Notes

- Flat layout (architecture rule: no layers without a force): two pure modules hold all
  the logic and are unit-tested; components only render.
