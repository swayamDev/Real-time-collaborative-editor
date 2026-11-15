# Security

## Reporting a vulnerability

Please report vulnerabilities privately through GitHub: open the repository's **Security** tab and choose **Report a vulnerability**. Do not open a public issue or pull request for a security problem.

Include what you found, the steps to reproduce it, and what an attacker could do with it. If you have a proof of concept, attach it to the report.

This is a personal project maintained by one person. You can expect an acknowledgement within a week, and an update when there is a fix. Credit is given in the fix's notes unless you prefer otherwise.

## Testing against the live site

The production app at https://editor.swayam.space holds other people's documents. When testing:

- Use only accounts and documents you created yourself.
- Do not access, change or delete anyone else's data, even if a flaw would let you.
- Do not run denial-of-service tests, load tests or automated scanners against it.
- Stop and report as soon as you have shown the problem.

## What is in scope

The app, the sync server and this repository's code and configuration. How the app is designed to resist attacks, and what it deliberately does not protect against, is described in the README's [threat model](README.md#threat-model).
