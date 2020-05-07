/**
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.*
 */

'use strict';

import {
  Adapter,
  Device,
  Database,
  Property
} from 'gateway-addon';

import request from 'request';

import SpotifyWebApi from 'spotify-web-api-node';

import { homedir } from 'os';

import { join } from 'path';

import mkdirp from 'mkdirp';

import fetch from 'node-fetch';

import { writeFile } from 'fs';

class SpotifyProperty extends Property {
  constructor(private device: Device, name: string, private setValueHandler: (value: any) => Promise<void>, propDescr: any) {
    super(device, name, propDescr);
  }

  updateValue(value: any) {
    this.setCachedValue(value);
    this.device.notifyPropertyChanged(this);
  }

  async setValue(value: any): Promise<void> {
    console.log(`Setting ${this.name} to ${value}`);
    await this.setValueHandler(value);
    super.setValue(value);
  }
}

const MEDIA_DIR = 'media';
const ADAPTER_DIR = 'spotify';
const ALBUM_FILE_NAME = 'album.jpg';

class SpotifyDevice extends Device {
  private spotifyApi = new SpotifyWebApi();
  private spotifyActions: { [key: string]: () => void } = {};
  private state?: SpotifyProperty;
  private cover?: SpotifyProperty;
  private callOpts: { device_id?: string } = {};
  private config: any;
  private mediaPath: string;

  constructor(adapter: Adapter, private manifest: any) {
    super(adapter, manifest.display_name);

    this['@context'] = 'https://iot.mozilla.org/schemas/';
    this.title = manifest.display_name;
    this['@type'] = manifest['@type'] || ['OnOffSwitch'];
    this.description = manifest.description;
    this.config = manifest.moziot.config;

    this.callOpts = {};

    if (this.config.deviceID) {
      this.callOpts.device_id = this.config.deviceID;
    }

    const baseDir = process.env.MOZIOT_HOME || join(homedir(), '.mozilla-iot') || '';
    this.mediaPath = join(baseDir, MEDIA_DIR, ADAPTER_DIR);

    this.initStateProperty();
    this.initAlbumDirectory();
    this.initAlbumCoverProperty();
    this.initActions();
    this.initSpotify();
  }

  async initSpotify() {
    console.log('Initializing spotify client');
    const db = new Database(this.manifest.name);
    await db.open();
    const config = await db.loadConfig();

    if (config.clientID) {
      console.log('Found client id');

      this.spotifyApi.setCredentials({
        clientId: config.clientID,
        clientSecret: config.clientSecret,
        redirectUri: config.redirectURI || 'https://ppacher.github.io/spotify-auth-callback'
      });

      if (config.accessToken) {
        console.log('Found access token');
        config.url = '';
        db.saveConfig(config);

        if (config.authorized) {
          console.log('Client is already authorized');
          this.spotifyApi.setAccessToken(config.accessToken);
          this.spotifyApi.setRefreshToken(config.refreshToken);

          if (this.spotifyApi.getRefreshToken()) {
            this.refresh(db, config);

            setInterval(() => this.refresh(db, config), 45 * 60 * 1000);
          } else {
            console.log('No refresh token available');
          }
        } else {
          this.authorize(db, config);
        }
      }

      if (!config.accessToken) {
        // we don't have an access/refresh token yet. Create a new authorization URL,
        // place it in the authorizationCode field and wait for the user
        // to follow the instructions
        this.initAuthUrl(db, config);
      }
    } else if (this.config.accessToken) {
      this.spotifyApi.setAccessToken(this.config.accessToken);
    }
  }

  initAuthUrl(db: Database, config: any) {
    console.log('Creating authorize url for client');

    const scopes = ['user-read-playback-state', 'user-modify-playback-state'];
    const url = this.spotifyApi.createAuthorizeURL(scopes, '');

    config.url = url;
    config.authorized = false;
    config.refreshToken = '';

    db.saveConfig(config);
  }

  authorize(db: Database, config: any) {
    console.log('Authorizing client by authorization code');

    request.post({
      url: 'https://accounts.spotify.com/api/token',
      method: 'POST',
      form: {
        grant_type: 'authorization_code',
        code: config.accessToken,
        redirect_uri: this.config.redirectURI || 'https://ppacher.github.io/spotify-auth-callback',
        client_id: this.config.clientID,
        client_secret: this.config.clientSecret,
      }
    }, (err, response, body) => {
      if (err) {
        console.error(err);
        return;
      }
      if (response.statusCode !== 200) {
        console.error(body);
        return;
      }

      const data = JSON.parse(body);

      config.accessToken = data.access_token;
      config.refreshToken = data.refresh_token;
      config.authorized = true;

      console.log('Client is now authorized');

      db.saveConfig(config);

      this.spotifyApi.setAccessToken(data.access_token);
      this.spotifyApi.setRefreshToken(data.refresh_token);

      this.updateState();
    });
  }

  async refresh(db: Database, config: any) {
    console.log('Refreshing access token');

    const data = await this.spotifyApi.refreshAccessToken();

    console.log(`Refreshed access token, expires in ${data.body.expires_in}`);

    this.spotifyApi.setAccessToken(data.body.access_token);
    config.accessToken = data.body.access_token;

    db.saveConfig(config);
    this.updateState();
  }

  schedulePolling() {
    const interval = (this.config.interval || 60) * 1000;
    setTimeout(() => this.updateState(), interval);
  }

  async updateState() {
    const response = await this.spotifyApi.getMyCurrentPlaybackState()

    if (response.statusCode == 204) {
      this.state?.updateValue(false);
    } else if (response.statusCode === 200) {
      if (this.config.deviceID) {
        this.state?.updateValue(response.body.device.id === this.config.deviceID &&
          response.body.is_playing);
      } else {
        this.state?.updateValue(response.body.is_playing);
      }

      const images = response.body?.item?.album?.images;

      if (images && images.length > 0) {
        this.updateAlbumCoverProperty(images[0].url);
      }
    }

    this.schedulePolling();
  }

  initStateProperty() {
    this.state = new SpotifyProperty(this, 'state', async (value) => {
      if (value) {
        await this.spotifyApi.play(this.callOpts);
      } else {
        await this.spotifyApi.pause(this.callOpts);
      }
    }, {
      title: 'State',
      '@type': 'OnOffProperty',
      type: 'boolean',
    });

    this.properties.set('state', this.state);
  }

  async initAlbumDirectory() {
    console.log(`Creating media directory ${join(this.mediaPath, this.id)}`);
    await mkdirp(join(this.mediaPath, this.id));
  }

  initAlbumCoverProperty() {
    this.cover = new SpotifyProperty(this, 'albumCover', () => Promise.reject('readOnly'), {
      '@type': 'ImageProperty',
      title: 'Album Cover',
      type: 'string',
      readOnly: true,
      links: [
        {
          mediaType: 'image/jpeg',
          href: `/${MEDIA_DIR}/${ADAPTER_DIR}/${this.id}/${ALBUM_FILE_NAME}`,
          rel: 'alternate'
        }
      ]
    });

    this.properties.set('albumCover', this.cover);
  }

  async updateAlbumCoverProperty(url: string) {
    const albumUrl = join(this.mediaPath, this.id, ALBUM_FILE_NAME);
    const response = await fetch(url);
    const blob = await response.buffer();

    await new Promise((resolve, reject) => {
      writeFile(albumUrl, blob, (e) => {
        if (e) {
          reject(e);
        }
        else {
          resolve();
        }
      });
    });
  }

  initActions() {
    this.addSpotifyAction('previous', {
      title: 'Previous',
      description: 'Skip to the previous track',
    }, () => this.spotifyApi.skipToPrevious());

    this.addSpotifyAction('next', {
      title: 'Next',
      description: 'Skip to the next track',
    }, () => this.spotifyApi.skipToNext());

    this.links = [
      {
        rel: 'alternate',
        mediaType: 'text/html',
        href: 'https://open.spotify.com',
      },
    ];

    this.addSpotifyAction('pause', {
      title: 'Pause',
      description: 'Pause playback',
    }, () => this.spotifyApi.pause(this.callOpts));

    this.addSpotifyAction('play', {
      title: 'Play',
      description: 'Start playback',
    }, () => this.spotifyApi.play(this.callOpts));
  }

  addSpotifyAction(name: string, description: any, apiCall: () => void) {
    this.spotifyActions[name] = apiCall;
    this.addAction(name, description);
  }

  async performAction(action: any) {
    action.start();

    const spotifyAction = this.spotifyActions[action.name];

    if (spotifyAction) {
      console.log(`Execute ${action.name} action`);
      spotifyAction();
    } else {
      console.warn(`Unknown action ${action}`);
    }

    action.finish();
  }
}

export class SpotifyAdapter extends Adapter {
  constructor(addonManager: any, manifest: any) {
    super(addonManager, SpotifyAdapter.name, manifest.name);

    addonManager.addAdapter(this);
    const device = new SpotifyDevice(this, manifest);
    this.handleDeviceAdded(device);
  }
}
