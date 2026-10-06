import { h, field, toast, confirmDialog, phoneDigits, mailAddress } from '../dom.js';
import { state, byId, put, remove } from '../store.js';
import { ASSEMBLY_TYPES } from '../domain/rules.js';
import { compareStanding, formatDate, isISODate } from '../domain/due.js';
import { navigate, rerender } from '../nav.js';
import { tagCard, assemblyStanding, backLink, resultBadge, emptyState, deviceLine } from './shared.js';

let query = '';

export function customersView() {
  const q = query.trim().toLowerCase();
  const list = [...state.customers]
    .filter((c) => !q || [c.name, c.contact, c.address, c.city, c.email, c.phone].some((v) => v && v.toLowerCase().includes(q)))
    .sort((a, b) => a.name.localeCompare(b.name));
  const search = h('input', { type: 'search', placeholder: 'Search customers', 'aria-label': 'Search customers', value: query });
  search.addEventListener('input', () => {
    query = search.value;
    const pos = search.selectionStart;
    rerender();
    const again = document.querySelector('.searchbar input');
    if (again) { again.focus(); again.setSelectionRange(pos, pos); }
  });
  return h('section', null,
    h('div', { class: 'row between' }, h('h1', null, 'Customers'), h('a', { class: 'btn primary', href: '#/customer/new' }, 'Add a customer')),
    state.customers.length ? h('div', { class: 'searchbar' }, search) : null,
    !state.customers.length
      ? emptyState('No customers yet', 'Add one by hand, or import the list you already have.',
        h('a', { class: 'btn', href: '#/settings/data' }, 'Import a spreadsheet'))
      : list.length
        ? h('ul', { class: 'rows' }, list.map((c) => {
          const n = state.assemblies.filter((a) => a.customerId === c.id && a.active !== false).length;
          return h('li', null, h('a', { href: `#/customer/${c.id}` },
            h('span', { class: 'row-main' }, c.name),
            h('span', { class: 'row-sub' }, [c.address, c.city].filter(Boolean).join(', ')),
            h('span', { class: 'row-count' }, n === 1 ? '1 assembly' : `${n} assemblies`)));
        }))
        : h('p', { class: 'quiet' }, 'No customers match that search.'));
}

export function customerView(id) {
  const c = byId('customers', id);
  if (!c) return missing('That customer is no longer here.', '#/customers', 'Customers');
  const rows = state.assemblies.filter((a) => a.customerId === id).map((a) => ({ a, s: assemblyStanding(a) }));
  rows.sort((x, y) => compareStanding(x.s, y.s));
  return h('section', null,
    backLink('#/customers', 'Customers'),
    h('div', { class: 'row between' }, h('h1', null, c.name), h('a', { class: 'btn small', href: `#/customer/${id}/edit` }, 'Edit')),
    h('dl', { class: 'facts' },
      fact('Contact', c.contact),
      fact('Phone', c.phone, phoneDigits(c.phone) ? `tel:${phoneDigits(c.phone)}` : null),
      fact('Email', c.email, c.email ? `mailto:${mailAddress(c.email)}` : null),
      fact('Address', [c.address, c.city, c.state, c.zip].filter(Boolean).join(', ')),
      fact('Notes', c.notes)),
    h('div', { class: 'row between' }, h('h2', null, 'Assemblies'), h('a', { class: 'btn primary small', href: `#/assembly/new/${id}` }, 'Add an assembly')),
    rows.length
      ? h('ul', { class: 'tags' }, rows.map(({ a, s }) => tagCard(a, s, {
        href: `#/assembly/${a.id}`,
        actions: a.active === false ? [h('span', { class: 'quiet' }, 'Removed from service')] : [h('a', { class: 'btn primary small', href: `#/test/new/${a.id}` }, 'Start test')],
      })))
      : h('p', { class: 'quiet' }, 'No assemblies on file for this customer yet.'));
}

function fact(label, value, href) {
  if (!value) return null;
  return [h('dt', null, label), h('dd', null, href ? h('a', { href }, value) : value)];
}

function missing(text, href, label) {
  return h('section', null, backLink(href, label), h('p', null, text));
}

export function customerEditView(id) {
  const existing = id ? byId('customers', id) : null;
  if (id && !existing) return missing('That customer is no longer here.', '#/customers', 'Customers');
  const c = existing ? { ...existing } : { name: '', contact: '', email: '', phone: '', address: '', city: '', state: '', zip: '', notes: '' };
  const error = h('p', { class: 'form-error', role: 'alert' });
  const save = async (e) => {
    e.preventDefault();
    c.name = c.name.trim();
    if (!c.name) { error.textContent = 'Enter the customer or business name.'; return; }
    if (c.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c.email.trim())) { error.textContent = 'That email address does not look right.'; return; }
    c.email = (c.email || '').trim();
    const saved = await put('customers', c);
    toast('Customer saved');
    navigate(existing ? `/customer/${saved.id}` : `/assembly/new/${saved.id}`);
  };
  return h('section', null,
    backLink(existing ? `#/customer/${id}` : '#/customers', existing ? existing.name : 'Customers'),
    h('h1', null, existing ? 'Edit customer' : 'Add a customer'),
    h('form', { onSubmit: save, novalidate: true },
      field('Customer or business name', c, 'name', { required: true, autocomplete: 'organization' }),
      field('Contact person', c, 'contact', { optional: true }),
      h('div', { class: 'grid2' },
        field('Phone', c, 'phone', { type: 'tel', optional: true }),
        field('Email', c, 'email', { type: 'email', optional: true, hint: 'Used for test-due reminders.' })),
      field('Street address', c, 'address', { optional: true }),
      h('div', { class: 'grid3' },
        field('City', c, 'city', { optional: true }),
        field('State', c, 'state', { optional: true, maxlength: 2 }),
        field('ZIP', c, 'zip', { optional: true, inputmode: 'numeric' })),
      field('Notes', c, 'notes', { multiline: true, optional: true, placeholder: 'Gate code, access hours, who to ask for' }),
      error,
      h('div', { class: 'row' },
        h('button', { class: 'btn primary', type: 'submit' }, existing ? 'Save customer' : 'Save and add an assembly'),
        existing ? h('button', {
          class: 'btn danger ghost', type: 'button',
          onClick: async () => {
            const asm = state.assemblies.filter((a) => a.customerId === id);
            const tests = state.tests.filter((t) => asm.some((a) => a.id === t.assemblyId));
            if (tests.length) {
              await confirmDialog({ title: 'This customer has test reports', body: `${tests.length} saved ${tests.length === 1 ? 'report belongs' : 'reports belong'} to this customer. Records must be kept, so the customer cannot be deleted. Mark their assemblies as removed from service instead.`, confirm: 'OK' });
              return;
            }
            if (!(await confirmDialog({ title: `Delete ${existing.name}?`, body: asm.length ? `Their ${asm.length === 1 ? 'assembly' : asm.length + ' assemblies'} will be deleted too.` : '', confirm: 'Delete customer', danger: true }))) return;
            for (const a of asm) await remove('assemblies', a.id);
            await remove('customers', id);
            toast('Customer deleted');
            navigate('/customers');
          },
        }, 'Delete customer') : null)));
}

export function assemblyView(id) {
  const a = byId('assemblies', id);
  if (!a) return missing('That assembly is no longer here.', '#/customers', 'Customers');
  const c = byId('customers', a.customerId);
  const s = assemblyStanding(a);
  const tests = state.tests.filter((t) => t.assemblyId === id).sort((x, y) => (x.date < y.date ? 1 : x.date > y.date ? -1 : (y.createdAt || 0) - (x.createdAt || 0)));
  return h('section', null,
    backLink(`#/customer/${a.customerId}`, c ? c.name : 'Customer'),
    h('div', { class: 'row between' }, h('h1', null, deviceLine(a)), h('a', { class: 'btn small', href: `#/assembly/${id}/edit` }, 'Edit')),
    h('ul', { class: 'tags' }, tagCard(a, s, {
      actions: a.active === false ? [h('span', { class: 'quiet' }, 'Removed from service')] : [h('a', { class: 'btn primary', href: `#/test/new/${id}` }, s.status === 'failed' ? 'Retest' : 'Start test')],
    })),
    h('dl', { class: 'facts' },
      fact('Location', a.location),
      fact('Service address', a.serviceAddress),
      fact('Serves', a.serves),
      fact('Hazard', a.hazard),
      fact('Water system', a.purveyor),
      fact('Account', a.account),
      fact('Installed', formatDate(a.installed)),
      fact('Test interval', a.intervalMonths ? `${a.intervalMonths} months` : ''),
      fact('Last test on import', formatDate(a.lastTestedImported)),
      fact('Bypass', [a.bypassMake, a.bypassModel, a.bypassSize, a.bypassSerial ? '#' + a.bypassSerial : ''].filter(Boolean).join(' '))),
    h('h2', null, 'Test history'),
    tests.length
      ? h('ul', { class: 'rows' }, tests.map((t) => h('li', null, h('a', { href: `#/report/${t.id}` },
        h('span', { class: 'row-main' }, formatDate(t.date)),
        h('span', { class: 'row-sub' }, [t.reason, t.snapshot?.tester?.name].filter(Boolean).join(', ')),
        resultBadge(t.result)))))
      : h('p', { class: 'quiet' }, 'No tests recorded in TagDue yet.'));
}

export function assemblyEditView(id, customerId) {
  const existing = id ? byId('assemblies', id) : null;
  if (id && !existing) return missing('That assembly is no longer here.', '#/customers', 'Customers');
  const custId = existing ? existing.customerId : customerId;
  const c = byId('customers', custId);
  if (!c) return missing('That customer is no longer here.', '#/customers', 'Customers');
  const previous = state.assemblies.filter((x) => x.customerId === custId).slice(-1)[0];
  const a = existing ? { ...existing } : {
    customerId: custId, type: 'RP', make: '', model: '', serial: '', size: '', location: '', serviceAddress: '',
    serves: '', hazard: '', purveyor: previous?.purveyor || '', account: previous?.account || '',
    installed: '', intervalMonths: '', lastTestedImported: '', bypassMake: '', bypassModel: '', bypassSize: '', bypassSerial: '', active: true,
  };
  const error = h('p', { class: 'form-error', role: 'alert' });
  const bypass = h('div', { class: 'grid2' },
    field('Bypass manufacturer', a, 'bypassMake', { optional: true }),
    field('Bypass model', a, 'bypassModel', { optional: true }),
    field('Bypass size', a, 'bypassSize', { optional: true }),
    field('Bypass serial number', a, 'bypassSerial', { optional: true }));
  const bypassWrap = h('fieldset', { hidden: !/DA/.test(a.type) }, h('legend', null, 'Bypass assembly'), bypass);
  const save = async (e) => {
    e.preventDefault();
    for (const k of ['installed', 'lastTestedImported']) {
      if (a[k] && !isISODate(a[k])) { error.textContent = 'One of the dates is not a real date.'; return; }
    }
    if (a.intervalMonths !== '' && a.intervalMonths != null && !(Number.isInteger(Number(a.intervalMonths)) && Number(a.intervalMonths) > 0 && Number(a.intervalMonths) <= 120)) {
      error.textContent = 'The test interval must be a whole number of months from 1 to 120, or blank to use your default.'; return;
    }
    const dup = a.serial && state.assemblies.find((x) => x.id !== a.id && x.serial && x.serial.trim().toLowerCase() === a.serial.trim().toLowerCase() && (x.make || '').toLowerCase() === (a.make || '').toLowerCase());
    if (dup && !(await confirmDialog({ title: 'That serial number is already on file', body: `${deviceLine(dup)} at ${byId('customers', dup.customerId)?.name || 'another customer'} has the same serial number. Save anyway?`, confirm: 'Save anyway' }))) return;
    const saved = await put('assemblies', a);
    toast('Assembly saved');
    navigate(`/assembly/${saved.id}`);
  };
  return h('section', null,
    backLink(existing ? `#/assembly/${id}` : `#/customer/${custId}`, existing ? 'Assembly' : c.name),
    h('h1', null, existing ? 'Edit assembly' : `Add an assembly for ${c.name}`),
    h('form', { onSubmit: save, novalidate: true },
      field('Assembly type', a, 'type', { options: ASSEMBLY_TYPES.map((t) => [t.code, t.name]), onChange: (v) => { bypassWrap.hidden = !/DA/.test(v); } }),
      h('div', { class: 'grid2' },
        field('Manufacturer', a, 'make', { placeholder: 'Watts, Febco, Wilkins' }),
        field('Model', a, 'model'),
        field('Serial number', a, 'serial'),
        field('Size', a, 'size', { placeholder: '3/4 in, 2 in' })),
      bypassWrap,
      field('Where it is on the property', a, 'location', { placeholder: 'North wall of mechanical room' }),
      field('Service address, if different from the customer address', a, 'serviceAddress', { optional: true }),
      h('div', { class: 'grid2' },
        field('Serves', a, 'serves', { optional: true, placeholder: 'Irrigation, domestic, fire line' }),
        field('Hazard', a, 'hazard', { optional: true, options: [['', 'Not recorded'], 'Low (non-health)', 'High (health)'] }),
        field('Water system', a, 'purveyor', { optional: true, placeholder: 'City water department' }),
        field('Account or customer number', a, 'account', { optional: true })),
      h('div', { class: 'grid3' },
        field('Installed', a, 'installed', { type: 'date', optional: true }),
        field('Last tested before TagDue', a, 'lastTestedImported', { type: 'date', optional: true, hint: 'Sets the first due date.' }),
        field('Test every (months)', a, 'intervalMonths', { optional: true, inputmode: 'numeric', placeholder: String(state.settings.rules.intervalMonths) })),
      existing ? h('label', { class: 'check' },
        h('input', { type: 'checkbox', checked: a.active === false, onChange: (e) => { a.active = !e.currentTarget.checked; } }),
        'Removed from service. Keep the history, stop tracking due dates.') : null,
      error,
      h('div', { class: 'row' },
        h('button', { class: 'btn primary', type: 'submit' }, 'Save assembly'),
        existing && !state.tests.some((t) => t.assemblyId === id) ? h('button', {
          class: 'btn danger ghost', type: 'button',
          onClick: async () => {
            if (!(await confirmDialog({ title: 'Delete this assembly?', body: 'It has no test reports, so nothing else is lost.', confirm: 'Delete assembly', danger: true }))) return;
            await remove('assemblies', id);
            toast('Assembly deleted');
            navigate(`/customer/${custId}`);
          },
        }, 'Delete assembly') : null)));
}
