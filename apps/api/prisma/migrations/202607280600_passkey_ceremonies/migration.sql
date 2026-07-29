-- Real WebAuthn ceremonies: server-side single-use challenges, passkey backup
-- state, and per-session step-up re-authentication (PRD §4.3, §5.2, §5.3).

CREATE TYPE "WebAuthnChallengePurpose" AS ENUM ('REGISTRATION', 'AUTHENTICATION', 'REAUTH');

CREATE TABLE "WebAuthnChallenge" (
    "id" TEXT NOT NULL,
    "purpose" "WebAuthnChallengePurpose" NOT NULL,
    "userId" TEXT,
    "challenge" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ(6) NOT NULL,
    "consumedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebAuthnChallenge_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WebAuthnChallenge_challenge_key" ON "WebAuthnChallenge"("challenge");
CREATE INDEX "WebAuthnChallenge_expiresAt_idx" ON "WebAuthnChallenge"("expiresAt");
CREATE INDEX "WebAuthnChallenge_userId_purpose_idx" ON "WebAuthnChallenge"("userId", "purpose");

ALTER TABLE "WebAuthnChallenge"
    ADD CONSTRAINT "WebAuthnChallenge_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "AppUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "UserPasskey"
    ADD COLUMN "deviceType" TEXT,
    ADD COLUMN "backedUp" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "UserSession"
    ADD COLUMN "reauthenticatedAt" TIMESTAMPTZ(6);
