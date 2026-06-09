# Kunnumpurathu Kudumbam — Family Tree

A visual, self-hosted family tree and family history book, built for the
**Kunnumpurathu Kudumbam** of Puthencavu, Chengannur, Kerala — and designed so
that it is a pleasure for an elder of the family to read *and* to edit.

## What it does

- **🌳 Family Tree** — an interactive tree drawn generation by generation.
  Couples sit side by side joined by a marriage ring; children hang beneath
  them. Drag to move around, scroll or use the big ＋/− buttons to zoom,
  click any card to open that person's page.
- **Person pages** — a full page per person: portrait photo, dates and places
  of birth and death, occupation, education, a free-form **life story**
  (with simple formatting), private research notes, and links to parents,
  spouses, children and siblings.
- **👥 All People** — an alphabetical register of everyone, searchable and
  filterable by family branch (e.g. *Kochuveettil*).
- **📜 Our History** — an editable long-form history of the kudumbam, styled
  like a printed page. Headings, bold, italics and lists are supported.
- **Editing made gentle** — big buttons, large readable serif type, an
  A/A text-size toggle, plain-language forms, and dates accepted in any form
  ("1932", "c. 1880", "12 May 1951") — exactly what historical records need.
- **Photos** — upload a photograph straight from the person's page.
- **Backups** — one-click *Download a backup* (a single JSON file) and
  *Restore from backup*. The server also keeps automatic daily backups.

No database server, no frameworks, **zero npm dependencies** — a single small
Node.js process and plain files. Easy to run for decades.

## Run with Docker (recommended)

```bash
docker compose up -d
```

Then open <http://localhost:8080>.

To require a password before anyone can edit (recommended if the site is
reachable from the internet):

```bash
EDIT_PASSWORD="our-family-secret" docker compose up -d
```

Everyone can *view* without a password; the password is only for editing.

All family data (the tree, photos, daily backups) lives in the
`familytree-data` Docker volume, mounted at `/data` in the container.

## Run without Docker

```bash
node server/server.js
# or: PORT=3000 EDIT_PASSWORD=secret DATA_DIR=/some/path node server/server.js
```

Requires Node.js 20 or newer. Data is stored in `./data` by default.

## First run & seed data

On first start the app loads `seed/seed.json`, which begins the record with
Dr. K. K. Kochukoshy and a draft of the family history. Direct access to
**kunnumpurathu.com** was not possible from the build environment, so the
rest of the site's tree should be entered through the app (it is quick:
open a person → *Add child / Add husband-wife / Add parent*), or prepared as
a JSON file in the same shape as `seed/seed.json` and loaded via
*Restore from backup* in the page footer.

## Data model

Everything is one JSON document (`/data/familytree.json`):

```jsonc
{
  "meta":    { "title", "subtitle", "rootId" },
  "history": "markdown text",
  "persons": { "<id>": { "name", "birthDate", "bio", "branch", "photo", ... } },
  "unions":  { "<id>": { "partner1", "partner2", "marriageDate", "children": [] } }
}
```

A *union* is a marriage or partnership; a union may have a single recorded
partner (the other parent unknown), and a person may have several unions.

## API

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/data` | the whole tree |
| GET | `/api/export` | download a backup |
| POST | `/api/import` | restore a backup |
| POST/PUT/DELETE | `/api/persons[/:id]` | manage people |
| POST | `/api/persons/:id/photo` | upload a photo (raw image body) |
| POST/PUT/DELETE | `/api/unions[/:id]` | manage marriages |
| POST/DELETE | `/api/unions/:id/children[/:childId]` | link children |
| PUT | `/api/history` | save the history page |
| GET/POST | `/api/auth`, `/api/auth/login`, `/api/auth/logout` | editing password |

Write endpoints require the editing password when `EDIT_PASSWORD` is set.

## Tests

```bash
npm test
```

Boots a real server against a temporary data directory and exercises the
full API: auth, people, marriages, children, photos, history, export/import
and path-traversal protection.
