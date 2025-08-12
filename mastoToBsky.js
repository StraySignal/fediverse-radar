const fs = require('fs');
const csv = require('csv-parser');
const { write } = require('fast-csv');
const axios = require('axios');
const { promisify } = require('util');
const path = require('path');
const _open = require('open');
const chalk = require('chalk').default;
const open = _open.default || _open;

const sleep = promisify(setTimeout);

// Convert a Mastodon account address to the Bluesky brid.gy format
function convertAddressFormat(address) {
  const formattedAddress = address.replace(/[_~]/g, '-');
  const [username, instance] = formattedAddress.split('@');
  return `${username}.${instance}.ap.brid.gy`;
}

// Determine if the domain should be excluded from conversion
function excludeDomain(address) {
  return address.endsWith('@bsky.brid.gy') || address.endsWith('@threads.net') || address.endsWith('@bird.makeup');
}

// Check if a Bluesky account exists
async function checkAccountExists(accountAddress) {
  const formattedAddress = accountAddress.replace('@', '');
  const profileUrl = `https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile?actor=${formattedAddress}`;
  try {
    const response = await axios.get(profileUrl);
    const accountExists = response.status === 200;
    return { exists: accountExists, address: formattedAddress };
  } catch (error) {
    return { exists: false, address: formattedAddress, error: error.message };
  }
}

// Ensure the atproto-export repo is present and dependencies are installed
async function ensureAtprotoExportRepo() {
  const repoDir = path.resolve(__dirname, 'atproto-export');
  if (!fs.existsSync(repoDir)) {
    console.log(chalk.yellow('Cloning atproto-export repository...'));
    await new Promise((resolve, reject) => {
      const git = require('child_process').spawn('git', ['clone', 'https://github.com/rdp-studio/atproto-export.git'], { stdio: 'inherit' });
      git.on('close', code => code === 0 ? resolve() : reject(new Error('git clone failed')));
      git.on('error', err => reject(err));
    });
  }
  const nodeModulesDir = path.join(repoDir, 'node_modules');
  if (!fs.existsSync(nodeModulesDir)) {
    console.log(chalk.yellow('Installing dependencies for atproto-export...'));
    await new Promise((resolve, reject) => {
      const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
      const npm = require('child_process').spawn(npmCmd, ['install'], { cwd: repoDir, stdio: 'inherit', shell: process.platform === 'win32' });
      npm.on('close', code => code === 0 ? resolve() : reject(new Error('npm install failed')));
      npm.on('error', err => reject(err));
    });
  }
  return repoDir;
}

// Run the atproto-export script for a given handle or DID
async function runAtprotoExport(handleOrDid) {
  const repoDir = await ensureAtprotoExportRepo();
  const exportScript = path.join(repoDir, 'bin', 'export.js');
  const outDir = path.join(repoDir, '..', 'atproto-export', handleOrDid);
  if (!fs.existsSync(exportScript)) {
    throw new Error(chalk.red('Could not find atproto-export export.js script.'));
  }
  if (!fs.existsSync(outDir)) {
    await new Promise((resolve, reject) => {
      const proc = require('child_process').spawn('node', [exportScript, '--no-blobs', '-o', outDir, handleOrDid], { stdio: 'inherit', cwd: repoDir });
      proc.on('close', code => code === 0 ? resolve() : reject(new Error('Export process failed')));
      proc.on('error', err => reject(err));
    });
  }
  // Find did-* subdirectory
  const subdirs = fs.readdirSync(outDir, { withFileTypes: true });
  let didDir = null;
  for (const sub of subdirs) {
    if (sub.isDirectory() && sub.name.startsWith('did-')) {
      didDir = path.join(outDir, sub.name);
      break;
    }
  }
  if (!didDir) throw new Error(chalk.red('Could not find DID directory after export.'));
  const followDir = path.join(didDir, 'app.bsky.graph.follow');
  if (!fs.existsSync(followDir)) throw new Error(chalk.red('Could not find app.bsky.graph.follow directory in export.'));
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

// Resolve a handle to a DID using the Bluesky API
async function resolveHandleToDid(handle) {
  try {
    const response = await axios.get(`https://public.api.bsky.app/xrpc/com.atproto.identity.resolveHandle?handle=${handle}`);
    if (response.data && response.data.did) return response.data.did;
  } catch (e) {}
  return null;
}

// Given a set of followed DIDs, resolve their handles and brid.gy aliases
async function getFollowedHandlesFromDids(didSet) {
  const handles = new Set();
  let count = 0;
  const total = didSet.size;
  const spinnerFrames = ['|', '/', '-', '\\'];
  let spinnerIndex = 0;
  process.stdout.write(chalk.cyan(`Resolving handles: 0/${total} `));
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
      // Ignore errors
    }
    count++;
    spinnerIndex = (spinnerIndex + 1) % spinnerFrames.length;
    process.stdout.write(
      `\r${chalk.cyan(`Resolving handles: ${count}/${total} ${spinnerFrames[spinnerIndex]}`)}`
    );
    await sleep(50); // Avoid rate limits
  }
  process.stdout.write('\n');
  return handles;
}

const mastodonInstanceInput = process.env.BSKY_CHECK_INSTANCE || 'mastodon.social';
const outputInstance = process.env.BSKY_WRITE_INSTANCE || 'bsky.brid.gy';

// Main entry point for the conversion process
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

  // If follow check is enabled, get followed DIDs and handles
  let followedDids = null;
  if (followCheckHandleOrDid) {
    console.log(chalk.yellow('Exporting your Bluesky follows to filter out already-followed accounts...'));
    const followDir = await runAtprotoExport(followCheckHandleOrDid);
    followedDids = getFollowedDids(followDir);
    console.log(chalk.green(`Loaded ${followedDids.size} followed DIDs.`));
  }

  let followedHandles = null;
  if (followedDids) {
    console.log(chalk.yellow('Resolving handles for followed DIDs... This may take a while...'));
    followedHandles = await getFollowedHandlesFromDids(followedDids);
    console.log(chalk.green(`Loaded ${followedHandles.size} followed handles.`));
  }

  // Read and process the input CSV
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
              // Check the profile URL directly
              try {
                const profileResponse = await axios.get(profileUrl, { validateStatus: null });
                if (profileResponse.status === 200) {
                  results.push({ 'Account address': result.address, 'Profile URL': profileUrl });
                  console.log(chalk.green(`Success: ${result.address} -> ${profileUrl}`));
                }
              } catch (err) {
                // Ignore errors for unsuccessful profile fetches
              }
            }
          });
        }
      })
      .on('end', async () => {
        console.log(chalk.cyan('CSV read complete, processing queue...'));
        await processRequestQueue();

        // Filter out already-followed accounts from results
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
          console.log(chalk.yellow(`After filtering, ${results.length} results remain (not already followed).`));
        }

        await writeResultsToFile();
        await writeResultsToHtml();
        resolve();
      })
      .on('error', async (error) => {
        console.error(chalk.red(`Error reading CSV: ${error.message}`));
        await writeResultsToFile();
        await writeResultsToHtml();
        resolve();
      });
  });

  // Process the queued requests with concurrency control
  async function processRequestQueue() {
    while (requestQueue.length > 0) {
      if (requestsInProgress < 10) {
        const request = requestQueue.shift();
        requestsInProgress++;
        await request();
        requestsInProgress--;
      } else {
        await sleep(100); // Delay if the maximum requests limit is reached
      }
    }
  }

  // Write results to a CSV file
  function writeResultsToFile() {
    return new Promise((resolve, reject) => {
      console.log(chalk.cyan(`Writing ${results.length} results to ${outputFilename}...`));
      const ws = fs.createWriteStream(outputFilename);
      write(results, { headers: true })
        .pipe(ws)
        .on('finish', () => {
          console.log(chalk.green(`Conversion complete. The updated addresses are saved in '${outputFilename}'.`));
          resolve();
        })
        .on('error', (err) => {
          console.error(chalk.red('Error writing output file:'), err.message);
          reject(err);
        });
    });
  }

  // Write results to a styled HTML file
  function writeResultsToHtml() {
    return new Promise((resolve, reject) => {
      const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Fediverse Radar: Mastodon → Bluesky Results</title>
  <style>
    body { font-family: system-ui, sans-serif; background: #f9f9fb; color: #222; margin: 0; padding: 2em; }
    h1 { color: #2b6cb0; }
    table { border-collapse: collapse; width: 100%; background: #fff; box-shadow: 0 2px 8px #0001; }
    th, td { border: 1px solid #e2e8f0; padding: 10px 8px; }
    th { background: #edf2fa; }
    tr:nth-child(even) { background: #f7fafc; }
    a { color: #3182ce; text-decoration: none; }
    a:hover { text-decoration: underline; }
    .count { margin-bottom: 1em; color: #555; }
  </style>
</head>
<body>
  <h1>Fediverse Radar: Mastodon → Bluesky Results</h1>
  <div class="count">${results.length} account${results.length === 1 ? '' : 's'} found</div>
  <table>
    <tr>
      <th>Account Address</th>
      <th>Profile URL</th>
    </tr>
    ${results.map(row => `
      <tr>
        <td>${row['Account address']}</td>
        <td><a href="${row['Profile URL']}" target="_blank">${row['Profile URL']}</a></td>
      </tr>
    `).join('')}
  </table>
</body>
</html>
      `.trim();

      fs.writeFile('output.html', html, err => {
        if (err) {
          console.error(chalk.red('Error writing output.html:'), err.message);
          reject(err);
        } else {
          console.log(chalk.green(`HTML report saved as output.html (${results.length} entries).`));
          resolve();
        }
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