# Fediverse Radar

This tool helps you bridge your Mastodon and Bluesky accounts by checking for bridged accounts and exporting/importing follows.  
**All features are now accessible through the interactive CLI: `fediverse-radar.js`.**

---

## Usage

### 1. Install dependencies

```sh
npm install
```

### 2. Start the CLI

```sh
node fediverse-radar.js
```

You will be presented with an interactive menu to:

- Convert Mastodon CSV to Bluesky (Mastodon to Bluesky)
- Convert Bluesky follows to Mastodon handles (Bluesky to Mastodon)
- Export atproto data
- Exit

---

## Features

### Convert Mastodon CSV to Bluesky

- Takes your Mastodon following accounts CSV export and checks for corresponding bridged Bluesky accounts using [Bridgy Fed](https://fed.brid.gy/).
- For each converted Bluesky account, the tool checks if the account actually exists and is reachable on Bluesky.
- Optionally, you can check your current Bluesky follows using [atproto-export](https://github.com/rdp-studio/atproto-export) to avoid including accounts you already follow.
- Only accounts that are confirmed to exist, are accessible, and are not already followed will be included in the output.
- The results are saved as `output.csv` in your project directory.

### Convert Bluesky follows to Mastodon handles

- Exports your Bluesky follows using [atproto-export](https://github.com/rdp-studio/atproto-export) (automatically handled by the CLI).
- Checks Mastodon for bridged Bluesky accounts.
- Supports filtering, test mode, and using existing handle files.

### Export atproto data

- Exports your Bluesky account data using [atproto-export](https://github.com/rdp-studio/atproto-export).
- The CLI will prompt for your handle or DID and manage the export process for you.

---

## Output

- Results are saved as `output.csv` in your project directory.
- Temporary files and exports are cleaned up when you exit the CLI.

---

## No Direct Script Usage

**You no longer need to run `mastoToBsky.js` or `bskyToMasto.js` directly.**  
All functionality is available through the interactive CLI (`fediverse-radar.js`).

---

## Future Plans

- Further integration and automation of export/import flows.
- Improved error handling and user experience.
- More output and filtering options.

---

## Credits

- [Bridgy Fed](https://fed.brid.gy/)
- [atproto-export](https://github.com/rdp-studio/atproto-export)

---

_This project is a work in progress. Contributions and feedback are welcome!_
