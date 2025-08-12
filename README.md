# Fediverse Radar

Fediverse Radar helps you bridge your Mastodon and Bluesky accounts by checking for bridged accounts and exporting/importing follows.  
**All features are accessible through the interactive CLI: `fediverse-radar.js`.**

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

You will be presented with an interactive, colorized menu to:

- Convert Mastodon CSV to Bluesky (Mastodon to Bluesky)
- Convert Bluesky follows to Mastodon handles (Bluesky to Mastodon)
- Export atproto data
- Exit

---

## Features

### Convert Mastodon CSV to Bluesky

- Takes your Mastodon following accounts CSV export and checks for corresponding bridged Bluesky accounts using [Bridgy Fed](https://fed.brid.gy/).
- Checks if each converted Bluesky account actually exists and is reachable.
- Optionally, omits accounts you already follow on Bluesky by exporting your follows using [atproto-export](https://github.com/rdp-studio/atproto-export) (handled automatically).
- Only accounts that are confirmed to exist, are accessible, and are not already followed will be included in the output.
- Results are saved as `output.csv` and a styled `output.html` in your project directory.
- After conversion, you will be prompted to open the HTML report in your default browser (cross-platform, **see Windows note below**).

### Convert Bluesky follows to Mastodon handles

- Exports your Bluesky follows using [atproto-export](https://github.com/rdp-studio/atproto-export) (automatically handled by the CLI).
- Checks Mastodon for bridged Bluesky accounts.
- **You can now specify separate Mastodon instances for checking account existence and for writing output links.**
- Supports filtering, test mode, and using existing handle files.
- Results are saved as `AccountHandles.csv` and a styled `output.html`.
- After conversion, you will be prompted to open the HTML report in your default browser (cross-platform, **see Windows note below**).
- **At the end of the run, you will see a summary of what percentage of your Bluesky follows are available to your Mastodon account, including already-followed bridged accounts if you provide a Mastodon CSV.**
- **You will be prompted to optionally output a file of all unbridged accounts, and can also generate a preformatted bridge request message for each.**  
  - The output file (`UnbridgedAccounts.csv`) will include the handle, a link to the Bluesky profile, and (optionally) a message in the format:  
    `@bsky.brid.gy@bsky.brid.gy <bsky account handle>`

### Export atproto data

- Exports your Bluesky account data using [atproto-export](https://github.com/rdp-studio/atproto-export).
- The CLI will prompt for your handle or DID and manage the export process for you.

---

## Automated Config-Driven Runs (`-f1` and `-f2` flags)

You can run both Mastodon-to-Bluesky and Bluesky-to-Mastodon conversions non-interactively using a config file.

### Config File Format

The config file is formatted the same for both flags. Example (`handle.config`):

```
HANDLE=your.bsky.handle
CHECK_INSTANCE=mastodon.social
WRITE_INSTANCE=vivaldi.social
FILE_PATH=/path/to/your_mastodon_follows.csv
```

- `HANDLE`: Your Bluesky handle (required)
- `CHECK_INSTANCE`: Mastodon instance to check for account existence (required)
- `WRITE_INSTANCE`: Mastodon instance to use for output links (required)
- `FILE_PATH`: Path to your Mastodon follows CSV (required for Mastodon-to-Bluesky, optional for Bluesky-to-Mastodon)

### Mastodon to Bluesky (use `-f1`)

```sh
node fediverse-radar.js -f1 handle.config
```

- Parses the config file and shows a summary of the values.
- Converts your Mastodon follows to Bluesky, using the specified options.
- Runs non-interactively.

### Bluesky to Mastodon (use `-f2`)

```sh
node fediverse-radar.js -f2 handle.config
```

- Parses the config file and shows a summary of the values.
- Exports your Bluesky follows and checks for bridged Mastodon accounts, using the specified options.
- If `FILE_PATH` is provided, already-followed bridged accounts are included in stats and filtering.
- Runs non-interactively.

---

## Output

- Results are saved as `output.csv` and/or `AccountHandles.csv` in your project directory.
- A styled `output.html` report is generated for easy viewing in your browser.
- If you choose, a file of unbridged accounts (`UnbridgedAccounts.csv`) will be generated, including optional bridge request messages.
- Temporary files and exports are cleaned up when you exit the CLI.

---

## Follow Stats & Unbridged Accounts

- After a Bluesky-to-Mastodon run, you will see a summary like:
  ```
  179 of 2186 BlueSky follows are now available to your Mastodon account (including already-followed). (8.19%)
  ```
- If you provide a Mastodon CSV, the tool will include already-followed bridged accounts in the percentage.
- You can output a file of all unbridged accounts, and optionally include a preformatted message for requesting a bridge for each account.

---

## No Direct Script Usage

**You no longer need to run `mastoToBsky.js` or `bskyToMasto.js` directly.**  
All functionality is available through the interactive CLI (`fediverse-radar.js`) or the config modes (`-f1` and `-f2`).

---

## Cross-Platform Support

- The CLI and HTML report opening work on Windows, macOS, and Linux.
- The tool uses the [`open`](https://www.npmjs.com/package/open) package to open HTML reports in your default browser, automatically using the correct command for your OS.
- **⚠️ On Windows, automatic opening of the HTML report is currently unreliable.**  
  You will be shown the path to the HTML file and a tip to run `start output.html` in your terminal to open it manually.

---

## Future Plans

- a GUI would be nice!

---

## Credits

- [Bridgy Fed](https://fed.brid.gy/)
- [atproto-export](https://github.com/rdp-studio/atproto-export)

---

## Dependencies

Fediverse Radar uses several npm packages to provide its functionality. Below is a summary of each package, where it is used, and its purpose:

| Package         | Where Used                      | Purpose                                                                 |
|-----------------|--------------------------------|-------------------------------------------------------------------------|
| **axios**       | `mastoToBsky.js`, `bskyToMasto.js` | Making HTTP requests to APIs (Bluesky, Mastodon, etc.)                  |
| **chalk**       | All CLI scripts                | Adds color and formatting to terminal output for better readability     |
| **csv-parser**  | `mastoToBsky.js`               | Efficiently reads and parses CSV files (Mastodon export)                |
| **csv-parse**   | `bskyToMasto.js`               | Parses CSV files for filtering and deduplication                        |
| **fast-csv**    | `mastoToBsky.js`               | Writes results to CSV files                                             |
| **open**        | `fediverse-radar.js`, `mastoToBsky.js`, `bskyToMasto.js` | Opens HTML reports in the user's default browser, cross-platform        |
| **readline-sync** | All CLI scripts              | Synchronously prompts the user for input in the terminal                |

All dependencies are cross-platform and chosen for reliability and ease of use in a CLI environment.

---

## Additional Requirements

- **Node.js** must be installed on your system.
- **Git** is required for cloning the [atproto-export](https://github.com/rdp-studio/atproto-export) repository (handled automatically).
- **Internet connection** is required for API lookups and downloading dependencies.
- The CLI will automatically clone and manage the `atproto-export` tool as needed.

---

_This project is a work in progress. Contributions and feedback are welcome!_
