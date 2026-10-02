# RMO Phase 3B — Register books and XLSX export

Date: 2026-10-02. Local Kostra only (`rmo_kostra_dev` / `rmo_kostra_test` at `127.0.0.1:5434`). `railway-monitor` was not changed.

## What landed

Railway Monitor’s question + register book behavior was ported onto Kostra’s existing structure:

| Railway | Kostra |
| --- | --- |
| `questions` rows | Fields in `FormVersion.schema` (unchanged) |
| `register_questions` | New `RegisterField` (`fieldKey`, `sortOrder`, `columnLabel`, `isKeyField`) |
| Register entries | View over `Submission` for the register’s form + division, with key-field visibility |
| Excel export | `exceljs` XLSX + JSON preview for registers and submissions |

CSV export remains at `GET /api/submissions/export`.

## APIs

| Method | Path |
| --- | --- |
| GET, PUT | `/api/admin/registers/:id/fields` |
| GET | `/api/admin/registers/:id/entries` |
| GET | `/api/admin/registers/:id/export` |
| GET | `/api/admin/registers/:id/export/preview` |
| GET | `/api/submissions/export/xlsx` |
| GET | `/api/submissions/export/preview` |

## UI

- `/registers` links to `/registers/[id]` (Open book)
- Register detail: column mapping, entries table, Export Excel
- Submissions and Analytics: Export Excel beside Export CSV

## Seed

`seedClientRegistersForDivision` creates the six client register shells (Detonator, Incident, ALP Duty, BP/FP Hose, Walkie-Talkie, Fog Safe Device) against a published form that supplies the shared field keys. Local `prisma/seed.ts` runs this for the first division when present.

## Audit

New actions: `register.fields_updated`, `register.exported`. Submission export metadata may include `format: csv | xlsx`. Answer payloads are not stored in audit metadata.
