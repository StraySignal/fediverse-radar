const fs = require('fs');
const csv = require('csv-parser');
const { write } = require('fast-csv');
const axios = require('axios');
const { promisify } = require('util');

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

// Check if the filename and optional -c flag are provided as command-line arguments
const inputFilename = process.argv[2];
const checkFlag = process.argv.includes('-c');
const outputFilename = 'output.csv';
const results = [];
const requestQueue = [];
let requestsInProgress = 0;
let csvReadFinished = false;

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
    csvReadFinished = true;
    await processRequestQueue();
    writeResultsToFile();
  })
  .on('error', (error) => {
    console.error(`Error reading CSV: ${error.message}`);
    writeResultsToFile();
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
  const ws = fs.createWriteStream(outputFilename);
  write(results, { headers: true })
    .pipe(ws)
    .on('finish', () => {
      console.log(`Conversion complete. The updated addresses are saved in '${outputFilename}'.`);
    });
}
