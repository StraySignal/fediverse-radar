const fs = require('fs');
const csv = require('csv-parser');
const { write } = require('fast-csv');
const axios = require('axios');
const path = require('path');
const _open = require('open');
const chalk = require('chalk').default;
const open = _open.default || _open;

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

// Fetch the list of accounts a user is following (their "follows") using the public API
async function fetchUserFollowsHandles(userHandle, maxEntries = null) {
  let cursor = undefined;
  let handles = [];
  let totalFetched = 0;
  while (true) {
    const url = `https://public.api.bsky.app/xrpc/app.bsky.graph.getFollows?actor=${encodeURIComponent(userHandle)}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}&limit=100`;
    try {
      const response = await axios.get(url);
      if (response.data && Array.isArray(response.data.follows)) {
        for (const follow of response.data.follows) {
          if (follow.handle) handles.push(follow.handle.toLowerCase());
          totalFetched++;
          if (maxEntries && totalFetched >= maxEntries) break;
        }
        if (maxEntries && totalFetched >= maxEntries) break;
        if (response.data.cursor) {
          cursor = response.data.cursor;
        } else {
          break;
        }
      } else {
        break;
      }
    } catch (err) {
      console.error(chalk.red(`Error fetching follows for ${userHandle}: ${err.message}`));
      break;
    }
  }
  return new Set(handles);
}

const mastodonInstanceInput = process.env.BSKY_CHECK_INSTANCE || 'mastodon.social';
const outputInstance = process.env.BSKY_WRITE_INSTANCE || 'bsky.brid.gy';

// Main entry point for the conversion process
async function main(args = process.argv.slice(2)) {
  const inputFilename = args[0];
  const checkFlag = args.includes('-c');
  const outputFilename = 'output.csv';
  const results = [];
  let followCheckHandleOrDid = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '-f' && args[i + 1]) {
      followCheckHandleOrDid = args[i + 1];
      i++;
    }
  }

  // If follow check is enabled, get followed handles from the Bluesky API (not atproto-export)
  let followedHandles = null;
  if (followCheckHandleOrDid) {
    console.log(chalk.cyan('Fetching your Bluesky follows...'));
    followedHandles = await fetchUserFollowsHandles(followCheckHandleOrDid);
    console.log(chalk.green(`Loaded ${followedHandles.size} followed handles.`));
  }

  // Read and process the input CSV
  let inputRows = [];
  await new Promise((resolve, reject) => {
    fs.createReadStream(inputFilename)
      .pipe(csv())
      .on('data', (row) => {
        if (!excludeDomain(row['Account address'])) {
          inputRows.push(row);
        }
      })
      .on('end', resolve)
      .on('error', reject);
  });

  // Loading bar for checking Bluesky accounts
  const total = inputRows.length;
  let loadingBarComplete = false;
  for (let i = 0; i < inputRows.length; i++) {
    const row = inputRows[i];
    const newAddress = convertAddressFormat(row['Account address']);
    const profileUrl = `https://bsky.app/profile/${newAddress.replace('@', '')}`;

    let status = 'Bridged, not yet followed';
    let statusClass = 'status-green';

    if (followedHandles && followedHandles.has(newAddress.toLowerCase())) {
      status = 'Bridged, already followed';
      statusClass = 'status-red';
      // Optionally, you can skip the existence check for already-followed accounts to save API calls
      results.push({ 'Account address': newAddress, 'Profile URL': profileUrl, status, statusClass });
    } else {
      const result = await checkAccountExists(newAddress);
      if (result.exists) {
        results.push({ 'Account address': result.address, 'Profile URL': profileUrl, status, statusClass });
      }
    }

    // Loading bar only (no per-account output)
    const checked = i + 1;
    const barLength = 40;
    const percent = checked / total;
    const filled = Math.round(barLength * percent);
    const bar = chalk.green('█'.repeat(filled)) + chalk.gray('░'.repeat(barLength - filled));
    const lineWidth = 60;
    const handleLine = `Checked ${checked}/${total}`;
    const paddedHandleLine = handleLine.padEnd(lineWidth, ' ');
    // If complete, print in green and do not overwrite
    if (checked === total) {
      process.stdout.write(`\r${chalk.green(paddedHandleLine)}\n${chalk.green(`[${'█'.repeat(barLength)}] 100.0%`)}\n`);
      loadingBarComplete = true;
    } else {
      process.stdout.write(`\r${chalk.cyan(paddedHandleLine)}\n[${bar}] ${(percent * 100).toFixed(1)}%`);
      process.stdout.write('\x1b[1A');
    }
  }
  if (!loadingBarComplete) process.stdout.write('\n'); // Move to next line after loop if not already done

  // Write results to a CSV file
  await writeResultsToFile(results, outputFilename);
  await writeResultsToHtml(results);
}

// Write results to a CSV file
function writeResultsToFile(results, outputFilename) {
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
function writeResultsToHtml(results) {
  return new Promise((resolve, reject) => {
    // Sort: "not yet followed" first, then "already followed"
    const sortedResults = [
      ...results.filter(r => r.status === 'Bridged, not yet followed'),
      ...results.filter(r => r.status === 'Bridged, already followed')
    ];

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
    .status-green { color: #228B22; font-weight: bold; }
    .status-red { color: #C00; font-weight: bold; }
  </style>
</head>
<body>
  <h1>Fediverse Radar: Mastodon → Bluesky Results</h1>
  <div class="count">${sortedResults.length} account${sortedResults.length === 1 ? '' : 's'} listed</div>
  <table>
    <tr>
      <th>Handle</th>
      <th>Link</th>
      <th>Status</th>
    </tr>
    ${sortedResults.map(row => `
      <tr>
        <td>${row['Account address']}</td>
        <td><a href="${row['Profile URL']}" target="_blank">${row['Profile URL']}</a></td>
        <td class="${row.statusClass}">${row.status}</td>
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
        console.log(chalk.green(`HTML report saved as output.html (${sortedResults.length} entries).`));
        resolve();
      }
    });
  });
}

// Export main for CLI use
module.exports = main;

// If run directly, call main()
if (require.main === module) {
  main();
}