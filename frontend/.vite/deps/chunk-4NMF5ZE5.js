import {
  Amplify,
  AuthAction,
  DEFAULT_SERVICE_CLIENT_API_CONFIG,
  PasskeyError,
  PasskeyErrorCode,
  assertAuthTokens,
  assertCredentialIsPkcWithAuthenticatorAttestationResponse,
  assertPasskeyError,
  assertTokenProviderConfig,
  assertValidCredentialCreationOptions,
  cognitoUserPoolTransferHandler,
  composeServiceApi,
  createCognitoUserPoolEndpointResolver,
  createUserPoolDeserializer,
  createUserPoolSerializer,
  deserializeJsonToPkcCreationOptions,
  fetchAuthSession,
  getAuthUserAgentValue,
  getIsPasskeySupported,
  getRegionFromUserPoolId,
  handlePasskeyError,
  passkeyErrorMap,
  serializePkcWithAttestationToJson
} from "./chunk-SCD7Y2BU.js";

// node_modules/@aws-amplify/auth/dist/esm/client/utils/passkey/errors/handlePasskeyRegistrationError.mjs
var handlePasskeyRegistrationError = (err) => {
  if (err instanceof PasskeyError) {
    return err;
  }
  if (err instanceof Error) {
    if (err.name === "InvalidStateError") {
      const { message, recoverySuggestion } = passkeyErrorMap[PasskeyErrorCode.PasskeyAlreadyExists];
      return new PasskeyError({
        name: PasskeyErrorCode.PasskeyAlreadyExists,
        message,
        recoverySuggestion,
        underlyingError: err
      });
    }
    if (err.name === "NotAllowedError") {
      const { message, recoverySuggestion } = passkeyErrorMap[PasskeyErrorCode.PasskeyRegistrationCanceled];
      return new PasskeyError({
        name: PasskeyErrorCode.PasskeyRegistrationCanceled,
        message,
        recoverySuggestion,
        underlyingError: err
      });
    }
  }
  return handlePasskeyError(err);
};

// node_modules/@aws-amplify/auth/dist/esm/client/utils/passkey/registerPasskey.mjs
var registerPasskey = async (input) => {
  try {
    const isPasskeySupported = getIsPasskeySupported();
    assertPasskeyError(isPasskeySupported, PasskeyErrorCode.PasskeyNotSupported);
    const passkeyCreationOptions = deserializeJsonToPkcCreationOptions(input);
    const credential = await navigator.credentials.create({
      publicKey: passkeyCreationOptions
    });
    assertCredentialIsPkcWithAuthenticatorAttestationResponse(credential);
    return serializePkcWithAttestationToJson(credential);
  } catch (err) {
    throw handlePasskeyRegistrationError(err);
  }
};

// node_modules/@aws-amplify/auth/dist/esm/foundation/factories/serviceClients/cognitoIdentityProvider/createStartWebAuthnRegistrationClient.mjs
var createStartWebAuthnRegistrationClient = (config) => composeServiceApi(cognitoUserPoolTransferHandler, createUserPoolSerializer("StartWebAuthnRegistration"), createUserPoolDeserializer(), {
  ...DEFAULT_SERVICE_CLIENT_API_CONFIG,
  ...config
});

// node_modules/@aws-amplify/auth/dist/esm/foundation/factories/serviceClients/cognitoIdentityProvider/createCompleteWebAuthnRegistrationClient.mjs
var createCompleteWebAuthnRegistrationClient = (config) => composeServiceApi(cognitoUserPoolTransferHandler, createUserPoolSerializer("CompleteWebAuthnRegistration"), createUserPoolDeserializer(), {
  ...DEFAULT_SERVICE_CLIENT_API_CONFIG,
  ...config
});

// node_modules/@aws-amplify/auth/dist/esm/client/apis/associateWebAuthnCredential.mjs
async function associateWebAuthnCredential() {
  const authConfig = Amplify.getConfig().Auth?.Cognito;
  assertTokenProviderConfig(authConfig);
  const { userPoolEndpoint, userPoolId } = authConfig;
  const { tokens } = await fetchAuthSession();
  assertAuthTokens(tokens);
  const startWebAuthnRegistration = createStartWebAuthnRegistrationClient({
    endpointResolver: createCognitoUserPoolEndpointResolver({
      endpointOverride: userPoolEndpoint
    })
  });
  const { CredentialCreationOptions: credentialCreationOptions } = await startWebAuthnRegistration({
    region: getRegionFromUserPoolId(userPoolId),
    userAgentValue: getAuthUserAgentValue(AuthAction.StartWebAuthnRegistration)
  }, {
    AccessToken: tokens.accessToken.toString()
  });
  assertValidCredentialCreationOptions(credentialCreationOptions);
  const cred = await registerPasskey(credentialCreationOptions);
  const completeWebAuthnRegistration = createCompleteWebAuthnRegistrationClient({
    endpointResolver: createCognitoUserPoolEndpointResolver({
      endpointOverride: userPoolEndpoint
    })
  });
  await completeWebAuthnRegistration({
    region: getRegionFromUserPoolId(userPoolId),
    userAgentValue: getAuthUserAgentValue(AuthAction.CompleteWebAuthnRegistration)
  }, {
    AccessToken: tokens.accessToken.toString(),
    Credential: cred
  });
}

// node_modules/@aws-amplify/auth/dist/esm/foundation/factories/serviceClients/cognitoIdentityProvider/createListWebAuthnCredentialsClient.mjs
var createListWebAuthnCredentialsClient = (config) => composeServiceApi(cognitoUserPoolTransferHandler, createUserPoolSerializer("ListWebAuthnCredentials"), createUserPoolDeserializer(), {
  ...DEFAULT_SERVICE_CLIENT_API_CONFIG,
  ...config
});

// node_modules/@aws-amplify/auth/dist/esm/foundation/apis/listWebAuthnCredentials.mjs
async function listWebAuthnCredentials(amplify, input) {
  const authConfig = amplify.getConfig().Auth?.Cognito;
  assertTokenProviderConfig(authConfig);
  const { userPoolEndpoint, userPoolId } = authConfig;
  const { tokens } = await amplify.Auth.fetchAuthSession();
  assertAuthTokens(tokens);
  const listWebAuthnCredentialsResult = createListWebAuthnCredentialsClient({
    endpointResolver: createCognitoUserPoolEndpointResolver({
      endpointOverride: userPoolEndpoint
    })
  });
  const { Credentials: commandCredentials = [], NextToken: nextToken } = await listWebAuthnCredentialsResult({
    region: getRegionFromUserPoolId(userPoolId),
    userAgentValue: getAuthUserAgentValue(AuthAction.ListWebAuthnCredentials)
  }, {
    AccessToken: tokens.accessToken.toString(),
    MaxResults: input?.pageSize,
    NextToken: input?.nextToken
  });
  const credentials = commandCredentials.map((item) => ({
    credentialId: item.CredentialId,
    friendlyCredentialName: item.FriendlyCredentialName,
    relyingPartyId: item.RelyingPartyId,
    authenticatorAttachment: item.AuthenticatorAttachment,
    authenticatorTransports: item.AuthenticatorTransports,
    createdAt: item.CreatedAt ? new Date(item.CreatedAt * 1e3) : void 0
  }));
  return {
    credentials,
    nextToken
  };
}

// node_modules/@aws-amplify/auth/dist/esm/client/apis/listWebAuthnCredentials.mjs
async function listWebAuthnCredentials2(input) {
  return listWebAuthnCredentials(Amplify, input);
}

// node_modules/@aws-amplify/auth/dist/esm/foundation/factories/serviceClients/cognitoIdentityProvider/createDeleteWebAuthnCredentialClient.mjs
var createDeleteWebAuthnCredentialClient = (config) => composeServiceApi(cognitoUserPoolTransferHandler, createUserPoolSerializer("DeleteWebAuthnCredential"), createUserPoolDeserializer(), {
  ...DEFAULT_SERVICE_CLIENT_API_CONFIG,
  ...config
});

// node_modules/@aws-amplify/auth/dist/esm/foundation/apis/deleteWebAuthnCredential.mjs
async function deleteWebAuthnCredential(amplify, input) {
  const authConfig = amplify.getConfig().Auth?.Cognito;
  assertTokenProviderConfig(authConfig);
  const { userPoolEndpoint, userPoolId } = authConfig;
  const { tokens } = await amplify.Auth.fetchAuthSession();
  assertAuthTokens(tokens);
  const deleteWebAuthnCredentialResult = createDeleteWebAuthnCredentialClient({
    endpointResolver: createCognitoUserPoolEndpointResolver({
      endpointOverride: userPoolEndpoint
    })
  });
  await deleteWebAuthnCredentialResult({
    region: getRegionFromUserPoolId(userPoolId),
    userAgentValue: getAuthUserAgentValue(AuthAction.DeleteWebAuthnCredential)
  }, {
    AccessToken: tokens.accessToken.toString(),
    CredentialId: input.credentialId
  });
}

// node_modules/@aws-amplify/auth/dist/esm/client/apis/deleteWebAuthnCredential.mjs
async function deleteWebAuthnCredential2(input) {
  return deleteWebAuthnCredential(Amplify, input);
}

export {
  associateWebAuthnCredential,
  listWebAuthnCredentials2 as listWebAuthnCredentials,
  deleteWebAuthnCredential2 as deleteWebAuthnCredential
};
//# sourceMappingURL=chunk-4NMF5ZE5.js.map
