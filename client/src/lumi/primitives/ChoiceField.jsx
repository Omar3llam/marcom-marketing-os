// ============================================================
// CheckboxField · RadioGroup — choices
// ------------------------------------------------------------
// Native inputs, so keyboard behaviour, form participation and assistive
// technology support are the platform's, not a re-implementation. The whole
// label is the target, which carries the control past the 24px minimum
// (WCAG 2.5.8). Selection is marked with `interaction.selected.indicator`.
//
// Justified by use: 3 checkboxes and 2 radio groups in the shipping client.
// Switch and Tabs are NOT built: 0 switches and 1 tab list exist, so neither
// passes CMP-01's "at least two consumers" rule (PHASE_3_PRIMITIVE_AUDIT.md).
// ============================================================
import { assertOneOf, assertProps, assertText } from '../contract.js';
import { useGround } from './Environment.jsx';
import { FieldDescription, FieldMessages, useFieldParts } from './FieldParts.jsx';
import css from './controls.module.css';

export function CheckboxField(props) {
  assertProps('CheckboxField', props, ['label', 'description', 'disabledReason', 'checked', 'onCheckedChange', 'name', 'id']);
  const { label, description, disabledReason, checked, onCheckedChange, name, id, ...aria } = props;
  useGround('CheckboxField');
  const { ids, describedBy, disabled } = useFieldParts('CheckboxField', props);
  assertOneOf('CheckboxField', 'checked', checked, [true, false]);
  if (typeof onCheckedChange !== 'function') throw new Error('CheckboxField: onCheckedChange is required.');

  return (
    <div className={css.field}>
      <label className={css.choice} aria-disabled={disabled ? 'true' : undefined}>
        <input
          {...aria}
          id={id ?? ids.control}
          type="checkbox"
          name={name}
          checked={checked}
          aria-disabled={disabled ? 'true' : undefined}
          aria-describedby={describedBy}
          onChange={(event) => { if (!disabled) onCheckedChange(event.target.checked); }}
          className={css.choiceInput}
        />
        {label}
      </label>
      <FieldDescription id={ids.description}>{description}</FieldDescription>
      <FieldMessages ids={ids} disabledReason={disabledReason} />
    </div>
  );
}

export function RadioGroup(props) {
  assertProps('RadioGroup', props, ['label', 'description', 'disabledReason', 'name', 'options', 'value', 'onValueChange']);
  const { label, description, disabledReason, name, options, value, onValueChange } = props;
  useGround('RadioGroup');
  const { ids, describedBy, disabled } = useFieldParts('RadioGroup', props);
  assertText('RadioGroup', 'name', name);
  if (!Array.isArray(options) || options.length < 2) {
    throw new Error('RadioGroup: a choice needs at least two options of { value, label }.');
  }
  if (value !== null) assertOneOf('RadioGroup', 'value', value, options.map((option) => option.value));
  if (typeof onValueChange !== 'function') throw new Error('RadioGroup: onValueChange is required.');

  return (
    <fieldset className={css.field} aria-describedby={describedBy} aria-disabled={disabled ? 'true' : undefined}>
      <legend className={css.fieldLabel}>{label}</legend>
      <FieldDescription id={ids.description}>{description}</FieldDescription>
      <div className={css.choices}>
        {options.map((option) => (
          <label key={option.value} className={css.choice} aria-disabled={disabled ? 'true' : undefined}>
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={value === option.value}
              aria-disabled={disabled ? 'true' : undefined}
              onChange={() => { if (!disabled) onValueChange(option.value); }}
              className={css.choiceInput}
            />
            {option.label}
          </label>
        ))}
      </div>
      <FieldMessages ids={ids} disabledReason={disabledReason} />
    </fieldset>
  );
}
