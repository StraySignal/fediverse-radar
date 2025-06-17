const fs = require('fs');
const path = require('path');
const csvWriter = require('csv-writer').createObjectCsvWriter;
const axios = require('axios');
const readlineSync = require('readline-sync');
const { parse } = require('csv-parse/sync');

// Function to read all files in a directory
function readDirectory(directory) {
    return fs.readdirSync(directory);
}

// Function to read JSON file
function readJSONFile(filePath) {
    const fileContent = fs.readFileSync(filePath);
    return JSON.parse(fileContent);
}

// Function to extract handles from JSON files
async function extractHandles(directory, instance, numEntries) {
    const files = readDirectory(directory);
    let handles = [];
    const numFilesToProcess = numEntries ? Math.min(files.length, numEntries) : files.length;

    for (let i = 0; i < numFilesToProcess; i++) {
        const filePath = path.join(directory, files[i]);
        const jsonData = readJSONFile(filePath);
        const did = jsonData.subject;

        if (did) {
            process.stdout.write(`Fetching handle ${i + 1}/${numFilesToProcess}...`);
            const handle = await resolveHandleWithDelay(did, instance);
            if (handle) {
                handles.push(handle);
            }
            process.stdout.write('\r'); // Clear loading text
        }
    }

    return handles;
}

// Function to resolve handle to DID with delay between batches
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

// Function to check if Mastodon account exists (now always cycles)
async function checkMastodonAccount(handle, instance) {
    try {
        const response = await axios.get(`https://${instance}/api/v2/search?q=${handle}@bsky.brid.gy`);
        if (response.data.accounts.length > 0) {
            console.log(`Found on ${instance}`); // Indicate which instance it was found on
            return { exists: true, instance }; // Return true and the instance
        }
    } catch (error) {
        if (error.response && error.response.status === 429) {
            return { exists: false, instance, rateLimited: true }; // Indicate rate limiting
        }
        console.error(`Error checking Mastodon on ${instance}:`, error.message);
    }
    return { exists: false, instance }; // Return false if not found on the instance
}

// Function to introduce delay
function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Function to write BlueSky handles to a file
function writeHandlesToFile(handles) {
    const filePath = 'BlueSkyHandles.txt';
    fs.writeFileSync(filePath, handles.join('\n'), 'utf8');
    console.log(`BlueSky handles written to ${filePath}`);
}

// Function to read existing CSV and return an array of unique handles (with extra debug)
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
            // console.log(`CSV Handle (Before Trim): "${handle}" Length: ${handle.length} Code Points: ${[...handle].map(c => c.charCodeAt(0))}`); // Debug: Show code points
            return handle;
        });
        const uniqueHandles = handles.filter((handle, index, self) => self.indexOf(handle) === index);
        // console.log("Unique CSV Handles (After Filter):", uniqueHandles);
        return uniqueHandles;

    } catch (error) {
        console.error("Error reading existing CSV:", error.message);
        return [];
    }
}

// Function to read BlueSky handles from a file
function readHandlesFromFile(filePath) {
    try {
        const fileContent = fs.readFileSync(filePath, 'utf8');
        return fileContent.split('\n').map(handle => handle.trim()).filter(handle => handle.length > 0);
    } catch (error) {
        console.error("Error reading BlueSky handles file:", error.message);
        return [];
    }
}

// Main function
async function main(args = process.argv.slice(2)) {
    let directory = null;
    let csvPath = null;
    let testMode = false;
    let testNum = 0;
    let useExisting = false;

    // Parse arguments
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
        console.error('Please provide the directory path as an argument or use the -e flag.');
        process.exit(1);
    }

    const mastodonInstanceInput = readlineSync.question('Enter your Mastodon instance (e.g., furries.club): ');
    const outputInstance = mastodonInstanceInput; // Store the user-entered instance for output

    let handles = [];
    if (useExisting) {
        handles = readHandlesFromFile('BlueSkyHandles.txt');
        if (handles.length === 0) {
            console.error("No handles found in BlueSkyHandles.txt.");
            return;
        }
    } else {
        handles = await extractHandles(directory, mastodonInstanceInput, testMode ? testNum : null);
        writeHandlesToFile(handles);
    }

    let existingHandles = [];
    if (csvPath) {
        existingHandles = readExistingCSV(csvPath);
        // console.log("Existing Handles (Length: " + existingHandles.length + "):", existingHandles);
    }

    // Filter out handles that already exist in the CSV file
    const filteredHandles = handles.filter(handle => typeof handle === 'string' && !existingHandles.includes(handle.trim()));

    const mastodonHandles = [];
    const errors = [];
    let instanceIndex = 0;
    let checkCount = 0;

    for (let i = 0; i < filteredHandles.length; i++) {
        let handle = filteredHandles[i].trim();
        const fullHandle = `@${handle}@bsky.brid.gy`;

        process.stdout.clearLine();
        process.stdout.cursorTo(0);
        process.stdout.write(`Checking handle ${i + 1}/${filteredHandles.length} (${handle})...`);

        if (checkCount >= 299) {
            instanceIndex++;
            checkCount = 0;
        }

        const mastodonCheckResult = await checkMastodonAccount(handle, mastodonInstanceInput); // Pass the user-input instance
        const mastodonExists = mastodonCheckResult.exists;
        const mastodonInstanceChecked = mastodonCheckResult.instance;

        if (mastodonCheckResult.rateLimited) {
            instanceIndex++;
            checkCount = 0;
            i--; // Re-check the current handle with the next instance
            continue;
        }

        if (mastodonExists) {
            process.stdout.clearLine();
            process.stdout.cursorTo(0);
            process.stdout.write(`Checking handle ${i + 1}/${filteredHandles.length} (${handle})... (Found on Mastodon)\r`);
            mastodonHandles.push({
                handle: fullHandle,
                link: `https://${outputInstance}/@${handle}@bsky.brid.gy` // Always use user-input instance
            });
        } else {
            process.stdout.clearLine();
            process.stdout.cursorTo(0);
            process.stdout.write(`Checking handle ${i + 1}/${filteredHandles.length} (${handle})... (Not found on ${mastodonInstanceChecked})\r`);
        }

        if (mastodonCheckResult.error) {
            errors.push(`Handle: ${handle}, Error: ${mastodonCheckResult.error}`);
        }

        checkCount++;
    }

    const csvWriterInstance = csvWriter({
        path: 'AccountHandles.csv',
        header: [
            { id: 'handle', title: 'Handle' },
            { id: 'link', title: 'Link' }
        ],
        append: csvPath ? true : false
    });

    csvWriterInstance.writeRecords(mastodonHandles)
        .then(() => console.log('\nCSV file created successfully.'))
        .catch(err => console.error('Error writing CSV:', err));

    if (errors.length > 0) {
        console.error('\nErrors encountered during fetching:');
        errors.forEach(error => console.error(error));
    }
}

module.exports = main;

if (require.main === module) {
    main();
}