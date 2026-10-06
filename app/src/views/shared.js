import { h } from '../dom.js';
import { state, byId } from '../store.js';
import { standing, formatDate, dueLabel } from '../domain/due.js';

export function customerAddress(c, asm) {
  const street = (asm && asm.serviceAddress) || c?.address || '';
  return [street, c?.city, c?.state].filter(Boolean).join(', ');
}

export function deviceLine(a) {
  return [a.type, a.size, a.make, a.model].filter(Boolean).join(' ') + (a.serial ? ` #${a.serial}` : '');
}

export function assemblyStanding(a) {
  const tests = state.tests.filter((t) => t.assemblyId === a.id);
  return standing(a, tests, state.settings.rules);
}

/** The hanging-tag card used wherever an assembly's due date is shown. */
export function tagCard(a, s, { actions = [], href } = {}) {
  const c = byId('customers', a.customerId);
  const big = s.status === 'untested' ? 'New' : s.status === 'failed' ? 'Failed' : shortDate(s.due);
  const year = s.due && s.status !== 'failed' ? s.due.slice(0, 4) : '';
  const body = h(href ? 'a' : 'div', { class: 'tag-body', href },
    h('div', { class: 'tag-date' }, h('strong', null, big), year ? h('span', null, year) : null),
    h('div', { class: 'tag-info' },
      h('p', { class: 'tag-status' }, dueLabel(s)),
      h('p', { class: 'tag-name' }, c ? c.name : 'Unknown customer'),
      h('p', { class: 'tag-meta' }, customerAddress(c, a)),
      h('p', { class: 'tag-meta' }, deviceLine(a), a.location ? `, ${a.location}` : '')));
  return h('li', { class: `tag ${s.status}` },
    h('span', { class: 'eyelet', 'aria-hidden': 'true' }),
    body,
    actions.length ? h('div', { class: 'tag-actions' }, actions) : null);
}

function shortDate(iso) {
  const full = formatDate(iso);
  return full ? full.split(',')[0] : '';
}

export function backLink(href, label) {
  return h('a', { class: 'back', href }, '‹ ' + label);
}

export function resultBadge(result) {
  const label = result === 'pass' ? 'Passed' : result === 'fail' ? 'Failed' : 'Incomplete';
  return h('span', { class: 'badge ' + result }, label);
}

export function emptyState(title, text, ...actions) {
  return h('div', { class: 'empty' }, h('h2', null, title), h('p', null, text), h('div', { class: 'row' }, actions));
}

/** The rules a saved report was evaluated under. A signed report must never change because settings did. */
export function rulesFor(test) {
  return test && test.rules ? test.rules : state.settings.rules;
}
