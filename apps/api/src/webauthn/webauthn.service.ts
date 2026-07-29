import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from '@simplewebauthn/server';
import { ConfigService } from '@nestjs/config';
import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';

import { CHALLENGE_TTL_MS } from './webauthn-challenge.service.js';
import type {
  AuthenticationResponseJSON,
  AuthenticatorTransportFuture,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
} from './webauthn.types.js';

export interface RelyingParty {
  rpID: string;
  rpName: string;
  origins: string[];
}

export interface VerifiedRegistration {
  credentialId: string;
  publicKey: Uint8Array;
  counter: number;
  transports: string[];
  deviceType: string;
  backedUp: boolean;
}

export interface StoredCredential {
  credentialId: string;
  publicKey: Uint8Array;
  counter: number;
  transports: string[];
}

/**
 * WebAuthn/FIDO2 ceremony logic (PRD §5.2, §5.3).
 *
 * User verification is `required` in both directions, which is what makes a
 * Touch ID / Face ID prompt (rather than mere user presence) the thing being
 * asserted. The server never sees biometric data — only the platform
 * authenticator's signed statement that verification succeeded.
 */
@Injectable()
export class WebAuthnService {
  private readonly logger = new Logger('WebAuthn');

  constructor(private readonly config: ConfigService) {}

  /**
   * Relying-party identity. Throws rather than falling back to a guess: a
   * wrong rpID silently produces credentials that can never be asserted.
   */
  rp(): RelyingParty {
    const rpID = this.config.get<string>('WEBAUTHN_RP_ID')?.trim();
    const originSetting =
      this.config.get<string>('WEBAUTHN_ORIGIN')?.trim() ||
      this.config.get<string>('PUBLIC_ORIGIN')?.trim() ||
      this.config.get<string>('WEB_ORIGIN')?.trim();
    if (!rpID || !originSetting) {
      throw new ServiceUnavailableException(
        'Passkeys are not configured; set WEBAUTHN_RP_ID and PUBLIC_ORIGIN',
      );
    }
    const origins = originSetting
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);
    if (origins.length === 0) {
      throw new ServiceUnavailableException('The WebAuthn origin must contain at least one origin');
    }
    return {
      rpID,
      rpName: this.config.get<string>('WEBAUTHN_RP_NAME')?.trim() || 'Bullion Ledger',
      origins,
    };
  }

  /** Whether passkey endpoints can operate at all in this deployment. */
  configured(): boolean {
    try {
      this.rp();
      return true;
    } catch {
      return false;
    }
  }

  async buildRegistrationOptions(
    userId: string,
    username: string,
    existing: readonly StoredCredential[],
  ): Promise<PublicKeyCredentialCreationOptionsJSON> {
    const { rpID, rpName } = this.rp();
    return await generateRegistrationOptions({
      rpName,
      rpID,
      userName: username,
      userDisplayName: username,
      userID: new TextEncoder().encode(userId),
      timeout: CHALLENGE_TTL_MS,
      attestationType: 'none',
      // PRD §5.3: platform authenticator, discoverable credential, UV required.
      authenticatorSelection: {
        residentKey: 'required',
        requireResidentKey: true,
        userVerification: 'required',
      },
      // Stops a second credential being enrolled on an already-enrolled device.
      excludeCredentials: existing.map((credential) => ({
        id: credential.credentialId,
        transports: credential.transports as AuthenticatorTransportFuture[],
      })),
    });
  }

  /**
   * Login options. `allowCredentials` is intentionally omitted so the platform
   * offers whatever discoverable passkey it holds — this is what lets the user
   * sign in with Touch ID without first typing a username.
   */
  async buildAuthenticationOptions(): Promise<PublicKeyCredentialRequestOptionsJSON> {
    const { rpID } = this.rp();
    return await generateAuthenticationOptions({
      rpID,
      timeout: CHALLENGE_TTL_MS,
      userVerification: 'required',
    });
  }

  /** Verifies an attestation. Returns null when the response is not valid. */
  async verifyRegistration(
    response: RegistrationResponseJSON,
    expectedChallenge: string,
  ): Promise<VerifiedRegistration | null> {
    const { rpID, origins } = this.rp();
    try {
      const result = await verifyRegistrationResponse({
        response,
        expectedChallenge,
        expectedOrigin: origins,
        expectedRPID: rpID,
        requireUserVerification: true,
      });
      if (!result.verified || !result.registrationInfo) return null;

      const { credential, credentialDeviceType, credentialBackedUp } = result.registrationInfo;
      return {
        credentialId: credential.id,
        publicKey: credential.publicKey,
        counter: credential.counter,
        transports: credential.transports ?? [],
        deviceType: credentialDeviceType,
        backedUp: credentialBackedUp,
      };
    } catch (error) {
      // A rejected ceremony is an expected outcome, not a server fault.
      this.logger.warn(`Passkey registration rejected: ${(error as Error).message}`);
      return null;
    }
  }

  /**
   * Verifies an assertion against one stored credential and returns the new
   * signature counter for the caller to persist. A cloned authenticator is
   * detected by the library when the counter fails to advance.
   */
  async verifyAuthentication(
    response: AuthenticationResponseJSON,
    expectedChallenge: string,
    stored: StoredCredential,
  ): Promise<{ newCounter: number } | null> {
    const { rpID, origins } = this.rp();
    try {
      const result = await verifyAuthenticationResponse({
        response,
        expectedChallenge,
        expectedOrigin: origins,
        expectedRPID: rpID,
        requireUserVerification: true,
        credential: {
          id: stored.credentialId,
          publicKey: stored.publicKey,
          counter: stored.counter,
          transports: stored.transports as AuthenticatorTransportFuture[],
        },
      });
      if (!result.verified) return null;
      return { newCounter: result.authenticationInfo.newCounter };
    } catch (error) {
      this.logger.warn(`Passkey assertion rejected: ${(error as Error).message}`);
      return null;
    }
  }
}
