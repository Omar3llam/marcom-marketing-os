// ============================================================
// TextField · SelectField — labelled single-value inputs
// ------------------------------------------------------------
// Justified by use, not by habit: 65 text inputs across 30 files and 19
// selects across 11 files in the shipping client (PHASE_3_PRIMITIVE_AUDIT.md).
//
// A disabled field is `aria-disabled` and read-only rather than `disabled`, so
// it stays focusable and its reason is announced (STATE_RULES.md §18).
//
// SelectField never falls back to its first option: a value that is not one
// of the options is refused, because a silently substituted choice is a value
// the operator never picked.
// ============================================================
import { assertOneOf, assertProps } from '../contract.js';
import { useGround } from './Environment.jsx';
import { FieldDescription, FieldMessages, useFieldParts } from './FieldParts.jsx';
import css from './fields.module.css';

const FIELD_PROPS = ['label', 'description', 'invalidReason', 'disabledReason', 'required', 'name', 'id'];

export function TextField(props) {
  assertProps('TextField', props, [...FIELD_PROPS, 'value', 'onValueChange', 'type', 'multiline', 'autoComplete']);
  const { label, description, invalidReason, disabledReason, required = false, name, id, value, onValueChange,
    type = 'text', multiline = false, autoComplete, ...aria } = props;
  useGround('TextField');
  const { ids, describedBy, disabled, invalid } = useFieldParts('TextField', props);
  assertOneOf('TextField', 'type', type, ['text', 'email', 'url', 'search', 'password', 'number']);
  assertOneOf('TextField', 'multiline', multiline, [true, false]);
  if (multiline && type !== 'text') throw new Error('TextField: a multiline field is plain text.');
  if (typeof value !== 'string') throw new Error('TextField: value must be a string (controlled).');
  if (typeof onValueChange !== 'function') throw new Error('TextField: onValueChange is required.');

  const controlProps = {
    ...aria,
    id: id ?? ids.control,
    name,
    value,
    required,
    autoComplete,
    readOnly: disabled || undefined,
    'aria-disabled': disabled ? 'true' : undefined,
    'aria-invalid': invalid ? 'true' : undefined,
    'aria-describedby': describedBy,
    onChange: (event) => { if (!disabled) onValueChange(event.target.value); },
    className: css.input,
  };

  return (
    <div className={css.field}>
      <label htmlFor={controlProps.id} className={css.fieldLabel}>{label}</label>
      <FieldDescription id={ids.description}>{description}</FieldDescription>
      {multiline ? <textarea {...controlProps} /> : <input {...controlProps} type={type} />}
      <FieldMessages ids={ids} invalidReason={invalidReason} disabledReason={disabledReason} />
    </div>
  );
}

export function SelectField(props) {
  assertProps('SelectField', props, [...FIELD_PROPS, 'value', 'onValueChange', 'options', 'unsetLabel']);
  const { label, description, invalidReason, disabledReason, required = false, name, id, value, onValueChange,
    options, unsetLabel, ...aria } = props;
  useGround('SelectField');
  const { ids, describedBy, disabled, invalid } = useFieldParts('SelectField', props);
  if (!Array.isArray(options) || options.length === 0) {
    throw new Error('SelectField: options must be a non-empty list of { value, label }.');
  }
  const values = options.map((option) => option.value);
  if (value === '') {
    if (unsetLabel === undefined) throw new Error('SelectField: an unset value needs an unsetLabel naming what is unchosen.');
  } else {
    assertOneOf('SelectField', 'value', value, values);
  }
  if (typeof onValueChange !== 'function') throw new Error('SelectField: onValueChange is required.');

  return (
    <div className={css.field}>
      <label htmlFor={id ?? ids.control} className={css.fieldLabel}>{label}</label>
      <FieldDescription id={ids.description}>{description}</FieldDescription>
      <select
        {...aria}
        id={id ?? ids.control}
        name={name}
        value={value}
        required={required}
        aria-disabled={disabled ? 'true' : undefined}
        aria-invalid={invalid ? 'true' : undefined}
        aria-describedby={describedBy}
        onChange={(event) => { if (!disabled) onValueChange(event.target.value); }}
        className={css.input}
      >
        {value === '' && <option value="" disabled>{unsetLabel}</option>}
        {options.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
      <FieldMessages ids={ids} invalidReason={invalidReason} disabledReason={disabledReason} />
    </div>
  );
}
