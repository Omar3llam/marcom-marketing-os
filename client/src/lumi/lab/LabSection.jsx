// LUMI Primitive Lab — one review section: a heading, what to look for, then the examples.
import { Heading, Stack, Text } from '../index.js';
import lab from './lab.module.css';

export function LabSection({ id, title, note, children }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className={lab.section}>
      <Stack gap="object">
        <Stack gap="inline">
          <Heading level={2} variant="surface" id={`${id}-title`}>{title}</Heading>
          {note && <Text variant="caption" as="p">{note}</Text>}
        </Stack>
        {children}
      </Stack>
    </section>
  );
}

/** A labelled review cell inside a wrapping grid. */
export function LabCell({ label, children }) {
  return (
    <li className={lab.cell}>
      <Stack gap="meta">
        <Text variant="identifier" as="p">{label}</Text>
        {children}
      </Stack>
    </li>
  );
}

export function LabGrid({ children }) {
  return <ul className={lab.grid}>{children}</ul>;
}
