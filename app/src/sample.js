// Sample records for trying the app. Every name and address is invented.
import { state, putMany, saveSettings, newId } from './store.js';
import { addMonthsISO } from './domain/rules.js';
import { todayISO } from './domain/due.js';

function shift(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return todayISO(d);
}

export async function loadSampleData() {
  const C = (name, contact, email, phone, address, city) => ({ id: newId(), name, contact, email, phone, address, city, state: 'TX', zip: '', notes: '', sample: true });
  const customers = [
    C('Cedar Hollow Dental', 'Office manager', 'office@cedarhollow.example', '(512) 555-0142', '1180 Cedar Hollow Rd', 'Round Rock'),
    C('Bluebonnet Car Wash', 'Owner', 'hello@bluebonnetwash.example', '(512) 555-0177', '402 Ranch Road 12', 'Georgetown'),
    C('Mesa Verde HOA', 'Property manager', 'manager@mesaverdehoa.example', '(512) 555-0109', '9 Mesa Verde Loop', 'Leander'),
    C('Northside Elementary', 'Facilities', 'facilities@northside.example', '(512) 555-0163', '75 School House Ln', 'Hutto'),
    C('Pecan Street Bakery', 'Owner', 'orders@pecanstreet.example', '(512) 555-0121', '310 Pecan St', 'Pflugerville'),
  ];
  const A = (ci, type, make, model, serial, size, location, serves, lastTest, extra = {}) => ({
    id: newId(), customerId: customers[ci].id, type, make, model, serial, size, location, serves,
    hazard: type === 'RP' ? 'High (health)' : 'Low (non-health)', purveyor: 'City water utilities', account: String(204000 + ci * 37),
    installed: '', intervalMonths: '', lastTestedImported: lastTest, serviceAddress: '', active: true, sample: true, ...extra,
  });
  const yearAgo = (daysFromDue) => addMonthsISO(shift(daysFromDue), -12);
  const assemblies = [
    A(0, 'RP', 'Watts', '009M2', 'A148822', '3/4 in', 'Mechanical closet, behind water heater', 'Dental equipment', yearAgo(-9)),
    A(1, 'RP', 'Wilkins', '975XL2', 'W5530917', '2 in', 'Equipment room, east wall', 'Wash bay chemical feed', yearAgo(12)),
    A(1, 'PVB', 'Febco', '765', 'F220418', '1 in', 'Outside, north fence line', 'Irrigation', yearAgo(26)),
    A(2, 'DC', 'Zurn', '350', 'Z771203', '1 1/2 in', 'Entrance island, green box', 'Irrigation', yearAgo(44)),
    A(2, 'DC', 'Zurn', '350', 'Z771204', '1 1/2 in', 'Pool house, south side', 'Irrigation', yearAgo(44)),
    A(3, 'DCDA', 'Ames', '3000SS', 'AM90311', '6 in', 'Fire riser room', 'Fire line', yearAgo(120), { bypassMake: 'Ames', bypassModel: '2000B', bypassSize: '3/4 in', bypassSerial: 'AM90311-B' }),
    A(4, 'RP', 'Watts', 'LF009', 'A201775', '1 in', 'Kitchen, under prep sink', 'Dish machine', ''),
  ];
  await putMany('customers', customers);
  await putMany('assemblies', assemblies);
  if (!state.testers.length) await putMany('testers', [{ id: newId(), name: 'Sample Tester', certNo: 'BP0012345', certBody: 'TCEQ BPAT', certExpires: shift(400), sample: true }]);
  if (!state.gauges.length) await putMany('gauges', [{ id: newId(), make: 'Mid-West', model: '845-5', serial: '08221764', verified: shift(-90), sample: true }]);
  if (!state.settings.company.name) {
    state.settings.company = { name: 'Sample Backflow Testing', address: '100 Example Way', cityStateZip: 'Round Rock, TX', phone: '(512) 555-0100', email: 'office@samplebackflow.example', contractorLicense: '' };
    await saveSettings('company');
  }
}
