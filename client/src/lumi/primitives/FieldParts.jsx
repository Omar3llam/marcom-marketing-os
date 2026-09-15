// ============================================================
// Field parts — the label, description and messages every field shares
// ------------------------------------------------------------
// A field always has a visible label (never a placeholder standing in for one),
// and every message it shows is linked to the control by aria-describedby, so
// what is drawn is also what is announced.
//
// An invalid value is stated in words beside an alert glyph, not by a colour:
// the FAILED state tokens belong to a failed read or mutation, and borrowing
// them for form validation would let one state restyle another
// (DESIGN_TOKEN_ARCHITECTURE.md §4.3).
// ============================================================
import { useId } from 'react';
import { AlertCircle } from 'lucide-react';
import { assertText } from '../contract.js';
import { Icon } from './Icon.jsx';
import controls from './controls.module.css';
import css from './fields.module.css';

/** Validates and wires the shared field props. Call it at the top of a field. */
export function useFieldParts(component, { label, description, invalidReason, disabledReason }) {
  assertText(component, 'label', label);
  if (description !== undefined) assertText(component, 'description', description);
  if (invalidReason !== undefined) assertText(component, 'invalidReason', invalidReason);
  if (disabledReason !== undefined) assertText(component, 'disabledReason', disabledReason);

  const base = useId();
  const ids = {
    control: `${base}-control`,
    description: description !== undefined ? `${base}-description` : undefined,
    invalid: invalidReason !== undefined ? `${base}-invalid` : undefined,
    disabled: disabledReason !== undefined ? `${base}-disabled` : undefined,
  };
  const describedBy = [ids.description, ids.invalid, ids.disabled].filter(Boolean).join(' ') || undefined;
  return { ids, describedBy, disabled: disabledReason !== undefined, invalid: invalidReason !== undefined };
}

export function FieldDescription({ id, children }) {
  if (!id) return null;
  return <p id={id} className={css.fieldDescription}>{children}</p>;
}

export function FieldMessages({ ids, invalidReason, disabledReason }) {
  return (
    <>
      {ids.invalid && (
        <p id={ids.invalid} className={css.fieldInvalid}>
          <Icon glyph={AlertCircle} size="inline" />
          {invalidReason}
        </p>
      )}
      {ids.disabled && <p id={ids.disabled} className={controls.reason}>{disabledReason}</p>}
    </>
  );
}
