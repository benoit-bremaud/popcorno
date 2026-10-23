import type { Media } from '@popcorno/shared';
import type { Row } from './catalog.js';
import { PosterCard } from './PosterCard.js';

/** Rows below this one enter together: the cascade stays short. */
const MAX_STAGGERED = 6;

type Props = {
  readonly row: Row;
  /** Position on the page; drives the entrance stagger. */
  readonly index?: number;
  readonly onOpen: (item: Media, trigger: HTMLElement) => void;
};

/** A titled horizontal shelf of posters. */
export function PosterRow({ row, index = 0, onOpen }: Props): React.JSX.Element {
  const headingId = `row-${row.key}`;
  return (
    <section
      className="row"
      aria-labelledby={headingId}
      style={{ animationDelay: `calc(${Math.min(index, MAX_STAGGERED)} * var(--stagger))` }}
    >
      <h2 className="row__title" id={headingId}>
        {row.title}
      </h2>
      <ul className="row__track">
        {row.items.map((item) => (
          <li key={item.id}>
            <PosterCard item={item} onOpen={onOpen} />
          </li>
        ))}
      </ul>
    </section>
  );
}
