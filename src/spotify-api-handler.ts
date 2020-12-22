'use strict';

import {AddonManagerProxy,
  APIHandler,
  APIRequest,
  APIResponse} from 'gateway-addon';
import {TokenProvider} from './token-provider';

interface AuthorizeUrlInput {
  clientId: string,
  clientSecret: string,
  redirectUri: string
}

interface AuthorizeInput {
  code: string
}

export class SpotifyApiHandler extends APIHandler {
  constructor(
    addonManager: AddonManagerProxy,
  // eslint-disable-next-line no-unused-vars
  private tokenProvider: TokenProvider) {
    super(addonManager, 'spotify-adapter');
    addonManager.addAPIHandler(this);
  }

  async handleRequest(request: APIRequest): Promise<APIResponse> {
    switch (request.getPath()) {
      case '/authorize-url': {
        const {
          clientId,
          clientSecret,
          redirectUri,
        } = <AuthorizeUrlInput><unknown>request.getBody();

        const authorizeUrl =
        await this.tokenProvider.createAuthorizeURL(
          clientId, clientSecret, redirectUri);

        return new APIResponse({
          status: 200,
          contentType: 'application/json',
          content: JSON.stringify({authorizeUrl}),
        });
      }
      case '/authorize': {
        const {
          code,
        } = <AuthorizeInput><unknown>request.getBody();

        await this.tokenProvider.authorize(code);

        const accessToken = this.tokenProvider
          .getManagedSpotifyApi()
          .getAccessToken();

        return new APIResponse({
          status: 200,
          contentType: 'application/json',
          content: JSON.stringify({accessToken}),
        });
      }
      case '/status': {
        const spotifyApi = this.tokenProvider
          .getManagedSpotifyApi();

        const clientId = spotifyApi.getClientId();
        const clientSecret = spotifyApi.getClientSecret();
        const accessToken = spotifyApi.getAccessToken();
        const refreshToken = spotifyApi.getRefreshToken();

        return new APIResponse({
          status: 200,
          contentType: 'application/json',
          content: JSON.stringify({
            clientId,
            clientSecret,
            accessToken,
            refreshToken,
          }),
        });
      }
      case '/reset': {
        await this.tokenProvider.reset();

        return new APIResponse({
          status: 204,
          contentType: '',
          content: '',
        });
      }
      default: {
        return new APIResponse({
          status: 404,
          contentType: '',
          content: '',
        });
      }
    }
  }
}
