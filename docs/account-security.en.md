# Account Security

## Scope

This document describes the current P2 account-security architecture, configuration, business rules, and release procedure. It is based on `apps/api/src/security`, `apps/api/src/auth`, the Prisma models, and the Web authentication and profile code.

The current capability includes:

- Registration email codes and account email verification
- Email-based password recovery with single-use reset tokens
- Cloudflare Turnstile verification
- Login throttling plus new-device, unfamiliar-IP, and unusual-frequency detection
- Email verification for untrusted devices, browser-installation trust management, and active-session sign-out
- In-app and email security alerts with user preferences
- Paginated administration queries for mail jobs, verification requests, and risk events
- Encrypted SMTP and Turnstile credentials

SMS codes, third-party login, two-factor authentication, and mandatory re-verification of all historical accounts are not included.

## Architecture And Data

### Service Responsibilities

- `AuthController` and `AuthService` handle registration, login, password changes, password resets, token issuance, and session revocation.
- `AccountSecurityService` handles verification codes, recovery requests, security events, known devices, alerts, and rate limits.
- `SecurityConfigurationService` owns the singleton security configuration, public policy, and completeness checks.
- `MailService` sends through Nodemailer and persists the outcome of every send as a mail job.
- `TurnstileService` calls Cloudflare `siteverify` from the server and does not trust a browser-only result.
- `SecretCryptoService` encrypts the SMTP password and Turnstile secret with AES-256-GCM.
- MySQL stores durable configuration, requests, devices, and events. Redis stores rate counters, refresh sessions, and failed-login state.

### MySQL Data

| Table                         | Purpose                                                                          | Important behavior                                                                                                                                        |
| ----------------------------- | -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `security_configurations`     | Singleton SMTP, mail-feature, and Turnstile configuration                        | The SMTP password and Turnstile secret are ciphertext only; the site key is public                                                                        |
| `user_security_preferences`   | Per-user security-alert preferences                                              | Login, email, and new-device alerts default to enabled                                                                                                    |
| `known_login_devices`         | Known browser/PWA installations, labels, first/last IP addresses, and trust time | Trusted identity stores only the SHA-256 hash of a random server-issued credential; cancelling trust clears the trust time while preserving audit history |
| `login_security_events`       | Login, risk, password, and email-verification events                             | Stores risk level, IP, User-Agent, device label, and limited metadata                                                                                     |
| `email_verification_requests` | Registration, account-email, and new-device login code requests                  | Codes are HMAC-hashed; device challenges store only a SHA-256 random-token hash bound to a device fingerprint                                             |
| `password_reset_requests`     | Single-use password-reset requests                                               | Stores a SHA-256 token hash, never the plaintext token from the URL                                                                                       |
| `mail_jobs`                   | Delivery state and failure reason                                                | Stores recipient, subject, type, state, attempts, and errors, but not the message body                                                                    |

The migration marks users that existed before deployment as email-verified using their original account creation time. This prevents historical accounts from unexpectedly losing recovery eligibility. A new user is verified during registration only when registration email verification is enabled and a valid code is consumed. Changing an account email clears its verification state and requires verification again.

The current code does not automatically purge security events, known devices, verification requests, or mail jobs. Define a production retention policy based on the required audit window before these tables grow significantly, and preserve required audit evidence before deletion.

### Redis Data

| Key pattern                             | Purpose                          | TTL / limit                                        |
| --------------------------------------- | -------------------------------- | -------------------------------------------------- |
| `security:code:email:<purpose>:<email>` | Verification sends for one email | 1 per 60 seconds                                   |
| `security:code:ip:<purpose>:<ip>`       | Verification sends for one IP    | 10 per hour                                        |
| `security:recovery:email:<email>`       | Recovery requests for one email  | 3 per hour                                         |
| `security:recovery:ip:<ip>`             | Recovery requests for one IP     | 10 per hour                                        |
| `login_fail:<account>:<ip>`             | Failed-login counter             | Temporarily blocked after 5 attempts in 15 minutes |
| `refresh_token:<token-id>`              | Refresh-token session record     | Matches the refresh-token lifetime                 |
| `user_sessions:<user-id>`               | Per-user session index           | Matches the refresh-token lifetime                 |

Rate-limit keys are temporary state. Flushing Redis also removes refresh sessions and rate counters, so a Redis flush is not a routine maintenance operation. Protected HTTP requests verify that the session ID in the access token still exists. Signing out one device invalidates its access token immediately and disconnects its chat WebSocket within about 15 seconds.

## Endpoints And Access

### Public Authentication Endpoints

- `GET /auth/security-policy`: returns public feature flags, the Turnstile site key, and the login challenge threshold.
- `POST /auth/registration-code`: sends a registration code.
- `POST /auth/register`: registers an account and consumes a code or verifies Turnstile when required.
- `POST /auth/login`: verifies the password and required Turnstile challenge; when untrusted-device verification is enabled, an untrusted browser receives a device challenge instead of tokens.
- `POST /auth/login/device-verification`: consumes a six-digit email code bound to the current browser credential, establishes trust, and completes sign-in.
- `POST /auth/login/device-verification/resend`: resends a code for a still-valid device challenge that belongs to the current browser.
- `POST /auth/password-recovery/request`: requests a recovery email.
- `POST /auth/password-recovery/reset`: sets a new password using a single-use token.

### Authenticated User Endpoints

- `GET /auth/me/security`: returns email status, preferences, the latest 30 security events, and the latest 20 trusted devices with the current browser marked.
- `PATCH /auth/me/security/preferences`: updates login, email, and new-device alert switches.
- `POST /auth/me/email-verification/send`: sends a verification code to the current email.
- `POST /auth/me/email-verification/confirm`: confirms the current account email.
- `PATCH /auth/me/password`: verifies the current password, changes it, and revokes refresh sessions other than the current session.
- `DELETE /auth/me/security/trusted-devices/:deviceId`: cancels trust for one browser/PWA installation; the current session remains active, while the next sign-in requires email verification.
- `DELETE /auth/sessions/:sessionId`: signs out one active session for the current account, including either the current device or another device.

The Web app provides `/register`, `/login`, `/forgot-password`, the account-security area in Profile, and the `/admin/security` administration page. Administrators and the super administrator can open Security Management from the avatar menu. Backend authorization never depends on hiding a frontend link.

### Administration Permissions

| Endpoint                         | Administrator               | Super administrator         |
| -------------------------------- | --------------------------- | --------------------------- |
| `GET /security-admin/config`     | Read redacted configuration | Read redacted configuration |
| `GET /security-admin/overview`   | Query records               | Query records               |
| `PATCH /security-admin/config`   | Denied                      | Update configuration        |
| `POST /security-admin/smtp/test` | Denied                      | Run connection test         |

An administrator is determined by role level `>= 90`. A super administrator must also have `isSuperAdmin=true`. Configuration reads return flags such as `smtpPasswordConfigured` and `turnstileSecretConfigured`, never either secret in plaintext.

## SMTP Configuration

### Required Provider Data

Obtain the following from the mail provider:

- SMTP hostname
- SMTP port
- Whether implicit TLS is required
- SMTP username
- SMTP password or app-specific password
- Sender name and sender email address

Port `465` commonly uses implicit TLS. Port `587` commonly uses STARTTLS with `smtpSecure` set to `false`. Follow the provider's official instructions. Prefer an app-specific password over the password used for webmail login.

### Recommended Order

1. Confirm that the API container has a valid `BACKUP_ENCRYPTION_KEY`; administration should report credential encryption as available.
2. Keep registration verification and recovery disabled, enter complete SMTP fields and the password, enable SMTP, and save.
3. Have the super administrator run the SMTP connection test. The current Web page enables the test action only after the saved SMTP configuration is enabled.
4. If the test fails, disable SMTP again, correct the fields, and repeat the save and test sequence.
5. Enable registration verification and password recovery separately, completing a real delivery test after each change.
6. Enable untrusted-device email verification last, while keeping one signed-in super-administrator session as a recovery path.

An update may omit the password to preserve its current ciphertext, or explicitly clear the stored password. When SMTP, registration verification, or password recovery is enabled, host, username, password, and sender address must all be present or the API rejects the update.

Untrusted-device email verification also requires complete, enabled SMTP configuration. Its switch defaults to off and must not be enabled before real mail delivery has passed.

This example shows field shape only. Repository placeholders are not production credentials:

```json
{
  "smtpEnabled": false,
  "smtpHost": "smtp.provider.example",
  "smtpPort": 587,
  "smtpSecure": false,
  "smtpUsername": "mailer@example.com",
  "smtpPassword": "<provider-app-password>",
  "smtpFromName": "HLOVET",
  "smtpFromEmail": "mailer@example.com"
}
```

Connection, greeting, and socket timeouts bound the SMTP test and send operation. A failed connection test returns a concrete error directly; a failed real delivery also records its mail job as `failed` for administration diagnostics.

## Cloudflare Turnstile Configuration

### Cloudflare

1. Create a Turnstile widget in Cloudflare.
2. Add the production hostname and every real staging hostname to the allowlist. Production should include the current site domain.
3. Obtain the site key and secret key. The site key is sent to browsers; only the API may use the secret key.
4. Prefer Cloudflare's official test credentials or a separate test widget for local development instead of weakening the production hostname policy.

Turnstile does not require Cloudflare proxying for site traffic. Browsers must be able to load `https://challenges.cloudflare.com/turnstile/v0/api.js`, and the API server must be able to reach `siteverify`.

### HLOVET

1. Keep all three Turnstile switches off while saving the site key and secret key.
2. Enable registration or recovery protection first and verify the complete flow.
3. Enable login protection last and begin with a reasonable failure threshold. The accepted range is `1` through `5`, and the default is `3`.

The switches protect these operations:

- Registration: protects code delivery when registration email verification is enabled; otherwise it protects the final registration request.
- Login: does not challenge every login. After the configured failure count for the account and IP is reached, the next login requires Turnstile.
- Password recovery: protects both the recovery-email request and the final password reset. Each request verifies its own Turnstile token.

A missing or failed token returns HTTP `428`. An unreachable or timed-out Cloudflare service returns `503`. Only operations protected by the corresponding switch are blocked.

## Registration Verification And Password Recovery

### Registration Email Verification

1. The Web app reads the public security policy.
2. The user requests a six-digit code; any older pending code for the same email and purpose expires immediately.
3. The code is valid for 10 minutes and is stored only as an HMAC hash.
4. Each code allows at most five incorrect attempts before a new code is required.
5. Registration atomically consumes the latest valid code; a code cannot be reused.
6. Successful registration stores the email verification timestamp.

Verification for an already registered account uses the separate `account_email` purpose and cannot consume a registration code.

### Trusted Devices And Active Sessions

1. During successful registration or the post-password device-challenge flow, API issues a one-year `HttpOnly`, `SameSite=Lax` device cookie. Production also adds `Secure`.
2. MySQL stores only the SHA-256 hash of that random value, never the replayable cookie plaintext.
3. When untrusted-device verification is enabled, successful password and required Turnstile checks still do not issue tokens. The user must enter the six-digit code sent to the account email.
4. A device challenge lasts ten minutes, permits at most five wrong attempts, and is bound to the browser credential that requested it. Another browser cannot consume it.
5. Registration completed with a registration email code trusts that browser immediately and records `Registration completed and signed in` without a misleading new-device risk alert.
6. Passing a new-device code trusts that browser and records `New device verified by email and signed in`. The code email is already a security alert, so no duplicate login-risk email is sent.
7. Cancelling trust affects the next sign-in and does not terminate the current session. Signing out a login device is separate: it removes the Redis session and immediately blocks that access token from protected APIs.
8. The login-device list comes only from active refresh sessions still present in Redis; expired and signed-out historical sessions are not shown.

A Web app or ordinary PWA cannot read disk serial numbers, motherboard identifiers, IMEI, or similar physical-hardware IDs. The system therefore cannot use a physical machine as a reliable unique identity. The current trust boundary is one browser profile or PWA installation. Clearing site cookies, using private browsing, switching browsers, or reinstalling the app creates a new device instance. IP, User-Agent, and browser labels can change and are used only for display and risk analysis, not as trusted identity.

### Password Recovery

1. Only active accounts with verified email addresses receive recovery mail.
2. Unknown, disabled, and unverified accounts receive the same successful API response to avoid disclosing whether an email is registered.
3. A new request expires every earlier unused request for that user.
4. The random URL token is valid for 30 minutes; MySQL stores only its SHA-256 hash.
5. A successfully consumed token is marked consumed immediately and cannot be reused.
6. After the new password is stored, every refresh session for that user is revoked from Redis.

Recovery also increments the account security version. Access tokens carry the version present when issued, and later requests return `401` immediately when that version no longer matches. All old access tokens and refresh sessions therefore become invalid. A normal password change made from an authenticated session revokes other refresh sessions while preserving the current session.

## Risk Detection Definitions

Classification precedence is unusual frequency, new device, unfamiliar IP, then ordinary login. One login creates one primary event type.

| Type                | Risk level | Current definition                                                                                              |
| ------------------- | ---------- | --------------------------------------------------------------------------------------------------------------- |
| `login_success`     | `info`     | Known device, known IP, and no unusual frequency                                                                |
| `new_ip`            | `low`      | The IP does not appear as the first or last IP of any known device for the user                                 |
| `new_device`        | `medium`   | The device fingerprint is new; a first login is usually also a new IP but is classified as a new device         |
| `unusual_frequency` | `high`     | Another login occurs after at least five login-related security events for the user in the preceding 10 minutes |
| `login_blocked`     | `high`     | The same account and IP reaches five failed logins within 15 minutes                                            |
| `password_changed`  | `medium`   | The user changes the password after proving the old password                                                    |
| `password_reset`    | `medium`   | The user resets the password using an email token                                                               |
| `email_verified`    | `info`     | Account email verification completes                                                                            |

A trusted-device fingerprint is the SHA-256 hash of a random server-issued browser credential. Legacy `X-Device-ID` or User-Agent hashes remain compatible with historical risk records but do not grant trust and cannot prove physical-hardware identity. The IP is the first value of `X-Forwarded-For` supplied by a trusted reverse proxy; that proxy must replace any client-forged header.

New-device, unfamiliar-IP, and unusual-frequency events create in-app system notifications when user preferences allow. Email alerts are dispatched asynchronously and delivery failures are caught, so SMTP failure does not roll back an otherwise successful login. The failed mail job remains available for administration review.

## User Preferences

Profile provides three independent switches:

- **Login alerts**: controls in-app notifications for non-ordinary login events.
- **Email alerts**: controls email notifications for non-ordinary login events.
- **New-device alerts**: controls alerts for new-device events; the security event is still recorded when this is off.

Preferences affect delivery only. They do not disable event recording, device history, login throttling, or administrator audit data. All three switches default to enabled. Profile currently renders the latest five events and latest five devices, while the API returns at most 30 events and 20 devices.

## Administration Queries

`GET /security-admin/overview` accepts `page`, `pageSize`, `search`, and `status`. The default page size is 10 and the maximum is 100.

| `tab`          | Records                     | Search fields                           | Status filter                                |
| -------------- | --------------------------- | --------------------------------------- | -------------------------------------------- |
| `mail`         | Mail jobs                   | Recipient, subject, last error          | `pending`, `sending`, `sent`, `failed`       |
| `verification` | Email verification requests | Email, IP                               | `pending`, `verified`, `consumed`, `expired` |
| `risk`         | Login security events       | Summary, IP, device, username, nickname | `info`, `low`, `medium`, `high`              |

Results are ordered by creation time descending. The current administration overview does not include password-reset requests and never returns plaintext reset tokens. Verification persistence contains an irreversible `codeHash`; the administration UI and logs must not present or export it as if it were a usable code.

## Rate-Limit Summary

- Verification codes: one per email every 60 seconds and ten per IP per hour; registration and account verification have separate purpose counters.
- Password recovery: three per email and ten per IP per hour.
- Incorrect code attempts: at most five for one request.
- Failed login: the account and IP combination is blocked after five failures within 15 minutes.
- Login Turnstile: starts at the configured failure threshold, default three, and does not replace the fifth-failure lock.
- Refresh sessions: ten per user by default, configurable through `MAX_REFRESH_SESSIONS_PER_USER`.

Request throttling returns HTTP `429`. It depends on Redis and should not be bypassed by flushing cache during normal operation.

## `BACKUP_ENCRYPTION_KEY`

This environment variable currently has two responsibilities:

1. Encrypt SMTP passwords and Turnstile secrets stored in MySQL.
2. Encrypt off-site database and media backups.

The implementation uses AES-256-GCM. The key must decode to exactly 32 bytes and may be represented as 64 hexadecimal characters or equivalent Base64. The real value belongs only in protected server environment files and a separate secret backup:

- Never place it in `docs`, README, source, commit messages, screenshots, or chat logs.
- Never commit `.env`; only obvious placeholders belong in `.env.example`.
- Never print it in logs or API responses.
- Keep at least one offline or access-controlled off-site copy and record its custodian.

Losing the key makes stored SMTP/Turnstile credentials and remote backups encrypted with it unrecoverable. Replacing it does not decrypt old data. Do not rotate it after ciphertext exists without decrypting with the old key and re-encrypting every credential and backup with the new key. An invalid decoded length prevents API initialization; a correctly sized but wrong value fails when ciphertext is decrypted.

`BACKUP_ENCRYPTION_KEY` is not used for user-password hashing, JWT signing, or HTTPS. Passwords are hashed separately. Verification-code HMAC and refresh-token HMAC depend on `REFRESH_TOKEN_SECRET`, which must also remain outside Git.

## Behavior Without External Credentials

| Condition                                                  | Current behavior                                                                                                                                                                    |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SMTP is missing or disabled                                | Registration follows the normal site-open policy without email verification by default; recovery remains disabled; an account-verification send fails and creates a failed mail job |
| Untrusted-device email verification is off                 | Trust records remain manageable, but login keeps the existing password/Turnstile flow without an email step                                                                         |
| Untrusted-device email verification is on while SMTP fails | Untrusted devices cannot complete sign-in; disable this switch immediately, while trusted devices continue through the existing flow                                                |
| SMTP fails while sending a login-risk alert                | The login is not rolled back; the in-app alert and risk event remain, and the mail job is marked failed                                                                             |
| Turnstile is unconfigured or all three switches are off    | `verify` returns immediately, so existing registration, login, and recovery behavior does not depend on Cloudflare                                                                  |
| Turnstile is enabled but its browser script cannot load    | The Web app cannot obtain a token, so the protected operation cannot complete                                                                                                       |
| Turnstile is enabled but `siteverify` is unreachable       | The protected operation returns `503`; operations outside that switch continue                                                                                                      |
| `BACKUP_ENCRYPTION_KEY` is absent                          | Non-sensitive configuration can be read and features can remain disabled; new SMTP/Turnstile secrets cannot be saved and dependent features cannot be enabled                       |
| `BACKUP_ENCRYPTION_KEY` does not match existing ciphertext | Credential decryption fails, breaking SMTP test/send and Turnstile verification; restore the original key instead of overwriting ciphertext                                         |

SMTP, registration verification, password recovery, untrusted-device email verification, and all three Turnstile switches default to disabled. Applying the migration alone therefore does not make existing registration or login depend on an external provider. Historical device rows are not automatically trusted.

## Release Procedure

1. Back up MySQL and confirm the backup is readable. Do not depend only on the encryption capability being released.
2. Confirm production `.env` contains stable `BACKUP_ENCRYPTION_KEY`, `JWT_ACCESS_SECRET`, and `REFRESH_TOKEN_SECRET` values and that none appears in Git. Also set `WEB_ORIGIN=https://5200918.xyz`; it must not include the internal-only `:3000` host or Docker port.
3. Keep every new mail and Turnstile switch disabled initially.
4. Run Prisma generation, API tests, frontend/backend lint, and production builds in the build environment.
5. Pull prebuilt GHCR images on the resource-constrained VPS; do not build images on the server.
6. Run `api-bootstrap` for the additive migration, then recreate API and Web. Do not run `docker compose down -v`.
7. Verify the home page, health endpoint, existing login and registration, Redis sessions, and administration permissions.
8. Configure and enable SMTP, complete the connection test, enable recovery first, and then enable registration email verification if required.
9. Keep one super-administrator browser signed in, then enable untrusted-device email verification. Test first verification and repeat sign-in with a normal account in another browser.
10. Configure Turnstile and enable registration/recovery before enabling login protection.
11. Observe mail failures, HTTP `401`/`428`/`429`/`503`, login-risk events, Redis sessions, and container resources for at least one complete business cycle.

The recommended production Compose sequence is below. Use image tags that have already passed CI:

```bash
docker compose -f docker-compose.prod.yml pull api-bootstrap api web
docker compose -f docker-compose.prod.yml run --rm api-bootstrap
docker compose -f docker-compose.prod.yml up -d --no-deps api web
docker compose -f docker-compose.prod.yml ps
```

## Rollback Procedure

1. If mail or Turnstile causes the incident, first have the super administrator disable the affected feature switch. This is the fastest data-preserving rollback.
2. For SMTP incidents, disable the mail service. The system also disables registration verification, password recovery, untrusted-device email verification, and recovery Turnstile so sign-in and registration never require an undeliverable code.
3. For Turnstile incidents, disable registration, login, and recovery protection separately. The saved site key and encrypted secret do not need to be deleted.
4. For code incidents, roll API and Web back to the previous verified image pair. The P2 migration only adds tables and nullable fields; preserve them during emergency rollback instead of running a destructive reverse migration.
5. If decryption fails, restore the original `BACKUP_ENCRYPTION_KEY` and recreate only API. Do not overwrite or clear existing ciphertext with a new key.
6. After rollback, verify existing login, registration, refresh rotation, active sessions, administration permissions, and the health endpoint. Preserve the added columns and enum values when rolling code back; do not run a destructive reverse migration.

## Verification

### Automated Checks

1. Run `pnpm --filter @lingxi/api prisma:generate`.
2. Run `pnpm --filter @lingxi/api test` and confirm authentication, session, password, and P2 security tests pass.
3. Run `pnpm --filter @lingxi/api lint` and `pnpm --filter @lingxi/web lint`.
4. Run `pnpm --filter @lingxi/api build` and `pnpm --filter @lingxi/web build`.
5. Run `docker compose -f docker-compose.prod.yml config` and verify environment references and service dependencies.

### Functional Checks

1. With every new switch off, complete the existing registration and login flows and confirm the migration did not change defaults.
2. Save SMTP configuration, test the connection, and send a real registration code. Confirm the mail job reaches `sent`.
3. Request another code for the same email within 60 seconds and confirm HTTP `429`. Enter an incorrect code five times and confirm that a new code is required.
4. Enable registration email verification. Confirm that registration requires a code, one code is consumed only once, and the new account is email-verified.
5. Request recovery for a verified account and confirm the email link starts with `https://5200918.xyz/forgot-password`, does not contain `:3000`, and remains valid for 30 minutes. Reset the password and confirm all old access and refresh tokens are rejected.
6. Request recovery for unknown, disabled, and unverified emails. Confirm the same non-enumerating response and no actual delivery.
7. Enable Turnstile for registration or recovery. Confirm missing tokens return `428`, valid challenges continue, and an unavailable Cloudflare service returns `503`.
8. Repeatedly enter the wrong login password. Confirm Turnstile appears at the configured threshold and the fifth failure creates a 15-minute restriction and `login_blocked` event.
9. Enable untrusted-device email verification and sign in to a normal account from a new browser. Confirm that password verification leads only to the six-digit code step and no token has been issued. Consuming that challenge from another browser must fail.
10. Enter the correct code and confirm sign-in succeeds, the browser appears under Trusted devices, and it is marked Current device. Sign out and sign in again from that browser; no email code should be required.
11. Cancel trust for the current browser and confirm the session remains usable. After sign-out, the next sign-in must require email verification again. Clearing cookies, switching browsers, and using a separate PWA installation must also create a new device instance.
12. Create two active sessions for one account and sign out both another device and the current device from Profile. The revoked device's HTTP requests must return `401` immediately, and its chat connection must disconnect within about 15 seconds.
13. Confirm Login devices lists only active Redis sessions, has no excessive gap below its heading, and has no horizontal overflow on desktop or a 390px mobile viewport.
14. Verify email status, preference switches, and security events in Profile. Disable new-device alerts, create another new-device event, and confirm the event remains while its alert is suppressed.
15. Test administration as both an administrator and the super administrator. Both can query mail, verification, and risk records; only the super administrator can update configuration and test SMTP.
16. Temporarily use an invalid SMTP host to force a send failure. Confirm the mail job records the error, an ordinary login-risk email failure does not fail login, and the untrusted-device gate can be rolled back by disabling its switch.
17. Inspect API responses, container logs, browser network data, and Git history. Confirm no SMTP password, Turnstile secret, device cookie, verification code, challenge token, reset token, or `BACKUP_ENCRYPTION_KEY` appears in plaintext.
18. Restore correct settings after production validation and apply the audit-retention policy before deleting test accounts or test mail records.
