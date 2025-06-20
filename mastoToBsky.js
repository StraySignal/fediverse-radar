const fs = require('fs');
const csv = require('csv-parser');
const { write } = require('fast-csv');
const axios = require('axios');
const { promisify } = require('util');
const path = require('path'); // Add at top if not present

const sleep = promisify(setTimeout);

// Function to convert the account address format
function convertAddressFormat(address) {
  const formattedAddress = address.replace(/[_~]/g, '-');
  const [username, instance] = formattedAddress.split('@');
  return `${username}.${instance}.ap.brid.gy`;
}

// Function to check if the domain should be excluded
function excludeDomain(address) {
  return address.endsWith('@bsky.brid.gy') || address.endsWith('@threads.net') || address.endsWith('@bird.makeup');
}

// Function to check if a Bluesky account exists
async function checkAccountExists(accountAddress) {
  const formattedAddress = accountAddress.replace('@', ''); // Remove the @ sign
  const profileUrl = `https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile?actor=${formattedAddress}`;
  try {
    const response = await axios.get(profileUrl);
    // If the response status is 200, the account exists
    const accountExists = response.status === 200;
    return { exists: accountExists, address: formattedAddress };
  } catch (error) {
    return { exists: false, address: formattedAddress, error: error.message };
  }
}

// --- Add these helper functions ---

// Export follows using atproto-export (reuse logic from fediverse-radar.js)
async function ensureAtprotoExportRepo() {
  const repoDir = path.resolve(__dirname, 'atproto-export');
  if (!fs.existsSync(repoDir)) {
    console.log('Cloning atproto-export repository...');
    await new Promise((resolve, reject) => {
      const git = require('child_process').spawn('git', ['clone', 'https://github.com/rdp-studio/atproto-export.git'], { stdio: 'inherit' });
      git.on('close', code => code === 0 ? resolve() : reject(new Error('git clone failed')));
      git.on('error', err => reject(err));
    });
  }
  const nodeModulesDir = path.join(repoDir, 'node_modules');
  if (!fs.existsSync(nodeModulesDir)) {
    console.log('Installing dependencies for atproto-export...');
    await new Promise((resolve, reject) => {
      const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
      const npm = require('child_process').spawn(npmCmd, ['install'], { cwd: repoDir, stdio: 'inherit', shell: process.platform === 'win32' });
      npm.on('close', code => code === 0 ? resolve() : reject(new Error('npm install failed')));
      npm.on('error', err => reject(err));
    });
  }
  return repoDir;
}

async function runAtprotoExport(handleOrDid) {
  const repoDir = await ensureAtprotoExportRepo();
  const exportScript = path.join(repoDir, 'bin', 'export.js');
  const outDir = path.join(repoDir, '..', 'atproto-export', handleOrDid);
  if (!fs.existsSync(exportScript)) {
    throw new Error('Could not find atproto-export export.js script.');
  }
  if (!fs.existsSync(outDir)) {
    await new Promise((resolve, reject) => {
      const proc = require('child_process').spawn('node', [exportScript, '--no-blobs', '-o', outDir, handleOrDid], { stdio: 'inherit', cwd: repoDir });
      proc.on('close', code => code === 0 ? resolve() : reject(new Error('Export process failed')));
      proc.on('error', err => reject(err));
    });
  }
  // Find did-* subdir
  const subdirs = fs.readdirSync(outDir, { withFileTypes: true });
  let didDir = null;
  for (const sub of subdirs) {
    if (sub.isDirectory() && sub.name.startsWith('did-')) {
      didDir = path.join(outDir, sub.name);
      break;
    }
  }
  if (!didDir) throw new Error('Could not find DID directory after export.');
  const followDir = path.join(didDir, 'app.bsky.graph.follow');
  if (!fs.existsSync(followDir)) throw new Error('Could not find app.bsky.graph.follow directory in export.');
  return followDir;
}

// Parse exported follows to get a Set of followed DIDs
function getFollowedDids(followDir) {
  const files = fs.readdirSync(followDir);
  const dids = new Set();
  for (const file of files) {
    const json = JSON.parse(fs.readFileSync(path.join(followDir, file)));
    if (json.subject) dids.add(json.subject);
  }
  return dids;
}

// Resolve handle to DID (reuse your existing resolve logic)
async function resolveHandleToDid(handle) {
  try {
    const response = await require('axios').get(`https://public.api.bsky.app/xrpc/com.atproto.identity.resolveHandle?handle=${handle}`);
    if (response.data && response.data.did) return response.data.did;
  } catch (e) {}
  return null;
}

// Given a set of followed DIDs, resolve their handles and brid.gy aliases
async function getFollowedHandlesFromDids(didSet) {
  const handles = new Set();
  for (const did of didSet) {
    try {
      const resp = await axios.get(`https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile?actor=${did}`);
      if (resp.data && resp.data.handle) {
        handles.add(resp.data.handle.toLowerCase());
        // Add brid.gy alias for Mastodon-to-Bluesky mapping
        const bridgy = resp.data.handle.replace('@', '.').replace(/\./g, '-') + '.ap.brid.gy';
        handles.add(bridgy.toLowerCase());
      }
    } catch (e) {
      // ignore errors
    }
    await sleep(50); // avoid rate limits
  }
  return handles;
}

async function main(args = process.argv.slice(2)) {
  const inputFilename = args[0];
  const checkFlag = args.includes('-c');
  const outputFilename = 'output.csv';
  const results = [];
  const requestQueue = [];
  let requestsInProgress = 0;
  let followCheckHandleOrDid = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '-f' && args[i + 1]) {
      followCheckHandleOrDid = args[i + 1];
      i++;
    }
  }

  // --- If follow check is enabled, get followed DIDs ---
  let followedDids = null;
  if (followCheckHandleOrDid) {
    console.log('Exporting your Bluesky follows to filter out already-followed accounts...');
    const followDir = await runAtprotoExport(followCheckHandleOrDid);
    followedDids = getFollowedDids(followDir);
    console.log(`Loaded ${followedDids.size} followed DIDs.`);
  }

  let followedHandles = null;
  if (followedDids) {
    console.log('Resolving handles for followed DIDs...');
    followedHandles = await getFollowedHandlesFromDids(followedDids);
    console.log(`Loaded ${followedHandles.size} followed handles.`);
  }

  await new Promise((resolve, reject) => {
    fs.createReadStream(inputFilename)
      .pipe(csv())
      .on('data', (row) => {
        const newAddress = convertAddressFormat(row['Account address']);
        const profileUrl = `https://bsky.app/profile/${newAddress.replace('@', '')}`;
        if (!excludeDomain(row['Account address'])) {
          requestQueue.push(async () => {
            const result = await checkAccountExists(newAddress);
            if (result.exists) {
              // Now check the profile URL directly
              try {
                const profileResponse = await axios.get(profileUrl, { validateStatus: null });
                if (profileResponse.status === 200) {
                  results.push({ 'Account address': result.address, 'Profile URL': profileUrl });
                  console.log(`Success: ${result.address} -> ${profileUrl}`);
                }
              } catch (err) {
                // do not log errors for unsuccessful profile fetches
              }
            }
          });
        }
      })
      .on('end', async () => {
        console.log('CSV read complete, processing queue...');
        await processRequestQueue();

        // --- Filter out already-followed accounts from results ---
        if (followedHandles) {
          const filteredResults = [];
          for (const row of results) {
            const handle = row['Account address'];
            const did = await resolveHandleToDid(handle);
            if (!did || !followedDids.has(did)) {
              filteredResults.push(row);
            }
          }
          results.length = 0;
          results.push(...filteredResults);
          console.log(`After filtering, ${results.length} results remain (not already followed).`);
        }

        await writeResultsToFile();
        resolve();
      })
      .on('error', async (error) => {
        console.error(`Error reading CSV: ${error.message}`);
        await writeResultsToFile();
        resolve();
      });
  });

  async function processRequestQueue() {
    while (requestQueue.length > 0) {
      if (requestsInProgress < 10) {
        const request = requestQueue.shift();
        requestsInProgress++;
        await request();
        requestsInProgress--;
      } else {
        await sleep(100); // Delay 100 milliseconds if the maximum requests limit is reached
      }
    }
  }

  function writeResultsToFile() {
    return new Promise((resolve, reject) => {
      console.log(`Writing ${results.length} results to ${outputFilename}...`);
      const ws = fs.createWriteStream(outputFilename);
      write(results, { headers: true })
        .pipe(ws)
        .on('finish', () => {
          console.log(`Conversion complete. The updated addresses are saved in '${outputFilename}'.`);
          resolve();
        })
        .on('error', (err) => {
          console.error('Error writing output file:', err.message);
          reject(err);
        });
    });
  }
}

// Export main for CLI use
module.exports = main;

// If run directly, call main()
if (require.main === module) {
  main();
}