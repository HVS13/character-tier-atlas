# Character Tier Atlas

Character Tier Atlas compares fictional characters by their VS Battles Wiki Keys. Choose two Keys to see their tier placements, stat coverage, and side-by-side stats. Copy the selection, share a link, or export the table as CSV.

## Run locally

Serve the repository root over HTTP. The site uses native JavaScript modules and ships without a build step.

```sh
python -m http.server 8000
```

Open `http://localhost:8000`. Run the parser and comparison tests with `node --test`.

## Data

The site uses the [VS Battles Wiki API](https://vsbattles.fandom.com/api.php) for search and live profiles. The starter JSON includes revision-linked profile excerpts from VS Battles Wiki contributors. Wiki text uses [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/). The site loads thumbnails from their original host.

Explore loads a snapshot of every article in the wiki’s [Characters category](https://vsbattles.fandom.com/wiki/Category:Characters). **Refresh index** builds a current roster and saves it in the browser. Atlas reads Keys and stats when you open a profile, compare it, or import a cache.

Atlas treats tiers as ordered categories. It preserves multiple ratings in the same Key and keeps unknown fields out of the comparison. Use the [wiki’s tier definitions](https://vsbattles.fandom.com/wiki/Tiering_System) to interpret the scale.

Explore can import the classic explorer’s cache and export your Atlas library. The classic app remains available at `/legacy/` relative to the site root.
