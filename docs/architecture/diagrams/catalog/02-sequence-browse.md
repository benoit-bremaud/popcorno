# Sequence diagram — catalog — load and open a title

> **Feature**: UC3 / UC4 ([spec](../../specs/catalog-grid.md))
> **Related ADRs**: ADR-0001, ADR-0004

## Diagram

```mermaid
sequenceDiagram
  actor Viewer
  participant Page as CatalogPage (React)
  participant Api as api.ts
  participant Server as Fastify server
  participant Cat as catalog.ts (pure)

  Viewer->>Page: open the web player
  Page->>Api: loadCatalog()
  Api->>Server: GET /api/libraries
  Server-->>Api: Library[]
  par one request per library
    Api->>Server: GET /api/libraries/:id/media
    Server-->>Api: Media[]
  end
  Api-->>Page: Media[] (all libraries)
  Page->>Cat: catalogItems(media), homeRows(items)
  Cat-->>Page: rows
  Page-->>Viewer: hero + rows, posters via GET /api/artwork/:file
  Viewer->>Page: activate a poster
  Page->>Cat: episodesOf(series, media)
  Page-->>Viewer: detail dialog (no extra request)
  alt any request fails
    Api-->>Page: throws ApiRequestError
    Page-->>Viewer: error state + Retry
  end
```

## Notes

- All media are loaded once; type / view / genre changes are pure recomputations, no
  further request.
