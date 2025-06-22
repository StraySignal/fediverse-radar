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

// Run a script as a child process and exit when done
function runScript(script, args) {
    const proc = spawn('node', [script, ...args], { stdio: 'inherit' });
    proc.on('close', code => process.exit(code));
}

// Ensure the atproto-export repo is present and dependencies are installed
async function ensureAtprotoExportRepo() {
    const repoDir = path.resolve(__dirname, 'atproto-export');
    if (!fs.existsSync(repoDir)) {
        console.log(chalk.yellow('Cloning atproto-export repository...'));
        await new Promise((resolve, reject) => {
            const git = spawn('git', ['clone', 'https://github.com/rdp-studio/atproto-export.git'], { stdio: 'inherit' });
            git.on('close', code => code === 0 ? resolve() : reject(new Error('git clone failed')));
            git.on('error', err => reject(err));
        });
    }
    if (!fs.existsSync(repoDir)) {
        throw new Error(chalk.red(`Repo directory does not exist after clone: ${repoDir}`));
    }
    const nodeModulesDir = path.join(repoDir, 'node_modules');
    if (!fs.existsSync(nodeModulesDir)) {
        console.log(chalk.yellow('Installing dependencies for atproto-export...'));
        await new Promise((resolve, reject) => {
            const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
            try {
                const npm = spawn(npmCmd, ['install'], { cwd: repoDir, stdio: 'inherit', shell: process.platform === 'win32' });
                npm.on('close', code => code === 0 ? resolve() : reject(new Error('npm install failed')));
                npm.on('error', err => reject(err));
            } catch (err) {
                reject(new Error('Failed to spawn npm install: ' + err.message));
            }
        });
    }
    return repoDir;
}

// Run the atproto-export script for a given handle or DID
async function runAtprotoExport(args) {
    const handleOrDid = args[0];
    const outDir = handleOrDid;
    const repoDir = await ensureAtprotoExportRepo();
    const exportScript = path.join(repoDir, 'bin', 'export.js');
    if (!fs.existsSync(exportScript)) {
        console.error(chalk.red('Could not find atproto-export export.js script.'));
        process.exit(1);
    }
    const exportArgs = [exportScript, '--no-blobs', '-o', outDir, handleOrDid];
    return new Promise((resolve, reject) => {
        const proc = spawn('node', exportArgs, { stdio: 'inherit', cwd: repoDir });
        proc.on('close', code => {
            if (code === 0) resolve();
            else reject(new Error('Export process failed'));
        });
        proc.on('error', err => reject(err));
    });
}

// Ensure export exists and return the path to the exported follows directory
async function ensureExportAndGetFollowPath(handleOrDid) {
    const repoDir = await ensureAtprotoExportRepo();
    const exportBase = path.join(repoDir, '..', 'atproto-export');
    const exportDir = path.join(exportBase, handleOrDid);

    if (!fs.existsSync(exportDir)) {
        await runAtprotoExport([handleOrDid]);
    }

    // Find the did-* directory inside exportDir
    let didDir = null;
    if (fs.existsSync(exportDir)) {
        const subdirs = fs.readdirSync(exportDir, { withFileTypes: true });
        for (const sub of subdirs) {
            if (sub.isDirectory() && sub.name.startsWith('did-')) {
                didDir = path.join(exportDir, sub.name);
                break;
            }
        }
    }
    if (!didDir || !fs.existsSync(didDir)) {
        throw new Error(chalk.red('Could not find DID directory after export.'));
    }

    // Find the app.bsky.graph.follow directory inside didDir
    const followDir = path.join(didDir, 'app.bsky.graph.follow');
    if (!fs.existsSync(followDir) || !fs.lstatSync(followDir).isDirectory()) {
        throw new Error(chalk.red('Could not find app.bsky.graph.follow directory in export.'));
    }
    return followDir;
}

// Remove the atproto-export directory
function cleanupAtprotoExport() {
    const repoDir = path.resolve(__dirname, 'atproto-export');
    if (fs.existsSync(repoDir)) {
        console.log(chalk.yellow('Cleaning up atproto-export directory...'));
        fs.rmSync(repoDir, { recursive: true, force: true });
    }
}

// Remove generated files on exit
function cleanupGeneratedFiles() {
    const files = [
        path.join(__dirname, 'AccountHandles.csv'),
        path.join(__dirname, 'BlueSkyHandles.txt'),
        path.join(__dirname, 'output.csv')
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

// Main interactive menu loop
async function mainMenu() {
    printHeader();
    const options = [
        chalk.cyan('Convert Mastodon CSV to Bluesky (Mastodon to Bluesky)'),
        chalk.cyan('Convert Bluesky follows to Mastodon handles (Bluesky to Mastodon)'),
        chalk.cyan('Export atproto data (atproto-export)')
    ];
    const index = readlineSync.keyInSelect(options, chalk.bold('Select an action:'), { cancel: chalk.red('Exit') });
    if (index === -1) {
        cleanupAtprotoExport();
        cleanupGeneratedFiles();
        console.log(chalk.magenta.bold('Goodbye!'));
        process.exit(0);
    }
    switch (index) {
        case 0: { // Mastodon to Bluesky conversion
            const inputCsv = readlineSync.question(chalk.bold('Enter the path to the Mastodon CSV file: '));
            const check = readlineSync.keyInYNStrict(chalk.yellow('Check account existence?'));
            let followCheckArgs = [];
            if (readlineSync.keyInYNStrict(chalk.yellow('Omit accounts you already follow on Bluesky?'))) {
                const bskyHandleOrDid = readlineSync.question(chalk.bold('Enter your Bluesky handle or DID: '));
                followCheckArgs = ['-f', bskyHandleOrDid];
            }
            console.log(chalk.cyan('Running mastoToBsky...'));
            const mastoToBsky = require('./mastoToBsky.js');
            await mastoToBsky([inputCsv, ...(check ? ['-c'] : []), ...followCheckArgs]);
            // Prompt to open HTML file
            const htmlPath = path.resolve('output.html');
            if (process.platform === 'win32') {
                // On Windows, instruct the user to open the file manually
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
            const handleOrDid = readlineSync.question(chalk.bold('Enter the Bluesky handle or DID to export follows from: '));
            let followPath;
            try {
                console.log(chalk.yellow('Ensuring atproto-export repo and exporting follows...'));
                followPath = await ensureExportAndGetFollowPath(handleOrDid);
                console.log(chalk.green('Using exported follows from: ') + chalk.underline(followPath));
            } catch (err) {
                console.error(chalk.red('Error exporting follows: ') + chalk.redBright(err.message));
                return mainMenu();
            }
            let args = [followPath];
            if (readlineSync.keyInYNStrict(chalk.yellow('Check mode (filter duplicates with CSV)?'))) {
                const csvPath = readlineSync.question(chalk.bold('Enter the path to the existing CSV: '));
                args.push('-c', csvPath);
            }
            console.log(chalk.cyan('Running bskyToMasto...'));
            const bskyToMasto = require('./bskyToMasto.js');
            await bskyToMasto(args);
            // Prompt to open HTML file
            const htmlPath = path.resolve('output.html');
            if (readlineSync.keyInYNStrict(chalk.yellow('Open the HTML report (output.html) in your browser?'))) {
                try {
                    if (process.platform === 'win32') {
                        // Use cmd /c start "" "path\to\output.html" for best Windows compatibility
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
        case 2: { // Export atproto data
            const handleOrDid = readlineSync.question(chalk.bold('Enter the handle or DID to export: '));
            const outDir = readlineSync.question(chalk.bold('Enter output directory (default: .): '), { defaultInput: '.' });
            await runAtprotoExport([handleOrDid, outDir]);
            break;
        }
        default:
            console.log(chalk.red('Unknown option.'));
    }
    // Return to the menu after the selected operation completes
    await mainMenu();
}

mainMenu();