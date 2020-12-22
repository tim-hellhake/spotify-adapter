/**
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.*
 */

'use strict';

import {
  Adapter,
  Device,
  Property,
  AddonManagerProxy,
  Action,
} from 'gateway-addon';

import SpotifyWebApi from 'spotify-web-api-node';

import {homedir} from 'os';

import {join} from 'path';

import mkdirp from 'mkdirp';

import fetch from 'node-fetch';

import {writeFile} from 'fs';

import {Action as ActionSchema,
  Link,
  Property as PropertySchema,
  PropertyValue} from 'gateway-addon/src/schema';

import {TokenProvider} from './token-provider';

export interface Manifest {
  name: string,
  display_name: string,
  moziot: {
    config: Record<string, string>
  }
}

class SpotifyProperty<T extends PropertyValue> extends Property<T> {
  constructor(
    device: Device,
    name: string,
    private _setValueHandler: (_value: unknown) => Promise<void>,
    propDescr: PropertySchema) {
    super(device, name, propDescr);
  }

  updateValue(value: T) {
    this.setCachedValue(value);
    this.getDevice().notifyPropertyChanged(this);
  }

  async setValue(value: T): Promise<T> {
    console.log(`Setting ${this.getName} to ${value}`);
    await this._setValueHandler(value);
    return super.setValue(value);
  }
}

const MEDIA_DIR = 'media';
const ADAPTER_DIR = 'spotify';
const ALBUM_FILE_NAME = 'album.jpg';

class SpotifyDevice extends Device {
  private spotifyActions: { [key: string]: () => void } = {};

  private state?: SpotifyProperty<boolean>;

  private cover?: SpotifyProperty<string>;

  private track?: SpotifyProperty<string>;

  private album?: SpotifyProperty<string>;

  private artist?: SpotifyProperty<string>;

  private volume?: SpotifyProperty<number>;

  private position?: SpotifyProperty<number>;

  private repeat?: SpotifyProperty<'off' | 'track' | 'context'>;

  private shuffle?: SpotifyProperty<boolean>;

  private callOpts: { device_id?: string } = {};

  private config:
  Record<string, string | boolean | number | Record<string, string>>;

  private mediaPath: string;

  private lastAlbumUrl?: string;

  private lastDuration?: number;

  constructor(
    adapter: Adapter,
    manifest: Manifest,
    // eslint-disable-next-line no-unused-vars
    private spotifyApi: SpotifyWebApi) {
    super(adapter, manifest.display_name);

    this['@context'] = 'https://iot.mozilla.org/schemas/';
    this.setTitle(manifest.display_name);
    this['@type'] = ['OnOffSwitch'];
    this.setDescription(manifest.display_name);
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
  }

  schedulePolling() {
    const interval = (<number> this.config.interval || 60) * 1000;
    console.log(`Refreshing state every ${interval} ms`);
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

      this.track?.setCachedValueAndNotify(playback?.item?.name ?? '');
      this.album?.setCachedValueAndNotify(playback?.item?.album?.name ?? '');

      const artists = playback?.item?.album?.artists;

      if (artists && artists.length > 0) {
        this.artist?.setCachedValueAndNotify(artists.map((x) => x.name)
          .join(', '));
      }

      this.volume?.setCachedValueAndNotify(
        playback?.device?.volume_percent ?? 0);

      const duration_ms = playback?.item?.duration_ms;

      if (this.position && duration_ms && this.lastDuration != duration_ms) {
        this.lastDuration = duration_ms;
        this.position.setMaximum(duration_ms / 1000);
        this.getAdapter().handleDeviceAdded(this);
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

    this.addProperty(this.state);
  }

  async initAlbumDirectory() {
    console.log(
      `Creating media directory ${join(this.mediaPath, this.getId())}`);
    await mkdirp(join(this.mediaPath, this.getId()));
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
            href:
            `/${MEDIA_DIR}/${ADAPTER_DIR}/${this.getId()}/${ALBUM_FILE_NAME}`,
            rel: 'alternate',
          },
        ],
      });

    this.addProperty(this.cover);

    this.track = new SpotifyProperty(
      this, 'track', () => Promise.reject('readOnly'), {
        title: 'Track',
        type: 'string',
        readOnly: true,
      });

    this.addProperty(this.track);

    this.album = new SpotifyProperty(
      this, 'album', () => Promise.reject('readOnly'), {
        title: 'Album',
        type: 'string',
        readOnly: true,
      });

    this.addProperty(this.album);

    this.artist = new SpotifyProperty(
      this, 'artist', () => Promise.reject('readOnly'), {
        title: 'Artist',
        type: 'string',
        readOnly: true,
      });

    this.addProperty(this.artist);


    this.volume = new SpotifyProperty(this, 'volume', async (value) => {
      await this.spotifyApi.setVolume(<number>value);
    }, {
      '@type': 'LevelProperty',
      minimum: 0,
      maximum: 100,
      title: 'Volume',
      type: 'number',
    });

    this.addProperty(this.volume);

    this.position = new SpotifyProperty(this, 'position', async (value) => {
      await this.spotifyApi.seek(<number>value * 1000);
    }, {
      '@type': 'LevelProperty',
      minimum: 0,
      maximum: 100,
      title: 'Position',
      type: 'number',
    });

    this.addProperty(this.position);

    this.repeat = new SpotifyProperty(this, 'repeat', async (value) => {
      await this.spotifyApi.setRepeat(
        {state: <'off' | 'context' | 'track'>value});
    }, {
      title: 'Repeat',
      type: 'string',
      enum: ['off', 'context', 'track'],
    });

    this.addProperty(this.repeat);

    this.shuffle = new SpotifyProperty(this, 'shuffle', async (value) => {
      await this.spotifyApi.setShuffle({state: <boolean>value});
    }, {
      title: 'Shuffle',
      type: 'boolean',
    });

    this.addProperty(this.shuffle);
  }

  async updateAlbumCoverProperty(url: string) {
    const coverFilePath = join(this.mediaPath, this.getId(), ALBUM_FILE_NAME);

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

    (<{links: Link[]}> <unknown> this).links = [
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

  addSpotifyAction(
    name: string, description: ActionSchema, apiCall: () => void) {
    this.spotifyActions[name] = apiCall;
    this.addAction(name, description);
  }

  async performAction(action: Action)
    : Promise<void> {
    const name = action.asDict().name;
    action.start();

    const spotifyAction = this.spotifyActions[name];

    if (spotifyAction) {
      console.log(`Execute ${name} action`);
      spotifyAction();
    } else {
      console.warn(`Unknown action ${name}`);
    }

    action.finish();
  }
}

export class SpotifyAdapter extends Adapter {
  constructor(
    addonManager: AddonManagerProxy,
    manifest: Manifest,
    tokenProvider: TokenProvider) {
    super(addonManager, SpotifyAdapter.name, manifest.name);

    addonManager.addAdapter(this);
    const spotifyApi = tokenProvider.getManagedSpotifyApi();
    const device = new SpotifyDevice(this, manifest, spotifyApi);
    this.handleDeviceAdded(device);
    device.schedulePolling();
  }
}
