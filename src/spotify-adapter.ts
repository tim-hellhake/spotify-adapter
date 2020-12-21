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
  Property,
  AddonManager,
  Manifest,
} from 'gateway-addon';

import request from 'request';

import SpotifyWebApi from 'spotify-web-api-node';

import {homedir} from 'os';

import {join} from 'path';

import mkdirp from 'mkdirp';

import fetch from 'node-fetch';

import {writeFile} from 'fs';

class SpotifyProperty extends Property {
  constructor(
    private device: Device,
    name: string,
    private _setValueHandler: (_value: unknown) => Promise<void>,
    propDescr: unknown) {
    super(device, name, propDescr);
  }

  updateValue(value: unknown) {
    this.setCachedValue(value);
    this.device.notifyPropertyChanged(this);
  }

  async setValue(value: unknown): Promise<void> {
    console.log(`Setting ${this.name} to ${value}`);
    await this._setValueHandler(value);
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

  private track?: SpotifyProperty;

  private album?: SpotifyProperty;

  private artist?: SpotifyProperty;

  private volume?: SpotifyProperty;

  private position?: SpotifyProperty;

  private repeat?: SpotifyProperty;

  private shuffle?: SpotifyProperty;

  private callOpts: { device_id?: string } = {};

  private config:
  Record<string, string | boolean | number | Record<string, string>>;

  private mediaPath: string;

  private lastAlbumUrl?: string;

  private lastDuration?: number;

  constructor(private adapter: Adapter, private manifest: Manifest) {
    super(adapter, manifest.display_name);

    this['@context'] = 'https://iot.mozilla.org/schemas/';
    this.title = manifest.display_name;
    this['@type'] = ['OnOffSwitch'];
    this.description = manifest.display_name;
    this.config = manifest.moziot.config;

    this.callOpts = {};

    if (this.config.deviceID) {
      this.callOpts.device_id = <string> this.config.deviceID;
    }

    const baseDir =
    process.env.MOZIOT_HOME || join(homedir(), '.mozilla-iot') || '';
    this.mediaPath = join(baseDir, MEDIA_DIR, ADAPTER_DIR);

    this.initStateProperty();
    this.initAlbumDirectory();
    this.initPlaybackProperties();
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
        redirectUri:
        config.redirectURI || 'https://ppacher.github.io/spotify-auth-callback',
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
        // we don't have an access/refresh token yet.
        // Create a new authorization URL,
        // place it in the authorizationCode field and wait for the user
        // to follow the instructions
        this.initAuthUrl(db, config);
      }
    } else if (this.config.accessToken) {
      this.spotifyApi.setAccessToken(<string> this.config.accessToken);
    }
  }

  initAuthUrl(db: Database, config: Record<string, string | boolean>) {
    console.log('Creating authorize url for client');

    const scopes = ['user-read-playback-state', 'user-modify-playback-state'];
    const url = this.spotifyApi.createAuthorizeURL(scopes, '');

    config.url = url;
    config.authorized = false;
    config.refreshToken = '';

    db.saveConfig(config);
  }

  authorize(db: Database, config: Record<string, string | boolean>) {
    console.log('Authorizing client by authorization code');

    request.post({
      url: 'https://accounts.spotify.com/api/token',
      method: 'POST',
      form: {
        grant_type: 'authorization_code',
        code: config.accessToken,
        redirect_uri:
        this.config.redirectURI ||
        'https://ppacher.github.io/spotify-auth-callback',
        client_id: this.config.clientID,
        client_secret: this.config.clientSecret,
      },
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

  async refresh(db: Database, config: Record<string, string>) {
    console.log('Refreshing access token');

    const data = await this.spotifyApi.refreshAccessToken();

    console.log(`Refreshed access token, expires in ${data.body.expires_in}`);

    this.spotifyApi.setAccessToken(data.body.access_token);
    config.accessToken = data.body.access_token;

    db.saveConfig(config);
    this.updateState();
  }

  schedulePolling() {
    const interval = (<number> this.config.interval || 60) * 1000;
    setInterval(() => this.updateState(), interval);
  }

  async updateState() {
    const response = await this.spotifyApi.getMyCurrentPlaybackState();
    const playback = response?.body;

    if (response.statusCode == 204) {
      this.state?.updateValue(false);
      this.track?.setCachedValueAndNotify('');
      this.album?.setCachedValueAndNotify('');
      this.artist?.setCachedValueAndNotify('');
    } else if (response.statusCode === 200) {
      if (this.config.deviceID) {
        this.state?.updateValue(playback?.device.id === this.config.deviceID &&
          playback?.is_playing);
      } else {
        this.state?.updateValue(playback?.is_playing);
      }

      const images = playback?.item?.album?.images;

      if (images && images.length > 0) {
        this.updateAlbumCoverProperty(images[0].url);
      }

      this.track?.setCachedValueAndNotify(playback?.item?.name);
      this.album?.setCachedValueAndNotify(playback?.item?.album?.name);

      const artists = playback?.item?.album?.artists;

      if (artists && artists.length > 0) {
        this.artist?.setCachedValueAndNotify(artists.map((x) => x.name)
          .join(', '));
      }

      this.volume?.setCachedValueAndNotify(playback?.device?.volume_percent);

      const duration_ms = playback?.item?.duration_ms;

      if (this.position && duration_ms && this.lastDuration != duration_ms) {
        this.lastDuration = duration_ms;
        this.position.maximum = duration_ms / 1000;
        this.adapter.handleDeviceAdded(this);
      }

      const progress_ms = playback?.progress_ms;

      if (progress_ms) {
        this.position?.setCachedValueAndNotify(progress_ms / 1000);
      }

      this?.repeat?.setCachedValueAndNotify(playback?.repeat_state);
      this?.shuffle?.setCachedValueAndNotify(playback?.shuffle_state);
    }
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

  initPlaybackProperties() {
    this.cover = new SpotifyProperty(
      this, 'albumCover', () => Promise.reject('readOnly'), {
        '@type': 'ImageProperty',
        title: 'Album Cover',
        type: 'string',
        readOnly: true,
        links: [
          {
            mediaType: 'image/jpeg',
            href: `/${MEDIA_DIR}/${ADAPTER_DIR}/${this.id}/${ALBUM_FILE_NAME}`,
            rel: 'alternate',
          },
        ],
      });

    this.properties.set('albumCover', this.cover);

    this.track = new SpotifyProperty(
      this, 'track', () => Promise.reject('readOnly'), {
        title: 'Track',
        type: 'string',
        readOnly: true,
      });

    this.properties.set('track', this.track);

    this.album = new SpotifyProperty(
      this, 'album', () => Promise.reject('readOnly'), {
        title: 'Album',
        type: 'string',
        readOnly: true,
      });

    this.properties.set('album', this.album);

    this.artist = new SpotifyProperty(
      this, 'artist', () => Promise.reject('readOnly'), {
        title: 'Artist',
        type: 'string',
        readOnly: true,
      });

    this.properties.set('artist', this.artist);


    this.volume = new SpotifyProperty(this, 'volume', async (value) => {
      await this.spotifyApi.setVolume(<number>value);
    }, {
      '@type': 'LevelProperty',
      minimum: 0,
      maximum: 100,
      title: 'Volume',
      type: 'number',
    });

    this.properties.set('volume', this.volume);

    this.position = new SpotifyProperty(this, 'position', async (value) => {
      await this.spotifyApi.seek(<number>value * 1000);
    }, {
      '@type': 'LevelProperty',
      minimum: 0,
      maximum: 100,
      title: 'Position',
      type: 'number',
    });

    this.properties.set('position', this.position);

    this.repeat = new SpotifyProperty(this, 'repeat', async (value) => {
      await this.spotifyApi.setRepeat(
        {state: <'off' | 'context' | 'track'>value});
    }, {
      title: 'Repeat',
      type: 'string',
      enum: ['off', 'context', 'track'],
    });

    this.properties.set('repeat', this.repeat);

    this.shuffle = new SpotifyProperty(this, 'shuffle', async (value) => {
      await this.spotifyApi.setShuffle({state: <boolean>value});
    }, {
      title: 'Shuffle',
      type: 'boolean',
    });

    this.properties.set('shuffle', this.shuffle);
  }

  async updateAlbumCoverProperty(url: string) {
    const coverFilePath = join(this.mediaPath, this.id, ALBUM_FILE_NAME);

    if (url != this.lastAlbumUrl) {
      const response = await fetch(url);
      const blob = await response.buffer();

      await new Promise<void>((resolve, reject) => {
        writeFile(coverFilePath, blob, (e) => {
          if (e) {
            reject(e);
          } else {
            this.lastAlbumUrl = url;
            resolve();
          }
        });
      });
    }
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

  addSpotifyAction(name: string, description: unknown, apiCall: () => void) {
    this.spotifyActions[name] = apiCall;
    this.addAction(name, description);
  }

  async performAction(
    action:{name: string, start: () => void, finish: () => void}) {
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
  constructor(addonManager: AddonManager, manifest: Manifest) {
    super(addonManager, SpotifyAdapter.name, manifest.name);

    addonManager.addAdapter(this);
    const device = new SpotifyDevice(this, manifest);
    this.handleDeviceAdded(device);
    device.schedulePolling();
  }
}
