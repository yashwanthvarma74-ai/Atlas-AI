import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DATA_DIR, type CorpusFile, type Dataset, type Question } from './dataset';
import { pick, rng, shuffled } from './rng';

// Builds the benchmark: a corpus of 30 short operations documents with 720 facts, and 276 questions about
// them. The text is generated from templates, which is stated plainly because it matters: it is a fair test of
// whether retrieval can tell near-identical sentences apart and find the right page, and it is not a test of
// how well a system reads real, messy documents. Real documents belong in the set when someone brings them.

const SEED = 20261103;

const CITIES =
  'Berlin Lisbon Osaka Toronto Nairobi Lima Oslo Seoul Dublin Cairo Hanoi Prague Quito Tunis Vienna Warsaw Accra Bogota Riga Perth Austin Denver Leeds Porto Basel Malmo Turin Kyoto Lagos Dhaka'.split(
    ' ',
  );
const QUARTERS = [
  'Q1 2024',
  'Q2 2024',
  'Q3 2024',
  'Q4 2024',
  'Q1 2025',
  'Q2 2025',
  'Q3 2025',
  'Q4 2025',
];

// what is measured, how a question names it in the same words, and in different words
const METRICS = [
  { noun: 'shipping costs', other: 'freight spending' },
  { noun: 'energy consumption', other: 'power usage' },
  { noun: 'support tickets', other: 'customer complaints' },
  { noun: 'staff turnover', other: 'employee attrition' },
  { noun: 'cloud spending', other: 'hosting bills' },
  { noun: 'meeting room bookings', other: 'conference space reservations' },
  { noun: 'travel expenses', other: 'business trip costs' },
  { noun: 'packaging waste', other: 'box refuse' },
  { noun: 'training hours', other: 'learning time' },
  { noun: 'printing volume', other: 'paper output' },
];
const REASONS = [
  'renegotiating the supplier contract',
  'moving to a new building',
  'automating the approval workflow',
  'a regional promotion',
  'changing the opening hours',
  'a new vendor agreement',
  'an internal audit',
  'seasonal demand',
];

const SERVICES =
  'Billing Ledger Catalog Checkout Identity Notifier Reports Search Gateway Scheduler Inventory Pricing Shipping Returns Loyalty Payments Fraud Ratings Recommender Warehouse Courier Invoicing Payroll Onboarding Directory Calendar Messaging Storage Uploads Exports Imports Audit Metrics Alerts Sessions Tokens Profiles Settings Reviews Coupons'.split(
    ' ',
  );
const PEOPLE =
  'Priya Marcus Lena Tomas Amara Jonas Keiko Rafael Ingrid Samuel Noor Viktor Elena Hassan Mei Dmitri Chloe Arjun Sofia Mateo Yara Felix Nia Oskar Lucia Idris Hana Pavel Zara Anders'.split(
    ' ',
  );
const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const VENDORS =
  'Northwind Contoso Fabrikam Initech Hooli Umbrella Globex Soylent Vandelay Stark Wayne Oscorp Aperture Cyberdyne Tyrell Wonka Massive Pied Gringotts Monarch Sterling Dunder Prestige Bluth Krusty Acme Duff Vehement Gekko Waystar Rekall Nakatomi Oceanic Bubba Genco Kitchen Lumon Mondo Zorg Moxie'.split(
    ' ',
  );
const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

interface Fact {
  sentence: string;
  lexical: string;
  paraphrase: string;
}

function facts(random: () => number): Fact[] {
  // family A: a change in a measure at an office in a quarter. 30 offices x 8 quarters x 2 measures = 480
  // facts that are all alike except a few words, which is what makes finding the right one a real test.
  const family: Fact[] = [];
  for (const city of CITIES) {
    for (const quarter of QUARTERS) {
      for (const metric of shuffled(METRICS, random).slice(0, 2)) {
        const up = random() < 0.5;
        const n = 2 + Math.floor(random() * 38);
        family.push({
          sentence: `In ${quarter}, the ${city} office ${up ? 'increased' : 'reduced'} ${metric.noun} by ${n} percent after ${pick(REASONS, random)}.`,
          lexical: `By how much did the ${city} office ${up ? 'increase' : 'reduce'} ${metric.noun} in ${quarter}?`,
          paraphrase: `What was the change in ${metric.other} at the ${city} branch during ${quarter}?`,
        });
      }
    }
  }

  // families B and C: facts about services; D: facts about vendor contracts
  for (const service of SERVICES) {
    family.push(
      {
        sentence: `The ${service} service has a recovery time objective of ${5 + Math.floor(random() * 235)} minutes.`,
        lexical: `What is the recovery time objective of the ${service} service?`,
        paraphrase: `How many minutes may the ${service} platform stay down before it must be restored?`,
      },
      {
        sentence: `The ${service} service keeps its backups for ${7 + Math.floor(random() * 358)} days.`,
        lexical: `How many days does the ${service} service keep its backups?`,
        paraphrase: `For how long are copies of the ${service} system's data retained?`,
      },
      {
        sentence: `${pick(PEOPLE, random)} owns the ${service} runbook.`,
        lexical: `Who owns the ${service} runbook?`,
        paraphrase: `Which person is responsible for the operating guide of the ${service} service?`,
      },
      {
        sentence: `The ${service} on-call engineer is paged every ${pick(WEEKDAYS, random)} at ${1 + Math.floor(random() * 11)} o'clock.`,
        lexical: `When is the ${service} on-call engineer paged?`,
        paraphrase: `At what time of the week is the duty technician for ${service} alerted?`,
      },
    );
  }
  for (const vendor of VENDORS) {
    family.push(
      {
        sentence: `The contract with ${vendor} renews on ${pick(MONTHS, random)} ${1 + Math.floor(random() * 28)}, 20${26 + Math.floor(random() * 3)}.`,
        lexical: `When does the contract with ${vendor} renew?`,
        paraphrase: `On which date is the agreement with ${vendor} extended?`,
      },
      {
        sentence: `The contract with ${vendor} requires a notice period of ${15 + 15 * Math.floor(random() * 8)} days.`,
        lexical: `What notice period does the contract with ${vendor} require?`,
        paraphrase: `How many days of advance warning does the agreement with ${vendor} demand?`,
      },
    );
  }
  return family;
}

export function build(): { corpus: CorpusFile[]; dataset: Dataset } {
  const random = rng(SEED);
  const pool = shuffled(facts(random), random);
  // 30 documents x 3 pages x 8 facts. Anything else would drop facts or leave a page empty without a sound.
  if (pool.length !== 720) throw new Error(`Expected 720 facts, built ${pool.length}`);
  const perDocument = 24;

  const corpus: CorpusFile[] = [];
  const located = new Map<Fact, string>();
  for (let d = 0; d < 30; d++) {
    const name = `ops-notes-${String(d + 1).padStart(2, '0')}.txt`;
    const mine = pool.slice(d * perDocument, (d + 1) * perDocument);
    const pages: string[] = [];
    // three pages, each two paragraphs, so a page holds many near-identical sentences
    for (let p = 0; p < 3; p++) {
      const onPage = mine.slice(p * 8, p * 8 + 8);
      const paragraphs = [onPage.slice(0, 4), onPage.slice(4)].map((part) =>
        part.map((f) => f.sentence).join(' '),
      );
      for (const f of onPage) located.set(f, name);
      pages.push(
        `${p === 0 ? `Operations notes ${d + 1}\n\n` : ''}${paragraphs.filter(Boolean).join('\n\n')}`,
      );
    }
    corpus.push({ name, text: pages.join('\f') });
  }

  // 120 questions in the document's own words and 120 in different words, about different facts
  const asked = shuffled([...located.keys()], random).slice(0, 240);
  const questions: Question[] = asked.map((fact, i) => {
    const lexical = i < 120;
    return {
      id: `q${String(i + 1).padStart(3, '0')}`,
      text: lexical ? fact.lexical : fact.paraphrase,
      kind: lexical ? 'lexical' : 'paraphrase',
      document: located.get(fact)!,
      span: fact.sentence,
    };
  });
  return { corpus, dataset: { version: 1, seed: SEED, questions } };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { corpus, dataset } = build();
  rmSync(join(DATA_DIR, 'corpus'), { recursive: true, force: true });
  mkdirSync(join(DATA_DIR, 'corpus'), { recursive: true });
  for (const file of corpus) writeFileSync(join(DATA_DIR, 'corpus', file.name), file.text);
  writeFileSync(join(DATA_DIR, 'dataset.json'), `${JSON.stringify(dataset, null, 2)}\n`);
  const counts = (kind: string) => dataset.questions.filter((q) => q.kind === kind).length;
  console.log(
    `${corpus.length} documents, ${dataset.questions.length} questions ` +
      `(${counts('lexical')} same words, ${counts('paraphrase')} paraphrased)`,
  );
}
