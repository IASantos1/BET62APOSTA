const HOST = 'http://127.0.0.1:5000';
const BRAND = '1653815133341880320';
const META = `${HOST}/betby-api-v4/api/v4/{kind}/brand/${BRAND}/en/0`;
const TREE = `${HOST}/betby-api-v4/api/v4/{kind}/brand/${BRAND}/en/{treeId}`;

function countEvents(events) {
  if (!events) return 0;
  if (Array.isArray(events)) return events.length;
  if (typeof events === 'object') return Object.keys(events).length;
  return 0;
}

async function req(url, label) {
  const t0 = Date.now();
  const r = await fetch(url, { headers: { Accept: 'application/json, text/plain, */*' } });
  const dt = Date.now() - t0;
  const enc = r.headers.get('content-encoding') || '(none)';
  const ct = r.headers.get('content-type') || '';
  const text = await r.text();
  console.log(`\n[${label}] HTTP ${r.status} dt=${dt}ms ct=${ct} enc=${enc} bytes=${text.length}`);
  let json;
  try { json = JSON.parse(text); } catch { json = null; }
  return { r, enc, text, json, ok: r.ok && json !== null };
}

async function main() {
  console.log('=== SMOKE TEST: Vite proxy BetBY v4 via port 5000 ===');
  console.log('Vite target: ', HOST);
  console.log('jwt-service upstream: http://127.0.0.1:8788 (via Vite proxy /betby-api-v4)');
  for (const kind of ['live', 'prematch']) {
    console.log(`\n----- KIND=${kind} -----`);
    const meta = await req(META.replace('{kind}', kind), `META ${kind}`);
    if (!meta.ok) { console.log('  META FAIL, preview:', meta.text.slice(0, 300)); continue; }
    const j = meta.json;
    console.log(`  epoch=${j.epoch} version=${j.version}`);
    console.log(`  top_events_versions (${j.top_events_versions?.length || 0}):`, j.top_events_versions?.slice(0, 3));
    console.log(`  rest_events_versions count=${j.rest_events_versions?.length || 0}`);
    const tid = (j.top_events_versions && j.top_events_versions[0]) || j.version;
    if (!tid) { console.log('  SEM treeId para testar'); continue; }
    const treeUrl = TREE.replace('{kind}', kind).replace('{treeId}', String(tid));
    const tree = await req(treeUrl, `TREE ${kind} id=${tid}`);
    if (!tree.ok) { console.log('  TREE FAIL preview:', tree.text.slice(0, 400)); continue; }
    const tj = tree.json;
    const ev = countEvents(tj.events);
    const sp = Array.isArray(tj.sports) ? tj.sports.length : (tj.sports && typeof tj.sports === 'object' ? Object.keys(tj.sports).length : 0);
    const ct = Array.isArray(tj.categories) ? tj.categories.length : (tj.categories && typeof tj.categories === 'object' ? Object.keys(tj.categories).length : 0);
    const tm = Array.isArray(tj.tournaments) ? tj.tournaments.length : (tj.tournaments && typeof tj.tournaments === 'object' ? Object.keys(tj.tournaments).length : 0);
    console.log(`  => events=${ev}   sports=${sp}   cats=${ct}   trns=${tm}`);
    if (ev > 0) {
      const sampleKey = Array.isArray(tj.events) ? 0 : Object.keys(tj.events)[0];
      const ev0 = Array.isArray(tj.events) ? tj.events[0] : tj.events[sampleKey];
      console.log(`  SAMPLE EVENT id=${ev0?.id || sampleKey}  name=${(ev0?.name || ev0?.home + ' x ' + ev0?.away) || ''}`);
      const mkts = ev0?.markets;
      const mktsLen = Array.isArray(mkts) ? mkts.length : (mkts && typeof mkts === 'object' ? Object.keys(mkts).length : 0);
      console.log(`    markets count=${mktsLen}`);
      if (mktsLen > 0) {
        const m0 = Array.isArray(mkts) ? mkts[0] : Object.values(mkts)[0];
        const scopes = m0?.scopes || [];
        const sc0 = scopes[0] || { outcomes: m0?.outcomes || [] };
        const outcomes = sc0.outcomes || [];
        console.log(`    first market=${m0?.name || m0?.id}  first_scope.outcomes.len=${outcomes.length}`);
        const oc0 = outcomes[0];
        const oc1 = outcomes[1];
        const oc2 = outcomes[2];
        console.log(`    odds[0]=${oc0?.price ?? oc0?.k ?? '?'} "${oc0?.name ?? oc0?.type ?? ''}"`);
        console.log(`    odds[1]=${oc1?.price ?? oc1?.k ?? '?'} "${oc1?.name ?? oc1?.type ?? ''}"`);
        if (oc2) console.log(`    odds[2]=${oc2?.price ?? oc2?.k ?? '?'} "${oc2?.name ?? oc2?.type ?? ''}"`);
      }
    }
  }
  console.log('\n=== FIM ===');
}
main().catch(e => { console.error('FATAL:', e); process.exit(1); });
