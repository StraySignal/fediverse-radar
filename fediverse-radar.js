#!/usr/bin/env node

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const glob = require('glob');
const readlineSync = require('readline-sync');

function printHeader() {
    console.log('\n=== Fediverse Radar CLI ===\n');
}

function runScript(script, args) {
    const proc = spawn('node', [script, ...args], { stdio: 'inherit' });
    proc.on('close', code => process.exit(code));
}

async function ensureAtprotoExportRepo() {
    const repoDir = path.resolve(__dirname, 'atproto-export');
    if (!fs.existsSync(repoDir)) {
        console.log('Cloning atproto-export repository...');
        await new Promise((resolve, reject) => {
            const git = spawn('git', ['clone', 'https://github.com/rdp-studio/atproto-export.git'], { stdio: 'inherit' });
            git.on('close', code => code === 0 ? resolve() : reject(new Error('git clone failed')));
            git.on('error', err => reject(err));
        });
    }
    if (!fs.existsSync(repoDir)) {
        throw new Error(`Repo directory does not exist after clone: ${repoDir}`);
    }
    const nodeModulesDir = path.join(repoDir, 'node_modules');
    if (!fs.existsSync(nodeModulesDir)) {
        console.log('Installing dependencies for atproto-export...');
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

async function runAtprotoExport(args) {
    const handleOrDid = args[0];
    const outDir = handleOrDid;
    const repoDir = await ensureAtprotoExportRepo();
    const exportScript = path.join(repoDir, 'bin', 'export.js');
    if (!fs.existsSync(exportScript)) {
        console.error('Could not find atproto-export export.js script.');
        process.exit(1);
    }
    const exportArgs = [exportScript, '--no-blobs', '-o', outDir, handleOrDid];
    // Return a promise that resolves when the export process finishes
    return new Promise((resolve, reject) => {
        const proc = spawn('node', exportArgs, { stdio: 'inherit', cwd: repoDir });
        proc.on('close', code => {
            if (code === 0) resolve();
            else reject(new Error('Export process failed'));
        });
        proc.on('error', err => reject(err));
    });
}

async function ensureExportAndGetFollowPath(handleOrDid) {
    const repoDir = await ensureAtprotoExportRepo();
    const exportBase = path.join(repoDir, '..', 'atproto-export');
    const exportDir = path.join(exportBase, handleOrDid);

    // Always export to handleOrDid directory if not present
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
        throw new Error('Could not find DID directory after export.');
    }

    // Find the app.bsky.graph.follow directory inside didDir
    const followDir = path.join(didDir, 'app.bsky.graph.follow');
    if (!fs.existsSync(followDir) || !fs.lstatSync(followDir).isDirectory()) {
        throw new Error('Could not find app.bsky.graph.follow directory in export.');
    }
    return followDir;
}

function cleanupAtprotoExport() {
    const repoDir = path.resolve(__dirname, 'atproto-export');
    if (fs.existsSync(repoDir)) {
        console.log('Cleaning up atproto-export directory...');
        fs.rmSync(repoDir, { recursive: true, force: true });
    }
}

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
                // Optionally, log: console.log(`Deleted ${file}`);
            } catch (err) {
                console.warn(`Could not delete ${file}: ${err.message}`);
            }
        }
    }
}

async function mainMenu() {
    printHeader();
    const options = [
        'Convert Mastodon CSV to Bluesky (Mastodon to Bluesky)',
        'Convert Bluesky follows to Mastodon handles (Bluesky to Mastodon)',
        'Export atproto data (export-atproto)',
        'Exit'
    ];
    const index = readlineSync.keyInSelect(options, 'Select an action:');
    if (index === -1 || options[index] === 'Exit') {
        cleanupAtprotoExport();
        cleanupGeneratedFiles(); // <-- Only clean up on exit/cancel
        console.log('Goodbye!');
        process.exit(0);
    }
    switch (index) {
        case 0: { // masto-to-bsky
            const inputCsv = readlineSync.question('Enter the path to the Mastodon CSV file: ');
            const check = readlineSync.keyInYNStrict('Check account existence?');
            // --- Add this block for follow-check ---
            let followCheckArgs = [];
            if (readlineSync.keyInYNStrict('Omit accounts you already follow on Bluesky?')) {
                const bskyHandleOrDid = readlineSync.question('Enter your Bluesky handle or DID: ');
                followCheckArgs = ['-f', bskyHandleOrDid];
            }
            // --- End block ---
            console.log('Running mastoToBsky...');
            const mastoToBsky = require('./mastoToBsky.js');
            await mastoToBsky([inputCsv, ...(check ? ['-c'] : []), ...followCheckArgs]);
            break;
        }
        case 1: { // bsky-to-masto (from exported follows)
            const handleOrDid = readlineSync.question('Enter the Bluesky handle or DID to export follows from: ');
            let followPath;
            try {
                console.log('Ensuring atproto-export repo and exporting follows...');
                followPath = await ensureExportAndGetFollowPath(handleOrDid);
                console.log('Using exported follows from:', followPath);
            } catch (err) {
                console.error('Error exporting follows:', err.message);
                return mainMenu();
            }
            let args = [followPath]; // This is the directory to pass!
            if (readlineSync.keyInYNStrict('Test mode?')) {
                const num = readlineSync.questionInt('How many entries to process? ');
                args.push('-t', num.toString());
            }
            if (readlineSync.keyInYNStrict('Check mode (filter duplicates with CSV)?')) {
                const csvPath = readlineSync.question('Enter the path to the existing CSV: ');
                args.push('-c', csvPath); // Only add CSV path for -c flag
            }
            if (readlineSync.keyInYNStrict('Use existing BlueSkyHandles.txt?')) {
                args.push('-e');
            }
            console.log('Running bskyToMasto...');
            const bskyToMasto = require('./bskyToMasto.js');
            await bskyToMasto(args);
            break;
        }
        case 2: { // export-atproto
            const handleOrDid = readlineSync.question('Enter the handle or DID to export: ');
            const outDir = readlineSync.question('Enter output directory (default: .): ', { defaultInput: '.' });
            await runAtprotoExport([handleOrDid, outDir]);
            break;
        }
        default:
            console.log('Unknown option.');
    }
    // Only call mainMenu again after the operation is finished
    await mainMenu();
}

mainMenu();