#!/usr/bin/env node

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const readlineSync = require('readline-sync');
const _open = require('open');
const chalk = require('chalk').default;
const open = _open.default || _open;

// Print the CLI header with formatting
function printHeader() {
    console.log(chalk.blue.bold('\n=== Fediverse Radar CLI ===\n'));
}

// Remove generated files on exit
function cleanupGeneratedFiles() {
    const files = [
        path.join(__dirname, 'AccountHandles.csv'),
        path.join(__dirname, 'BlueSkyHandles.txt'),
        path.join(__dirname, 'output.csv'),
        path.join(__dirname, 'output.html')
    ];
    for (const file of files) {
        if (fs.existsSync(file)) {
            try {
                fs.unlinkSync(file);
            } catch (err) {
                console.warn(chalk.yellow(`Could not delete ${file}: ${err.message}`));
            }
        }
    }
}

// Helper to parse handle.config-like files
function parseConfigFile(configPath) {
    const config = {};
    const lines = fs.readFileSync(configPath, 'utf8').split(/\r?\n/);
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const [key, ...rest] = trimmed.split('=');
        if (key && rest.length) config[key.trim()] = rest.join('=').replace(/^['"]|['"]$/g, '').trim();
    }
    return config;
}

// Check for -f2 flag and run in config mode if present
if (process.argv.includes('-f2')) {
    const idx = process.argv.indexOf('-f2');
    const configPath = process.argv[idx + 1];
    if (!configPath || !fs.existsSync(configPath)) {
        console.error(chalk.red('Config file not found or not specified after -f2.'));
        process.exit(1);
    }
    const config = parseConfigFile(configPath);

    // Show config summary to user
    console.log(chalk.magenta.bold('\n=== Fediverse Radar Config Mode ==='));
    console.log(chalk.cyan('HANDLE:'), config.HANDLE || chalk.red('MISSING'));
    console.log(chalk.cyan('CHECK_INSTANCE:'), config.CHECK_INSTANCE || chalk.red('MISSING'));
    console.log(chalk.cyan('WRITE_INSTANCE:'), config.WRITE_INSTANCE || chalk.red('MISSING'));
    console.log(chalk.cyan('FILE_PATH:'), config.FILE_PATH || chalk.gray('(none, will not check CSV)'));
    console.log('');

    // Validate required fields
    if (!config.HANDLE || !config.CHECK_INSTANCE || !config.WRITE_INSTANCE) {
        console.error(chalk.red('Config file missing required fields (HANDLE, CHECK_INSTANCE, WRITE_INSTANCE).'));
        process.exit(1);
    }

    // Build args for bskyToMasto
    let args = [config.HANDLE];
    if (config.FILE_PATH) {
        args.push('-c', config.FILE_PATH);
    }
    process.env.BSKY_CHECK_INSTANCE = config.CHECK_INSTANCE;
    process.env.BSKY_WRITE_INSTANCE = config.WRITE_INSTANCE;
    const bskyToMasto = require('./bskyToMasto.js');
    (async () => {
        await bskyToMasto(args);

        if (readlineSync.keyInYNStrict(chalk.yellow('\nWould you like to clean up generated files?'))) {
            cleanupGeneratedFiles();
            console.log(chalk.green('Cleanup complete.'));
        }

        process.exit(0);
    })();
    return;
}

// Check for -f1 flag and run in config mode if present
if (process.argv.includes('-f1')) {
    const idx = process.argv.indexOf('-f1');
    const configPath = process.argv[idx + 1];
    if (!configPath || !fs.existsSync(configPath)) {
        console.error(chalk.red('Config file not found or not specified after -f1.'));
        process.exit(1);
    }
    const config = parseConfigFile(configPath);

    // Show config summary to user
    console.log(chalk.magenta.bold('\n=== Fediverse Radar Config Mode (Mastodon to Bluesky) ==='));
    console.log(chalk.cyan('HANDLE:'), config.HANDLE || chalk.red('MISSING'));
    console.log(chalk.cyan('CHECK_INSTANCE:'), config.CHECK_INSTANCE || chalk.red('MISSING'));
    console.log(chalk.cyan('WRITE_INSTANCE:'), config.WRITE_INSTANCE || chalk.red('MISSING'));
    console.log(chalk.cyan('FILE_PATH:'), config.FILE_PATH || chalk.red('MISSING'));
    console.log('');

    // Validate required fields
    if (!config.FILE_PATH) {
        console.error(chalk.red('Config file missing required field: FILE_PATH (Mastodon CSV).'));
        process.exit(1);
    }

    // Build args for mastoToBsky
    let args = [config.FILE_PATH];
    if (config.CHECK_INSTANCE) {
        args.push('-c');
    }
    if (config.HANDLE) {
        args.push('-f', config.HANDLE);
    }

    process.env.BSKY_CHECK_INSTANCE = config.CHECK_INSTANCE || '';
    process.env.BSKY_WRITE_INSTANCE = config.WRITE_INSTANCE || '';

    (async () => {
        const mastoToBsky = require('./mastoToBsky.js');
        await mastoToBsky(args);

        if (readlineSync.keyInYNStrict(chalk.yellow('\nWould you like to clean up generated files?'))) {
            cleanupGeneratedFiles();
            console.log(chalk.green('Cleanup complete.'));
        }

        process.exit(0);
    })();
    return;
}

// Main interactive menu loop
async function mainMenu() {
    printHeader();
    const options = [
        chalk.cyan('Convert Mastodon CSV to Bluesky (Mastodon to Bluesky)'),
        chalk.cyan('Convert Bluesky follows to Mastodon handles (Bluesky to Mastodon)')
    ];
    const index = readlineSync.keyInSelect(options, chalk.bold('Select an action:'), { cancel: chalk.red('Exit/Cleanup') });
    if (index === -1) {
        cleanupGeneratedFiles();
        console.log(chalk.magenta.bold('Goodbye!'));
        process.exit(0);
    }
    switch (index) {
        case 0: { // Mastodon to Bluesky conversion
            let inputCsv = readlineSync.question(chalk.bold('Enter the path to the Mastodon CSV file: '));
            inputCsv = inputCsv.trim().replace(/^['"]+|['"]+$/g, '');
            const check = readlineSync.keyInYNStrict(chalk.yellow('Check account existence?'));
            let followCheckArgs = [];
            if (readlineSync.keyInYNStrict(chalk.yellow('Omit accounts you already follow on Bluesky?'))) {
                const bskyHandleOrDid = readlineSync.question(chalk.bold('Enter your Bluesky handle or DID: '));
                followCheckArgs = ['-f', bskyHandleOrDid];
            }
            console.log(chalk.cyan('Running mastoToBsky...'));
            const mastoToBsky = require('./mastoToBsky.js');
            await mastoToBsky([inputCsv, ...(check ? ['-c'] : []), ...followCheckArgs]);
            const htmlPath = path.resolve('output.html');
            if (process.platform === 'win32') {
                console.log(chalk.yellow('\nTo view the HTML report, open the following file in your browser:'));
                console.log(chalk.cyan.bold(htmlPath));
                console.log(chalk.gray('Tip: You can run ') + chalk.whiteBright('start output.html') + chalk.gray(' in your terminal.'));
            } else if (readlineSync.keyInYNStrict(chalk.yellow('Open the HTML report (output.html) in your browser?'))) {
                try {
                    await open(htmlPath);
                    console.log(chalk.green('Open command issued using open package.'));
                } catch (err) {
                    console.warn(chalk.red('Could not open output.html:'), err.message);
                }
            }
            break;
        }
        case 1: { // Bluesky to Mastodon conversion
            const handleOrDid = readlineSync.question(chalk.bold('Enter the Bluesky handle or DID to fetch follows from: '));
            let args = [handleOrDid];
            if (readlineSync.keyInYNStrict(chalk.yellow('Check mode (filter duplicates with CSV)?'))) {
                let csvPath = readlineSync.question(chalk.bold('Enter the path to the existing CSV: '));
                csvPath = csvPath.trim().replace(/^['"]+|['"]+$/g, '');
                args.push('-c', csvPath);
            }
            console.log(chalk.cyan('Running bskyToMasto...'));
            const bskyToMasto = require('./bskyToMasto.js');
            await bskyToMasto(args);
            const htmlPath = path.resolve('output.html');
            if (readlineSync.keyInYNStrict(chalk.yellow('Open the HTML report (output.html) in your browser?'))) {
                try {
                    if (process.platform === 'win32') {
                        require('child_process').spawn('cmd', ['/c', 'start', '', htmlPath], { shell: true, stdio: 'ignore', detached: true });
                        console.log(chalk.green('Open command issued using Windows cmd start.'));
                    } else {
                        await open(htmlPath);
                        console.log(chalk.green('Open command issued using open package.'));
                    }
                } catch (err) {
                    console.warn(chalk.red('Could not open output.html:'), err.message);
                }
            }
            break;
        }
        default:
            console.log(chalk.red('Unknown option.'));
    }
    // Return to the menu after the selected operation completes
    await mainMenu();
}

mainMenu();