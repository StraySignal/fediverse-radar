const fs = require('fs');
const path = require('path');
const axios = require('axios');
const readlineSync = require('readline-sync');
const { parse } = require('csv-parse/sync');
const _open = require('open');
const chalk = require('chalk').default;
const open = _open.default || _open;

// Read all files in a directory
function readDirectory(directory) {
    return fs.readdirSync(directory);
}

// Read and parse a JSON file
function readJSONFile(filePath) {
    const fileContent = fs.readFileSync(filePath);
    return JSON.parse(fileContent);
}

// Extract handles from JSON files in a directory
async function extractHandles(directory, instance, numEntries) {
    const files = readDirectory(directory);
    let handles = [];
    const numFilesToProcess = numEntries ? Math.min(files.length, numEntries) : files.length;

    for (let i = 0; i < numFilesToProcess; i++) {
        const filePath = path.join(directory, files[i]);
        const jsonData = readJSONFile(filePath);
        const did = jsonData.subject;

        if (did) {
            process.stdout.write(chalk.cyan(`Fetching handle ${i + 1}/${numFilesToProcess}...`));
            const handle = await resolveHandleWithDelay(did, instance);
            if (handle) {
                handles.push(handle);
            }
            process.stdout.write('\r');
        }
    }

    return handles;
}

// Resolve a DID to a handle with a delay to avoid rate limits
async function resolveHandleWithDelay(did, instance) {
    try {
        const response = await axios.get(`https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile?actor=${did}`);
        if (response.data && response.data.handle) {
            return response.data.handle;
        }
        return null;
    } catch (error) {
        return { error: `Error resolving handle: ${error.message}`, did };
    } finally {
        await delay(100);
    }
}

// Check if a Mastodon account exists on the given instance
async function checkMastodonAccount(handle, instance) {
    try {
        const response = await axios.get(`https://${instance}/api/v2/search?q=${handle}@bsky.brid.gy`);
        if (response.data.accounts.length > 0) {
            console.log(chalk.green(`Found on ${instance}`));
            return { exists: true, instance };
        }
    } catch (error) {
        if (error.response && error.response.status === 429) {
            return { exists: false, instance, rateLimited: true };
        }
        console.error(chalk.red(`Error checking Mastodon on ${instance}:`), error.message);
    }
    return { exists: false, instance };
}

// Check if a handle is bridged by querying the bridge control panel
async function isHandleBridged(handle) {
    try {
        const url = `https://fed.brid.gy/bsky/${encodeURIComponent(handle)}`;
        const response = await axios.get(url, { validateStatus: () => true });
        return response.status === 200;
    } catch (err) {
        return false;
    }
}

// Delay helper
function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Write BlueSky handles to a file
function writeHandlesToFile(handles) {
    const filePath = 'BlueSkyHandles.txt';
    fs.writeFileSync(filePath, handles.join('\n'), 'utf8');
    console.log(chalk.green(`BlueSky handles written to ${filePath}`));
}

// Read existing CSV and return an array of unique handles
function readExistingCSV(csvPath) {
    try {
        const fileContent = fs.readFileSync(csvPath, 'utf8');
        const records = parse(fileContent, {
            columns: true,
            skip_empty_lines: true
        });
        const handles = records.map(record => {
            const address = record['Account address'];
            const handle = address ? address.split('@')[0] : '';
            return handle;
        });
        const uniqueHandles = handles.filter((handle, index, self) => self.indexOf(handle) === index);
        return uniqueHandles;
    } catch (error) {
        console.error(chalk.red("Error reading existing CSV:"), error.message);
        return [];
    }
}

// Read BlueSky handles from a file
function readHandlesFromFile(filePath) {
    try {
        const fileContent = fs.readFileSync(filePath, 'utf8');
        return fileContent.split('\n').map(handle => handle.trim()).filter(handle => handle.length > 0);
    } catch (error) {
        console.error(chalk.red("Error reading BlueSky handles file:"), error.message);
        return [];
    }
}

const csvFilePath = 'AccountHandles.csv';

// Append a single record to the CSV file (add a status column)
function appendToCSV(handle, link, status = '') {
    const row = `"${handle}","${link}","${status}"\n`;
    fs.appendFileSync(csvFilePath, row, 'utf8');
}

// Initialize the CSV file with headers (overwrites at start)
function initializeCSV() {
    const headers = 'Handle,Link,Status\n';
    fs.writeFileSync(csvFilePath, headers, 'utf8');
}

// Write results to a styled HTML file
async function writeResultsToHtml(outputInstance = 'mastodon.social', existingCsvPath = null) {
    // Read already-followed handles from the existing CSV, if provided
    let alreadyFollowedHandles = new Set();
    let alreadyFollowedRows = [];
    if (existingCsvPath && fs.existsSync(existingCsvPath)) {
        try {
            const fileContent = fs.readFileSync(existingCsvPath, 'utf8');
            const records = parse(fileContent, {
                columns: true,
                skip_empty_lines: true
            });
            alreadyFollowedHandles = new Set(
                records
                    .map(record => {
                        const address = record['Account address'];
                        // Only count bsky.brid.gy accounts
                        if (address && address.endsWith('@bsky.brid.gy')) {
                            // Add both with and without leading @ for robust comparison
                            return [address.toLowerCase(), `@${address.toLowerCase()}`];
                        }
                        return [];
                    })
                    .flat()
                    .filter(Boolean)
            );
            // Prepare already-followed rows for the HTML
            alreadyFollowedRows = records
                .filter(record => record['Account address'] && record['Account address'].endsWith('@bsky.brid.gy'))
                .map(record => {
                    const address = record['Account address'];
                    const handle = `@${address}`;
                    const link = `https://${outputInstance}/@${address}`;
                    return {
                        handle,
                        address,
                        link,
                        status: 'Already followed',
                        statusClass: 'status-red',
                        searchLink: ''
                    };
                });
        } catch (e) {
            console.error(chalk.red('Error reading Mastodon CSV for already-followed accounts:'), e.message);
        }
    }

    try {
        const fileContent = fs.readFileSync(csvFilePath, 'utf8');
        const lines = fileContent.trim().split('\n');
        // Only include rows where status starts with "Bridged" AND not in already-followed
        let rows = lines.slice(1).map(line => {
            const match = line.match(/"([^"]*)","([^"]*)","([^"]*)"/);
            if (match) {
                const [, handle, , status] = match;
                const address = handle.replace(/^@/, ''); // e.g. monstercollie.bsky.social@bsky.brid.gy
                const link = `https://${outputInstance}/@${address}`;
                return { handle, address, link, status };
            }
            return null;
        }).filter(row =>
            row &&
            row.status &&
            row.status.toLowerCase().startsWith('bridged') &&
            !alreadyFollowedHandles.has(row.address.toLowerCase()) &&
            !alreadyFollowedHandles.has(row.handle.toLowerCase())
        );

        // Check if the profile exists on the instance for each row
        for (let row of rows) {
            const exists = await checkProfileExistsOnInstance(outputInstance, row.address);
            if (exists) {
                row.status = `Bridged, exists on instance`;
                row.statusClass = 'status-green';
                row.existsOnInstance = true;
                row.searchLink = '';
            } else {
                row.status = `Bridged, but does not exist on the instance`;
                row.statusClass = 'status-orange';
                row.existsOnInstance = false;
                const encoded = encodeURIComponent(`@${row.address}`);
                row.searchLink = `https://${outputInstance}/search?q=${encoded}`;
            }
        }

        // Sort: accounts that exist on the instance first
        rows.sort((a, b) => {
            if (a.existsOnInstance === b.existsOnInstance) return 0;
            return a.existsOnInstance ? -1 : 1;
        });

        // Combine: bridged rows first, then already-followed rows
        const allRows = [...rows, ...alreadyFollowedRows];

        const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Fediverse Radar: Bluesky → Mastodon Results</title>
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
    .status-orange { color: #FF8C00; font-weight: bold; }
    .status-red { color: #C00; font-weight: bold; }
  </style>
</head>
<body>
  <h1>Fediverse Radar: Bluesky → Mastodon Results</h1>
  <div class="count">${allRows.length} account${allRows.length === 1 ? '' : 's'} listed (${rows.length} newly bridged, ${alreadyFollowedRows.length} already followed)</div>
  <table>
    <tr>
      <th>Handle</th>
      <th>Link</th>
      <th>Status</th>
      <th>Search Link</th>
    </tr>
    ${allRows.map(row => `
      <tr>
        <td>${row.handle}</td>
        <td><a href="${row.link}" target="_blank">${row.link}</a></td>
        <td class="${row.statusClass || ''}">${row.status}</td>
        <td>${row.searchLink ? `<a href="${row.searchLink}" target="_blank">Search link</a>` : ''}</td>
      </tr>
    `).join('')}
  </table>
</body>
</html>
        `.trim();

        fs.writeFileSync('output.html', html, 'utf8');
        console.log(chalk.green(`HTML report saved as output.html (${allRows.length} total entries: ${rows.length} newly bridged, ${alreadyFollowedRows.length} already followed).`));
    } catch (err) {
        console.error(chalk.red('Error writing output.html:'), err.message);
    }
}

// Calculate and display the percentage of bridged accounts found, including already-followed
function showBridgedPercentage(bskyHandlesPath, csvFilePath, mastoCsvPath = null) {
    try {
        const bskyHandles = readHandlesFromFile(bskyHandlesPath);
        const bskySet = new Set(bskyHandles.map(h => h.trim().toLowerCase()));

        // Handles found in this run
        const csvContent = fs.readFileSync(csvFilePath, 'utf8');
        const bridgedHandles = csvContent
            .trim()
            .split('\n')
            .slice(1) // skip header
            .map(line => {
                const match = line.match(/"@([^@]+)@bsky\.brid\.gy"/);
                return match ? match[1].toLowerCase() : null;
            })
            .filter(Boolean);

        // Handles already followed in Mastodon CSV (if provided)
        let alreadyFollowedHandles = [];
        if (mastoCsvPath) {
            try {
                const fileContent = fs.readFileSync(mastoCsvPath, 'utf8');
                const records = parse(fileContent, {
                    columns: true,
                    skip_empty_lines: true
                });
                alreadyFollowedHandles = records
                    .map(record => {
                        const address = record['Account address'];
                        // Only count bsky.brid.gy accounts
                        if (address && address.endsWith('@bsky.brid.gy')) {
                            return address.split('@')[0].replace(/^@/, '').toLowerCase();
                        }
                        return null;
                    })
                    .filter(Boolean);
            } catch (e) {
                console.error(chalk.red('Error reading Mastodon CSV for already-followed accounts:'), e.message);
            }
        }

        // Union of found + already-followed, but only those in bskyHandles
        const bridgedSet = new Set([...bridgedHandles, ...alreadyFollowedHandles].filter(h => bskySet.has(h)));
        const bridgedCount = bridgedSet.size;
        const total = bskyHandles.length;
        const percent = total > 0 ? ((bridgedCount / total) * 100).toFixed(2) : '0.00';

        console.log(chalk.bold.cyan(
            `\n${bridgedCount} of ${total} BlueSky follows are now available to your Mastodon account (including already-followed). (${percent}%)`
        ));
    } catch (err) {
        console.error(chalk.red('Error calculating bridged percentage:'), err.message);
    }
}

// Fetch followers of a BSKY account using the public API
async function fetchFollowersHandles(actorHandleOrDid, maxEntries = null) {
    let cursor = undefined;
    let handles = [];
    let totalFetched = 0;
    while (true) {
        const url = `https://public.api.bsky.app/xrpc/app.bsky.graph.getFollowers?actor=${encodeURIComponent(actorHandleOrDid)}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}&limit=100`;
        try {
            const response = await axios.get(url);
            if (response.data && Array.isArray(response.data.followers)) {
                for (const follower of response.data.followers) {
                    if (follower.handle) handles.push(follower.handle);
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
            console.error(chalk.red(`Error fetching followers for ${actorHandleOrDid}: ${err.message}`));
            break;
        }
    }
    return handles;
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
                    if (follow.handle) handles.push(follow.handle);
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
    return handles;
}

// Check if a profile exists on a given instance
async function checkProfileExistsOnInstance(instance, address) {
    try {
        // Use the Mastodon API to check for account existence
        const url = `https://${instance}/api/v1/accounts/lookup?acct=${encodeURIComponent(address)}`;
        const response = await axios.get(url, { validateStatus: () => true });
        return response.status === 200;
    } catch (err) {
        return false;
    }
}

// Fetch accounts followed by the bridge account (ap.brid.gy)
async function fetchBridgeFollowingHandles(bridgeHandle = 'ap.brid.gy') {
    let cursor = undefined;
    let handles = [];
    let totalFetched = 0;

    // Print the static status line (in blue)
    process.stdout.write(chalk.cyan('Gathering bridge follows...\n'));
    // Print the dynamic count line (start with 0, in blue)
    process.stdout.write(chalk.cyan(`Bridge follows gathered: 0`));
    let lastLength = `Bridge follows gathered: 0`.length;

    while (true) {
        const url = `https://public.api.bsky.app/xrpc/app.bsky.graph.getFollows?actor=${encodeURIComponent(bridgeHandle)}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}&limit=100`;
        try {
            const response = await axios.get(url);
            if (response.data && Array.isArray(response.data.follows)) {
                for (const follow of response.data.follows) {
                    handles.push(follow.handle);
                    totalFetched++;
                    // Overwrite the count line in blue
                    const countStr = `Bridge follows gathered: ${totalFetched}`;
                    process.stdout.write(`\r${chalk.cyan(countStr)}${' '.repeat(Math.max(0, lastLength - countStr.length))}`);
                    lastLength = countStr.length;
                }
                if (response.data.cursor) {
                    cursor = response.data.cursor;
                } else {
                    break;
                }
            } else {
                break;
            }
        } catch (err) {
            process.stdout.write('\n');
            console.error(chalk.red(`Error fetching follows for ${bridgeHandle}: ${err.message}`));
            break;
        }
    }
    // When done, overwrite the count line in green and move to next line
    const doneStr = `Bridge follows gathered: ${totalFetched}`;
    process.stdout.write(`\r${chalk.green(doneStr)}${' '.repeat(Math.max(0, lastLength - doneStr.length))}\n`);
    return new Set(handles.map(h => h.toLowerCase()));
}

async function main(args = process.argv.slice(2)) {
    // Parse args, fetch follows, check bridge, write CSV/HTML, etc.
    const handleOrDid = args[0];
    if (!handleOrDid) {
        console.error(chalk.red('No Bluesky handle or DID provided.'));
        process.exit(1);
    }

    // Detect -c flag and get CSV path if present
    let existingCsvPath = null;
    const cIndex = args.indexOf('-c');
    if (cIndex !== -1 && args[cIndex + 1]) {
        existingCsvPath = args[cIndex + 1];
    }

    // Check for --instance argument
    let outputInstance = null;
    const instanceIndex = args.indexOf('--instance');
    if (instanceIndex !== -1 && args[instanceIndex + 1]) {
        outputInstance = args[instanceIndex + 1];
    }

    // Prompt for Mastodon instance only if not provided
    const defaultInstance = 'mastodon.social';
    if (!outputInstance) {
        outputInstance = readlineSync.question(
            chalk.bold(`Enter your Mastodon instance for profile links [${defaultInstance}]: `)
        ).trim() || defaultInstance;
    }

    // Fetch follows using your API helper
    process.stdout.write(chalk.cyan('Fetching your follows...'));
    const handles = await fetchUserFollowsHandles(handleOrDid);
    // Overwrite the previous line with the green completed status
    process.stdout.write(`\r${chalk.green('Fetching your follows... Done!')}\n`);

    initializeCSV();
    const bridgeFollowingSet = await fetchBridgeFollowingHandles('ap.brid.gy');

    // Loading bar for checking handles
    const total = handles.length;
    let loadingBarComplete = false;
    for (let i = 0; i < handles.length; i++) {
        const handle = handles[i];
        const fullHandle = `@${handle}@bsky.brid.gy`;
        const link = `https://${outputInstance}/@${handle}@bsky.brid.gy`;
        const isBridged = bridgeFollowingSet.has(handle.toLowerCase());
        const status = isBridged ? 'Bridged (via ap.brid.gy)' : 'Not bridged';

        appendToCSV(fullHandle, link, status);

        // Loading bar only (no per-handle output)
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

    // Pass the CSV path to the HTML writer!
    await writeResultsToHtml(outputInstance, existingCsvPath);
    console.log(chalk.green('\nDone!'));

    // Prompt to open the HTML file
    const htmlPath = path.resolve('output.html');
    if (readlineSync.keyInYNStrict(chalk.yellow('Open the HTML report (output.html) in your browser?'))) {
        try {
            await open(htmlPath);
            console.log(chalk.green('HTML report opened in your default browser.'));
        } catch (err) {
            console.warn(chalk.red('Could not open output.html:'), err.message);
        }
    }
}

module.exports = main;