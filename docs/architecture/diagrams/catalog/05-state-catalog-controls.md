# State diagram — catalog — dynamic controls

> **Feature**: UC3 Browse the catalog ([spec](../../specs/catalog-grid.md))
> **Related ADRs**: ADR-0004

## Context

The owner wants controls whose options depend on the previous choice. The view state is
`{ type, view, genre }`; each choice resets the ones after it, and an option is only
rendered when it leads to a non-empty result.

## Diagram

```mermaid
stateDiagram-v2
  [*] --> Home
  Home: Home (type = all)<br/>hero + type rows + genre rows
  Home --> ByGenre: pick a type
  state TypeChosen {
    ByGenre: By genre (default)<br/>genre chips of this type
    TopRated: Top rated grid<br/>[some item rated]
    AToZ: A–Z grid
    GenreGrid: One genre grid
    ByGenre --> TopRated: pick Top rated
    ByGenre --> AToZ: pick A–Z
    TopRated --> ByGenre: pick By genre
    TopRated --> AToZ: pick A–Z
    AToZ --> ByGenre: pick By genre
    AToZ --> TopRated: pick Top rated
    ByGenre --> GenreGrid: pick a genre chip
    GenreGrid --> ByGenre: pick the same chip again
    GenreGrid --> GenreGrid: pick another chip
  }
  TypeChosen --> ByGenre: pick another type (view and genre reset)
  TypeChosen --> Home: pick All
```

## Notes

- Guards: a type tab exists only if the type has items; *Top rated* only if one of its
  items is rated; genre chips list only the genres of the chosen type.
- Implemented by the pure reducer `catalog/view-state.ts`; leaving a view clears `genre`.
