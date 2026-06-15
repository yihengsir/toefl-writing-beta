import { readFile } from 'node:fs/promises';

const supabaseUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const inputPath = process.argv[2] || '../online-upgrade/question-bank.raw.json';

if (!supabaseUrl || !serviceRoleKey) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.');
  process.exit(1);
}

const raw = JSON.parse(await readFile(inputPath, 'utf8'));
const rows = raw.map((item) => ({
  import_index: item.import_index,
  type: item.type,
  title: item.title,
  time_limit_seconds: item.time_limit_seconds,
  prompt_payload: item.prompt_payload,
  source_date: item.source_date,
  source_raw: item.source_raw,
  duplicate_group_id: item.duplicate_group_id,
  duplicate_note: item.duplicate_note,
  is_active: true
}));

async function upsertChunk(chunk) {
  const response = await fetch(`${supabaseUrl}/rest/v1/questions?on_conflict=import_index`, {
    method: 'POST',
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates'
    },
    body: JSON.stringify(chunk)
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`${response.status} ${response.statusText}: ${text}`);
  }
}

for (let i = 0; i < rows.length; i += 50) {
  const chunk = rows.slice(i, i + 50);
  await upsertChunk(chunk);
  console.log(`Imported ${Math.min(i + chunk.length, rows.length)} / ${rows.length}`);
}

console.log(`Done. Imported ${rows.length} questions.`);

