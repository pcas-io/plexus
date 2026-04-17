/**
 * WebAuthn (Passkey) server-side helpers.
 *
 * Wraps @simplewebauthn/server for registration and authentication.
 * Challenge storage is in-memory per process (single-worker deployment);
 * challenges live ~5 minutes.
 */

import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from '@simplewebauthn/server';
import type {
  RegistrationResponseJSON,
  AuthenticationResponseJSON,
} from '@simplewebauthn/server';

export interface WebAuthnConfig {
  readonly rpId: string;
  readonly rpName: string;
  readonly origin: string;
}

interface ChallengeEntry {
  readonly challenge: string;
  readonly userId: string;
  readonly expiresAt: number;
}

const CHALLENGE_TTL_MS = 5 * 60 * 1000;

export class WebAuthnService {
  private readonly challenges = new Map<string, ChallengeEntry>();

  constructor(private readonly config: WebAuthnConfig) {}

  private cleanExpired(): void {
    const now = Date.now();
    for (const [key, entry] of this.challenges.entries()) {
      if (entry.expiresAt < now) this.challenges.delete(key);
    }
  }

  async generateEnrollmentOptions(
    userId: string,
    userName: string,
    excludeCredentialIds: string[] = []
  ) {
    this.cleanExpired();
    const options = await generateRegistrationOptions({
      rpID: this.config.rpId,
      rpName: this.config.rpName,
      userID: new TextEncoder().encode(userId),
      userName,
      userDisplayName: userName,
      attestationType: 'none',
      authenticatorSelection: {
        residentKey: 'preferred',
        userVerification: 'required',
      },
      excludeCredentials: excludeCredentialIds.map((id) => ({ id })),
    });

    this.challenges.set(`enroll:${userId}`, {
      challenge: options.challenge,
      userId,
      expiresAt: Date.now() + CHALLENGE_TTL_MS,
    });

    return options;
  }

  async verifyEnrollment(
    userId: string,
    response: RegistrationResponseJSON
  ) {
    this.cleanExpired();
    const entry = this.challenges.get(`enroll:${userId}`);
    if (!entry) throw new Error('Enrollment challenge not found or expired');
    this.challenges.delete(`enroll:${userId}`);

    const verification = await verifyRegistrationResponse({
      response,
      expectedChallenge: entry.challenge,
      expectedOrigin: this.config.origin,
      expectedRPID: this.config.rpId,
      requireUserVerification: true,
    });

    if (!verification.verified || !verification.registrationInfo) {
      throw new Error('Passkey enrollment verification failed');
    }

    const { credential } = verification.registrationInfo;
    return {
      credentialId: credential.id,
      publicKey: Buffer.from(credential.publicKey).toString('base64'),
      counter: credential.counter,
      transports: response.response.transports ?? [],
    };
  }

  async generateAuthOptions(
    userId: string,
    allowCredentialIds: string[]
  ) {
    this.cleanExpired();
    const options = await generateAuthenticationOptions({
      rpID: this.config.rpId,
      userVerification: 'required',
      allowCredentials: allowCredentialIds.map((id) => ({ id })),
    });

    this.challenges.set(`auth:${userId}`, {
      challenge: options.challenge,
      userId,
      expiresAt: Date.now() + CHALLENGE_TTL_MS,
    });

    return options;
  }

  /**
   * Step-up flow: issues a fresh passkey challenge for a user who is
   * already signed in, to gate a sensitive action such as share-link
   * creation or token reset. The `purpose` binds the challenge to a
   * specific action so a challenge for "share" cannot be replayed
   * against "token_reset".
   */
  async generateStepUpOptions(
    userId: string,
    purpose: string,
    allowCredentialIds: string[]
  ) {
    this.cleanExpired();
    const options = await generateAuthenticationOptions({
      rpID: this.config.rpId,
      userVerification: 'required',
      allowCredentials: allowCredentialIds.map((id) => ({ id })),
    });

    this.challenges.set(`stepup:${purpose}:${userId}`, {
      challenge: options.challenge,
      userId,
      expiresAt: Date.now() + CHALLENGE_TTL_MS,
    });

    return options;
  }

  async verifyStepUp(
    userId: string,
    purpose: string,
    response: AuthenticationResponseJSON,
    storedCredential: {
      id: string;
      publicKey: string;
      counter: number;
    }
  ) {
    this.cleanExpired();
    const key = `stepup:${purpose}:${userId}`;
    const entry = this.challenges.get(key);
    if (!entry) throw new Error('Step-up challenge not found or expired');
    this.challenges.delete(key);

    const verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge: entry.challenge,
      expectedOrigin: this.config.origin,
      expectedRPID: this.config.rpId,
      credential: {
        id: storedCredential.id,
        publicKey: new Uint8Array(Buffer.from(storedCredential.publicKey, 'base64')),
        counter: storedCredential.counter,
      },
      requireUserVerification: true,
    });

    if (!verification.verified) {
      throw new Error('Step-up passkey verification failed');
    }

    return { newCounter: verification.authenticationInfo.newCounter };
  }

  async verifyAuth(
    userId: string,
    response: AuthenticationResponseJSON,
    storedCredential: {
      id: string;
      publicKey: string; // base64 encoded
      counter: number;
    }
  ) {
    this.cleanExpired();
    const entry = this.challenges.get(`auth:${userId}`);
    if (!entry) throw new Error('Auth challenge not found or expired');
    this.challenges.delete(`auth:${userId}`);

    const verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge: entry.challenge,
      expectedOrigin: this.config.origin,
      expectedRPID: this.config.rpId,
      credential: {
        id: storedCredential.id,
        publicKey: new Uint8Array(Buffer.from(storedCredential.publicKey, 'base64')),
        counter: storedCredential.counter,
      },
      requireUserVerification: true,
    });

    if (!verification.verified) {
      throw new Error('Passkey auth verification failed');
    }

    return {
      newCounter: verification.authenticationInfo.newCounter,
    };
  }
}
