/**
 * Backward-compatible facade over the design system in ./ui/ (see
 * ./ui/README.md). Older pages import Button/Card/TextField/... from here; new
 * code imports from './ui/index.js' directly.
 */
import { useId } from 'react';
import ButtonBase from './ui/Button';
import { Card as CardBase } from './ui/Card';
import { Input, Textarea, Select as SelectBase, Field } from './ui/Form';

export { StatusBadge } from './ui/Badge';

export function Card({ className = '', children, ...props }) {
  return <CardBase className={className} {...props}>{children}</CardBase>;
}

export function Button({ variant = 'primary', size = 'md', ...props }) {
  return <ButtonBase variant={variant} size={size} {...props} />;
}

export function TextField({ label, help, error, className = '', id, ...props }) {
  const autoId = useId();
  const inputId = id || autoId;
  const input = <Input id={inputId} className={className} invalid={Boolean(error)} {...props} />;
  if (!label && !help && !error) return input;
  return <Field label={label} help={help} error={error} htmlFor={inputId} required={props.required}>{input}</Field>;
}

export function TextArea({ label, help, className = '', id, ...props }) {
  const autoId = useId();
  const inputId = id || autoId;
  const input = <Textarea id={inputId} className={className} {...props} />;
  if (!label && !help) return input;
  return <Field label={label} help={help} htmlFor={inputId}>{input}</Field>;
}

export function Select({ label, className = '', children, id, ...props }) {
  const autoId = useId();
  const inputId = id || autoId;
  const select = <SelectBase id={inputId} className={className} {...props}>{children}</SelectBase>;
  if (!label) return select;
  return <Field label={label} htmlFor={inputId}>{select}</Field>;
}

export function ErrorText({ children }) {
  if (!children) return null;
  return <p className="text-sm text-danger" role="alert">{children}</p>;
}
