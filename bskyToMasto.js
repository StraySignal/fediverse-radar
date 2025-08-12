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

// Initialize the CSV file with headers (overwrites at start)
function initializeCSV() {
    const headers = 'Handle,Link\n';
    fs.writeFileSync(csvFilePath, headers, 'utf8');
}

// Append a single record to the CSV file
function appendToCSV(handle, link) {
    const row = `"${handle}","${link}"\n`;
    fs.appendFileSync(csvFilePath, row, 'utf8');
}

// Write results to a styled HTML file
function writeResultsToHtml() {
    try {
        const fileContent = fs.readFileSync(csvFilePath, 'utf8');
        const lines = fileContent.trim().split('\n');
        const rows = lines.slice(1).map(line => {
            const [handle, link] = line.match(/"([^"]*)","([^"]*)"/).slice(1, 3);
            return { handle, link };
        });

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
  </style>
</head>
<body>
  <h1>Fediverse Radar: Bluesky → Mastodon Results</h1>
  <div class="count">${rows.length} account${rows.length === 1 ? '' : 's'} found</div>
  <table>
    <tr>
      <th>Handle</th>
      <th>Link</th>
    </tr>
    ${rows.map(row => `
      <tr>
        <td>${row.handle}</td>
        <td><a href="${row.link}" target="_blank">${row.link}</a></td>
      </tr>
    `).join('')}
  </table>
</body>
</html>
        `.trim();

        fs.writeFileSync('output.html', html, 'utf8');
        console.log(chalk.green(`HTML report saved as output.html (${rows.length} entries).`));
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

// Main entry point for the conversion process
async function main(args = process.argv.slice(2)) {
    let directory = null;
    let csvPath = null;
    let testMode = false;
    let testNum = 0;
    let useExisting = false;

    // Parse CLI arguments
    for (let i = 0; i < args.length; i++) {
        if (args[i] === '-c' && args[i + 1]) {
            csvPath = args[i + 1];
            i++;
        } else if (args[i] === '-t' && args[i + 1]) {
            testMode = true;
            testNum = parseInt(args[i + 1], 10);
            i++;
        } else if (args[i] === '-e') {
            useExisting = true;
        } else if (!directory) {
            directory = args[i];
        }
    }

    if (!directory && !useExisting) {
        console.error(chalk.red('Please provide the directory path as an argument or use the -e flag.'));
        process.exit(1);
    }

    const mastodonInstanceInput = process.env.BSKY_CHECK_INSTANCE ||
        readlineSync.question(
            chalk.bold('Enter the Mastodon instance to CHECK (e.g., mastodon.social): ')
        );
    const outputInstance = process.env.BSKY_WRITE_INSTANCE ||
        readlineSync.question(
            chalk.bold('Enter the Mastodon instance to WRITE (e.g., vivaldi.social): ')
        );

    let handles = [];
    if (useExisting) {
        handles = readHandlesFromFile('BlueSkyHandles.txt');
        if (handles.length === 0) {
            console.error(chalk.red("No handles found in BlueSkyHandles.txt."));
            return;
        }
    } else {
        handles = await extractHandles(directory, mastodonInstanceInput, testMode ? testNum : null);
        writeHandlesToFile(handles);
    }

    let existingHandles = [];
    if (csvPath) {
        existingHandles = readExistingCSV(csvPath);
    }

    // Filter out handles that already exist in the CSV file
    const filteredHandles = handles.filter(handle => typeof handle === 'string' && !existingHandles.includes(handle.trim()));

    const errors = [];
    let instanceIndex = 0;
    let checkCount = 0;

    // Initialize the CSV file
    initializeCSV();

    for (let i = 0; i < filteredHandles.length; i++) {
        let handle = filteredHandles[i].trim();
        const fullHandle = `@${handle}@bsky.brid.gy`;

        process.stdout.clearLine();
        process.stdout.cursorTo(0);
        process.stdout.write(chalk.cyan(`Checking handle ${i + 1}/${filteredHandles.length} (${handle})...`));

        if (checkCount >= 299) {
            instanceIndex++;
            checkCount = 0;
        }

        // Check existence on the CHECK instance
        const mastodonCheckResult = await checkMastodonAccount(handle, mastodonInstanceInput);
        const mastodonExists = mastodonCheckResult.exists;
        const mastodonInstanceChecked = mastodonCheckResult.instance;

        if (mastodonCheckResult.rateLimited) {
            instanceIndex++;
            checkCount = 0;
            i--;
            continue;
        }

        if (mastodonExists) {
            process.stdout.clearLine();
            process.stdout.cursorTo(0);
            process.stdout.write(chalk.green(`Checking handle ${i + 1}/${filteredHandles.length} (${handle})... (Found on Mastodon)\r`));
            // Write the link for the WRITE instance
            const link = `https://${outputInstance}/@${handle}@bsky.brid.gy`;
            appendToCSV(fullHandle, link);
        } else {
            process.stdout.clearLine();
            process.stdout.cursorTo(0);
            process.stdout.write(chalk.yellow(`Checking handle ${i + 1}/${filteredHandles.length} (${handle})... (Not found on ${mastodonInstanceChecked})\r`));
        }

        if (mastodonCheckResult.error) {
            errors.push(`Handle: ${handle}, Error: ${mastodonCheckResult.error}`);
        }

        checkCount++;
    }

    if (errors.length > 0) {
        console.error(chalk.red('\nErrors encountered during fetching:'));
        errors.forEach(error => console.error(chalk.red(error)));
    }

    // Write results to HTML at the end
    writeResultsToHtml();

    // Always prompt to open the HTML report
    const wantOpenHtml = readlineSync.keyInYNStrict(
        chalk.bold('\nDo you want to open the output.html report in your browser?')
    );
    if (wantOpenHtml) {
        try {
            await open('output.html');
        } catch (err) {
            console.error(chalk.red('Could not open output.html in browser:'), err.message);
        }
    }

    // Show percentage of bridged accounts
    showBridgedPercentage('BlueSkyHandles.txt', csvFilePath, csvPath);

    // After main loop, before writing results:
    // Find unbridged handles
    const allHandlesSet = new Set(
        handles
            .filter(h => typeof h === 'string')
            .map(h => h.trim().toLowerCase())
    );
    const bridgedHandlesSet = new Set();
    // Get bridged handles from output CSV
    const csvContent = fs.readFileSync(csvFilePath, 'utf8');
    csvContent
        .trim()
        .split('\n')
        .slice(1)
        .forEach(line => {
            const match = line.match(/"@([^@]+)@bsky\.brid\.gy"/);
            if (match) bridgedHandlesSet.add(match[1].toLowerCase());
        });

    // Also add already-followed bridged handles from masto CSV if present
    if (csvPath) {
        try {
            const fileContent = fs.readFileSync(csvPath, 'utf8');
            const records = parse(fileContent, {
                columns: true,
                skip_empty_lines: true
            });
            records.forEach(record => {
                const address = record['Account address'];
                if (address && address.endsWith('@bsky.brid.gy')) {
                    const h = address.split('@')[0].replace(/^@/, '').toLowerCase();
                    bridgedHandlesSet.add(h);
                }
            });
        } catch (e) {
            console.error(chalk.red('Error reading Mastodon CSV for already-followed accounts:'), e.message);
        }
    }

    const unbridgedHandles = Array.from(allHandlesSet).filter(h => !bridgedHandlesSet.has(h));

    if (unbridgedHandles.length > 0) {
        const wantUnbridged = readlineSync.keyInYNStrict(
            chalk.bold('\nDo you want to output a file of all accounts that are NOT bridged?')
        );
        if (wantUnbridged) {
            const wantMsg = readlineSync.keyInYNStrict(
                chalk.bold('Do you want to include a bridge request message for each account?')
            );
            // Prepare output
            let output = 'Handle,BlueSky Link' + (wantMsg ? ',Bridge Request Message' : '') + '\n';
            unbridgedHandles.forEach(handle => {
                const bskyLink = `https://bsky.app/profile/${handle}`;
                const msg = wantMsg ? `"@bsky.brid.gy@bsky.brid.gy ${handle}"` : '';
                output += `${handle},${bskyLink}${wantMsg ? ',' + msg : ''}\n`;
            });
            const outFile = 'UnbridgedAccounts.csv';
            fs.writeFileSync(outFile, output, 'utf8');
            console.log(chalk.yellow(`\nUnbridged account list saved as ${outFile} (${unbridgedHandles.length} entries).`));
        }
    }
}

module.exports = main;

if (require.main === module) {
    main();
}