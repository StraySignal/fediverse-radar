# Bridgy Check

This tool intakes your followed users export from Mastodon and checks to see if they have a corresponding bridged account using [Bridgy Fed](https://fed.brid.gy/)

## Usage

To check for bridged BlueSky accounts from a Mastodon following accounts CSV file, use the following command:

```sh
node mastoToBsky.js <name_of_mastodon_following_accounts.csv>
```

### Using the `-c` flag with mastoToBsky.js

The `-c` flag will re-check all converted accounts in your CSV file, verifying that each one still exists and is reachable. This is useful if you want to validate or refresh an existing output file.

Example usage:

```sh
node mastoToBsky.js <name_of_mastodon_following_accounts.csv> -c
```

When you use the `-c` flag, the script will:
- Convert each Mastodon account address to its bridged BlueSky format.
- Check if the corresponding BlueSky account exists and is reachable.
- Only output accounts that are confirmed to exist.

## bskyToMasto.js

I've also added bskyToMasto.js which checks Mastodon for bridged BSKY accounts. Currently this functionality is super dirty and requires you download an account export using [this tool](https://github.com/rdp-studio/atproto-export/tree/main), which you then take the app.bsky.graph.follow folder and use it as a command line arg for the js file.

Example:
```sh
node bskyToMasto.js <path>\<to>\app.bsky.graph.follow
```

### Flags

#### `-c` flag (bskyToMasto.js)
The `-c` flag allows you to specify an existing CSV file to check against. This will filter out handles that already exist in the CSV file, so they are not checked again.

Example:
```sh
node bskyToMasto.js <path>\<to>\app.bsky.graph.follow -c <name_of_mastodon_following_accounts.csv>
```

#### `-t` flag
The `-t` flag allows you to specify the number of entries to process. This is useful for testing with a smaller subset of data.

Example:
```sh
node bskyToMasto.js <path>\<to>\app.bsky.graph.follow -t 20
```

#### `-e` flag
The `-e` flag allows you to use an existing `BlueSkyHandles.txt` file instead of extracting handles from the JSON files again.

Example:
```sh
node bskyToMasto.js -e
```

### Future Plans
I think next I'm going to try to eventually integrate [rdp-studio's code](https://github.com/rdp-studio/atproto-export/tree/main) so the tool will automatically get the export for you instead of you needing to do it yourself.

I also would like to make a handler for all this so you don't need to run these from the terminal.

I know this is all very sparse, I will make it prettier in time I promise
