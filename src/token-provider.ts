/**
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.*
 */

'use strict';

import {Database} from 'gateway-addon';

import SpotifyWebApi from 'spotify-web-api-node';

export interface State {
  clientID?: string;
  clientSecret?: string;
  refreshToken?: string;
}

export class TokenProvider {
    private spotifyApi: SpotifyWebApi = new SpotifyWebApi();

    private interval?: NodeJS.Timeout;

    async init(): Promise<void> {
      await this.load();
      await this.refresh();
    }

    getManagedSpotifyApi(): SpotifyWebApi {
      return this.spotifyApi;
    }

    async createAuthorizeURL(
      clientId: string,
      clientSecret: string,
      redirectUri: string): Promise<string> {
      const scopes = ['user-read-playback-state', 'user-modify-playback-state'];

      this.spotifyApi.setClientId(clientId);
      this.spotifyApi.setClientSecret(clientSecret);
      this.spotifyApi.setRedirectURI(redirectUri);

      await this.save();

      return this.spotifyApi.createAuthorizeURL(scopes, '');
    }

    async authorize(code: string): Promise<void> {
      console.log('Exchanging access code with refresh token');

      const response = await this.spotifyApi.authorizationCodeGrant(code);

      const {
        refresh_token,
      } = response.body;

      this.spotifyApi.setRefreshToken(refresh_token);
      await this.save();
      await this.refresh();
    }

    async refresh(): Promise<void> {
      console.log('Refreshing access token');

      if (this.spotifyApi.getRefreshToken()) {
        const response = await this.spotifyApi.refreshAccessToken();

        const {
          access_token,
          expires_in,
        } = response.body;

        console.log('Updating manged spotify client');
        this.spotifyApi.setAccessToken(access_token);
        this.rearmRefreshInterval(expires_in - 60);
      } else {
        console.warn(`Cannot refresh access token, no refresh token present`);
      }
    }

    async reset(): Promise<void> {
      this.spotifyApi.setClientId('');
      this.spotifyApi.setClientSecret('');
      this.spotifyApi.setAccessToken('');
      this.spotifyApi.setRefreshToken('');
      await this.save();
    }

    private rearmRefreshInterval(seconds: number) {
      console.log(`Rearming refresh interval with ${seconds} seconds`);

      if (this.interval) {
        console.log('Clearing old refresh interval');
        clearInterval(this.interval);
      }

      this.interval = setInterval(() => {
        this.refresh();
      }, seconds * 1000);
    }

    async load(): Promise<void> {
      console.log('Loading token provider state');
      const db = new Database('spotify-adapter', '');
      await db.open();
      const {
        clientID,
        clientSecret,
        refreshToken,
      } = <State><unknown> await db.loadConfig();

      if (clientID) {
        this.spotifyApi.setClientId(clientID);
      } else {
        console.warn('No client id found');
      }


      if (clientSecret) {
        this.spotifyApi.setClientSecret(clientSecret);
      } else {
        console.warn('No client secret found');
      }


      if (refreshToken) {
        this.spotifyApi.setRefreshToken(refreshToken);
      } else {
        console.warn('No refresh token found');
      }

      db.close();
    }

    async save(): Promise<void> {
      console.log('Saving token provider state');
      const db = new Database('spotify-adapter', '');
      await db.open();
      const oldState = <State><unknown> await db.loadConfig();
      const state: State = {
        ...oldState,
        clientID: this.spotifyApi.getClientId(),
        clientSecret: this.spotifyApi.getClientSecret(),
        refreshToken: this.spotifyApi.getRefreshToken(),
      };
      await db.saveConfig(<Record<string, unknown>><unknown> state);
      db.close();
    }
}
