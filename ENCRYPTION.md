# Encryption at rest

With `FIELD_ENCRYPTION_KEYS` set in the root `.env`, the API encrypts these before they are stored:

- **Every uploaded file**: documents, receipts, weekly and property photos, videos, chat and Agent attachments, and
  import workbooks. The bucket (or `apps/api/uploads` on a server without S3) only holds ciphertext, and so do the
  backup copies of files under `<prefix>/backups/files/`.
- **Company tax and bank details**: EIN, bank name, routing number, account number, wire entity name and bank address.
- **Property access info** (lockbox and door codes). The activity log and the admins' "Property updated" alert now
  say "Access info changed" instead of showing the codes.

AES-256-GCM, with the record and field (or the file's place in storage) bound in, so a value or file copied somewhere
else won't open. Code: `apps/api/src/lib/crypto.js`, `lib/sealed.js`, `services/files.js`, `services/encryptData.js`.

## How files reach people

Files always come through the signed-in API (`/api/documents/:id/raw`, `/download`, the chat and Agent routes), which
decrypts them as it sends them. Videos still play and skip ahead: files are encrypted in 64 KiB pieces, so a byte
range only reads the pieces it needs. The public CloudFront links for photos and receipts are gone, since the bucket
can't decrypt. The website already fell back to the signed-in route, so it needs no change.

The phone apps are unaffected: they show the website, and they download through a short-lived link to the website's
own address (`/api/documents/download-link`), never from S3 or CloudFront.

## What is not encrypted, and why

- **Names, addresses, emails and phone numbers** of people, properties and companies. Sign-in looks people up by email,
  companies must have unique names, properties are matched by address in imports and on the map.
- **Amounts** (prices, loans, expenses, draws). They are totaled, sorted and compared in database queries.
- **Loan numbers, insurance policy numbers and account codes, utility accounts, tax parcels.** Imports match loans by
  number, and the Agent and insurance features read the others in many places. None of them moves money. A later pass.
- **Chat messages, call notes and Agent conversations.** Chat search runs in the database, and the AI teammate reads
  messages in many places. A later pass.
- **File names.** Searched and sorted, and they tell the type. The S3 key of a file includes its name too.
- **Draft import rows** (`ImportJob.rows`). The workbook itself is encrypted.
- **Backups made before encryption.** They hold plain text until they age out (Settings › Backups, 30 days by
  default). Backups made after hold the encrypted values.

Passwords are hashed as before.

## The key

```bash
openssl rand -base64 32
```

`FIELD_ENCRYPTION_KEYS="k1:<that value>"` in the root `.env` on the server. The first key encrypts; every key listed
decrypts.

**Save it in the password manager before the first deploy.** Every encrypted file and bank detail needs it. Losing it
loses them, and a database backup won't bring them back: the backups hold the same ciphertext and don't contain the key.

Use a new key for SynergiFund, not Lendhous's.

The database keeps a check value for each key. A server started with a different secret under the same key name, or
without any key the data is under, refuses to start and changes nothing.

Without `FIELD_ENCRYPTION_KEYS` nothing new is encrypted and `GET /health` says `"encryption": "off"`. There is no
built-in development key on purpose. A local API pointed at the live database must not encrypt live data, so don't put
the key in this Mac's `.env` while the server still runs the build from before encryption. After the deploy, a local
API against the live database needs the same key to read encrypted records (and then holds the production key).

## Deploying it the first time

Do these in order. The build from before encryption can't read encrypted data, so once step 5 has run, **rolling back
to an older build breaks the site** (bank details show as `enc1:…`, files come out as ciphertext).

1. Generate the key and save it in the password manager.
2. On the server, in the SynergiFund checkout: `git pull`. No new packages, so `npm ci` isn't needed.
3. Add `FIELD_ENCRYPTION_KEYS="k1:<key>"` to the root `.env` with an editor (`nano .env`), so it stays out of the
   shell history.
4. Rebuild the website if it changed since the last deploy (`npm run build -w @synergifund/web`), then restart the API
   and the website under pm2 (`pm2 ls` shows their names). Check the API (port 4000 unless `PORT` says otherwise): `curl -s localhost:4000/health` shows
   `"encryption":"on"`, and `pm2 logs` shows "Encryption at rest is on (key k1)".
5. `npm run db:encrypt`. It encrypts everything stored before and prints what it did, for example
   `Encrypted with key k1: 12 companies, 40 properties, 3 activity entries and alerts, 812 files, 790 backup copies of files.`
   It runs while the site serves and is safe to run again; a second run prints zeros. Files it couldn't read are
   counted, logged and tried again next time.

After that:

- In AWS, invalidate the CloudFront distribution (`/*`). Its edge caches can hold copies of photos and receipts for up
  to a year. Then remove `AWS_CLOUDFRONT_URL` from `.env` (nothing reads it any more), and disable the distribution if
  nothing else uses it.
- If versioning is on for the bucket, the plain-text versions of the files are still there as older versions. Expire
  noncurrent versions under the `synergifund/` prefix only (Lendhous shares the bucket under `lendhous/`).

## Later deploys

```bash
git pull && npm run build -w @synergifund/web && pm2 restart <api> <web> && npm run db:encrypt
```

`db:encrypt` changes nothing once everything is encrypted. The daily backup also runs it first, as a backstop, so a
record restored from an older backup is encrypted again by the next day's backup.

## Rotating the key

1. Generate a new key and save it in the password manager.
2. Put it first in `.env`: `FIELD_ENCRYPTION_KEYS="k2:<new>,k1:<old>"`.
3. Restart the API, then `npm run db:encrypt`. It moves every record, file and backup copy to `k2`.
4. Keep `k1` listed until the backups made before the rotation have aged out (up to 90 days, by the Settings ›
   Backups choice). Restoring one of them needs `k1`. Then remove it from `.env` and restart.

Keep every old key in the password manager anyway.

## Tests

`npm test` from the repository root. They need a `mongod` binary: one on PATH, in `~/.cache/mongodb-binaries`, or
named by `MONGOD=`. They use a scratch database, a fake S3 and a scratch folder, and never read `.env`.
