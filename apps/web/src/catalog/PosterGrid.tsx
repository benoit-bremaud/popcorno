import { useId } from 'react';
import type { Media } from '@popcorntv/shared';
import { PosterCard } from './PosterCard.js';

type Props = {
  readonly title: string;
  readonly items: readonly Media[];
  readonly onOpen: (item: Media, trigger: HTMLElement) => void;
};

/** A titled wrapping grid of posters. */
export function PosterGrid({ title, items, onOpen }: Props): React.JSX.Element {
  const headingId = useId();
  return (
    <section className="grid" aria-labelledby={headingId}>
      <h2 className="row__title" id={headingId}>
        {title}
      </h2>
      <ul className="grid__items">
        {items.map((item) => (
          <li key={item.id}>
            <PosterCard item={item} onOpen={onOpen} />
          </li>
        ))}
      </ul>
    </section>
  );
}
