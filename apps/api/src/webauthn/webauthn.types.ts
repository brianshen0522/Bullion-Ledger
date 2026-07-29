import type {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  GenerateRegistrationOptionsOpts,
  VerifyAuthenticationResponseOpts,
  VerifyRegistrationResponseOpts,
} from '@simplewebauthn/server';

/**
 * WebAuthn wire types.
 *
 * `@simplewebauthn/server` re-exports these from `@simplewebauthn/types`, which
 * is only a transitive dependency here. Deriving them from the server package's
 * own public signatures keeps the dependency graph unchanged while staying
 * automatically correct: if the library's contract changes, these break at
 * compile time instead of drifting.
 */
export type RegistrationResponseJSON = VerifyRegistrationResponseOpts['response'];

export type AuthenticationResponseJSON = VerifyAuthenticationResponseOpts['response'];

export type PublicKeyCredentialCreationOptionsJSON = Awaited<
  ReturnType<typeof generateRegistrationOptions>
>;

export type PublicKeyCredentialRequestOptionsJSON = Awaited<
  ReturnType<typeof generateAuthenticationOptions>
>;

export type AuthenticatorTransportFuture = NonNullable<
  NonNullable<GenerateRegistrationOptionsOpts['excludeCredentials']>[number]['transports']
>[number];
