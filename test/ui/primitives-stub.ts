// Stand-in for @deepseek-ai/dsh-client-ui-primitives in the server-rendered card test. The Host's components are not what the
// test is about; what the stubs keep faithful is what the card decides and what a person (or a test) can observe of it:
//   - Switch is a labelled checkbox with role=switch, so its state and accessible name are real;
//   - Button passes its attributes through; Tag is a span carrying its tone;
//   - Modal renders its children (and the footer) in place, only while it is open, with role=dialog and its title as the accessible name;
//   - Tooltip puts its label in a `title`, so a test can read what the `?` button would say.
import { Children, cloneElement, createElement, forwardRef, isValidElement, type ReactElement, type ReactNode } from 'react'

export const Button = forwardRef<HTMLButtonElement, Record<string, unknown>>(function Button({ variant, size, icon, children, ...rest }, ref) {
  void icon
  return createElement('button', { ref, 'data-variant': variant, 'data-size': size, ...rest }, children as ReactNode)
})
export const Switch = (props: { checked: boolean; onChange: (next: boolean) => void; label: string; disabled?: boolean }) =>
  createElement('input', { type: 'checkbox', role: 'switch', 'aria-label': props.label, checked: props.checked, disabled: props.disabled, onChange: (event: { currentTarget: HTMLInputElement }) => props.onChange(event.currentTarget.checked) })
export const Tag = (props: { tone?: string; children?: ReactNode }) => createElement('span', { 'data-tag': props.tone ?? 'outline' }, props.children)
export const Tooltip = (props: { label: string | (() => string); children: ReactElement }) => {
  const only = Children.only(props.children)
  return isValidElement(only) ? cloneElement(only as ReactElement<Record<string, unknown>>, { title: typeof props.label === 'function' ? props.label() : props.label }) : only
}
export const Modal = (props: { open: boolean; onClose: () => void; title: string; closeLabel?: string; description?: string; children?: ReactNode; footer?: ReactNode; className?: string }) =>
  props.open
    ? createElement('div', { role: 'dialog', 'aria-modal': true, 'aria-label': props.title, className: props.className },
      createElement('h2', null, props.title),
      createElement('button', { type: 'button', 'aria-label': props.closeLabel, onClick: props.onClose }, '×'),
      props.description ? createElement('p', null, props.description) : null,
      createElement('div', null, props.children),
      props.footer ? createElement('div', null, props.footer) : null)
    : null
