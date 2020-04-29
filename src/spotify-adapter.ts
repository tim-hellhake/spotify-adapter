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


class SpotifyProperty extends Property {
  constructor(private device: Device, name: string, private setValueHandler: (value: any) => Promise<any>, propDescr: any) {
    super(device, name, propDescr);
  }

  updateValue(value: any) {
    this.setCachedValue(value);
    this.device.notifyPropertyChanged(this);
  }

  setValue(value: any): Promise<void> {
    return new Promise((resolve, reject) => {
      console.log(`Setting ${this.name} to ${value}`);
      this.setValueHandler(value)
        .then((updatedValue: any) => {
          this.setCachedValue(updatedValue);
          resolve(updatedValue);
          this.device.notifyPropertyChanged(this);
        })
        .catch((err: any) => reject(err));
    });
  }
}

class SpotifyDevice extends Device {
  private spotifyApi = new SpotifyWebApi();
  private spotifyActions: { [key: string]: () => void } = {};
  private state?: SpotifyProperty;
  private cover?: SpotifyProperty;
  private callOpts: { device_id?: string } = {};
  private config: any;

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

    this.initStateProperty();
    this.initAlbumCoverProperty();
    this.initActions();
    this.initSpotify();
  }

  async initSpotify() {
    const db = new Database(this.manifest.name);
    db.open()
      .then(async () => {
        const config = await db.loadConfig();
        if (config.clientID) {
          this.spotifyApi.setCredentials({
            clientId: config.clientID,
            clientSecret: config.clientSecret,
            redirectUri: config.redirectURI || 'https://ppacher.github.io/spotify-auth-callback'
          });

          if (config.accessToken) {
            config.url = '';
            db.saveConfig(config);

            if (config.authorized) {
              console.log(`Refresh-Token: ${config.refreshToken}`);
              this.spotifyApi.setAccessToken(config.accessToken);
              this.spotifyApi.setRefreshToken(config.refreshToken);

              if (this.spotifyApi.getRefreshToken()) {
                this.refresh(db, config);
              } else {
                console.log(`No refresh token available`);
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
      });
  }

  initAuthUrl(db: Database, config: any) {
    const scopes = ['user-read-playback-state', 'user-modify-playback-state'];
    const url = this.spotifyApi.createAuthorizeURL(scopes, '');

    config.url = url;
    config.authorized = false;
    config.refreshToken = '';

    db.saveConfig(config);
  }

  authorize(db: Database, config: any) {
    request.post({
      url: 'https://accounts.spotify.com/api/token',
      method: 'POST',
      form: {
        grant_type: 'authorization_code',
        code: config.accessToken,
        redirect_uri: this.config.redirectURI || 'https://ppacher.at/callback',
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

      console.log(config);

      db.saveConfig(config);

      this.spotifyApi.setAccessToken(data.access_token);
      this.spotifyApi.setRefreshToken(data.refresh_token);

      this.updateState();
    });
  }

  refresh(db: Database, config: any) {
    this.spotifyApi.refreshAccessToken()
      .then((data) => {
        console.log(`Refreshed access token. Expires in ${data.body.expires_in}`);

        this.spotifyApi.setAccessToken(data.body.access_token);
        config.accessToken = data.body.access_token;
        if ((<any>data.body).refresh_token) {
          console.log(`Refreshed refresh token`);
          this.spotifyApi.setRefreshToken((<any>data.body).refresh_token);
          config.refreshToken = (<any>data.body).refresh_token;
        }

        db.saveConfig(config);
        this.updateState();
      })
      .catch((err) => console.error(err));
  }

  schedulePolling() {
    const interval = (this.config.interval || 60) * 1000;
    setTimeout(() => this.updateState(), interval);
  }

  updateState() {
    this.spotifyApi.getMyCurrentPlaybackState()
      .then((response) => {
        if (response.statusCode == 204) {
          this.state?.updateValue(false);
        } else if (response.statusCode === 200) {
          if (this.config.deviceID) {
            this.state?.updateValue(response.body.device.id === this.config.deviceID &&
              response.body.is_playing);
          } else {
            this.state?.updateValue(response.body.is_playing);
          }

          if (response.body.item && response.body.item.album && response.body.item.album.images) {
            this.cover?.updateValue(response.body.item.album.images[0].url);
          }
        }

        this.schedulePolling();
      }).catch((err) => console.error(err));
  }

  initStateProperty() {
    this.state = new SpotifyProperty(this, 'state', (value) => {
      if (value) {
        return this.spotifyApi.play(this.callOpts)
          .then(() => value);
      }

      return this.spotifyApi.pause(this.callOpts)
        .then(() => value);
    }, {
      title: 'State',
      '@type': 'OnOffProperty',
      type: 'boolean',
    });

    this.properties.set('state', this.state);
  }

  initAlbumCoverProperty() {
    this.cover = new SpotifyProperty(this, 'albumCover', () => Promise.reject('readOnly'), {
      title: 'Album Cover',
      type: 'string',
      readOnly: true,
    });

    this.properties.set('albumCover', this.cover);
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
