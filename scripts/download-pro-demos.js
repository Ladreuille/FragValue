#!/usr/bin/env node
/* eslint-disable */
// scripts/download-pro-demos.js · FragValue · Option B Phase 2
//
// Telecharge les demos pros HLTV (archives .rar/.zip avec demos multi-maps) et
// upload chaque .dem dans Supabase Storage bucket `pro-demos`.
//
// Pipeline :
//   1. SELECT pro_demos WHERE status='pending'
//   2. Set status='downloading'
//   3. Download archive via fetch (follow redirects)
//   4. Extract via 7z (mac: brew install p7zip, linux: apt install p7zip)
//   5. Map chaque .dem extrait avec son pro_match_map_id (via map_name)
//   6. Upload .dem → Supabase Storage
//   7. Update pro_demos.storage_path + status='parsing' (ready for parser)
//
// Pre-requis :
//   - `7z` installe (mac: brew install p7zip-full, mac fallback: `unrar`)
//   - Supabase bucket 'pro-demos' cree (privé, service_role only)
//   - 10-50GB free disk pour download temp (auto-clean apres upload)
//
// Usage :
//   node scripts/download-pro-demos.js [--limit=5]
//
// CAUTION : telecharger des archives 200-500MB depuis HLTV. Rate limit 5min entre downloads.

const fs = require('node:fs');
const path = require('node:path');
const { execSync, exec } = require('node:child_process');
const { promisify } = require('node:util');
const execAsync = promisify(exec);

const envPath = path.resolve(__dirname, '..', '.env.local');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

const args = process.argv.slice(2).reduce((acc, a) => {
  const m = a.match(/^--([a-z-]+)=(.+)$/);
  if (m) acc[m[1]] = m[2];
  return acc;
}, {});
const LIMIT = parseInt(args.limit || '5', 10);

const TMP_DIR = '/tmp/fragvalue-pro-demos';
const STORAGE_BUCKET = 'pro-demos';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ─── Helpers ──────────────────────────────────────────────────────────────

function checkSystemDeps() {
  try {
    execSync('which 7z', { stdio: 'pipe' });
    console.log('[deps] 7z found');
  } catch {
    try {
      execSync('which unrar', { stdio: 'pipe' });
      console.log('[deps] 7z missing, fallback to unrar');
    } catch {
      console.error('[deps] FATAL : install 7z (mac: brew install p7zip-full, linux: apt install p7zip-full)');
      process.exit(1);
    }
  }
}

async function downloadFile(url, destPath) {
  console.log(`  downloading ${url}`);
  // Use curl for resumable downloads + handle redirects (HLTV redirects to CDN)
  await execAsync(`curl -L --fail --silent --show-error --max-time 600 -o "${destPath}" "${url}"`);
  const stats = fs.statSync(destPath);
  console.log(`  downloaded ${(stats.size / 1024 / 1024).toFixed(1)} MB`);
  return stats.size;
}

async function extractArchive(archivePath, extractDir) {
  fs.mkdirSync(extractDir, { recursive: true });
  // 7z handles .rar/.zip/.tar.gz/.7z
  try {
    await execAsync(`7z x "${archivePath}" -o"${extractDir}" -y`, { maxBuffer: 50 * 1024 * 1024 });
  } catch (e) {
    // Fallback unrar
    try {
      await execAsync(`unrar x -o+ "${archivePath}" "${extractDir}/"`, { maxBuffer: 50 * 1024 * 1024 });
    } catch (e2) {
      throw new Error(`extraction failed : ${e.message} | ${e2.message}`);
    }
  }
  // Find .dem files
  const findDems = (dir) => {
    const out = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) out.push(...findDems(full));
      else if (entry.name.toLowerCase().endsWith('.dem')) out.push(full);
    }
    return out;
  };
  return findDems(extractDir);
}

// Match un .dem filename a un map_name (mirage, inferno, etc.)
function matchDemToMap(demFilename, maps) {
  const fname = path.basename(demFilename).toLowerCase();
  for (const map of maps) {
    const mname = (map.map_name || '').toLowerCase();
    if (!mname) continue;
    if (fname.includes(mname) || fname.includes(`de_${mname}`)) {
      return map;
    }
  }
  return null;
}

async function uploadToStorage(localPath, storagePath) {
  const buffer = fs.readFileSync(localPath);
  const { error } = await supabase.storage
    .from(STORAGE_BUCKET)
    .upload(storagePath, buffer, {
      contentType: 'application/octet-stream',
      upsert: true,
    });
  if (error) throw error;
  return storagePath;
}

// ─── Main ─────────────────────────────────────────────────────────────────

async function main() {
  checkSystemDeps();
  fs.mkdirSync(TMP_DIR, { recursive: true });

  // Verify bucket exists (create if missing)
  const { data: buckets } = await supabase.storage.listBuckets();
  if (!buckets?.find(b => b.name === STORAGE_BUCKET)) {
    console.log(`[storage] creating bucket ${STORAGE_BUCKET}`);
    await supabase.storage.createBucket(STORAGE_BUCKET, {
      public: false,
      fileSizeLimit: 1024 * 1024 * 1024, // 1GB per file
    });
  }

  // Group pro_demos par archive URL (multiple maps share same archive)
  const { data: pending, error } = await supabase
    .from('pro_demos')
    .select(`
      id, pro_match_map_id, hltv_demo_url, status,
      pro_match_maps!inner ( id, map_name, match_id )
    `)
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
    .limit(LIMIT * 4);  // overfetch : group archives

  if (error) throw error;
  if (!pending || pending.length === 0) {
    console.log('[download-pro-demos] no pending demos');
    return;
  }

  // Group by archive URL
  const groups = new Map();
  for (const row of pending) {
    const url = row.hltv_demo_url;
    if (!url) continue;
    if (!groups.has(url)) groups.set(url, []);
    groups.get(url).push(row);
  }

  console.log(`[download-pro-demos] ${groups.size} archives to download (${pending.length} maps)`);

  let processedArchives = 0;
  let processedMaps = 0;

  for (const [archiveUrl, rows] of groups) {
    if (processedArchives >= LIMIT) break;
    processedArchives++;

    console.log(`\n[archive ${processedArchives}/${LIMIT}] ${archiveUrl}`);
    console.log(`  ${rows.length} maps to extract`);

    const archiveFilename = `archive-${Date.now()}.rar`;
    const archivePath = path.join(TMP_DIR, archiveFilename);
    const extractDir = path.join(TMP_DIR, `extract-${Date.now()}`);

    try {
      // 1. Mark downloading
      const ids = rows.map(r => r.id);
      await supabase.from('pro_demos').update({ status: 'downloading', download_started_at: new Date().toISOString() }).in('id', ids);

      // 2. Download
      const bytes = await downloadFile(archiveUrl, archivePath);

      // 3. Extract
      const demFiles = await extractArchive(archivePath, extractDir);
      console.log(`  extracted ${demFiles.length} .dem files`);

      // 4. Map each .dem to its pro_match_map + upload
      const maps = rows.map(r => r.pro_match_maps);
      for (const demFile of demFiles) {
        const matchedMap = matchDemToMap(demFile, maps);
        if (!matchedMap) {
          console.log(`  ⚠️  unmatched : ${path.basename(demFile)}`);
          continue;
        }
        const row = rows.find(r => r.pro_match_map_id === matchedMap.id);
        if (!row) continue;

        const storagePath = `${row.pro_match_map_id}.dem`;
        try {
          await uploadToStorage(demFile, storagePath);
          await supabase.from('pro_demos').update({
            storage_path: storagePath,
            status: 'parsing',  // ready for parser
            download_completed_at: new Date().toISOString(),
            bytes_size: fs.statSync(demFile).size,
          }).eq('id', row.id);
          processedMaps++;
          console.log(`  uploaded ${matchedMap.map_name} → ${storagePath}`);
        } catch (e) {
          console.error(`  upload error ${matchedMap.map_name} : ${e.message}`);
          await supabase.from('pro_demos').update({
            status: 'failed',
            error_message: 'upload : ' + e.message,
          }).eq('id', row.id);
        }
      }
    } catch (e) {
      console.error(`  archive error : ${e.message}`);
      await supabase.from('pro_demos').update({
        status: 'failed',
        error_message: e.message,
        retry_count: supabase.raw('retry_count + 1'),
      }).in('id', rows.map(r => r.id));
    } finally {
      // Cleanup local
      try { fs.unlinkSync(archivePath); } catch {}
      try { fs.rmSync(extractDir, { recursive: true, force: true }); } catch {}
    }

    // Rate limit between archives (HLTV friendly)
    if (processedArchives < LIMIT) {
      console.log('  sleep 5min before next archive...');
      await sleep(5 * 60 * 1000);
    }
  }

  console.log(`\n[download-pro-demos] DONE. archives=${processedArchives}, maps=${processedMaps}`);
}

main().catch(e => {
  console.error('[download-pro-demos] FATAL:', e);
  process.exit(1);
});
